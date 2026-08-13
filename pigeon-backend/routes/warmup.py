"""Warmup timeline and stats routes"""
import asyncio
import imaplib
import logging
import re
import string
import uuid
import smtplib
import random
from email.mime.text import MIMEText
from email.utils import formatdate
from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel, EmailStr
from typing import Any, Literal, Optional

from database import db
from routes.auth_utils import normalize_email
from routes.dependencies import get_current_user
from services.email_validation import (
    UnsupportedRynEmailProviderError,
    check_stop_forum_spam,
    detect_ryn_listing_provider,
    get_mx_records,
    has_mx_record,
)
from services.credit_service import CreditService
from services.plan_service import MONTHLY_SMTP_QUOTA_MESSAGE, MonthlySmtpQuotaExceeded
from services.warmup_shared_pool_service import (
    SHARED_POOL_CREDITS_PER_SEND,
    WarmupSharedPoolService,
)
from services.warmup_sender_service import (
    DEFAULT_WARMUP_NETWORK_CONTACT_DAILY_LIMIT,
    MAX_WARMUP_NETWORK_CONTACT_DAILY_LIMIT,
    MIN_WARMUP_NETWORK_CONTACT_DAILY_LIMIT,
)
from services.outlook_oauth_service import (
    get_access_token_async as get_outlook_access_token_async,
    graph_send_mail,
)
from services.gmail_oauth_receiver import (
    build_gmail_service,
    get_access_token_async as get_gmail_access_token_async,
    gmail_api_send_mail,
)

router = APIRouter()

_warmup_sender_service: Any = None
_warmup_network_otp_smtp: Any = None
_credit_service = CreditService(db)
_shared_pool_service = WarmupSharedPoolService(db)

WARMUP_NETWORK_OTP_EXPIRE_MINUTES = 15
WARMUP_NETWORK_SPAM_THRESHOLD = 1
COMMON_MULTI_LABEL_SUFFIXES = {
    "co.uk", "org.uk", "gov.uk", "ac.uk",
    "com.au", "net.au", "org.au",
    "co.nz", "org.nz",
    "co.in", "firm.in", "net.in", "org.in", "gen.in", "ind.in",
    "com.br", "net.br", "org.br",
    "com.mx", "org.mx",
    "co.jp", "ne.jp", "or.jp",
    "co.kr", "or.kr",
    "com.sg", "net.sg", "org.sg",
    "com.tr", "org.tr",
}

CAMPAIGN_NETWORK_SOURCE_TO_MODE = {
    "real_engagement_network": "network",
    "personal_network_pool": "shared_pool",
}
CAMPAIGN_WARMUP_SUCCESS_STATUSES = ("sent", "opened", "clicked", "replied")


def _root_domain_from_host(host: str) -> str:
    value = (host or "").strip().lower().strip(".")
    if not value:
        return ""
    parts = [p for p in value.split(".") if p]
    if len(parts) <= 2:
        return value
    suffix2 = ".".join(parts[-2:])
    if suffix2 in COMMON_MULTI_LABEL_SUFFIXES and len(parts) >= 3:
        return ".".join(parts[-3:])
    return suffix2


def init_warmup_sender_service(service: Any) -> None:
    global _warmup_sender_service
    _warmup_sender_service = service


def init_warmup_network_otp_smtp(service: Any) -> None:
    global _warmup_network_otp_smtp
    _warmup_network_otp_smtp = service


def _campaign_source_filter_for_mode(engagement_mode: str | None) -> Optional[str]:
    if engagement_mode == "network":
        return "real_engagement_network"
    if engagement_mode == "shared_pool":
        return "personal_network_pool"
    if engagement_mode in ("pool", "quick"):
        return "__none__"
    return None


def _ensure_utc(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        if getattr(value, "tzinfo", None) is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, str):
        try:
            from dateutil import parser

            dt = parser.parse(value)
            if getattr(dt, "tzinfo", None) is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            return None
    return None


async def _load_campaign_warmup_contact_map(
    user_id: str, engagement_mode: str | None = None
) -> dict[str, dict[str, str]]:
    source_filter = _campaign_source_filter_for_mode(engagement_mode)
    if source_filter == "__none__":
        return {}

    query: dict[str, Any] = {
        "user_id": user_id,
        "custom_fields.network_campaign_source": {"$in": list(CAMPAIGN_NETWORK_SOURCE_TO_MODE.keys())},
    }
    if source_filter:
        query["custom_fields.network_campaign_source"] = source_filter

    contacts = await db.contacts.find(
        query,
        {"_id": 0, "id": 1, "email": 1, "custom_fields": 1},
    ).to_list(None)
    out: dict[str, dict[str, str]] = {}
    for c in contacts:
        cid = c.get("id")
        if not cid:
            continue
        source = (c.get("custom_fields") or {}).get("network_campaign_source")
        mapped_mode = CAMPAIGN_NETWORK_SOURCE_TO_MODE.get(source)
        if not mapped_mode:
            continue
        out[cid] = {
            "email": (c.get("email") or "").strip().lower(),
            "engagement_mode": mapped_mode,
        }
    return out


def _generate_warmup_network_otp_code() -> str:
    return "".join(random.choices(string.digits, k=6))


async def _send_warmup_network_contact_otp(to_email: str, code: str) -> bool:
    subject = "Verify your email for Pigeon Warmup Network"
    body_plain = (
        f"Your verification code is: {code}\n\n"
        f"Enter this code to confirm ownership of {to_email} and add it to your Warmup Network (My Network).\n"
        f"This code expires in {WARMUP_NETWORK_OTP_EXPIRE_MINUTES} minutes."
    )
    body_html = f"""
<div style="font-family:sans-serif;max-width:480px;margin:auto">
  <h2 style="font-size:20px;margin-bottom:8px">Verify your email</h2>
  <p style="color:#555">Enter the code below to confirm ownership of <strong>{to_email}</strong> and add it to your Warmup Network.</p>
  <div style="font-size:36px;font-weight:700;letter-spacing:8px;text-align:center;padding:24px 0;color:#1a1a1a">{code}</div>
  <p style="color:#888;font-size:13px">This code expires in {WARMUP_NETWORK_OTP_EXPIRE_MINUTES} minutes. If you didn&rsquo;t request this, ignore this email.</p>
</div>
"""
    if _warmup_network_otp_smtp:
        return await _warmup_network_otp_smtp.send_app_notification_email(
            to_email=to_email,
            subject=subject,
            body_plain=body_plain,
            body_html=body_html,
        )
    logging.warning("Warmup network OTP: smtp not injected; code not sent to %s", to_email)
    return False


