"""Inbox management routes"""
import asyncio
import hashlib
import imaplib
import json
import logging
import os
import re
import secrets
import smtplib
import uuid
from typing import Literal, Optional
from fastapi import APIRouter, Body, HTTPException, Depends, Request
from fastapi.encoders import jsonable_encoder
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel, EmailStr
from starlette.responses import Response, JSONResponse

from database import db
from models import Inbox
from services.gmail_service import GmailService
from services.smtp_service import SMTPService
from services.email_validation import check_stop_forum_spam
from services.email_infra_service import EmailInfraService, EmailInfraServiceError
from services.credit_service import CreditService
from services.warmup_shared_pool_service import WarmupSharedPoolService
from services.email_service import EmailService
from routes.dependencies import get_current_user
from routes.auth_utils import get_password_hash
from services.plan_service import outbound_subscription_block_message, user_subscription_blocks_outbound

router = APIRouter()
logger = logging.getLogger(__name__)

# Gmail IMAP/SMTP for app-password flow
GMAIL_IMAP_HOST = "imap.gmail.com"
GMAIL_IMAP_PORT = 993
GMAIL_SMTP_HOST = "smtp.gmail.com"
GMAIL_SMTP_PORT = 587


class InboxStatusUpdate(BaseModel):
    """Partial update for inbox status (e.g. pause/resume warmup)."""
    status: Optional[str] = None  # warming, ready, paused
    auto_warmup: Optional[bool] = None


class ResumeBody(BaseModel):
    """Optional body for resume endpoint to choose warmup engagement mode."""
    warmup_engagement_mode: Optional[Literal["pool", "network", "network_plus_shared", "hybrid", "shared_pool"]] = None


class SetMailboxPasswordBody(BaseModel):
    """Password for /mailbox web login (separate from SMTP credentials)."""
    password: str

# Initialize services (will be injected from server.py)
gmail_service: GmailService = None
smtp_service: SMTPService = None
lifecycle_automation_service = None

def init_inbox_services(gmail: GmailService, smtp: SMTPService):
    """Initialize inbox services"""
    global gmail_service, smtp_service
    gmail_service = gmail
    smtp_service = smtp


def init_lifecycle_automation_service(service):
    """Inject lifecycle automation service."""
    global lifecycle_automation_service
    lifecycle_automation_service = service


plan_service = None
email_infra_service = EmailInfraService()
credit_service = CreditService(db)
shared_pool_service = WarmupSharedPoolService(db)


def init_plan_service(service):
    global plan_service
    plan_service = service


async def _is_email_infra_enabled_for_user(user_id: str) -> bool:
    """Per-user toggle, stored in user_settings.email_infra.enabled."""
    settings = await db.user_settings.find_one(
        {"user_id": user_id},
        {"_id": 0, "email_infra": 1},
    )
    return bool(settings and settings.get("email_infra", {}).get("enabled") is True)


def _derive_email_infra_mailbox_password(user_id: str, domain_id: str, email: str) -> str:
    """Derive deterministic mailbox password when seed exists; else generate random."""
    seed = (os.getenv("EMAIL_INFRA_MAILBOX_PASSWORD_SEED") or os.getenv("ENCRYPTION_KEY") or "").strip()
    if not seed:
        return secrets.token_urlsafe(24)
    raw = f"{seed}:{user_id}:{domain_id}:{email.lower()}"
    digest = hashlib.sha256(raw.encode()).hexdigest()
    return f"EiMbx!{digest[:24]}"


async def _test_gmail_app_password_connection(email: str, password: str) -> tuple[bool, str]:
    """Test Gmail IMAP + SMTP login with email and app password. Returns (success, message)."""
    imap_ok, smtp_ok = False, False
    imap_msg, smtp_msg = "", ""

    def _test_imap():
        nonlocal imap_ok, imap_msg
        conn = imaplib.IMAP4_SSL(GMAIL_IMAP_HOST, port=GMAIL_IMAP_PORT)
        conn.login(email, password)
        conn.select("INBOX", readonly=True)
        conn.logout()
        imap_ok = True
        imap_msg = "OK"

    def _test_smtp():
        nonlocal smtp_ok, smtp_msg
        server = smtplib.SMTP(GMAIL_SMTP_HOST, GMAIL_SMTP_PORT, timeout=15)
        server.starttls()
        server.login(email, password)
        server.quit()
        smtp_ok = True
        smtp_msg = "OK"

    try:
        await asyncio.to_thread(_test_imap)
    except Exception as e:
        imap_msg = str(e)
    try:
        await asyncio.to_thread(_test_smtp)
    except Exception as e:
        smtp_msg = str(e)

    ok = imap_ok and smtp_ok
    msg = "Connection OK" if ok else f"IMAP: {imap_msg}; SMTP: {smtp_msg}"
    return (ok, msg)


