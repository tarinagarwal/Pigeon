"""Public (no-auth) free tool endpoints.

These routes are intentionally unauthenticated so marketing visitors can use
deliverability tools without signing up.  Rate-limit abuse protection is done
via short-lived TTL sessions (24h) stored in MongoDB.

Inbox Placement Test flow
─────────────────────────
1. POST /public/inbox-placement/start
   → picks one Gmail + one Outlook receiver from admin_db.warmup_receiver_accounts
   → stores a session doc with a short unique marker
   → returns receiver emails + marker tag the user must include in their subject

2. GET  /public/inbox-placement/{test_id}/check
   → looks up the session
   → searches inbox + spam on each receiver account for a subject containing the marker
   → returns placement per provider (inbox | spam | promotions | not_found)
"""

import asyncio
import logging
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/public")

# ──────────────────────────────────────────────────────────────────
# Module-level service handles (injected from server.py)
# ──────────────────────────────────────────────────────────────────

_admin_db: Any = None
_db: Any = None
_smtp_service: Any = None          # for _decrypt_password
_gmail_classify_fn: Any = None     # callable(refresh_token, client_id, client_secret, marker) → "inbox"|"spam"|"promotions"|"not_found"
_outlook_classify_fn: Any = None   # callable(refresh_token, marker) → "inbox"|"spam"|"not_found"


def init_public_tools(admin_db, db, smtp_service):
    global _admin_db, _db, _smtp_service
    _admin_db = admin_db
    _db = db
    _smtp_service = smtp_service


# ──────────────────────────────────────────────────────────────────
# Helpers: receiver-account classification
# ──────────────────────────────────────────────────────────────────

def _decrypt(value: str) -> str:
    if _smtp_service and value:
        return _smtp_service._decrypt_password(value)
    return value


async def _classify_gmail_receiver(receiver: Dict[str, Any], marker: str) -> str:
    """Search this Gmail receiver account for an email whose subject contains marker."""
    try:
        from services.gmail_oauth_receiver import (
            build_gmail_service,
            get_access_token_async as get_gmail_token,
        )

        refresh_token = _decrypt(receiver.get("gmail_refresh_token", ""))
        client_id = receiver.get("google_client_id", "")
        secret_enc = receiver.get("google_client_secret_encrypted", "")
        client_secret = _decrypt(secret_enc) if secret_enc else ""

        if not refresh_token or not client_id or not client_secret:
            return "not_found"

        access_token = await get_gmail_token(
            refresh_token, client_id, client_secret,
            scope="https://mail.google.com/",
        )
        svc = build_gmail_service(access_token, refresh_token, client_id, client_secret)

        # Search by subject tag — Gmail search supports subject: operator
        search_q = f'subject:"{marker}"'

        def _search(label: str) -> Optional[dict]:
            try:
                resp = svc.users().messages().list(
                    userId="me", q=f"{search_q} label:{label}", maxResults=5
                ).execute()
                msgs = resp.get("messages", [])
                return msgs[0] if msgs else None
            except Exception:
                return None

        results = await asyncio.to_thread(lambda: {
            "inbox": _search("inbox"),
            "spam": _search("spam"),
            "promotions": _search("category:promotions"),
        })

        if results["spam"]:
            return "spam"
        if results["promotions"]:
            return "promotions"
        if results["inbox"]:
            return "inbox"
        return "not_found"

    except Exception as exc:
        logger.warning("public inbox placement: Gmail classify error: %s", exc)
        return "error"


async def _classify_outlook_receiver(receiver: Dict[str, Any], marker: str) -> str:
    """Search this Outlook receiver account for an email whose subject contains marker."""
    try:
        from services.outlook_oauth_service import (
            get_access_token_async as get_outlook_token,
        )
        import aiohttp

        refresh_token = _decrypt(receiver.get("outlook_refresh_token", ""))
        if not refresh_token:
            return "not_found"

        access_token = await get_outlook_token(refresh_token)

        encoded_marker = marker.replace("'", "''")
        filter_q = f"contains(subject,'{encoded_marker}')"
        headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}

        async with aiohttp.ClientSession() as session:
            # Check inbox
            async with session.get(
                "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages",
                headers=headers,
                params={"$filter": filter_q, "$top": "5", "$select": "id,subject"},
            ) as r:
                data = await r.json()
                if data.get("value"):
                    return "inbox"

            # Check junk
            async with session.get(
                "https://graph.microsoft.com/v1.0/me/mailFolders/junkemail/messages",
                headers=headers,
                params={"$filter": filter_q, "$top": "5", "$select": "id,subject"},
            ) as r:
                data = await r.json()
                if data.get("value"):
                    return "spam"

        return "not_found"

    except Exception as exc:
        logger.warning("public inbox placement: Outlook classify error: %s", exc)
        return "error"


async def _classify_receiver(receiver: Dict[str, Any], marker: str) -> str:
    provider = (receiver.get("provider") or "").strip().lower()
    auth_method = (receiver.get("auth_method") or "").strip().lower()

    is_gmail = provider == "gmail" and (auth_method == "oauth" or receiver.get("gmail_refresh_token"))
    is_outlook = provider == "outlook" and (auth_method == "oauth" or receiver.get("outlook_refresh_token"))

    if is_gmail:
        return await _classify_gmail_receiver(receiver, marker)
    if is_outlook:
        return await _classify_outlook_receiver(receiver, marker)
    return "not_found"