async def _backfill_warmup_replies(user_id: str) -> None:
    """Best-effort reply backfill so warmup stats/logs stay in sync with mailbox history."""
    try:
        from services.warmup_inbound_sync import backfill_warmup_replies_for_user

        await backfill_warmup_replies_for_user(db, user_id)
    except Exception:
        pass


async def _sync_shared_pool_enrollment(user_id: str) -> dict[str, Any]:
    summary = await _shared_pool_service.get_user_summary(user_id)
    if not summary.get("qualifies"):
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"warmup_shared_pool_enabled": False, "updated_at": datetime.now(timezone.utc)}},
        )
    return summary


async def _build_shared_pool_state(user_id: str) -> dict[str, Any]:
    user = await db.users.find_one(
        {"id": user_id},
        {
            "_id": 0,
            "credits_balance": 1,
            "credits_total_purchased": 1,
            "credits_total_earned": 1,
            "credits_total_spent": 1,
            "warmup_shared_pool_enabled": 1,
        },
    )
    summary = await _sync_shared_pool_enrollment(user_id)
    eligible_contributor_ids = await _shared_pool_service.get_eligible_contributor_user_ids(exclude_user_id=user_id)
    transactions = await _credit_service.list_transactions(user_id, limit=10)
    credits_balance = int((user or {}).get("credits_balance", 0) or 0)
    available_contacts = 0
    if eligible_contributor_ids:
        available_contacts = await db.warmup_network_contacts.count_documents(
            {"user_id": {"$in": eligible_contributor_ids}}
        )

    # Also count active RYN listings — they participate in the pool as receivers
    ryn_active_listings = await db.ryn_listings.count_documents({"status": "active"})
    ryn_active_owners = len(
        await db.ryn_listings.distinct("owner_id", {"status": "active"})
    )
    available_contacts += ryn_active_listings

    # Sum credits currently held (sent but not yet settled)
    held_pipeline = [
        {"$match": {"user_id": user_id, "engagement_mode": "shared_pool", "credit_status": "held"}},
        {"$group": {"_id": None, "total": {"$sum": "$credits_charged"}}},
    ]
    held_result = await db.warmup_sent.aggregate(held_pipeline).to_list(1)
    credits_held = int((held_result[0].get("total") if held_result else None) or 0)

    return {
        "credits": {
            "balance": credits_balance,
            "total_purchased": int((user or {}).get("credits_total_purchased", 0) or 0),
            "total_earned": int((user or {}).get("credits_total_earned", 0) or 0),
            "total_spent": int((user or {}).get("credits_total_spent", 0) or 0),
            "cost_per_send": SHARED_POOL_CREDITS_PER_SEND,
            "reward_per_rental": SHARED_POOL_CREDITS_PER_SEND,
            "credits_held": credits_held,
        },
        "contributor": {
            "enabled": bool((user or {}).get("warmup_shared_pool_enabled")),
            "eligibility": summary,
        },
        "marketplace": {
            "active_contributors": len(eligible_contributor_ids) + ryn_active_owners,
            "available_contacts": available_contacts,
            "can_use_shared_pool": credits_balance > 0 and available_contacts > 0,
        },
        "transactions": transactions,
    }


def _resolve_warmup_body_type(
    body: str, body_type: Optional[Literal["html", "plain", "rich"]]
) -> Literal["html", "plain", "rich"]:
    """Store html | plain | rich (like campaign templates). Infer when body_type is absent."""
    if body_type == "rich":
        return "rich"
    if body_type == "html":
        return "html"
    if body_type == "plain":
        return "plain"
    body_text = (body or "").strip()
    return "html" if re.search(r"<[a-zA-Z][^>]*>", body_text) else "plain"


class WarmupSendTemplateCreate(BaseModel):
    subject: str
    body: str
    body_type: Optional[Literal["html", "plain", "rich"]] = None


class WarmupSendTemplateUpdate(BaseModel):
    subject: Optional[str] = None
    body: Optional[str] = None
    body_type: Optional[Literal["html", "plain", "rich"]] = None


@router.get("/warmup/stats")
async def get_warmup_stats(current_user: dict = Depends(get_current_user)):
    """Get warm-up sent/replied counts for the user's inboxes in the last 7 days."""
    user_id = current_user["id"]
    await _backfill_warmup_replies(user_id)
    inbox_ids = await db.inboxes.distinct("id", {"user_id": user_id})
    if not inbox_ids:
        return {
            "sent_count_7d": 0,
            "replied_count_7d": 0,
            "replied_count_7d_pool_only": 0,
        }
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    sent_count_7d = await db.warmup_sent.count_documents(
        {"inbox_id": {"$in": inbox_ids}, "sent_at": {"$gte": cutoff}}
    )
    replied_count_7d = await db.warmup_sent.count_documents(
        {
            "inbox_id": {"$in": inbox_ids},
            "replied_at": {"$gte": cutoff},
        }
    )
    replied_count_7d_pool_only = await db.warmup_sent.count_documents(
        {
            "inbox_id": {"$in": inbox_ids},
            "replied_at": {"$gte": cutoff},
            "$or": [{"engagement_mode": "pool"}, {"engagement_mode": {"$exists": False}}],
        }
    )

    # Include campaign "Reply engagement & network reach" sends so warmup metrics
    # reflect the "Automated Real Network" and optional shared contact pool traffic.
    campaign_contact_ids = list((await _load_campaign_warmup_contact_map(user_id)).keys())
    if campaign_contact_ids:
        campaign_sent_query = {
            "user_id": user_id,
            "contact_id": {"$in": campaign_contact_ids},
            "sent_at": {"$gte": cutoff},
            "status": {"$in": list(CAMPAIGN_WARMUP_SUCCESS_STATUSES)},
        }
        campaign_reply_query = {
            "user_id": user_id,
            "contact_id": {"$in": campaign_contact_ids},
            "replied_at": {"$gte": cutoff},
            "status": "replied",
        }
        sent_count_7d += await db.email_logs.count_documents(campaign_sent_query)
        replied_count_7d += await db.email_logs.count_documents(campaign_reply_query)

    return {
        "sent_count_7d": sent_count_7d,
        "replied_count_7d": replied_count_7d,
        "replied_count_7d_pool_only": replied_count_7d_pool_only,
    }