class GmailAppPasswordCreate(BaseModel):
    """Body for adding a Gmail account with email + app password."""
    email: EmailStr
    password: str


@router.post("/inboxes/gmail-app-password")
async def create_gmail_app_password_inbox(
    payload: GmailAppPasswordCreate,
    current_user: dict = Depends(get_current_user),
):
    """Add a Gmail account using email and app password. Tests connection first, then creates inbox."""
    if smtp_service is None:
        raise HTTPException(status_code=503, detail="Service not configured")
    user_id = current_user["id"]
    email = payload.email.strip().lower()
    password = payload.password.strip()
    if not password:
        raise HTTPException(status_code=400, detail="Password is required")

    # Don't add if this Gmail is already connected by any user (global)
    existing_inbox = await db.inboxes.find_one(
        {"sender_type": "gmail", "email": email}
    )
    if existing_inbox:
        raise HTTPException(
            status_code=400,
            detail="This Gmail account is already connected by another user. Each Gmail can only be connected to one account.",
        )

    # Enforce plan limit (same as OAuth Gmail)
    if plan_service:
        user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if user:
            limits = await plan_service.get_user_limits(user)
            max_google = limits.get("max_google_accounts", 0)
            if max_google == 0:
                raise HTTPException(
                    status_code=403,
                    detail="Your plan does not include Google accounts. Upgrade your plan to connect Gmail.",
                )
            count = await plan_service.gmail_inboxes_count(user_id)
            if max_google != -1 and count >= max_google:
                raise HTTPException(
                    status_code=403,
                    detail=f"Plan limit reached: maximum {max_google} Gmail accounts. Upgrade to add more.",
                )

    # Test connection before creating
    ok, msg = await _test_gmail_app_password_connection(email, password)
    if not ok:
        raise HTTPException(
            status_code=400,
            detail=f"Could not connect. Check email and password. ({msg})",
        )

    now = datetime.now(timezone.utc)
    inbox_id = str(uuid.uuid4())
    encrypted_password = smtp_service._encrypt_password(password)
    inbox_doc = {
        "id": inbox_id,
        "user_id": user_id,
        "email": email,
        "sender_type": "gmail",
        "gmail_auth_method": "app_password",
        "gmail_app_password_encrypted": encrypted_password,
        "status": "ready",
        "warmup_progress": 100,
        "daily_limit": 50,
        "sent_today": 0,
        "created_at": now,
        "updated_at": now,
    }
    await db.inboxes.insert_one(inbox_doc)
    if lifecycle_automation_service:
        try:
            await lifecycle_automation_service.emit_event(
                user_id,
                "inbox_created",
                {"inbox_id": inbox_id, "sender_type": "gmail_app_password"},
            )
        except Exception:
            logger.exception("Failed to emit lifecycle inbox_created for user %s", user_id)
    out = {k: v for k, v in inbox_doc.items() if k != "gmail_app_password_encrypted" and k != "_id"}
    return out