def _pick_receivers(all_receivers: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Pick one Gmail + one Outlook from the active pool."""
    gmails = [r for r in all_receivers if (r.get("provider") or "").lower() == "gmail"]
    outlooks = [r for r in all_receivers if (r.get("provider") or "").lower() == "outlook"]
    selected = []
    if gmails:
        selected.append(random.choice(gmails))
    if outlooks:
        selected.append(random.choice(outlooks))
    # Fallback: if only one provider type, still pick one
    if not selected and all_receivers:
        selected.append(random.choice(all_receivers))
    return selected


def _ensure_utc_aware(value: Optional[datetime]) -> Optional[datetime]:
    """Normalize datetimes from DB to timezone-aware UTC for safe comparison."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


# ──────────────────────────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────────────────────────

@router.post("/inbox-placement/start")
async def start_inbox_placement_test(request: Request):
    """
    Create a new public inbox placement test session.
    Returns receiver seed email addresses + a unique subject tag.
    No authentication required.
    """
    if _admin_db is None or _db is None:
        raise HTTPException(status_code=503, detail="Service not available")

    # Basic IP-based rate limit: max 10 sessions per IP per hour
    client_ip = request.client.host if request.client else "unknown"
    one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
    recent_count = await _db.public_placement_tests.count_documents({
        "client_ip": client_ip,
        "created_at": {"$gte": one_hour_ago},
    })
    if recent_count >= 10:
        raise HTTPException(
            status_code=429,
            detail="Too many tests from this IP. Please wait before creating another.",
        )

    # Pick receivers
    all_receivers = await _admin_db.warmup_receiver_accounts.find(
        {"is_active": True}, {"_id": 0}
    ).to_list(None)

    if not all_receivers:
        raise HTTPException(status_code=503, detail="No receiver accounts available right now")

    selected = _pick_receivers(all_receivers)

    # Build marker (short, unique, human-readable in subject)
    short_id = uuid.uuid4().hex[:8].upper()
    marker = f"EMATEST:{short_id}"
    tag = f"[{marker}]"
    test_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    receivers_public = [
        {"email": r.get("email", ""), "provider": (r.get("provider") or "").lower()}
        for r in selected
        if r.get("email")
    ]
    receiver_account_ids = [str(r.get("id", "")) for r in selected]

    session_doc = {
        "id": test_id,
        "marker": marker,
        "tag": tag,
        "receiver_account_ids": receiver_account_ids,
        "receivers_public": receivers_public,
        "client_ip": client_ip,
        "created_at": now,
        "expires_at": now + timedelta(hours=24),
        "results": None,
        "last_checked_at": None,
    }
    await _db.public_placement_tests.insert_one(session_doc)

    return {
        "test_id": test_id,
        "marker": marker,
        "tag": tag,
        "receivers": receivers_public,
        "instructions": (
            f"Send your email to the address(es) above. "
            f"Include {tag} anywhere in your subject line so we can find it. "
            f"After sending, wait 30–60 seconds then click 'Check Placement'."
        ),
        "expires_in_hours": 24,
    }


@router.get("/inbox-placement/{test_id}/check")
async def check_inbox_placement_test(test_id: str):
    """
    Check where emails for this placement session landed (inbox / spam / promotions / not_found).
    No authentication required.
    """
    if _admin_db is None or _db is None:
        raise HTTPException(status_code=503, detail="Service not available")

    session = await _db.public_placement_tests.find_one({"id": test_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Test session not found or expired")

    now = _ensure_utc_aware(datetime.now(timezone.utc))
    expires_at = _ensure_utc_aware(session.get("expires_at"))
    if expires_at and now > expires_at:
        raise HTTPException(status_code=410, detail="Test session has expired")

    marker = session.get("marker", "")
    receiver_ids = session.get("receiver_account_ids", [])

    if not receiver_ids:
        raise HTTPException(status_code=400, detail="No receiver accounts in this session")

    # Fetch full receiver account docs (need credentials for classification)
    accounts = await _admin_db.warmup_receiver_accounts.find(
        {"id": {"$in": receiver_ids}, "is_active": True}, {"_id": 0}
    ).to_list(None)

    if not accounts:
        raise HTTPException(status_code=503, detail="Receiver accounts unavailable")

    # Map back to public receiver info
    pub_by_id = {str(r.get("id", "")): r for r in session.get("receivers_public", [])}

    tasks = [(_classify_receiver(acc, marker), acc) for acc in accounts]
    classifications = await asyncio.gather(*[t[0] for t in tasks])

    results = []
    for acc, placement in zip(accounts, classifications):
        acc_id = str(acc.get("id", ""))
        pub = pub_by_id.get(acc_id, {})
        results.append({
            "provider": (acc.get("provider") or "").lower(),
            "email": acc.get("email", ""),
            "placement": placement,
        })

    # Persist results
    await _db.public_placement_tests.update_one(
        {"id": test_id},
        {"$set": {"results": results, "last_checked_at": now}},
    )

    return {
        "test_id": test_id,
        "marker": marker,
        "tag": session.get("tag", ""),
        "checked_at": now.isoformat(),
        "results": results,
    }