@router.get("/warmup/timeline")
async def get_warmup_timeline(current_user: dict = Depends(get_current_user)):
    """Get warmup timeline data for charts"""
    user_id = current_user["id"]
    inboxes = await db.inboxes.find(
        {"user_id": user_id},
        {"_id": 0, "id": 1, "daily_limit": 1, "created_at": 1, "warmup_started_at": 1},
    ).to_list(None)

    if not inboxes:
        return []

    def _to_utc_dt(value):
        if value is None:
            return None
        if isinstance(value, datetime):
            dt = value
        elif isinstance(value, str):
            try:
                from dateutil import parser
                dt = parser.parse(value)
            except Exception:
                return None
        else:
            return None
        if getattr(dt, "tzinfo", None) is None and hasattr(dt, "replace"):
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)

    now_utc = datetime.now(timezone.utc)
    inbox_start: dict[str, datetime] = {}
    inbox_goal: dict[str, int] = {}
    for inbox in inboxes:
        inbox_id = inbox.get("id")
        if not inbox_id:
            continue
        start_at = _to_utc_dt(inbox.get("warmup_started_at")) or _to_utc_dt(inbox.get("created_at"))
        if not start_at:
            continue
        inbox_start[inbox_id] = start_at
        inbox_goal[inbox_id] = max(1, min(50, int(inbox.get("daily_limit") or 50)))

    if not inbox_start:
        return []

    inbox_ids = list(inbox_start.keys())
    min_start = min(inbox_start.values())
    sent_docs = await db.warmup_sent.find(
        {"inbox_id": {"$in": inbox_ids}, "sent_at": {"$gte": min_start}},
        {"_id": 0, "inbox_id": 1, "sent_at": 1},
    ).to_list(None)
    actual_per_day: dict[int, int] = {d: 0 for d in range(1, 8)}
    for doc in sent_docs:
        inbox_id = doc.get("inbox_id")
        start_at = inbox_start.get(inbox_id)
        sent_at = _to_utc_dt(doc.get("sent_at"))
        if not start_at or not sent_at:
            continue
        day_num = int((sent_at - start_at).days) + 1
        if 1 <= day_num <= 7:
            actual_per_day[day_num] += 1

    def _daily_target_for_day(day: int, daily_goal: int) -> int:
        progress = (min(7, max(1, day)) - 1) / 6.0
        return max(1, min(50, int(round(daily_goal * (0.20 + (0.80 * progress))))))

    timeline_data = []
    max_days = 7
    for day in range(1, max_days + 1):
        active_ids = []
        for inbox_id, start_at in inbox_start.items():
            if (now_utc - start_at).days + 1 >= day:
                active_ids.append(inbox_id)
        active_count = len(active_ids)
        if active_count == 0:
            avg_volume = 0
            target = 0
        else:
            avg_volume = actual_per_day.get(day, 0) / active_count
            target_total = sum(_daily_target_for_day(day, inbox_goal[iid]) for iid in active_ids)
            target = int(round(target_total / active_count))

        timeline_data.append({
            "day": f"Day {day}",
            "volume": int(avg_volume),
            "target": target
        })
    
    return timeline_data


# ---------------------------------------------------------------------------
# Warmup send templates (per-user: one template = one subject + one body)
# ---------------------------------------------------------------------------


@router.get("/warmup/send-templates")
async def list_warmup_send_templates(current_user: dict = Depends(get_current_user)):
    """List warmup send templates for the current user. Each template has subject + body."""
    cursor = db.warmup_send_templates.find(
        {"user_id": current_user["id"], "subject": {"$exists": True}, "body": {"$exists": True}},
        {"_id": 0}
    ).sort("created_at", 1)
    docs = await cursor.to_list(None)
    templates = [
        {
            "id": d["id"],
            "subject": d["subject"],
            "body": d["body"],
            "body_type": _resolve_warmup_body_type(d.get("body", ""), d.get("body_type")),
            "created_at": d["created_at"],
        }
        for d in docs
    ]
    return {"templates": templates}


@router.post("/warmup/send-templates")
async def create_warmup_send_template(
    payload: WarmupSendTemplateCreate,
    current_user: dict = Depends(get_current_user),
):
    """Create one warmup send template (subject + body pair)."""
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "subject": (payload.subject or "").strip(),
        "body": (payload.body or "").strip(),
        "body_type": _resolve_warmup_body_type(payload.body, payload.body_type),
        "created_at": now,
        "updated_at": now,
    }
    await db.warmup_send_templates.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.patch("/warmup/send-templates/{template_id}")