@router.post("/inboxes")
async def create_inbox(inbox: Inbox, current_user: dict = Depends(get_current_user)):
    """Create inbox (from domain or Gmail)"""
    try:
        # Ensure user can only create inboxes for themselves
        if inbox.user_id != current_user["id"]:
            raise HTTPException(status_code=403, detail="Cannot create inbox for another user")

        # Enforce plan limits and capture warmup entitlement
        has_warmup = False
        # Gmail inboxes are created exclusively via the Gmail OAuth flow.
        # Prevent creating Gmail-type inboxes directly from the generic "Add Inbox" flow.
        if inbox.sender_type == "gmail":
            raise HTTPException(
                status_code=400,
                detail="Gmail inboxes must be connected via Settings → Integrations → Gmail, not created from Add Inbox.",
            )

        if plan_service:
            limits = await plan_service.get_user_limits(current_user)
            # For domain-based inboxes, enforce the subdomain quota (1 subdomain → 1 SMTP inbox).
            count = await plan_service.smtp_inboxes_count(current_user["id"])
            max_smtp_inboxes = limits.get("max_subdomains", 0)

            if max_smtp_inboxes != -1 and count >= max_smtp_inboxes:
                raise HTTPException(
                    status_code=403,
                    detail=f"Plan limit reached: maximum {max_smtp_inboxes} domain inboxes (matching your subdomain limit). Upgrade to add more.",
                )

            has_warmup = bool(limits.get("warmup", False))

        inbox_dict = inbox.model_dump()

        # Normalize email-related fields to lowercase for consistency
        if inbox_dict.get("email"):
            inbox_dict["email"] = inbox_dict["email"].strip().lower()
        if inbox_dict.get("smtp_username"):
            inbox_dict["smtp_username"] = inbox_dict["smtp_username"].strip().lower()
        if "sender_name" in inbox_dict:
            inbox_dict["sender_name"] = str(inbox_dict.get("sender_name") or "").strip()

        # For pigeon smtp_provider (Pigeon-managed SendGrid + Email Infra enabled), ensure and link one domain mailbox id.
        if (
            inbox_dict.get("sender_type") == "smtp"
            and inbox_dict.get("smtp_provider") == "pigeon"
            and await _is_email_infra_enabled_for_user(current_user["id"])
        ):
            domain_id = inbox_dict.get("domain_id")
            if not domain_id:
                raise HTTPException(
                    status_code=400,
                    detail="Domain is required for Pigeon inboxes when Email Infra is enabled.",
                )

            domain = await db.domains.find_one(
                {"id": domain_id, "user_id": current_user["id"]},
                {"_id": 0, "email_infra": 1, "domain": 1},
            )
            if not domain:
                raise HTTPException(status_code=404, detail="Domain not found")
            inbox_email = (inbox_dict.get("email") or "").strip().lower()
            expected_suffix = f"@{(domain.get('domain') or '').strip().lower()}"
            if not inbox_email or not expected_suffix or not inbox_email.endswith(expected_suffix):
                raise HTTPException(
                    status_code=400,
                    detail=f"Email must belong to selected domain ({domain.get('domain')}).",
                )

            infra = domain.get("email_infra") if isinstance(domain.get("email_infra"), dict) else {}
            if not infra.get("enabled"):
                raise HTTPException(
                    status_code=400,
                    detail="Email Infra is enabled for this account, but this domain is not synced to Email Infra.",
                )
            infra_domain_id = infra.get("domain_id")
            infra_vps_id = infra.get("vps_id")
            mailbox_id = infra.get("mailbox_id")
            if not infra_domain_id or not infra_vps_id:
                raise HTTPException(
                    status_code=400,
                    detail="Email Infra domain is not ready. Verify domain and wait until Email Infra is configured.",
                )

            if not mailbox_id:
                print(
                    "[EMAIL-INFRA][mailbox-create] user_id=",
                    current_user["id"],
                    "domain_id=",
                    domain_id,
                    "infra_domain_id=",
                    infra_domain_id,
                    "infra_vps_id=",
                    infra_vps_id,
                    "email=",
                    inbox_email,
                )
                try:
                    # Step 1: request mailbox creation (returns id immediately / once queued)
                    mailbox = await email_infra_service.create_mailbox(
                        email=inbox_email,
                        password=_derive_email_infra_mailbox_password(
                            current_user["id"],
                            domain_id,
                            inbox_email,
                        ),
                        domain_id=infra_domain_id,
                        vps_id=infra_vps_id,
                        ip_id=None,
                    )
                    mailbox_id = mailbox.get("id")
                    print(
                        "[EMAIL-INFRA][mailbox-create] create response mailbox_id=",
                        mailbox_id,
                        "raw_response=",
                        mailbox,
                    )
                    if not mailbox_id:
                        raise HTTPException(
                            status_code=502,
                            detail="Email Infra mailbox creation returned no mailbox id.",
                        )

                    # Step 2: wait 30s, then verify mailbox up to 20 times with 10s gaps
                    print(
                        "[EMAIL-INFRA][mailbox-verify] initial sleep 30s before first verify for mailbox_id=",
                        mailbox_id,
                    )
                    await asyncio.sleep(30)

                    verified_ok = False
                    verify_payload = None
                    for attempt in range(1, 21):
                        try:
                            verify_payload = await email_infra_service.verify_mailbox(mailbox_id)
                            print(
                                "[EMAIL-INFRA][mailbox-verify] attempt=",
                                attempt,
                                "payload=",
                                verify_payload,
                            )
                            if verify_payload.get("ok"):
                                verified_ok = True
                                break
                        except EmailInfraServiceError as exc:
                            print(
                                "[EMAIL-INFRA][mailbox-verify] EmailInfraServiceError on attempt",
                                attempt,
                                "detail=",
                                str(exc),
                            )
                            # keep retrying until attempts exhausted
                        if attempt < 20:
                            await asyncio.sleep(10)

                    if not verified_ok:
                        raise HTTPException(
                            status_code=502,
                            detail="Email Infra mailbox was not ready after repeated verification attempts.",
                        )

                except HTTPException:
                    # re-raise HTTP errors we built above
                    raise
                except EmailInfraServiceError as exc:
                    print(
                        "[EMAIL-INFRA][mailbox-create] EmailInfraServiceError detail=",
                        str(exc),
                    )
                    await db.domains.update_one(
                        {"id": domain_id},
                        {
                            "$set": {
                                "email_infra.last_error": str(exc),
                                "email_infra.last_sync_at": datetime.now(timezone.utc),
                            }
                        },
                    )
                    raise HTTPException(
                        status_code=502,
                        detail=f"Email Infra mailbox creation failed: {str(exc)}",
                    )
                except Exception as exc:
                    # Catch any unexpected errors so we can see them in logs
                    print(
                        "[EMAIL-INFRA][mailbox-create] unexpected error type=",
                        type(exc).__name__,
                        "detail=",
                        str(exc),
                    )
                    raise HTTPException(
                        status_code=502,
                        detail="Email Infra mailbox creation failed with unexpected error.",
                    )
                await db.domains.update_one(
                    {"id": domain_id},
                    {
                        "$set": {
                            "email_infra.mailbox_id": mailbox_id,
                            "email_infra.mailbox_email": mailbox.get("email") or inbox_email,
                            "email_infra.mailbox_status": mailbox.get("status"),
                            "email_infra.mailbox_created_at": mailbox.get("created_at"),
                            "email_infra.last_error": None,
                            "email_infra.last_sync_at": datetime.now(timezone.utc),
                        }
                    },
                )

            inbox_dict["mailbox_id"] = mailbox_id

        # Validate auto warmup against plan
        auto_warmup_requested = bool(inbox_dict.get("auto_warmup"))
        if auto_warmup_requested and not has_warmup:
            raise HTTPException(
                status_code=403,
                detail="Your current plan does not include warmup. Please upgrade to enable auto warmup.",
            )

        # Require at least one warmup send template when enabling automated warmup
        if auto_warmup_requested and has_warmup:
            template_count = await db.warmup_send_templates.count_documents(
                {"user_id": inbox_dict["user_id"], "subject": {"$exists": True}, "body": {"$exists": True}}
            )
            if template_count == 0:
                raise HTTPException(
                    status_code=400,
                    detail="Add at least one warmup send template before enabling automated warmup. Go to Warmup → Manage send templates.",
                )

        # Decide initial status based on auto warmup and plan
        if auto_warmup_requested and has_warmup:
            inbox_dict["status"] = "warming"
            inbox_dict["warmup_progress"] = 0
            inbox_dict["warmup_started_at"] = datetime.now(timezone.utc)
            # Persist the user's intended warmup goal once at creation time.
            # Midnight ramp logic then derives daily_limit from this anchor.
            goal = max(1, min(50, int(inbox_dict.get("daily_limit", 50) or 50)))
            inbox_dict["warmup_daily_limit_goal"] = goal
            # Start ramp immediately on create (day-1 cap), instead of waiting for midnight.
            day1_baseline_for_goal_50 = 5
            day1_cap = int(round(day1_baseline_for_goal_50 * (goal / 50.0)))
            inbox_dict["daily_limit"] = max(1, min(goal, day1_cap))
        else:
            # No auto warmup – inbox is immediately ready
            inbox_dict["status"] = "ready"
            inbox_dict["warmup_progress"] = 100
        
        # Encrypt SMTP password if provided
        if inbox_dict.get("smtp_password") and inbox.sender_type == "smtp":
            encrypted_password = smtp_service._encrypt_password(inbox_dict["smtp_password"])
            inbox_dict["smtp_password"] = encrypted_password
        
        now_ts = datetime.now(timezone.utc)
        inbox_dict["created_at"] = now_ts
        inbox_dict["updated_at"] = now_ts
        if inbox_dict.get("campaign_rampup"):
            inbox_dict["campaign_rampup_started_at"] = inbox_dict.get("campaign_rampup_started_at") or now_ts
        else:
            inbox_dict.pop("campaign_rampup_started_at", None)

        await db.inboxes.insert_one(inbox_dict)
        if lifecycle_automation_service:
            try:
                await lifecycle_automation_service.emit_event(
                    current_user["id"],
                    "inbox_created",
                    {"inbox_id": inbox_dict.get("id"), "sender_type": inbox_dict.get("sender_type")},
                )
            except Exception:
                logger.exception("Failed to emit lifecycle inbox_created for user %s", current_user["id"])
        inbox_dict.pop("_id", None)
        inbox_dict.pop("smtp_password", None)  # Don't return password
        return _with_sender_name_fields(inbox_dict)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

def _etag_for_inboxes_payload(payload: list) -> str:
    """Compute ETag for inbox list (stable JSON hash)."""
    raw = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def _maybe_304_inboxes(request: Request, etag: str) -> Optional[Response]:
    """If client sent If-None-Match matching etag, return 304; else None."""
    inm = (request.headers.get("if-none-match") or "").strip().strip('"')
    if inm and inm == etag:
        return Response(status_code=304)
    return None


def _with_sender_name_fields(inbox: dict) -> dict:
    """Attach derived and effective sender display names for inbox settings/UI."""
    out = dict(inbox or {})
    manual = str(out.get("sender_name") or "").strip()
    auto = EmailService.get_inbox_name_from_email(str(out.get("email") or "").strip())
    out["sender_name"] = manual
    out["auto_sender_name"] = auto
    out["effective_sender_name"] = manual or auto
    return out


@router.get("/inboxes")
async def get_inboxes(request: Request, user_id: str, current_user: dict = Depends(get_current_user)):
    """List user inboxes. Supports ETag/304."""
    # Ensure users can only list their own inboxes
    if user_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    inboxes = await db.inboxes.find(
        {"user_id": user_id},
        {"_id": 0, "smtp_password": 0}
    ).sort("created_at", -1).to_list(None)
    # If there are inboxes, compute warmup flags and 7d stats in bulk using Mongo aggregations
    if inboxes:
        inbox_ids = [ibox["id"] for ibox in inboxes]
        cutoff_7d = datetime.now(timezone.utc) - timedelta(days=7)

        async def _warmup_7d_stats() -> dict[str, dict]:
            """
            Warmup engagement rates (last 7d) for all inboxes in one aggregation.
            """
            pipeline = [
                {
                    "$match": {
                        "inbox_id": {"$in": inbox_ids},
                        "sent_at": {"$gte": cutoff_7d},
                    }
                },
                {
                    "$group": {
                        "_id": "$inbox_id",
                        "sent_7d": {"$sum": 1},
                        "opened_7d": {
                            "$sum": {
                                "$cond": [
                                    {"$ne": ["$opened_at", None]},
                                    1,
                                    0,
                                ]
                            }
                        },
                        "replied_7d": {
                            "$sum": {
                                "$cond": [
                                    {"$ne": ["$replied_at", None]},
                                    1,
                                    0,
                                ]
                            }
                        },
                    }
                },
            ]
            rows = await db.warmup_sent.aggregate(pipeline).to_list(None)
            stats: dict[str, dict] = {}
            for row in rows:
                inbox_id = row.get("_id")
                if not inbox_id:
                    continue
                sent_7d = row.get("sent_7d", 0) or 0
                opened_7d = row.get("opened_7d", 0) or 0
                replied_7d = row.get("replied_7d", 0) or 0
                stats[inbox_id] = {
                    "warmup_sent_7d": sent_7d,
                    "warmup_opened_7d": opened_7d,
                    "warmup_replied_7d": replied_7d,
                    "warmup_open_rate_7d": round(opened_7d / sent_7d, 2) if sent_7d else None,
                    "warmup_reply_rate_7d": round(replied_7d / sent_7d, 2) if sent_7d else None,
                }
            return stats

        warmup_stats = await _warmup_7d_stats()

        for inbox in inboxes:
            iid = inbox.get("id")
            if not iid:
                continue
            inbox["warmup_warning"] = False
            inbox["warm_up_required"] = False
            stats = warmup_stats.get(iid)
            if stats:
                inbox.update(stats)

    inboxes = [_with_sender_name_fields(inbox) for inbox in inboxes]
    etag = _etag_for_inboxes_payload(inboxes)
    not_modified = _maybe_304_inboxes(request, etag)
    if not_modified is not None:
        return not_modified
    return JSONResponse(content=jsonable_encoder(inboxes), headers={"ETag": f'"{etag}"'})