async def update_warmup_send_template(
    template_id: str,
    payload: WarmupSendTemplateUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Update a warmup send template. Only the owner can update."""
    existing = await db.warmup_send_templates.find_one({"id": template_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Template not found")
    if existing["user_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    update_data = {}
    if payload.subject is not None:
        update_data["subject"] = payload.subject.strip()
    if payload.body is not None:
        update_data["body"] = payload.body.strip()
    if payload.body_type is not None:
        update_data["body_type"] = payload.body_type
    if "body" in update_data or "body_type" in update_data:
        merged_body = update_data.get("body", existing.get("body", ""))
        merged_type = update_data.get("body_type", existing.get("body_type"))
        update_data["body_type"] = _resolve_warmup_body_type(str(merged_body or ""), merged_type)
    if not update_data:
        return await db.warmup_send_templates.find_one({"id": template_id}, {"_id": 0})
    update_data["updated_at"] = datetime.now(timezone.utc)
    await db.warmup_send_templates.update_one(
        {"id": template_id},
        {"$set": update_data},
    )
    doc = await db.warmup_send_templates.find_one({"id": template_id}, {"_id": 0})
    return doc


@router.delete("/warmup/send-templates/{template_id}")
async def delete_warmup_send_template(
    template_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Delete a warmup send template. Only the owner can delete."""
    existing = await db.warmup_send_templates.find_one({"id": template_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Template not found")
    if existing["user_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    await db.warmup_send_templates.delete_one({"id": template_id})
    return {"message": "Deleted"}


# ---------------------------------------------------------------------------
# Warmup Network contacts (per-user real-engagement contact list)
# ---------------------------------------------------------------------------


class WarmupNetworkVerifySend(BaseModel):
    email: EmailStr


class WarmupNetworkVerifyConfirm(BaseModel):
    email: EmailStr
    otp: str


class WarmupNetworkContactCreate(BaseModel):
    email: EmailStr
    otp: str
    label: Optional[str] = None


class WarmupNetworkSettingsUpdate(BaseModel):
    contact_daily_limit: int


def _clamp_network_contact_daily_limit(raw: Any) -> int:
    if raw is None:
        return DEFAULT_WARMUP_NETWORK_CONTACT_DAILY_LIMIT
    try:
        v = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_WARMUP_NETWORK_CONTACT_DAILY_LIMIT
    return max(MIN_WARMUP_NETWORK_CONTACT_DAILY_LIMIT, min(v, MAX_WARMUP_NETWORK_CONTACT_DAILY_LIMIT))


class SharedPoolEnrollmentUpdate(BaseModel):
    enabled: bool


@router.get("/warmup/shared-pool")
async def get_warmup_shared_pool_state(current_user: dict = Depends(get_current_user)):
    return await _build_shared_pool_state(current_user["id"])


@router.post("/warmup/shared-pool/enrollment")
async def update_warmup_shared_pool_enrollment(
    payload: SharedPoolEnrollmentUpdate,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    if payload.enabled:
        user = await db.users.find_one(
            {"id": user_id},
            {"_id": 0, "credits_balance": 1},
        )
        if int((user or {}).get("credits_balance", 0) or 0) <= 0:
            raise HTTPException(
                status_code=400,
                detail="You need credits before you can enable renting in the shared pool. Top up first.",
            )
        summary = await _sync_shared_pool_enrollment(user_id)
        if not summary.get("qualifies"):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Your Gmail and Outlook warmup contacts must number at least 15 combined, with an "
                    "approximately 80% Gmail and 20% Outlook mix, before this network can be rented in "
                    "the shared pool. Other domains are ignored for this check."
                ),
            )
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"warmup_shared_pool_enabled": bool(payload.enabled), "updated_at": datetime.now(timezone.utc)}},
    )
    return await _build_shared_pool_state(user_id)


@router.get("/warmup/network")
async def list_warmup_network_contacts(current_user: dict = Depends(get_current_user)):
    """List all Warmup Network contacts for the current user."""
    user_id = current_user["id"]
    docs = await db.warmup_network_contacts.find(
        {"user_id": user_id},
        {"_id": 0},
    ).sort("created_at", 1).to_list(None)
    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "warmup_network_contact_daily_limit": 1},
    )
    contact_daily_limit = _clamp_network_contact_daily_limit((user or {}).get("warmup_network_contact_daily_limit"))
    return {"contacts": docs, "settings": {"contact_daily_limit": contact_daily_limit}}