@router.get("/inboxes/{inbox_id}/stats")
async def get_inbox_stats(inbox_id: str, current_user: dict = Depends(get_current_user)):
    """
    Get warmup / engagement stats for a single inbox.
    Mirrors the campaign stats pattern so list loading stays fast and
    detailed metrics are fetched lazily per row.
    """
    inbox = await db.inboxes.find_one(
        {"id": inbox_id},
        {"_id": 0, "user_id": 1},
    )
    if not inbox:
        raise HTTPException(status_code=404, detail="Inbox not found")
    if inbox["user_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")

    cutoff_7d = datetime.now(timezone.utc) - timedelta(days=7)

    sent_7d, opened_7d, replied_7d = await asyncio.gather(
        db.warmup_sent.count_documents(
            {"inbox_id": inbox_id, "sent_at": {"$gte": cutoff_7d}}
        ),
        db.warmup_sent.count_documents(
            {
                "inbox_id": inbox_id,
                "sent_at": {"$gte": cutoff_7d},
                "opened_at": {"$ne": None},
            }
        ),
        db.warmup_sent.count_documents(
            {
                "inbox_id": inbox_id,
                "sent_at": {"$gte": cutoff_7d},
                "replied_at": {"$ne": None},
            }
        ),
    )

    open_rate = round(opened_7d / sent_7d, 2) if sent_7d else None
    reply_rate = round(replied_7d / sent_7d, 2) if sent_7d else None

    return {
        "inbox_id": inbox_id,
        "warmup_warning": False,
        "warm_up_required": False,
        "warmup_sent_7d": sent_7d,
        "warmup_opened_7d": opened_7d,
        "warmup_replied_7d": replied_7d,
        "warmup_open_rate_7d": open_rate,
        "warmup_reply_rate_7d": reply_rate,
    }


@router.get("/inboxes/spam-score")
async def get_inbox_spam_scores(
    user_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Check StopForumSpam reputation for each inbox email and return a simple score.

    Uses the same StopForumSpam threshold (frequency >= 50) that we use for
    signup protection. No data is modified; this is read-only reputation info.
    """
    if user_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")

    inboxes = await db.inboxes.find(
        {"user_id": user_id},
        {"_id": 0, "id": 1, "email": 1},
    ).to_list(None)

    scores: list[dict] = []
    for inbox in inboxes:
        email = inbox.get("email")
        if not email:
            continue
        ok, message = check_stop_forum_spam(email)
        frequency = None
        match = re.search(r"email frequency (\d+)", message)
        if match:
            try:
                frequency = int(match.group(1))
            except ValueError:
                frequency = None
        scores.append(
            {
                "inbox_id": inbox["id"],
                "email": email,
                "stop_forum_spam_ok": ok,
                "message": message,
                "frequency": frequency,
            }
        )

    return JSONResponse(content={"scores": scores})

@router.get("/inboxes/{inbox_id}")
async def get_inbox(inbox_id: str, current_user: dict = Depends(get_current_user)):
    """Get inbox details"""
    inbox = await db.inboxes.find_one(
        {"id": inbox_id},
        {"_id": 0, "smtp_password": 0}
    )
    if not inbox:
        raise HTTPException(status_code=404, detail="Inbox not found")
    if inbox["user_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    inbox = _with_sender_name_fields(inbox)
    # Warmup engagement rates (last 7d)
    cutoff_7d = datetime.now(timezone.utc) - timedelta(days=7)
    sent_7d = await db.warmup_sent.count_documents(
        {"inbox_id": inbox_id, "sent_at": {"$gte": cutoff_7d}}
    )
    opened_7d = await db.warmup_sent.count_documents(
        {"inbox_id": inbox_id, "sent_at": {"$gte": cutoff_7d}, "opened_at": {"$ne": None}}
    )
    replied_7d = await db.warmup_sent.count_documents(
        {"inbox_id": inbox_id, "sent_at": {"$gte": cutoff_7d}, "replied_at": {"$ne": None}}
    )
    inbox["warmup_sent_7d"] = sent_7d
    inbox["warmup_opened_7d"] = opened_7d
    inbox["warmup_replied_7d"] = replied_7d
    inbox["warmup_open_rate_7d"] = round(opened_7d / sent_7d, 2) if sent_7d else None
    inbox["warmup_reply_rate_7d"] = round(replied_7d / sent_7d, 2) if sent_7d else None
    return JSONResponse(content=jsonable_encoder(inbox))


@router.post("/inboxes/{inbox_id}/mailbox-password")
async def set_inbox_mailbox_password(
    inbox_id: str,
    body: SetMailboxPasswordBody,
    current_user: dict = Depends(get_current_user),
):
    """Set password for mailbox web login at /mailbox/login (account owner)."""
    existing = await db.inboxes.find_one({"id": inbox_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Inbox not found")
    if existing["user_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    pwd = (body.password or "").strip()
    if len(pwd) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    now = datetime.now(timezone.utc)
    new_hash = get_password_hash(pwd)
    await db.inboxes.update_one(
        {"id": inbox_id},
        {"$set": {"mailbox_password_hash": new_hash, "updated_at": now}},
    )
    return {"message": "Mailbox login password has been set."}


@router.put("/inboxes/{inbox_id}")
async def update_inbox(inbox_id: str, inbox: Inbox, current_user: dict = Depends(get_current_user)):
    """Update inbox settings"""
    try:
        existing = await db.inboxes.find_one({"id": inbox_id})
        if not existing:
            raise HTTPException(status_code=404, detail="Inbox not found")
        if existing["user_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Forbidden")

        # This endpoint is used by the UI for *partial* inbox updates.
        # Use `exclude_unset=True` so fields the client didn't send don't reset to defaults.
        update_data = inbox.model_dump(exclude={"id", "user_id", "created_at"}, exclude_unset=True)
        
        # Encrypt password if provided
        if "smtp_password" in update_data and update_data["smtp_password"]:
            encrypted_password = smtp_service._encrypt_password(update_data["smtp_password"])
            update_data["smtp_password"] = encrypted_password
        if "sender_name" in update_data:
            update_data["sender_name"] = str(update_data.get("sender_name") or "").strip()
        
        # When enabling campaign ramp-up, restart the ramp timer from "now".
        if "campaign_rampup" in update_data:
            now_ts = datetime.now(timezone.utc)
            update_data["campaign_rampup_started_at"] = now_ts if update_data.get("campaign_rampup") else None

        update_data["updated_at"] = datetime.now(timezone.utc)
        
        await db.inboxes.update_one(
            {"id": inbox_id},
            {"$set": update_data}
        )
        
        updated = await db.inboxes.find_one(
            {"id": inbox_id},
            {"_id": 0, "smtp_password": 0}
        )
        return _with_sender_name_fields(updated or {})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/inboxes/{inbox_id}")
async def patch_inbox(inbox_id: str, payload: InboxStatusUpdate, current_user: dict = Depends(get_current_user)):
    """Partially update inbox (e.g. status for pause/resume warmup)."""
    existing = await db.inboxes.find_one({"id": inbox_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Inbox not found")
    if existing["user_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return await db.inboxes.find_one({"id": inbox_id}, {"_id": 0, "smtp_password": 0})
    if "status" in update_data and update_data["status"] not in ("warming", "ready", "paused"):
        raise HTTPException(status_code=400, detail="status must be warming, ready, or paused")
    if update_data.get("status") == "warming" and plan_service:
        limits = await plan_service.get_user_limits(current_user)
        if not limits.get("warmup"):
            raise HTTPException(
                status_code=403,
                detail="Your current plan does not include warmup. Please upgrade to enable warmup.",
            )
    if update_data.get("status") == "warming":
        owner = await db.users.find_one(
            {"id": current_user["id"]},
            {"subscription_status": 1, "subscription_start": 1, "subscription_end": 1, "plan_id": 1},
        )
        if owner and user_subscription_blocks_outbound(owner):
            raise HTTPException(
                status_code=403,
                detail=outbound_subscription_block_message(owner)
                or "Fix your subscription in Settings → Billing before resuming warmup.",
            )
    update_data["updated_at"] = datetime.now(timezone.utc)
    await db.inboxes.update_one({"id": inbox_id}, {"$set": update_data})
    return await db.inboxes.find_one({"id": inbox_id}, {"_id": 0, "smtp_password": 0})


@router.post("/inboxes/{inbox_id}/pause")
async def pause_inbox_warmup(inbox_id: str, current_user: dict = Depends(get_current_user)):
    """Set inbox status to paused (stop warmup)."""
    existing = await db.inboxes.find_one({"id": inbox_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Inbox not found")
    if existing["user_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    await db.inboxes.update_one(
        {"id": inbox_id},
        {
            "$set": {
                "status": "paused",
                "auto_warmup": False,
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )
    return await db.inboxes.find_one({"id": inbox_id}, {"_id": 0, "smtp_password": 0})


@router.post("/inboxes/{inbox_id}/resume")
async def resume_inbox_warmup(
    inbox_id: str,
    payload: Optional[ResumeBody] = Body(None),
    current_user: dict = Depends(get_current_user),
):
    """Set inbox status to warming and enable auto_warmup (start/resume warmup).
    If warmup was already 100%, reset progress to 0 so warmup runs again; otherwise keep current progress.
    Optionally accepts { warmup_engagement_mode: 'pool' | 'network' | 'network_plus_shared' | 'hybrid' | 'shared_pool' }
    to choose engagement mode."""
    existing = await db.inboxes.find_one({"id": inbox_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Inbox not found")
    if existing["user_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    if plan_service:
        limits = await plan_service.get_user_limits(current_user)
        if not limits.get("warmup"):
            raise HTTPException(
                status_code=403,
                detail="Your current plan does not include warmup. Please upgrade to enable warmup.",
            )
    owner = await db.users.find_one(
        {"id": current_user["id"]},
        {"subscription_status": 1, "subscription_start": 1, "subscription_end": 1, "plan_id": 1},
    )
    if owner and user_subscription_blocks_outbound(owner):
        raise HTTPException(
            status_code=403,
            detail=outbound_subscription_block_message(owner)
            or "Fix your subscription in Settings → Billing before resuming warmup.",
        )
    requested_mode = (payload.warmup_engagement_mode if payload else None) or existing.get("warmup_engagement_mode") or "pool"
    # Validate that network/hybrid mode has at least one contact
    if requested_mode in ("network", "network_plus_shared", "hybrid"):
        contact_count = await db.warmup_network_contacts.count_documents({"user_id": current_user["id"]})
        if contact_count == 0:
            raise HTTPException(
                status_code=400,
                detail="Your Warmup Network has no contacts. Add at least one contact before using real engagement mode.",
            )
    if requested_mode in ("shared_pool", "network_plus_shared"):
        credits_balance = await credit_service.get_balance(current_user["id"])
        if credits_balance <= 0:
            raise HTTPException(
                status_code=400,
                detail="You do not have credits to use the Personal Network Pool. Top up credits first.",
            )
        available_contacts = await shared_pool_service.count_available_contacts(exclude_user_id=current_user["id"])
        if available_contacts <= 0:
            raise HTTPException(
                status_code=400,
                detail="The Personal Network Pool does not have enough eligible contacts right now.",
            )
    now_utc = datetime.now(timezone.utc)
    set_fields = {
        "status": "warming",
        "auto_warmup": True,
        "warmup_engagement_mode": requested_mode,
        "updated_at": now_utc,
    }
    if existing.get("warmup_progress", 0) == 100:
        set_fields["warmup_progress"] = 0
        set_fields["warmup_started_at"] = now_utc  # fresh 30-day period when "warm again"
    await db.inboxes.update_one(
        {"id": inbox_id},
        {"$set": set_fields},
    )
    return await db.inboxes.find_one({"id": inbox_id}, {"_id": 0, "smtp_password": 0})


@router.post("/inboxes/{inbox_id}/test")
async def test_inbox(inbox_id: str, current_user: dict = Depends(get_current_user)):
    """Test inbox connection"""
    try:
        inbox = await db.inboxes.find_one({"id": inbox_id})
        if not inbox:
            raise HTTPException(status_code=404, detail="Inbox not found")
        if inbox["user_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Forbidden")
        
        if inbox.get("sender_type") == "smtp":
            result = await smtp_service.test_smtp_connection(inbox_id)
            return {"connected": result}
        elif inbox.get("sender_type") == "gmail":
            if inbox.get("gmail_auth_method") == "app_password":
                enc = inbox.get("gmail_app_password_encrypted")
                if not enc:
                    return {"connected": False}
                try:
                    password = smtp_service._decrypt_password(enc)
                except Exception:
                    return {"connected": False}
                ok, _ = await _test_gmail_app_password_connection(inbox["email"], password)
                return {"connected": ok}
            # OAuth Gmail
            is_connected = await gmail_service.is_connected(inbox.get("gmail_credentials_id") or inbox.get("user_id"))
            return {"connected": is_connected}
        else:
            raise HTTPException(status_code=400, detail="Unknown sender type")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/inboxes/{inbox_id}/force-ready")
async def force_ready_inbox(inbox_id: str, current_user: dict = Depends(get_current_user)):
    """Force warmup complete for an inbox (dev/testing helper)"""
    try:
        inbox = await db.inboxes.find_one({"id": inbox_id})
        if not inbox:
            raise HTTPException(status_code=404, detail="Inbox not found")
        if inbox["user_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Forbidden")

        await db.inboxes.update_one(
            {"id": inbox_id},
            {
                "$set": {
                    "status": "ready",
                    "warmup_progress": 100,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )
        return {"message": "Inbox forced to ready"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/inboxes/{inbox_id}")
async def delete_inbox(inbox_id: str, current_user: dict = Depends(get_current_user)):
    """Delete inbox"""
    inbox = await db.inboxes.find_one({"id": inbox_id})
    if not inbox:
        raise HTTPException(status_code=404, detail="Inbox not found")
    if inbox["user_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    await db.inboxes.delete_one({"id": inbox_id})
    return {"message": "Inbox deleted"}