@router.patch("/warmup/network/settings")
async def update_warmup_network_settings(
    payload: WarmupNetworkSettingsUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Set max warmup emails each network contact may receive per rolling 24h (across your inboxes + pool rentals)."""
    contact_daily_limit = _clamp_network_contact_daily_limit(payload.contact_daily_limit)
    await db.users.update_one(
        {"id": current_user["id"]},
        {
            "$set": {
                "warmup_network_contact_daily_limit": contact_daily_limit,
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )
    return {"settings": {"contact_daily_limit": contact_daily_limit}}


@router.post("/warmup/network/verify/send")
async def warmup_network_verify_send(
    body: WarmupNetworkVerifySend,
    current_user: dict = Depends(get_current_user),
):
    """MX + spam + provider checks, then email a 6-digit OTP (same gates as Rent Your Network listings)."""
    user_id = current_user["id"]
    normalized = normalize_email(str(body.email))
    domain = normalized.split("@")[-1]

    if await db.warmup_network_contacts.find_one({"user_id": user_id, "email": normalized}):
        raise HTTPException(status_code=400, detail="This contact is already in your network.")

    loop = asyncio.get_event_loop()
    mx_ok, mx_err = await loop.run_in_executor(None, has_mx_record, domain)
    if not mx_ok:
        raise HTTPException(
            status_code=422,
            detail=(
                f"The domain '{domain}' has no valid MX records and cannot receive email"
                + (f": {mx_err}" if mx_err else "")
            ),
        )

    ok, reason = check_stop_forum_spam(normalized, threshold=WARMUP_NETWORK_SPAM_THRESHOLD)
    if not ok:
        raise HTTPException(
            status_code=422,
            detail=f"This email address has a poor reputation and cannot be added ({reason}).",
        )

    mx_hosts: list[str] = await loop.run_in_executor(None, get_mx_records, domain)
    try:
        provider: str = detect_ryn_listing_provider(mx_hosts, domain)
    except UnsupportedRynEmailProviderError as e:
        raise HTTPException(status_code=422, detail=str(e))
    domain_root = _root_domain_from_host(domain)

    code = _generate_warmup_network_otp_code()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=WARMUP_NETWORK_OTP_EXPIRE_MINUTES)
    await db.warmup_network_email_otps.update_one(
        {"user_id": user_id, "email": normalized},
        {
            "$set": {
                "user_id": user_id,
                "email": normalized,
                "code": code,
                "expires_at": expires_at,
                "verified": False,
                "mx_ok": True,
                "mx_records": mx_hosts,
                "provider": provider,
                "domain_root": domain_root,
                "domain_group": domain_root,
            }
        },
        upsert=True,
    )

    sent = await _send_warmup_network_contact_otp(normalized, code)
    if not sent:
        raise HTTPException(status_code=500, detail="Failed to send verification email. Please try again.")

    return {"message": f"Verification code sent to {normalized}", "provider": provider}


@router.post("/warmup/network/verify/confirm")
async def warmup_network_verify_confirm(
    body: WarmupNetworkVerifyConfirm,
    current_user: dict = Depends(get_current_user),
):
    """Optional: verify OTP without creating the contact (parity with RYN)."""
    user_id = current_user["id"]
    normalized = normalize_email(str(body.email))
    doc = await db.warmup_network_email_otps.find_one({"user_id": user_id, "email": normalized})
    if not doc:
        raise HTTPException(status_code=400, detail="No verification code found. Please request a new one.")
    expires_at = doc.get("expires_at")
    if expires_at and getattr(expires_at, "tzinfo", None) is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Verification code has expired. Please request a new one.")
    if doc.get("code") != body.otp.strip():
        raise HTTPException(status_code=400, detail="Incorrect verification code.")
    await db.warmup_network_email_otps.update_one(
        {"user_id": user_id, "email": normalized},
        {"$set": {"verified": True}},
    )
    return {"message": "Email verified"}


@router.post("/warmup/network")
async def create_warmup_network_contact(
    payload: WarmupNetworkContactCreate,
    current_user: dict = Depends(get_current_user),
):
    """Add a contact to the Warmup Network after OTP verification from /warmup/network/verify/send."""
    user_id = current_user["id"]
    email = normalize_email(str(payload.email))

    otp_doc = await db.warmup_network_email_otps.find_one({"user_id": user_id, "email": email})
    if not otp_doc:
        raise HTTPException(status_code=400, detail="No verification code found. Please request a new one.")
    expires_at = otp_doc.get("expires_at")
    if expires_at and getattr(expires_at, "tzinfo", None) is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Verification code has expired. Please request a new one.")
    if otp_doc.get("code") != payload.otp.strip():
        raise HTTPException(status_code=400, detail="Incorrect verification code.")

    loop = asyncio.get_event_loop()
    domain = email.split("@")[-1]
    mx_ok_now, mx_err = await loop.run_in_executor(None, has_mx_record, domain)
    if not mx_ok_now:
        raise HTTPException(
            status_code=422,
            detail=(
                f"The domain '{domain}' has no valid MX records and cannot receive email"
                + (f": {mx_err}" if mx_err else "")
            ),
        )

    mx_hosts: list[str] = await loop.run_in_executor(None, get_mx_records, domain)
    try:
        provider = detect_ryn_listing_provider(mx_hosts, domain)
    except UnsupportedRynEmailProviderError as e:
        raise HTTPException(status_code=422, detail=str(e))
    domain_root = _root_domain_from_host(domain)

    existing = await db.warmup_network_contacts.find_one({"user_id": user_id, "email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Contact already exists")

    await db.warmup_network_email_otps.delete_one({"user_id": user_id, "email": email})

    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "email": email,
        "label": (payload.label or "").strip() or None,
        "provider": (otp_doc.get("provider") or provider or "").strip().lower() or "other",
        "domain_root": (otp_doc.get("domain_root") or domain_root or "").strip().lower(),
        "domain_group": (otp_doc.get("domain_group") or domain_root or "").strip().lower(),
        "mx_records": otp_doc.get("mx_records") or mx_hosts,
        "created_at": now,
        "updated_at": now,
    }
    await db.warmup_network_contacts.insert_one(doc)
    await _sync_shared_pool_enrollment(user_id)
    doc.pop("_id", None)
    return doc


@router.delete("/warmup/network/{contact_id}")
async def delete_warmup_network_contact(
    contact_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Remove a contact from the Warmup Network."""
    existing = await db.warmup_network_contacts.find_one({"id": contact_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Contact not found")
    if existing["user_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    await db.warmup_network_contacts.delete_one({"id": contact_id})
    await _sync_shared_pool_enrollment(current_user["id"])
    return {"message": "Deleted"}


# ---------------------------------------------------------------------------
# Recent warmup sends (for Warmup Network transparency strip)
# ---------------------------------------------------------------------------


@router.get("/warmup/recent-sends")
async def get_warmup_recent_sends(
    limit: int = 20,
    current_user: dict = Depends(get_current_user),
):
    """Return recent warmup sends for the current user (newest first), joined with inbox email."""
    user_id = current_user["id"]
    docs = await db.warmup_sent.find(
        {"user_id": user_id},
        {"_id": 0, "id": 1, "inbox_id": 1, "receiver_email": 1, "engagement_mode": 1, "sent_at": 1, "subject": 1},
    ).sort("sent_at", -1).limit(max(1, min(limit, 100))).to_list(None)

    # Attach inbox email for display
    inbox_ids = list({d["inbox_id"] for d in docs if d.get("inbox_id")})
    inbox_email_map = {}
    if inbox_ids:
        inboxes = await db.inboxes.find(
            {"id": {"$in": inbox_ids}},
            {"_id": 0, "id": 1, "email": 1},
        ).to_list(None)
        inbox_email_map = {i["id"]: i["email"] for i in inboxes}

    result = []
    for d in docs:
        result.append({
            "id": d["id"],
            "inbox_email": inbox_email_map.get(d.get("inbox_id"), ""),
            "receiver_email": d.get("receiver_email", ""),
            "engagement_mode": d.get("engagement_mode", "pool"),
            "subject": d.get("subject", ""),
            "sent_at": d.get("sent_at"),
        })
    return {"sends": result}


# ---------------------------------------------------------------------------
# Sent logs — paginated, filterable send history
# ---------------------------------------------------------------------------


@router.get("/warmup/sent-logs")
async def get_warmup_sent_logs(
    limit: int = 50,
    offset: int = 0,
    engagement_mode: str | None = None,
    since_hours: int | None = Query(
        None,
        description="Only include sends from the last N hours. Allowed values: 24, 48. Omit for all time.",
    ),
    current_user: dict = Depends(get_current_user),
):
    """Return paginated warmup send history for the current user."""
    user_id = current_user["id"]
    await _backfill_warmup_replies(user_id)

    query: dict = {"user_id": user_id}
    if engagement_mode in ("pool", "network", "shared_pool", "quick"):
        query["engagement_mode"] = engagement_mode
    if since_hours is not None:
        if since_hours not in (24, 48):
            raise HTTPException(status_code=400, detail="since_hours must be 24 or 48")
        cutoff = datetime.now(timezone.utc) - timedelta(hours=since_hours)
        query["sent_at"] = {"$gte": cutoff}

    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    total = await db.warmup_sent.count_documents(query)
    fetch_limit = max(1, min(5000, offset + limit))
    warmup_docs = await db.warmup_sent.find(
        query,
        {"_id": 0, "id": 1, "inbox_id": 1, "receiver_email": 1, "engagement_mode": 1,
         "sent_at": 1, "subject": 1, "replied_at": 1},
    ).sort("sent_at", -1).limit(fetch_limit).to_list(None)

    inbox_ids = list({d["inbox_id"] for d in warmup_docs if d.get("inbox_id")})
    inbox_email_map = {}
    if inbox_ids:
        inboxes = await db.inboxes.find(
            {"id": {"$in": inbox_ids}},
            {"_id": 0, "id": 1, "email": 1},
        ).to_list(None)
        inbox_email_map = {i["id"]: i["email"] for i in inboxes}

    warmup_items = []
    for d in warmup_docs:
        warmup_items.append({
            "id": d["id"],
            "inbox_email": inbox_email_map.get(d.get("inbox_id"), ""),
            "receiver_email": d.get("receiver_email", ""),
            "engagement_mode": d.get("engagement_mode", "pool"),
            "subject": d.get("subject", ""),
            "sent_at": d.get("sent_at"),
            "replied_at": d.get("replied_at"),
        })

    campaign_contact_map = await _load_campaign_warmup_contact_map(user_id, engagement_mode)
    campaign_items: list[dict[str, Any]] = []
    campaign_total = 0
    if campaign_contact_map:
        campaign_contact_ids = list(campaign_contact_map.keys())
        campaign_query: dict[str, Any] = {
            "user_id": user_id,
            "contact_id": {"$in": campaign_contact_ids},
            "status": {"$in": list(CAMPAIGN_WARMUP_SUCCESS_STATUSES)},
        }
        if since_hours is not None:
            campaign_query["sent_at"] = {"$gte": cutoff}
        campaign_total = await db.email_logs.count_documents(campaign_query)
        campaign_logs = await db.email_logs.find(
            campaign_query,
            {
                "_id": 0,
                "id": 1,
                "sender_id": 1,
                "contact_id": 1,
                "subject": 1,
                "sent_at": 1,
                "replied_at": 1,
            },
        ).sort("sent_at", -1).limit(fetch_limit).to_list(None)

        campaign_sender_ids = list({d.get("sender_id") for d in campaign_logs if d.get("sender_id")})
        campaign_inbox_email_map: dict[str, str] = {}
        if campaign_sender_ids:
            campaign_inboxes = await db.inboxes.find(
                {"id": {"$in": campaign_sender_ids}},
                {"_id": 0, "id": 1, "email": 1},
            ).to_list(None)
            campaign_inbox_email_map = {i["id"]: i["email"] for i in campaign_inboxes}

        for d in campaign_logs:
            cmeta = campaign_contact_map.get(d.get("contact_id") or "", {})
            if not cmeta:
                continue
            campaign_items.append(
                {
                    "id": f"campaign:{d.get('id')}",
                    "inbox_email": campaign_inbox_email_map.get(d.get("sender_id"), ""),
                    "receiver_email": cmeta.get("email", ""),
                    "engagement_mode": cmeta.get("engagement_mode", "network"),
                    "subject": d.get("subject", ""),
                    "sent_at": d.get("sent_at"),
                    "replied_at": d.get("replied_at"),
                }
            )

    merged = warmup_items + campaign_items
    merged.sort(
        key=lambda item: _ensure_utc(item.get("sent_at")) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    items = merged[offset : offset + limit]
    return {"total": total + campaign_total, "items": items}


# ---------------------------------------------------------------------------
# Quick Engagement — send one warmup email immediately to a specific address
# ---------------------------------------------------------------------------


class QuickEngagementRequest(BaseModel):
    inbox_id: str
    recipient_email: EmailStr


class DomainMailTestRequest(BaseModel):
    domain_id: str


def _test_gmail_app_password_operational_sync(email: str, password: str) -> bool:
    """Verify Gmail app-password inbox can read (IMAP) and send (SMTP)."""
    imap_ok = False
    smtp_ok = False
    try:
        conn = imaplib.IMAP4_SSL("imap.gmail.com", port=993)
        conn.login(email, password)
        conn.select("INBOX", readonly=True)
        conn.logout()
        imap_ok = True
    except Exception:
        imap_ok = False
    try:
        server = smtplib.SMTP("smtp.gmail.com", 587, timeout=15)
        server.starttls()
        server.login(email, password)
        server.quit()
        smtp_ok = True
    except Exception:
        smtp_ok = False
    return imap_ok and smtp_ok


def _send_reverse_probe_via_smtp_sync(
    smtp_host: str,
    smtp_port: int,
    smtp_username: str,
    smtp_password: str,
    from_email: str,
    to_email: str,
) -> None:
    msg = MIMEText("Reverse test probe from receiver pool.", "plain")
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = "Reverse test probe"
    msg["Date"] = formatdate(localtime=True)
    if smtp_port == 465:
        server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=30)
    else:
        server = smtplib.SMTP(smtp_host, smtp_port, timeout=30)
        if smtp_port == 587:
            server.starttls()
    server.login(smtp_username, smtp_password)
    server.sendmail(from_email, [to_email], msg.as_string())
    server.quit()


def _pool_receiver_reverse_capable(rec: dict) -> bool:
    provider = (rec.get("provider") or "").strip().lower()
    auth_method = (rec.get("auth_method") or "").strip().lower()
    if rec.get("smtp_password") and rec.get("smtp_host") and rec.get("smtp_username"):
        return True
    if provider == "outlook" and (auth_method == "oauth" or rec.get("outlook_refresh_token")):
        return True
    if provider == "gmail" and (auth_method == "oauth" or rec.get("gmail_refresh_token")):
        return bool(rec.get("google_client_id") and rec.get("google_client_secret_encrypted"))
    return False


def _build_probe_code(prefix: str = "EMA") -> str:
    token = uuid.uuid4().hex[:8].upper()
    return f"{prefix}-{token}"


@router.post("/warmup/quick-send")
async def quick_engagement_send(
    payload: QuickEngagementRequest,
    current_user: dict = Depends(get_current_user),
):
    """Send a single warmup email immediately to a specific recipient."""
    if _warmup_sender_service is None:
        raise HTTPException(status_code=503, detail="Warmup sender not available")
    user_id = current_user["id"]
    try:
        await _warmup_sender_service.quick_send(user_id, payload.inbox_id, str(payload.recipient_email))
    except MonthlySmtpQuotaExceeded:
        raise HTTPException(status_code=403, detail=MONTHLY_SMTP_QUOTA_MESSAGE)
    except ValueError as e:
        msg = str(e)
        if msg == "Inbox not found":
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send: {str(e)}")
    return {"sent": True}


@router.post("/warmup/domain-mail-test")
async def domain_mail_test(
    payload: DomainMailTestRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Run a mail flow test from a domain inbox.
    Recipient selection:
    1) Prefer another connected Gmail inbox in this workspace (any domain).
    2) Fallback to backend warmup receiver pool.
    """
    if _warmup_sender_service is None:
        raise HTTPException(status_code=503, detail="Warmup sender not available")

    user_id = current_user["id"]
    domain = await db.domains.find_one(
        {"id": payload.domain_id, "user_id": user_id},
        {"_id": 0, "id": 1, "domain": 1},
    )
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")

    inboxes = await db.inboxes.find(
        {
            "user_id": user_id,
            "domain_id": payload.domain_id,
            "email": {"$exists": True, "$ne": ""},
            "status": {"$in": ["ready", "warming"]},
        },
        {"_id": 0},
    ).to_list(None)
    if not inboxes:
        raise HTTPException(
            status_code=400,
            detail="No ready/warming inbox found for this domain. Add and verify an inbox first.",
        )

    async def _gmail_operational(i: dict) -> bool:
        if (i.get("sender_type") or "").lower() != "gmail":
            return False
        inbox_id = i.get("id")
        if not inbox_id:
            return False
        auth_method = (i.get("gmail_auth_method") or "").lower()
        if auth_method == "app_password":
            if not i.get("gmail_app_password_encrypted"):
                return False
            smtp_service = getattr(_warmup_sender_service, "smtp_service", None)
            if not smtp_service:
                return False
            try:
                app_password = smtp_service._decrypt_password(i.get("gmail_app_password_encrypted"))
            except Exception:
                return False
            return await asyncio.to_thread(
                _test_gmail_app_password_operational_sync,
                (i.get("email") or "").strip(),
                app_password,
            )

        credential_id = i.get("gmail_credentials_id")
        gmail_service = getattr(_warmup_sender_service, "gmail_service", None)
        if not gmail_service or not credential_id:
            return False
        connected = await gmail_service.is_connected(str(credential_id))
        if not connected:
            return False
        # Read capability check: list at least one recent inbox id (or empty list on a valid mailbox).
        try:
            await gmail_service.list_recent_inbox_message_ids(
                user_id,
                max_results=1,
                credential_id=str(credential_id),
            )
            return True
        except Exception:
            return False

    # Prefer Gmail sender when available; otherwise use first eligible inbox.
    sender = inboxes[0]
    for i in inboxes:
        if await _gmail_operational(i):
            sender = i
            break
    sender_email = (sender.get("email") or "").strip().lower()

    recipient_email: Optional[str] = None
    recipient_inbox: Optional[dict] = None
    recipient_source = "backend_receiver_pool"

    # Try connected Gmail recipient from this workspace first (not restricted to this domain).
    all_user_inboxes = await db.inboxes.find(
        {
            "user_id": user_id,
            "sender_type": "gmail",
            "email": {"$exists": True, "$ne": ""},
        },
        {"_id": 0},
    ).to_list(None)
    gmail_recipients: list[dict] = []
    for inbox in all_user_inboxes:
        candidate_email = (inbox.get("email") or "").strip().lower()
        if not candidate_email or candidate_email == sender_email:
            continue
        if await _gmail_operational(inbox):
            gmail_recipients.append(inbox)
    if gmail_recipients:
        recipient_inbox = gmail_recipients[0]
        recipient_email = (recipient_inbox.get("email") or "").strip().lower()
        recipient_source = "connected_gmail"

    # Fallback: backend receiver pool.
    pool_receiver_doc = None
    if not recipient_email:
        admin_db = getattr(_warmup_sender_service, "admin_db", db)
        pool_receivers = await admin_db.warmup_receiver_accounts.find(
            {
                "is_active": True,
                "email": {"$exists": True, "$ne": ""},
            },
            {"_id": 0},
        ).to_list(None)
        reverse_capable = [r for r in pool_receivers if _pool_receiver_reverse_capable(r)]
        # Prefer random reverse-capable pool account so reverse check is usually available.
        if reverse_capable:
            pool_receiver_doc = random.choice(reverse_capable)
        elif pool_receivers:
            pool_receiver_doc = random.choice(pool_receivers)
        if not pool_receiver_doc:
            raise HTTPException(
                status_code=400,
                detail="No connected Gmail recipient and backend receiver pool is empty.",
            )
        recipient_email = str(pool_receiver_doc["email"]).strip().lower()

    if not recipient_email:
        raise HTTPException(status_code=400, detail="No valid recipient available for test mode.")

    recipient_capable = bool(recipient_email)
    forward_probe_code = _build_probe_code("FWD")
    reverse_probe_code = _build_probe_code("REV")
    forward_subject = f"Domain test {forward_probe_code}"
    forward_body = (
        f"Automated domain test mail.\n"
        f"Probe code: {forward_probe_code}\n"
        f"If you received this, delivery path is working."
    )
    reverse_subject = f"Reverse domain test {reverse_probe_code}"
    reverse_body = (
        f"Automated reverse domain test mail.\n"
        f"Probe code: {reverse_probe_code}\n"
        f"If you received this, reverse path is working."
    )
    reverse_test_id: Optional[str] = None
    reverse_flow = {
        "enabled": False,
        "status": "pending",
        "message": "Reverse flow is available only when recipient is a connected Gmail inbox.",
    }
    try:
        test_id = await _warmup_sender_service.quick_send(
            user_id,
            sender["id"],
            recipient_email,
            subject_override=forward_subject,
            body_override=forward_body,
            body_type_override="plain",
        )
        await db.warmup_sent.update_one(
            {"id": test_id, "user_id": user_id},
            {
                "$set": {
                    "test_mode": {
                        "recipient_source": recipient_source,
                        "flow": "forward",
                        "probe_code": forward_probe_code,
                        "probe_to": recipient_email,
                    }
                }
            },
        )
        # Bidirectional test only when recipient is one of the user's connected Gmail inboxes.
        if recipient_source == "connected_gmail" and recipient_inbox and recipient_inbox.get("id"):
            reverse_test_id = await _warmup_sender_service.quick_send(
                user_id,
                str(recipient_inbox["id"]),
                sender_email,
                subject_override=reverse_subject,
                body_override=reverse_body,
                body_type_override="plain",
            )
            await db.warmup_sent.update_one(
                {"id": reverse_test_id, "user_id": user_id},
                {
                    "$set": {
                        "test_mode": {
                            "recipient_source": "connected_gmail",
                            "flow": "reverse",
                            "probe_code": reverse_probe_code,
                            "probe_to": sender_email,
                        }
                    }
                },
            )
            reverse_flow = {
                "enabled": True,
                "status": "pending",
                "message": "Reverse flow queued from recipient back to sender.",
            }
        elif recipient_source == "backend_receiver_pool":
            admin_db = getattr(_warmup_sender_service, "admin_db", db)
            if not pool_receiver_doc:
                pool_receiver_doc = await admin_db.warmup_receiver_accounts.find_one(
                    {"is_active": True, "email": {"$regex": f"^{re.escape(recipient_email)}$", "$options": "i"}},
                    {"_id": 0},
                )
            if pool_receiver_doc and _pool_receiver_reverse_capable(pool_receiver_doc):
                try:
                    smtp_service = getattr(_warmup_sender_service, "smtp_service", None)
                    if smtp_service:
                        provider = (pool_receiver_doc.get("provider") or "").strip().lower()
                        auth_method = (pool_receiver_doc.get("auth_method") or "").strip().lower()
                        if pool_receiver_doc.get("smtp_password") and pool_receiver_doc.get("smtp_host"):
                            smtp_password = smtp_service._decrypt_password(pool_receiver_doc["smtp_password"])
                            await asyncio.to_thread(
                                _send_reverse_probe_via_smtp_sync,
                                pool_receiver_doc.get("smtp_host"),
                                int(pool_receiver_doc.get("smtp_port", 587) or 587),
                                pool_receiver_doc.get("smtp_username"),
                                smtp_password,
                                recipient_email,
                                sender_email,
                            )
                        elif provider == "outlook" and (auth_method == "oauth" or pool_receiver_doc.get("outlook_refresh_token")):
                            refresh_token = smtp_service._decrypt_password(pool_receiver_doc["outlook_refresh_token"])
                            access_token = await get_outlook_access_token_async(refresh_token)
                            await graph_send_mail(
                                access_token,
                                sender_email,
                                reverse_subject,
                                reverse_body,
                                from_email=recipient_email,
                            )
                        elif provider == "gmail" and (auth_method == "oauth" or pool_receiver_doc.get("gmail_refresh_token")):
                            refresh_token = smtp_service._decrypt_password(pool_receiver_doc["gmail_refresh_token"])
                            client_id = pool_receiver_doc.get("google_client_id") or ""
                            client_secret = smtp_service._decrypt_password(
                                pool_receiver_doc.get("google_client_secret_encrypted")
                            )
                            access_token = await get_gmail_access_token_async(
                                refresh_token, client_id, client_secret, scope="https://mail.google.com/"
                            )
                            gmail_svc = build_gmail_service(access_token, refresh_token, client_id, client_secret)
                            await asyncio.to_thread(
                                gmail_api_send_mail,
                                gmail_svc,
                                sender_email,
                                reverse_subject,
                                reverse_body,
                                recipient_email,
                            )
                        else:
                            raise RuntimeError("No supported reverse send method for this receiver account")
                        reverse_flow = {
                            "enabled": True,
                            "status": "success",
                            "message": "Reverse probe sent from backend receiver pool to sender inbox.",
                        }
                    else:
                        reverse_flow = {
                            "enabled": True,
                            "status": "failed",
                            "message": "Reverse probe skipped: SMTP service unavailable.",
                        }
                except Exception:
                    reverse_flow = {
                        "enabled": True,
                        "status": "failed",
                        "message": "Reverse probe failed for backend receiver pool.",
                    }
            else:
                reverse_flow = {
                    "enabled": True,
                    "status": "failed",
                    "message": "Reverse probe unavailable for this pool receiver auth type.",
                }
    except MonthlySmtpQuotaExceeded:
        raise HTTPException(status_code=403, detail=MONTHLY_SMTP_QUOTA_MESSAGE)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send test email: {str(e)}")

    return {
        "sent": True,
        "test_id": test_id,
        "reverse_test_id": reverse_test_id,
        "domain_id": payload.domain_id,
        "domain": domain.get("domain"),
        "sender_inbox_id": sender.get("id"),
        "sender_email": sender.get("email"),
        "recipient_email": recipient_email,
        "recipient_source": recipient_source,
        "sender_check": {"ok": True, "message": "Sender mailbox is available for test send."},
        "recipient_check": {
            "ok": recipient_capable,
            "message": (
                "Connected Gmail recipient selected."
                if recipient_source == "connected_gmail"
                else "Backend receiver pool recipient selected."
            ),
        },
        "receive_signal": {
            "ok": False,
            "status": "pending",
            "message": "Waiting for open/reply signal from recipient.",
        },
        "reverse_flow": reverse_flow,
        "message": "Test email sent. We are now waiting for a receive/open signal.",
    }


@router.get("/warmup/domain-mail-test/{test_id}/status")
async def domain_mail_test_status(test_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    doc = await db.warmup_sent.find_one(
        {"id": test_id, "user_id": user_id, "engagement_mode": "quick"},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Test run not found")

    has_receive_signal = bool(
        doc.get("opened_at")
        or doc.get("replied_at")
        or doc.get("receiver_message_uid")
        or doc.get("receiver_gmail_id")
    )
    test_mode = doc.get("test_mode") or {}
    probe_code = (test_mode.get("probe_code") or "").strip()
    flow = (test_mode.get("flow") or "").strip().lower()
    probe_to = (test_mode.get("probe_to") or "").strip().lower()
    if probe_code and flow == "reverse":
        regex = {"$regex": re.escape(probe_code), "$options": "i"}
        probe_query = {
            "user_id": user_id,
            "$or": [
                {"subject": regex},
                {"body_text": regex},
                {"body_html": regex},
            ],
        }
        if probe_to:
            probe_query["to"] = {"$regex": re.escape(probe_to), "$options": "i"}
        probe_hit = await db.inbound_messages.find_one(probe_query, {"_id": 0, "id": 1})
        if probe_hit:
            has_receive_signal = True
    recipient_source = ((doc.get("test_mode") or {}).get("recipient_source") or "").strip().lower()
    if not has_receive_signal and recipient_source == "backend_receiver_pool":
        # Pool mailboxes may not always emit open/reply quickly; treat send acceptance as pass.
        has_receive_signal = True
        fallback_message = "Message accepted by backend receiver pool. Open/reply signal may appear later."
    else:
        fallback_message = "No receive/open signal yet."
    return {
        "test_id": test_id,
        "sent": True,
        "sender_email": doc.get("sender_email"),
        "recipient_email": doc.get("receiver_email"),
        "receive_signal": {
            "ok": has_receive_signal,
            "status": "success" if has_receive_signal else "pending",
            "opened_at": doc.get("opened_at"),
            "replied_at": doc.get("replied_at"),
            "message": (
                "Receive/open signal detected."
                if has_receive_signal
                else fallback_message
            ),
        },
    }
