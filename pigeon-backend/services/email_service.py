from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import html
import json
import random
import asyncio
import re
import uuid
import os
import logging
import hashlib
from typing import Awaitable, Callable, List, Optional, Set, Tuple
from zoneinfo import ZoneInfo

from markdown_it import MarkdownIt
from pymongo import UpdateOne

from config import BLOCK_AFTER_EMAILS
from services.smtp_service import SendGridForbiddenError, EmailInfraWarmupDelayError, DomainRateLimitError
from services.campaign_rampup import effective_campaign_daily_limit
from services.warmup_shared_pool_service import SHARED_POOL_CREDITS_PER_SEND, WarmupSharedPoolService
from services.credit_service import CreditService
from services.campaign_enrichment_service import generate_enriched_email_content
from services.plan_service import (
    MonthlySmtpQuotaExceeded,
    outbound_subscription_block_message,
    user_subscription_blocks_outbound,
)

# Set EMAIL_DEBUG=1 in .env to see detailed warnings in server logs only (not exposed to users)
_EMAIL_DEBUG = os.environ.get("EMAIL_DEBUG", "").strip().lower() in ("1", "true", "yes")

DEFAULT_COMPLIANCE = {
    "max_links_per_email": 3,
    "max_images_per_email": 2,
    "require_unsubscribe_link": False,
}


def normalize_schedule_weekdays_from_campaign(campaign: dict) -> set:
    """Which weekdays may send: 0=Monday .. 6=Sunday. Missing/empty defaults to Mon–Fri."""
    raw = campaign.get("schedule_weekdays")
    default = {0, 1, 2, 3, 4}
    if raw is None:
        return default
    if not isinstance(raw, list) or len(raw) == 0:
        return default
    try:
        out = {int(x) for x in raw if 0 <= int(x) <= 6}
    except (TypeError, ValueError):
        return default
    return out if out else default


def next_campaign_window_start_utc(
    now_utc: datetime,
    *,
    tz_name: str,
    start_time_str: str,
    allowed_weekdays: set,
) -> datetime:
    """Next moment at start_time on an allowed weekday in tz_name, returned as UTC."""
    try:
        tz = ZoneInfo(tz_name.strip())
    except Exception:
        tz = timezone.utc
    try:
        sh, sm = map(int, start_time_str.strip().split(":", 1))
    except Exception:
        sh, sm = 9, 0
    now_local = now_utc.astimezone(tz)
    days = allowed_weekdays if allowed_weekdays else {0, 1, 2, 3, 4}
    for delta in range(0, 8):
        day = now_local.date() + timedelta(days=delta)
        wd = day.weekday()
        if wd not in days:
            continue
        candidate = datetime(
            day.year,
            day.month,
            day.day,
            sh,
            sm,
            0,
            0,
            tzinfo=tz,
        )
        if candidate > now_local:
            return candidate.astimezone(timezone.utc)
    return now_utc + timedelta(days=1)

# Human-like sending pattern: internal only, not exposed in API or UI
MIN_GAP_MINUTES = 0.5
MAX_COFFEE_BREAK_MINUTES = 45
# Per-inbox weekly rhythm: on "light" days we stretch gaps by this multiplier (more human variation)
WEEKLY_RHYTHM_LIGHT_DAY_GAP_MULTIPLIER = 1.3
# Humans sometimes break rhythm: chance to act normal on a light day, or act slower on a normal day
RHYTHM_BREAK_PROBABILITY = 0.15  # 15%: on light day, don't stretch (break the pattern)
RHYTHM_SURPRISE_SLOW_PROBABILITY = 0.08  # 8%: on normal day, add a small stretch anyway
RHYTHM_SURPRISE_SLOW_MULTIPLIER = 1.15  # When "surprise slow", use this multiplier

# A/B auto-winner: min sends per variant and time/total thresholds; weighted score reply vs open
MIN_SENDS_PER_VARIANT = int(os.environ.get("AB_MIN_SENDS_PER_VARIANT", "50"))
MIN_HOURS_FOR_WINNER = float(os.environ.get("AB_MIN_HOURS", "24"))
MIN_TOTAL_SENDS_FOR_WINNER = int(os.environ.get("AB_MIN_TOTAL_SENDS", "200"))
REPLY_WEIGHT = float(os.environ.get("AB_REPLY_WEIGHT", "0.6"))
OPEN_WEIGHT = float(os.environ.get("AB_OPEN_WEIGHT", "0.4"))
# Re-evaluation: after winner is set, re-check cumulative performance and switch if another variant does better
REEVAL_MIN_HOURS = float(os.environ.get("AB_REEVAL_MIN_HOURS", "24"))  # Only re-eval after winner set this long
REEVAL_MIN_IMPROVEMENT = float(os.environ.get("AB_REEVAL_MIN_IMPROVEMENT", "0.0"))  # Only switch if new best score is this much higher

# Per-inbox per-recipient-domain daily send limit: prevents targeting the same company too heavily.
# Set CAMPAIGN_DOMAIN_DAILY_LIMIT in .env to override (e.g. 10 for larger enterprise lists).
DOMAIN_DAILY_LIMIT = int(os.environ.get("CAMPAIGN_DOMAIN_DAILY_LIMIT", "3"))

# Public/consumer email providers are exempt from the per-domain daily limit because their
# domains (gmail.com, outlook.com, …) are shared by millions of unrelated individuals —
# the limit is only meaningful for corporate domains where all users belong to the same company.
_PUBLIC_EMAIL_DOMAINS = frozenset({
    "gmail.com", "googlemail.com",
    "outlook.com", "hotmail.com", "hotmail.co.uk", "hotmail.fr", "live.com", "msn.com",
    "yahoo.com", "yahoo.co.uk", "yahoo.fr", "yahoo.de", "yahoo.in", "yahoo.com.au",
    "icloud.com", "me.com", "mac.com",
    "aol.com",
    "protonmail.com", "proton.me",
    "zoho.com",
    "mail.com", "gmx.com", "gmx.net", "gmx.de",
    "yandex.com", "yandex.ru",
    "rediffmail.com",
    "tutanota.com",
})

# Max retries for a contact when a send fails; after this many failures for a step, skip the contact
MAX_FAILED_RETRIES = int(os.environ.get("CAMPAIGN_MAX_FAILED_RETRIES", "3"))
# When next send would require waiting longer than this (min), exit batch and schedule next at that time
# instead of sleeping. Avoids long-running batches blocking the semaphore when gaps are 20+ min.
MAX_SLEEP_BEFORE_DEFER_MINUTES = int(os.environ.get("CAMPAIGN_MAX_SLEEP_BEFORE_DEFER_MINUTES", "5"))


def is_gmail_smtp_web_login_required_error(exc: BaseException) -> bool:
    """Gmail SMTP 534 / WebLoginRequired — account needs browser sign-in; skip sender instead of halting the campaign."""
    raw = str(exc)
    if "534" not in raw:
        return False
    low = raw.lower()
    return (
        "webloginrequired" in raw
        or "5.7.9" in raw
        or "web browser" in low
        or "p=webloginrequired" in low
    )


@dataclass
class SendingPattern:
    pattern_type: str  # "steady" | "bursty" | "ramp_up" | "very_safe"
    min_gap_minutes: float
    max_gap_minutes: float
    burst_probability: float
    burst_min_minutes: float
    burst_max_minutes: float
    coffee_break_every: int
    coffee_break_min_minutes: float
    coffee_break_max_minutes: float
    jitter_minutes: float


class EmailService:
    def __init__(self, db, gmail_service, llm_service, smtp_service=None, imap_reply_service=None, plan_service=None):
        self.db = db
        self.gmail_service = gmail_service
        self.llm_service = llm_service
        self.smtp_service = smtp_service
        self.imap_reply_service = imap_reply_service
        self.plan_service = plan_service
        self.lifecycle_automation_service = None
        self.automation_service = None
        self._log = logging.getLogger(__name__)

    def set_automation_service(self, service) -> None:
        """Optional: cancel/stop batch jobs when pausing campaigns from the send pipeline."""
        self.automation_service = service

    def set_lifecycle_automation_service(self, service) -> None:
        """Attach lifecycle automation service for campaign event hooks."""
        self.lifecycle_automation_service = service

    def _dev_warn(self, msg: str, *args, **kwargs) -> None:
        """Print warning when EMAIL_DEBUG=1 (re-read env each time so .env is respected)."""
        if os.environ.get("EMAIL_DEBUG", "").strip().lower() in ("1", "true", "yes"):
            text = "[EMAIL_DEBUG] " + (msg % args if args else msg)
            print(text, flush=True)

    def _batch_log(self, msg: str, *args) -> None:
        """Always print to terminal so you see campaign batch activity (no env var)."""
        text = "[CAMPAIGN_BATCH] " + (msg % args if args else msg)
        print(text, flush=True)

    async def _notify_gmail_smtp_web_login_skipped_sender(
        self,
        *,
        user_id: str,
        inbox_id: str,
        inbox_email: Optional[str],
        campaign_name: Optional[str],
    ) -> None:
        """In-app alert (db.alerts) only. Deduped per inbox within 6 hours."""
        try:
            since = datetime.now(timezone.utc) - timedelta(hours=6)
            dup = await self.db.alerts.find_one(
                {
                    "user_id": user_id,
                    "inbox_id": inbox_id,
                    "alert_kind": "gmail_smtp_web_login_required",
                    "time": {"$gte": since},
                }
            )
            if dup:
                return
        except Exception as ex:
            logging.warning("Gmail WebLoginRequired alert dedup check failed: %s", ex)

        now = datetime.now(timezone.utc)
        em = inbox_email or inbox_id
        cn = (campaign_name or "").strip() or "your campaign"
        message = (
            f"Google blocked SMTP from {em} (browser sign-in required). "
            f'This account was removed from senders for "{cn}" so the campaign can continue with other mailboxes. '
            f"Check Google Account security, then reconnect or send a test from Settings → Integrations."
        )
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "type": "warning",
            "title": "Gmail sender skipped — sign in required",
            "message": message,
            "time": now,
            "is_read": False,
            "actionable": True,
            "action_link": "/settings?tab=integrations",
            "created_at": now,
            "alert_kind": "gmail_smtp_web_login_required",
            "inbox_id": inbox_id,
        }
        try:
            await self.db.alerts.insert_one(doc)
        except Exception as ex:
            logging.warning("failed to insert Gmail WebLoginRequired in-app alert: %s", ex)

    @staticmethod
    def inbox_counts_against_smtp_monthly_quota(inbox: Optional[dict]) -> bool:
        """True when send uses SMTP transport for plan monthly SMTP cap (domain SMTP or Gmail app password)."""
        if not inbox:
            return False
        if inbox.get("sender_type") == "smtp":
            return True
        if inbox.get("sender_type") == "gmail" and inbox.get("gmail_auth_method") == "app_password":
            return True
        return False

    @staticmethod
    def metering_log_sender_fields(inbox: Optional[dict]) -> Tuple[str, bool]:
        """(sender_type, counts_as_smtp) for email_logs rows used by PlanService.monthly_smtp_emails_sent."""
        if not inbox:
            return ("smtp", False)
        st = (inbox.get("sender_type") or "smtp").strip().lower()
        if st not in ("smtp", "gmail"):
            st = "smtp"
        if st == "smtp":
            return ("smtp", False)
        if inbox.get("gmail_auth_method") == "app_password":
            return ("gmail", True)
        return ("gmail", False)

    async def assert_smtp_monthly_quota_if_needed(self, user_id: str, inbox: Optional[dict]) -> None:
        if not self.plan_service or not self.inbox_counts_against_smtp_monthly_quota(inbox):
            return
        await self.plan_service.assert_monthly_smtp_quota(user_id)

    async def record_outbound_send_for_usage(
        self,
        *,
        user_id: str,
        sender_id: str,
        send_source: str,
        to_email: str,
        subject: str,
        inbox: Optional[dict] = None,
        message_id: Optional[str] = None,
        template_id: Optional[str] = None,
        campaign_id: Optional[str] = None,
        contact_id: Optional[str] = None,
    ) -> str:
        """Insert a minimal email_logs row so monthly SMTP/Gmail usage and analytics stay accurate.

        send_source: warmup, template_test, connection_test, mailbox_compose, mailbox_reply_inbound,
        mailbox_reply_thread, deliverability_probe, etc. Campaign sends use the full send_email log instead.
        """
        now = datetime.now(timezone.utc)
        log_id = str(uuid.uuid4())
        to_clean = (to_email or "").strip().lower()
        recipient_domain = to_clean.split("@", 1)[1].strip().lower() if "@" in to_clean else ""

        sender_type, counts_as_smtp = self.metering_log_sender_fields(inbox)

        doc: dict = {
            "id": log_id,
            "user_id": user_id,
            "status": "sent",
            "sender_id": sender_id,
            "sender_type": sender_type,
            "send_source": send_source,
            "subject": (subject or "")[:500],
            "body": "",
            "sent_at": now,
            "scheduled_at": now,
            "created_at": now,
            "recipient_domain": recipient_domain,
        }
        if counts_as_smtp:
            doc["counts_as_smtp"] = True
        if template_id:
            doc["template_id"] = template_id
        if campaign_id:
            doc["campaign_id"] = campaign_id
        if contact_id:
            doc["contact_id"] = contact_id
        if sender_type == "gmail":
            doc["gmail_message_id"] = message_id
        else:
            doc["smtp_message_id"] = message_id

        await self.db.email_logs.insert_one(doc)
        return log_id

    async def _ensure_subscription_allows_outbound_send(self, user_id: str) -> None:
        user = await self.db.users.find_one(
            {"id": user_id},
            {"subscription_status": 1, "subscription_start": 1, "subscription_end": 1, "plan_id": 1},
        )
        msg = outbound_subscription_block_message(user or {})
        if msg:
            raise Exception(msg)

    async def _pause_campaigns_for_subscription_block(self, campaign_id: str, user_id: str, user: dict) -> dict:
        """Pause all active campaigns for user when subscription gate blocks sends; return batch result shape."""
        now_utc = datetime.now(timezone.utc)
        msg = outbound_subscription_block_message(user) or (
            "Sending is paused due to your subscription status. Check Settings → Billing."
        )
        if self.automation_service:
            await self.automation_service.pause_all_active_campaigns_for_user(user_id)
        else:
            await self.db.campaigns.update_one(
                {"id": campaign_id},
                {
                    "$set": {
                        "status": "paused",
                        "last_error_note": msg,
                        "last_error_at": now_utc,
                        "updated_at": now_utc,
                    }
                },
            )
        await self.db.inboxes.update_many(
            {"user_id": user_id, "status": "warming"},
            {"$set": {"status": "paused", "auto_warmup": False, "updated_at": now_utc}},
        )
        await self.db.campaigns.update_one(
            {"id": campaign_id},
            {"$set": {"last_error_note": msg, "last_error_at": now_utc, "updated_at": now_utc}},
        )
        self._batch_log(
            "send_campaign_batch ABORT: subscription gate user_id=%s campaign_id=%s msg=%s",
            user_id,
            campaign_id,
            msg[:80],
        )
        return {
            "message": msg,
            "sent": 0,
            "gmail_send_failed_stop_campaign": True,
            "subscription_pending_paused": True,
            "subscription_window_blocked": True,
        }

    def _choose_sending_pattern(
        self,
        campaign: dict,
        inboxes: list,
        pending_count: int,
        now_local: datetime,
    ) -> SendingPattern:
        """Pick pattern from backend signals only (no user input). Returns one pattern for the whole batch."""
        tz_name = (campaign.get("timezone") or "America/New_York").strip()
        hour = now_local.hour

        # Risk: any inbox < 7 days old -> high; any inbox sent_today/daily_limit > 0.8 -> medium/high
        today_utc = datetime.now(timezone.utc).date()
        high_risk = False
        medium_risk = False
        for inv in inboxes:
            created_at = inv.get("created_at")
            if created_at:
                if isinstance(created_at, str):
                    try:
                        created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                    except Exception:
                        created_at = datetime.now(timezone.utc)
                if getattr(created_at, "tzinfo", None) is None and hasattr(created_at, "replace"):
                    created_at = created_at.replace(tzinfo=timezone.utc)
                created_date = created_at.date() if hasattr(created_at, "date") else today_utc
                days_ago = (today_utc - created_date).days
                if days_ago < 7:
                    high_risk = True
                    break
            st = inv.get("sent_today", 0) or 0
            dl = effective_campaign_daily_limit(inv)
            if st / dl > 0.8:
                medium_risk = True

        # Time of day: outside 8-18 local -> nudge safer
        outside_business = hour < 8 or hour >= 18

        if high_risk or (medium_risk and outside_business):
            return SendingPattern(
                pattern_type="very_safe",
                min_gap_minutes=12.0,
                max_gap_minutes=25.0,
                burst_probability=0.0,
                burst_min_minutes=1.0,
                burst_max_minutes=3.0,
                coffee_break_every=5,
                coffee_break_min_minutes=15.0,
                coffee_break_max_minutes=min(30.0, MAX_COFFEE_BREAK_MINUTES),
                jitter_minutes=2.0,
            )
        if medium_risk:
            return SendingPattern(
                pattern_type="steady",
                min_gap_minutes=7.0,
                max_gap_minutes=18.0,
                burst_probability=0.0,
                burst_min_minutes=1.0,
                burst_max_minutes=3.0,
                coffee_break_every=6,
                coffee_break_min_minutes=15.0,
                coffee_break_max_minutes=min(28.0, MAX_COFFEE_BREAK_MINUTES),
                jitter_minutes=2.0,
            )
        if pending_count > 20:
            return SendingPattern(
                pattern_type="bursty",
                min_gap_minutes=4.0,
                max_gap_minutes=12.0,
                burst_probability=0.2,
                burst_min_minutes=1.0,
                burst_max_minutes=3.0,
                coffee_break_every=8,
                coffee_break_min_minutes=15.0,
                coffee_break_max_minutes=min(30.0, MAX_COFFEE_BREAK_MINUTES),
                jitter_minutes=2.5,
            )
        return SendingPattern(
            pattern_type="steady",
            min_gap_minutes=5.0,
            max_gap_minutes=15.0,
            burst_probability=0.0,
            burst_min_minutes=1.0,
            burst_max_minutes=3.0,
            coffee_break_every=6,
            coffee_break_min_minutes=15.0,
            coffee_break_max_minutes=min(25.0, MAX_COFFEE_BREAK_MINUTES),
            jitter_minutes=2.0,
        )

    async def _ensure_inbox_weekly_rhythm(self, inbox_id: str) -> List[int]:
        """Get per-inbox 'light' weekdays (0=Mon..6=Sun). Generate and store randomly if not set. Used for weekly rhythm: on light days we use longer gaps."""
        inbox = await self.db.inboxes.find_one(
            {"id": inbox_id},
            {"weekly_rhythm_light_days": 1},
        )
        if inbox and isinstance(inbox.get("weekly_rhythm_light_days"), list):
            days = [int(x) for x in inbox["weekly_rhythm_light_days"] if isinstance(x, (int, float)) and 0 <= int(x) <= 6]
            if days:
                return days
        # Generate 1 or 2 random weekdays as "light" days for this inbox
        num_light = random.randint(1, 2)
        light_days = sorted(random.sample(range(7), num_light))
        await self.db.inboxes.update_one(
            {"id": inbox_id},
            {"$set": {"weekly_rhythm_light_days": light_days}},
        )
        return light_days

    def _next_gap_minutes(
        self,
        pattern: SendingPattern,
        sends_since_coffee_break: int,
        is_first_send_from_inbox_today: bool,
    ) -> Tuple[float, bool]:
        """Return (delay_minutes, was_coffee_break) before this inbox's next send."""
        # Even for the very first send of the day, add a small random delay so
        # multiple inboxes don't all fire at exactly the same moment. This
        # smooths out the initial "mini-burst" and looks more human.
        if is_first_send_from_inbox_today:
            # Short warm-up window: between MIN_GAP_MINUTES and the pattern's
            # min gap (capped so it doesn't become excessively long).
            upper = max(MIN_GAP_MINUTES, min(pattern.min_gap_minutes, 10.0))
            gap = random.uniform(MIN_GAP_MINUTES, upper)
            return (gap, False)
        if sends_since_coffee_break >= pattern.coffee_break_every:
            gap = random.uniform(
                pattern.coffee_break_min_minutes,
                min(pattern.coffee_break_max_minutes, MAX_COFFEE_BREAK_MINUTES),
            )
            return (gap, True)
        if pattern.pattern_type in ("bursty", "ramp_up") and pattern.burst_probability > 0:
            if random.random() < pattern.burst_probability:
                gap = random.uniform(pattern.burst_min_minutes, pattern.burst_max_minutes)
                jitter = random.uniform(-pattern.jitter_minutes, pattern.jitter_minutes)
                gap = max(MIN_GAP_MINUTES, gap + jitter)
                return (gap, False)
        gap = random.uniform(pattern.min_gap_minutes, pattern.max_gap_minutes)
        jitter = random.uniform(-pattern.jitter_minutes, pattern.jitter_minutes)
        gap = max(MIN_GAP_MINUTES, gap + jitter)
        return (gap, False)

    async def _load_per_inbox_sending_state(
        self,
        sender_ids: list,
        today_start: datetime,
        pattern: SendingPattern,
    ) -> Tuple[dict, dict]:
        """Load last_sent_at and sends_since_coffee_break per inbox from email_logs. Returns (last_sent_at_by_inbox, sends_since_coffee_break_by_inbox)."""
        pipeline = [
            {
                "$match": {
                    "sender_id": {"$in": sender_ids},
                    "sent_at": {"$gte": today_start},
                    "status": "sent",
                }
            },
            {
                "$group": {
                    "_id": "$sender_id",
                    "last_sent_at": {"$max": "$sent_at"},
                    "count": {"$sum": 1},
                }
            },
        ]
        cursor = await self.db.email_logs.aggregate(pipeline).to_list(None)
        last_sent_at_by_inbox = {}
        sends_since_coffee_break_by_inbox = {}
        for doc in cursor:
            sid = doc["_id"]
            last = doc["last_sent_at"]
            # Normalize to timezone-aware UTC to avoid "can't compare offset-naive and offset-aware datetimes"
            if isinstance(last, datetime):
                if last.tzinfo is None:
                    last = last.replace(tzinfo=timezone.utc)
                else:
                    last = last.astimezone(timezone.utc)
            last_sent_at_by_inbox[sid] = last
            count = doc["count"]
            sends_since_coffee_break_by_inbox[sid] = count % pattern.coffee_break_every if pattern.coffee_break_every else 0
        # Inboxes with no sends today: can send immediately; first send today
        for sid in sender_ids:
            if sid not in last_sent_at_by_inbox:
                last_sent_at_by_inbox[sid] = today_start.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(hours=1)
            if sid not in sends_since_coffee_break_by_inbox:
                sends_since_coffee_break_by_inbox[sid] = 0
        return last_sent_at_by_inbox, sends_since_coffee_break_by_inbox

    async def _filter_blocked_contacts(self, user_id: str, contact_ids: list) -> list:
        """Return contact_ids that are not blocked (pending + global emails sent >= BLOCK_AFTER_EMAILS)."""
        if not contact_ids:
            return []
        contacts = await self.db.contacts.find(
            {"id": {"$in": contact_ids}, "user_id": user_id},
            {"_id": 0, "id": 1, "status": 1, "manual_unblock": 1},
        ).to_list(None)
        contact_by_id = {c["id"]: c for c in contacts}
        pipeline = [
            {
                "$match": {
                    "user_id": user_id,
                    "contact_id": {"$in": contact_ids},
                    "status": {"$in": ["sent", "opened", "clicked", "replied"]},
                }
            },
            {"$group": {"_id": "$contact_id", "count": {"$sum": 1}}},
        ]
        counts_cursor = await self.db.email_logs.aggregate(pipeline).to_list(None)
        global_sent = {x["_id"]: x["count"] for x in counts_cursor}
        result = []
        for cid in contact_ids:
            c = contact_by_id.get(cid)
            if not c:
                result.append(cid)
                continue
            status = (c.get("status") or "pending").lower()
            sent_count = global_sent.get(cid, 0)

            # Unsubscribed contacts are excluded (same as block) unless manually unblocked
            if status == "unsubscribed":
                if c.get("manual_unblock"):
                    result.append(cid)
                continue
            # Blocked (3+ failed delivery attempts) unless manually unblocked
            if status == "blocked":
                if c.get("manual_unblock"):
                    result.append(cid)
                continue
            # If already engaged/verified, they are never blocked
            if status in ["opened", "clicked", "replied"]:
                result.append(cid)
            # Manual unblock overrides the limit
            elif c.get("manual_unblock"):
                result.append(cid)
            # Otherwise, check if they've reached the global limit
            elif sent_count < BLOCK_AFTER_EMAILS:
                result.append(cid)
        return result

    def _parse_email_json(self, raw: str) -> Optional[dict]:
        """Parse AI output as JSON with subject/body. Strips markdown code fence if present. Returns None on failure."""
        if not raw or not raw.strip():
            return None
        s = raw.strip()
        # Strip ```json ... ``` or ``` ... ```
        for prefix in ("```json", "```"):
            if s.startswith(prefix):
                s = s[len(prefix):].strip()
            if s.endswith("```"):
                s = s[:-3].strip()
        try:
            out = json.loads(s)
            if isinstance(out, dict) and "subject" in out and "body" in out:
                return {"subject": str(out["subject"]), "body": str(out["body"])}
        except (json.JSONDecodeError, TypeError):
            pass
        return None

    async def generate_email_content(
        self,
        user_id: str,
        contact_id: str,
        template_id: str,
        provider: str
    ) -> dict:
        """Generate personalized email content using AI"""
        # Get contact
        contact = await self.db.contacts.find_one({"id": contact_id})
        if not contact:
            raise Exception("Contact not found")
        
        # Get template
        template = await self.db.templates.find_one({"id": template_id})
        if not template:
            raise Exception("Template not found")
        
        # Get campaign to get AI prompt
        campaign = await self.db.campaigns.find_one({
            "template_ids": template_id,
            "user_id": user_id
        })
        
        if not campaign or not campaign.get("ai_prompt"):
            raise Exception("No AI prompt configured")
        
        body_type = template.get("body_type", "html")
        is_html = body_type == "html" or (
            template.get("body") and ("<" in template["body"] and ">" in template["body"])
        )
        html_instruction = (
            "The template body is HTML. You MUST preserve the exact HTML structure, all tags, and all styles (e.g. <p>, <ul>, <li>, <strong>, style=..., class=...). "
            "Only change the text content inside the tags—rewrite the words and sentences to personalize or vary the message. "
            "Do NOT remove, add, or alter any HTML tags or attributes; keep format and styles the same."
        ) if is_html else (
            "The template body is plain text. Return plain text in BODY. Do not use markdown (**bold** or [text](url))."
        )
        # Build prompt with contact data
        prompt = f"""{campaign['ai_prompt']}

Contact Information:
- First Name: {contact.get('first_name', 'N/A')}
- Last Name: {contact.get('last_name', 'N/A')}
- Company: {contact.get('company', 'N/A')}
- Industry: {contact.get('industry', 'N/A')}
- Email: {contact.get('email', 'N/A')}

Template:
Subject: {template['subject']}
Body: {template['body']}

Please generate a personalized email based on the above information.
- Do NOT repeat or restate the subject line in the email body. Start the body with a greeting or opening.
- {html_instruction}

Return ONLY a valid JSON object with exactly two keys: "subject" (string) and "body" (string). No markdown, no code fence, no text before or after. Escape quotes and newlines inside strings. Example: {{"subject": "Your subject", "body": "<p>Hello</p>"}}"""
        
        # Generate content
        generated = await self.llm_service.generate_text(
            user_id, provider, prompt
        )
        
        # Parse as JSON first (keeps HTML/links intact); fallback to legacy SUBJECT/BODY regex
        subject = template['subject']
        body = generated
        parsed = self._parse_email_json(generated)
        if parsed:
            subject = parsed.get("subject", subject)
            body = parsed.get("body", body)
        else:
            subject_match = re.search(r'SUBJECT:\s*(.+?)(?:\n|$)', generated, re.IGNORECASE)
            body_match = re.search(r'BODY:\s*(.+)', generated, re.IGNORECASE | re.DOTALL)
            if subject_match:
                subject = subject_match.group(1).strip()
            if body_match:
                body = body_match.group(1).strip()
        
        return {
            "subject": subject,
            "body": body
        }

    async def generate_email_content_for_test(
        self,
        user_id: str,
        template_id: str,
        provider: str,
        ai_prompt: str,
        contact_data: dict,
    ) -> dict:
        """Generate AI variation for a template test (no campaign required)."""
        template = await self.db.templates.find_one({"id": template_id})
        if not template:
            raise Exception("Template not found")
        first_name = contact_data.get("first_name") or contact_data.get("firstName") or "N/A"
        last_name = contact_data.get("last_name") or contact_data.get("lastName") or "N/A"
        company = contact_data.get("company", "N/A")
        industry = contact_data.get("industry", "N/A")
        email = contact_data.get("email", "N/A")
        body_type = template.get("body_type", "html")
        is_html = body_type == "html" or (
            template.get("body") and ("<" in template["body"] and ">" in template["body"])
        )
        html_instruction = (
            "The template body is HTML. You MUST preserve the exact HTML structure, all tags, and all styles (e.g. <p>, <ul>, <li>, <strong>, style=..., class=...). "
            "Only change the text content inside the tags—rewrite the words and sentences to personalize or vary the message. "
            "Do NOT remove, add, or alter any HTML tags or attributes; keep format and styles the same."
        ) if is_html else (
            "The template body is plain text. Return plain text in BODY. Do not use markdown (**bold** or [text](url))."
        )
        prompt = f"""{ai_prompt}

Contact Information:
- First Name: {first_name}
- Last Name: {last_name}
- Company: {company}
- Industry: {industry}
- Email: {email}

Template:
Subject: {template['subject']}
Body: {template['body']}

Please generate a personalized email based on the above information.
- Do NOT repeat or restate the subject line in the email body. Start the body with a greeting or opening.
- {html_instruction}

Return ONLY a valid JSON object with exactly two keys: "subject" (string) and "body" (string). No markdown, no code fence, no text before or after. Escape quotes and newlines inside strings. Example: {{"subject": "Your subject", "body": "<p>Hello</p>"}}"""
        generated = await self.llm_service.generate_text(user_id, provider, prompt)
        subject = template["subject"]
        body = generated
        parsed = self._parse_email_json(generated)
        if parsed:
            subject = parsed.get("subject", subject)
            body = parsed.get("body", body)
        else:
            subject_match = re.search(r'SUBJECT:\s*(.+?)(?:\n|$)', generated, re.IGNORECASE)
            body_match = re.search(r'BODY:\s*(.+)', generated, re.IGNORECASE | re.DOTALL)
            if subject_match:
                subject = subject_match.group(1).strip()
            if body_match:
                body = body_match.group(1).strip()
        return {"subject": subject, "body": body}

    @staticmethod
    def _is_unsubscribe_url(url: str) -> bool:
        """Return True if the URL is considered an unsubscribe/opt-out link."""
        if not url or not isinstance(url, str):
            return False
        lower = url.lower().strip()
        return (
            "unsubscribe" in lower
            or "opt-out" in lower
            or "optout" in lower
            or bool(re.search(r"/(unsub|opt.?out|preferences|manage.?subscription)", lower))
        )

    async def _registered_parent_domain_id(self, user_id: str, domain_name: str) -> Optional[str]:
        """
        If the hostname is a child of another domain row for this user (e.g. mail.example.com when
        example.com exists), return the parent domain id. Mirrors routes/domains.py domain tree.
        """
        name = (domain_name or "").strip().lower().rstrip(".")
        parts = name.split(".")
        if len(parts) < 3:
            return None
        for i in range(1, len(parts) - 1):
            candidate = ".".join(parts[i:])
            parent = await self.db.domains.find_one({"user_id": user_id, "domain": candidate}, {"id": 1})
            if parent:
                return parent.get("id")
        return None

    async def _verified_tracking_host_for_domain_doc(self, user_id: str, domain_doc: Optional[dict]) -> Optional[str]:
        """Return verified tracking hostname from this domain row, or from registered root parent if unset."""
        if not domain_doc:
            return None
        if domain_doc.get("tracking_domain_verified") and domain_doc.get("tracking_domain"):
            host = str(domain_doc["tracking_domain"]).strip().lower().rstrip(".")
            return host or None
        parent_id = await self._registered_parent_domain_id(user_id, domain_doc.get("domain", "") or "")
        if not parent_id:
            return None
        parent = await self.db.domains.find_one(
            {"id": parent_id, "user_id": user_id},
            {"tracking_domain": 1, "tracking_domain_verified": 1},
        )
        if parent and parent.get("tracking_domain_verified") and parent.get("tracking_domain"):
            host = str(parent["tracking_domain"]).strip().lower().rstrip(".")
            return host or None
        return None

    async def _get_tracking_base(self, user_id: str, domain_id: Optional[str] = None) -> str:
        """
        Resolve tracking base URL.
        Priority: verified custom tracking domain for the sending domain, then the same for the
        registered root domain when the send uses a subdomain row, then TRACKING_BASE_URL, then BACKEND_URL.
        """
        if domain_id:
            domain_doc = await self.db.domains.find_one(
                {"id": domain_id, "user_id": user_id},
                {"domain": 1, "tracking_domain": 1, "tracking_domain_verified": 1},
            )
            host = await self._verified_tracking_host_for_domain_doc(user_id, domain_doc)
            if host:
                return f"https://{host}"
        return (
            os.getenv("TRACKING_BASE_URL")
            or os.getenv("BACKEND_URL", "http://localhost:8001")
        )

    async def wrap_links(self, body: str, email_log_id: str, tracking_base_url: Optional[str] = None) -> str:
        """Wrap links in email body for click tracking. Only replaces URLs inside href=\"...\",
        so visible link text (e.g. 'Unsubscribe') stays unchanged."""
        tracking_base = tracking_base_url or os.getenv("TRACKING_BASE_URL") or os.getenv("BACKEND_URL", "http://localhost:8001")
        # Match href="URL" or href='URL' and capture the URL (group 1)
        href_pattern = re.compile(
            r'href\s*=\s*["\'](https?://[^"\']+)["\']',
            re.IGNORECASE
        )
        matches = list(href_pattern.finditer(body))
        # Process from end to start so string indices stay valid when replacing
        for m in sorted(matches, key=lambda x: x.start(1), reverse=True):
            url = m.group(1)
            link_id = str(uuid.uuid4())
            is_unsubscribe = self._is_unsubscribe_url(url)
            await self.db.link_clicks.insert_one({
                "id": link_id,
                "email_log_id": email_log_id,
                "original_url": url,
                "clicked": False,
                "click_count": 0,
                "is_unsubscribe": is_unsubscribe,
                "created_at": datetime.now(timezone.utc)
            })
            tracking_url = f"{tracking_base}/api/track/click/{link_id}"
            body = body[: m.start(1)] + tracking_url + body[m.end(1) :]
        return body
    
    # --- Inbox placeholder derivation ({{inbox_name}}, {{inbox_email}}) ---
    _INBOX_NAME_NOISE_WORDS = {
        # Common non-name tokens in inbox local-parts
        "admin",
        "info",
        "support",
        "sales",
        "team",
        "contact",
        "hello",
        "help",
        "service",
        "services",
        # Titles/roles that often appear in sender emails
        "ceo",
        "cto",
        "cfo",
        "vp",
        "founder",
        "cofounder",
        "president",
        "director",
        "manager",
        "head",
        "lead",
        "recruiter",
        "recruiting",
        # Generic marketing words
        "marketing",
        "growth",
        "outreach",
    }

    # Longest first: endswith checks must match the most specific segment (e.g. sarwar before war).
    _INBOX_SURNAME_SUFFIXES: Tuple[str, ...] = tuple(
        sorted(
            {
                "makhija",
                "choudhary",
                "chowdhury",
                "sharma",
                "gupta",
                "verma",
                "kapoor",
                "reddy",
                "patel",
                "singh",
                "kumar",
                "malik",
                "sarwar",
                "desai",
                "mehta",
                "joshi",
                "bose",
                "nath",
                "lal",
                "khan",
                "war",  # after sarwar; still helps e.g. ...war surnames when glued
            },
            key=len,
            reverse=True,
        )
    )

    # Right-hand fragments that usually mean the split was one letter too late (e.g. adils|arwar).
    _INBOX_BAD_RIGHT_FRAGMENTS = frozenset({"arwar", "hwar", "lwar", "mwar"})

    @classmethod
    def _score_inbox_name_split(cls, left: str, right: str) -> float:
        """Higher = better split for a glued local-part (both sides lowercase letters)."""
        L, R = len(left), len(right)
        balance = float(min(L, R))
        score = balance
        vowels = set("aeiou")
        if not any(c in vowels for c in left) or not any(c in vowels for c in right):
            return -1e9
        # Typical given-name length on the left
        if 3 <= L <= 6:
            score += 2.5
        elif L > 9:
            score -= 1.5
        r = right.lower()
        if r in cls._INBOX_BAD_RIGHT_FRAGMENTS:
            score -= 14.0
        suf_bonus = 0.0
        for suf in cls._INBOX_SURNAME_SUFFIXES:
            if r.endswith(suf) and len(r) >= len(suf):
                suf_bonus = max(suf_bonus, float(10 + len(suf)))
                break
        score += suf_bonus
        # Unbalanced glued junk (e.g. projectm|artstore) when we did not get a surname signal
        if suf_bonus < 8.0 and abs(L - R) > 5:
            score -= 2.0
        return score

    @classmethod
    def _split_glued_local_name(cls, word: str) -> Tuple[Optional[str], Optional[str], float]:
        """Pick first/last for a single lowercase token (digits already stripped). Returns score."""
        w = word.lower().strip()
        if len(w) < 4:
            return None, None, 0.0
        vowels = set("aeiou")
        best_score = -1e9
        best_pair: Optional[Tuple[str, str]] = None
        for i in range(2, len(w) - 1):
            left, right = w[:i], w[i:]
            if len(right) < 2:
                continue
            sc = cls._score_inbox_name_split(left, right)
            if sc > best_score:
                best_score = sc
                best_pair = (left, right)
        if best_pair is None:
            return None, None, 0.0
        first, last = best_pair
        return first, last, best_score

    @classmethod
    def get_inbox_name_from_email(cls, inbox_email: str) -> str:
        """Derive a human-ish sender name from an inbox email local-part.

        Examples:
        - `john.doe@x.com` -> `John Doe`
        - `john_doe_ceo@x.com` -> `John Doe`
        - `johndoe99@x.com` -> `John Doe`
        - `doe.john@x.com` -> `John Doe` (heuristic swap)
        - `arjunsharma2024@x.com` -> `Arjun Sharma` (suffix-aware split, trailing year stripped)
        - `brandstoreonline@x.com` -> `Brandstoreonline` (long brand-like local part fallback)
        """
        if not inbox_email:
            return ""

        try:
            local_part = inbox_email.split("@", 1)[0]
        except Exception:
            local_part = inbox_email

        # 1) Clean local-part before extracting name parts.
        # Strip trailing 19xx/20xx glued to names (common in Gmail: name2024, name2002).
        local_part = re.sub(r"(?:19|20)\d{2}$", "", str(local_part), flags=re.IGNORECASE)
        # Replace separators with spaces, remove digits, normalize whitespace, drop non-letters.
        local_part = re.sub(r"[._\-+]", " ", str(local_part))
        local_part = re.sub(r"\d+", "", local_part)
        local_part = re.sub(r"[^a-zA-Z\s]", " ", local_part)
        local_part = re.sub(r"\s+", " ", local_part).strip().lower()
        if not local_part:
            return "Team Wellwishers"

        raw_parts = [p for p in local_part.split() if p]
        # Remove common noise tokens only if we still have meaningful parts.
        # This prevents cases like `team_admin@x.com` from collapsing to "there".
        parts = [p for p in raw_parts if p not in cls._INBOX_NAME_NOISE_WORDS]
        if not parts:
            parts = raw_parts
        if not parts:
            return "Team Wellwishers"

        first: Optional[str] = None
        last: Optional[str] = None

        # 2) Extract first + last intelligently
        if len(parts) >= 2:
            # Prefer first + last token so formats like "john+alias.doe" work.
            first, last = parts[0], parts[-1]

            # Heuristic: if it looks reversed (common for "last.first"), swap.
            # e.g. "doe john" -> "john doe"
            if first and last and len(first) <= 3 and len(last) >= 4:
                first, last = last, first
        else:
            # Single token case: handle "johndoe" (no separator).
            word = parts[0]
            # If noise words are glued to the start (e.g. `teamwellwishers`), strip them first.
            # This prevents returning "Team Wellwishers" when only the real name part is "wellwishers".
            for noise in sorted(cls._INBOX_NAME_NOISE_WORDS, key=len, reverse=True):
                if len(word) > (len(noise) + 2) and word.startswith(noise):
                    word = word[len(noise):].strip()
                    break
            # Strip common trailing noise suffixes (helps when titles are glued).
            for noise in sorted(cls._INBOX_NAME_NOISE_WORDS, key=len, reverse=True):
                if len(word) > (len(noise) + 2) and word.endswith(noise):
                    word = word[: -len(noise)].strip()
                    break

            if not word:
                return "Team Wellwishers"

            # Split glued tokens (e.g. arjunsharma2024 -> adilsarwar) using suffix-aware scoring,
            # not pure length balance (which favored adils|arwar over adil|sarwar).
            if len(word) >= 6:
                gl_first, gl_last, gl_score = cls._split_glued_local_name(word)
                use_pair = bool(
                    gl_first
                    and gl_last
                    and not (len(word) >= 14 and gl_score < 12.0)
                )
                if use_pair:
                    first, last = gl_first, gl_last
                else:
                    first, last = word, None
            else:
                first, last = word, None

        # 3) Format properly for placeholders
        if not first:
            return "Team Wellwishers"

        first_fmt = first[:1].upper() + first[1:].lower()
        if last:
            last_fmt = last[:1].upper() + last[1:].lower()
            return f"{first_fmt} {last_fmt}"
        return first_fmt

    @classmethod
    def get_effective_inbox_name(cls, inbox: Optional[dict] = None, inbox_email: str = "") -> str:
        """Prefer manual inbox sender name override; otherwise derive from email."""
        inbox = inbox or {}
        manual = str(inbox.get("sender_name") or inbox.get("from_name") or "").strip()
        if manual:
            return manual
        email = str(inbox_email or inbox.get("email") or "").strip()
        return cls.get_inbox_name_from_email(email)

    def replace_placeholders(self, text: str, contact: dict) -> str:
        """Replace placeholders in text with contact + inbox data.
        
        Supports:
        - {{name}}, {{first_name}}, {{last_name}}, {{email}}, {{company}}, {{industry}}
        - {{inbox_name}}, {{inbox_email}} for the sending inbox (and camelCase variants)
        - {{sender_name}}, {{sender_email}} — same as inbox display name and address (aliases for readability)
        - {{receiver_name}}, {{receiver_email}} — recipient display name and address (warmup / when provided)
        """
        import re
        
        # Build contact data dictionary (snake_case + camelCase so {{first_name}} and {{firstName}} both work)
        first_name = contact.get("first_name", "") or ""
        last_name = contact.get("last_name", "") or ""
        name = (first_name + " " + last_name).strip() or first_name or last_name  # {{name}} → full or first
        inbox_email = contact.get("inbox_email", "") or ""
        inbox_name = contact.get("inbox_name", "") or ""
        recipient_email = contact.get("email", "") or ""
        receiver_email = contact.get("receiver_email", "") or recipient_email
        receiver_name = contact.get("receiver_name", "") or ""
        if not receiver_name:
            receiver_name = name
        sender_email = contact.get("sender_email", "") or inbox_email
        sender_name = contact.get("sender_name", "") or inbox_name
        contact_data = {
            "first_name": first_name,
            "firstName": first_name,
            "last_name": last_name,
            "lastName": last_name,
            "name": name,
            "email": recipient_email,
            "company": contact.get("company", "") or "",
            "industry": contact.get("industry", "") or "",
            # Sending inbox fields (available when campaign sends from a specific inbox)
            "inbox_email": inbox_email,
            "inboxEmail": inbox_email,
            "inbox_name": inbox_name,
            "inboxName": inbox_name,
            "sender_email": sender_email,
            "senderEmail": sender_email,
            "sender_name": sender_name,
            "senderName": sender_name,
            "receiver_email": receiver_email,
            "receiverEmail": receiver_email,
            "receiver_name": receiver_name,
            "receiverName": receiver_name,
        }
        # Add custom fields
        contact_data.update(contact.get("custom_fields", {}))
        
        # Replace {{placeholder}} and {placeholder} formats (escape key for regex safety)
        for key, value in contact_data.items():
            val_str = str(value) if value else ""
            esc = re.escape(key)
            text = re.sub(r"\{\{" + esc + r"\}\}", val_str, text, flags=re.IGNORECASE)
            text = re.sub(r"\{" + esc + r"\}", val_str, text, flags=re.IGNORECASE)
        
        return text

    @staticmethod
    def _markdown_to_html(text: str) -> str:
        """Convert markdown to HTML when template is HTML and AI returns markdown (e.g. **bold**, [text](url))."""
        if not text:
            return text
        has_markdown = "**" in text or re.search(r"\[[^\]]+\]\([^)]+\)", text)
        if not has_markdown:
            return text
        try:
            md = MarkdownIt()
            return md.render(text)
        except Exception:
            return text

    @staticmethod
    def _markdown_to_plain(text: str) -> str:
        """Strip markdown for plain-text emails so ** and [text](url) don't show raw. Use when template is plain text."""
        if not text:
            return text
        out = text
        out = re.sub(r"\*\*(.+?)\*\*", r"\1", out)
        out = re.sub(r"\*(.+?)\*", r"\1", out)
        out = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", out)
        return out

    @staticmethod
    def _strip_html_document_cruft(text: str) -> str:
        """Remove HTML document fragments and stray ''html so they don't appear as visible text in the email."""
        if not text:
            return text
        out = text.strip()
        # Strip leading/trailing quotes that might wrap the whole body
        for _ in range(3):
            if (out.startswith("'") and out.endswith("'")) or (out.startswith('"') and out.endswith('"')):
                out = out[1:-1].strip()
        # Remove literal ''html or 'html at start (AI sometimes echoes this)
        for prefix in ("''html", "'html", "'<html>", "''", "<!DOCTYPE html>", "<!doctype html>"):
            if out.lower().startswith(prefix.lower()):
                out = out[len(prefix):].strip()
                break
        # Remove full <!DOCTYPE ...> line
        out = re.sub(r"^\s*<!DOCTYPE[^>]*>\s*", "", out, flags=re.IGNORECASE)
        # Remove opening <html ...> (and optional attributes) on its own or first line
        out = re.sub(r"^\s*<html[^>]*>\s*", "", out, flags=re.IGNORECASE)
        # Remove <head>...</head> block
        out = re.sub(r"\s*<head[^>]*>.*?</head>\s*", "", out, flags=re.DOTALL | re.IGNORECASE)
        # Remove lone <body> or <body ...> at start
        out = re.sub(r"^\s*<body[^>]*>\s*", "", out, flags=re.IGNORECASE)
        return out.strip()

    def parse_spintax(self, text: str) -> str:
        """Parse spintax syntax {option1|option2|option3} and randomly select one option.
        
        This enables content variation without AI cost. Examples:
        - {Hi|Hello|Hey} → randomly picks one
        - {Hi {{first_name}}|Hello {{first_name}}} → works with variables
        
        Options may contain {{placeholder}}; the pattern allows nested double braces
        so variables inside spintax are supported. Splits only on | outside {{...}}.
        """
        import re
        import random
        
        if not text:
            return ""
        
        # Allow content to include {{...}} so {Hi {{company}} | Hello {{company}}} matches
        pattern = re.compile(r'\{((?:[^{}]|\{\{[^}]*\}\})*)\}')
        
        def replace_spintax(match):
            content = match.group(1)
            if "|" not in content:
                return match.group(0)  # leave as-is (e.g. {first_name})
            # Temporarily replace {{...}} so we don't split on | inside placeholders
            placeholders = []
            def repl(m):
                placeholders.append(m.group(0))
                return f"\x00PH_{len(placeholders)-1}\x00"
            content_safe = re.sub(r'\{\{[^}]*\}\}', repl, content)
            options = [s.strip() for s in content_safe.split("|") if s.strip()]
            if not options:
                return match.group(0)
            chosen = random.choice(options)
            for i, ph in enumerate(placeholders):
                chosen = chosen.replace(f"\x00PH_{i}\x00", ph)
            return chosen

        # Process until no more spintax patterns (nested braces may need multiple passes)
        max_iterations = 100
        for _ in range(max_iterations):
            new_text = pattern.sub(replace_spintax, text)
            if new_text == text:
                break
            text = new_text
        return text

    async def _get_user_compliance(self, user_id: str) -> dict:
        """Get user compliance settings (merge stored with defaults)."""
        doc = await self.db.user_settings.find_one({"user_id": user_id}, {"_id": 0})
        if not doc or "compliance" not in doc:
            return DEFAULT_COMPLIANCE
        return {**DEFAULT_COMPLIANCE, **doc.get("compliance", {})}

    def _count_links(self, text: str) -> int:
        if not text:
            return 0
        matches = re.findall(r"https?://[^\s<>\"']+", text, re.IGNORECASE)
        return len(matches)

    def _has_unsubscribe_link(self, text: str) -> bool:
        if not text:
            return False
        lower = text.lower()
        if re.search(r"\{\{?\s*unsubscribe_url\s*\}?\}", text, re.IGNORECASE):
            return True
        return (
            "unsubscribe" in lower
            or "opt-out" in lower
            or "opt out" in lower
            or re.search(r"href\s*=\s*[^>]*unsubscribe", lower)
        )

    @staticmethod
    def _inject_unsubscribe_url_placeholder(text: str, unsubscribe_url: str) -> str:
        """Replace {{unsubscribe_url}} / {unsubscribe_url} with the per-send API unsubscribe URL."""
        if not text or not unsubscribe_url:
            return text
        out = re.sub(r"\{\{unsubscribe_url\}\}", unsubscribe_url, text, flags=re.IGNORECASE)
        out = re.sub(r"\{unsubscribe_url\}", unsubscribe_url, out, flags=re.IGNORECASE)
        return out

    def _get_spam_words_list(self, spam_words) -> List[str]:
        """Parse spam words string (comma/newline-separated) into list of lowercased tokens."""
        if not spam_words or not isinstance(spam_words, str):
            return []
        return [w.strip().lower() for w in spam_words.replace("\n", ",").split(",") if w.strip()]

    def _find_spam_words_in_text(self, text: str, spam_list: List[str]) -> List[str]:
        """Find which spam words appear in text (whole-word match, case-insensitive)."""
        if not text or not spam_list:
            return []
        lower = text.lower()
        found = []
        for word in spam_list:
            if not word:
                continue
            escaped = re.escape(word)
            if re.search(rf"\b{escaped}\b", lower):
                found.append(word)
        return found

    async def validate_campaign_full_compliance(
        self, user_id: str, template_ids: List[str]
    ) -> List[str]:
        """Check all 3 compliance rules (links, unsubscribe, spam words) on campaign templates.
        Returns list of error messages; empty if all pass."""
        if not template_ids:
            return ["At least one template is required."]
        compliance = await self._get_user_compliance(user_id)
        max_links = compliance.get("max_links_per_email", 3)
        require_unsub = compliance.get("require_unsubscribe_link", False)
        spam_list = self._get_spam_words_list(compliance.get("spam_words"))
        errors: List[str] = []

        for tid in template_ids:
            template = await self.db.templates.find_one({"id": tid}, {"name": 1, "subject": 1, "body": 1})
            if not template:
                errors.append(f"Template '{tid}' not found.")
                continue
            name = template.get("name") or tid
            subject = template.get("subject") or ""
            body = template.get("body") or ""
            content = f"{subject} {body}"

            link_count = self._count_links(content)
            if link_count > max_links:
                errors.append(
                    f"'{name}': {link_count} links (max {max_links} allowed). Update in Settings → Compliance or reduce links."
                )

            if require_unsub and not self._has_unsubscribe_link(body):
                errors.append(
                    f"'{name}': Unsubscribe link is required. Add an unsubscribe link or change this in Settings → Compliance."
                )

            if spam_list:
                spam_found = self._find_spam_words_in_text(content, spam_list)
                if spam_found:
                    words_preview = ", ".join(spam_found[:5])
                    if len(spam_found) > 5:
                        words_preview += f" (+{len(spam_found) - 5} more)"
                    errors.append(
                        f"'{name}': Contains spam-trigger words: {words_preview}."
                    )

        return errors

    async def validate_campaign_templates_compliance(self, user_id: str, template_ids: list) -> Optional[str]:
        """Return an error message if templates violate compliance (e.g. missing unsubscribe link), else None."""
        if not template_ids:
            return "At least one template is required."
        compliance = await self._get_user_compliance(user_id)
        if not compliance.get("require_unsubscribe_link", True):
            return None
        for tid in template_ids:
            template = await self.db.templates.find_one({"id": tid}, {"body": 1})
            if not template:
                return f"Template {tid} not found."
            body = template.get("body") or ""
            if not self._has_unsubscribe_link(body):
                return (
                    "Unsubscribe link is required. Add an unsubscribe link to your email template "
                    "or change this in Settings → Compliance."
                )
        return None

    async def _resolve_reply_to_email(self, user_id: str, campaign: dict) -> Optional[str]:
        """Resolve Reply-To email from campaign (and user_settings default). Returns None for 'none' or when not set."""
        reply_to_type = campaign.get("reply_to_type")
        reply_to_id = campaign.get("reply_to_id")
        if reply_to_type in (None, "default"):
            settings_doc = await self.db.user_settings.find_one({"user_id": user_id}, {"_id": 0})
            reply_to_type = (settings_doc or {}).get("default_reply_to_type")
            reply_to_id = (settings_doc or {}).get("default_reply_to_id")
        if reply_to_type in (None, "none") or not reply_to_type:
            return None
        if reply_to_type == "gmail":
            inbox = await self.db.inboxes.find_one({"id": reply_to_id, "user_id": user_id, "sender_type": "gmail"}, {"email": 1})
            if inbox:
                return inbox.get("email")
            return await self.gmail_service.get_user_email(reply_to_id)
        if reply_to_type == "imap":
            config = await self.db.reply_to_imap_configs.find_one({"id": reply_to_id, "user_id": user_id}, {"email": 1})
            if config:
                return config.get("email")
            logging.warning("reply_to imap config_id=%s not found for user_id=%s", reply_to_id, user_id)
            return None
        if reply_to_type == "custom":
            custom = (campaign.get("reply_to_email") or "").strip()
            if not custom:
                logging.warning(
                    "Campaign reply_to_type is 'custom' but reply_to_email is missing or empty (campaign_id=%s). "
                    "Save the campaign again with a custom Reply-To address.",
                    campaign.get("id"),
                )
            return custom if custom else None
        return None

    async def send_email(
        self,
        user_id: str,
        campaign_id: str,
        contact_id: str,
        template_id: str,
        subject: str,
        body: str,
        body_type: str = "html",
        sender_id: str = None,
        sender_type: str = "gmail",
        sender_name: str = None,
        reply_to_email: str = None,
        reply_to_explicitly_none: bool = False,
        sequence_step: Optional[int] = None,
    ) -> dict:
        """Send individual email with tracking"""
        self._dev_warn("send_email: campaign_id=%s contact_id=%s sender_id=%s sender_type=%s", campaign_id, contact_id, sender_id, sender_type)
        # Get contact
        contact = await self.db.contacts.find_one({"id": contact_id})
        if not contact:
            self._dev_warn("send_email: contact_id=%s not found", contact_id)
            raise Exception("Contact not found")

        await self._ensure_subscription_allows_outbound_send(user_id)

        # Per-inbox per-recipient-domain daily rate limit (prevents targeting one company too heavily).
        # Skipped for public/consumer providers (gmail.com, outlook.com, …) because those domains
        # are shared by unrelated individuals — the limit only makes sense for corporate domains.
        # Configurable via CAMPAIGN_DOMAIN_DAILY_LIMIT env var (default 3).
        if sender_id and contact.get("email") and "@" in contact["email"]:
            recipient_domain = contact["email"].split("@", 1)[1].strip().lower()
            if recipient_domain not in _PUBLIC_EMAIL_DOMAINS:
                today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
                domain_sent_today = await self.db.email_logs.count_documents({
                    "sender_id": sender_id,
                    "recipient_domain": recipient_domain,
                    "sent_at": {"$gte": today_start},
                    "status": {"$ne": "failed"},
                })
                if domain_sent_today >= DOMAIN_DAILY_LIMIT:
                    raise DomainRateLimitError(recipient_domain, DOMAIN_DAILY_LIMIT)

        # Compliance check (before placeholders) using user settings
        compliance = await self._get_user_compliance(user_id)
        content = f"{subject or ''} {body or ''}"
        link_count = self._count_links(content)
        max_links = compliance.get("max_links_per_email", 3)
        if link_count > max_links:
            raise Exception(
                f"Email has {link_count} links (max {max_links} allowed). "
                "Update in Settings → Compliance or reduce links in your template."
            )
        if compliance.get("require_unsubscribe_link", True) and not self._has_unsubscribe_link(body or ""):
            raise Exception(
                "Unsubscribe link is required. Add an unsubscribe link to your email or change this in Settings → Compliance."
            )
        
        # Parse spintax first (before placeholders) so spintax can contain variables
        # Order: Spintax → Placeholders ensures {Hi {{first_name}}|Hello {{first_name}}} works correctly
        subject = self.parse_spintax(subject or "")
        body = self.parse_spintax(body or "")
        
        # Build placeholder context: start from contact and enrich with inbox info (for {{inbox_name}}, {{inbox_email}})
        placeholder_context = dict(contact or {})
        inbox_email_for_placeholders = ""
        inbox_name_for_placeholders = ""
        sender_domain_id = ""
        try:
            if sender_id:
                inbox_doc = await self.db.inboxes.find_one(
                    {"id": sender_id},
                    {"email": 1, "domain_id": 1, "sender_name": 1, "from_name": 1}
                )
                if inbox_doc and inbox_doc.get("email"):
                    inbox_email_for_placeholders = str(inbox_doc["email"]).strip()
                    sender_domain_id = str(inbox_doc.get("domain_id") or "").strip()
                    # Use robust parsing so we can handle names like "john_doe", "johndoe99", "doe.john".
                    inbox_name_for_placeholders = self.get_effective_inbox_name(
                        inbox=inbox_doc,
                        inbox_email=inbox_email_for_placeholders,
                    )
        except Exception:
            # Never fail sending just because inbox placeholder enrichment failed
            inbox_email_for_placeholders = ""
            inbox_name_for_placeholders = ""
        if inbox_email_for_placeholders:
            placeholder_context["inbox_email"] = inbox_email_for_placeholders
        if inbox_name_for_placeholders:
            placeholder_context["inbox_name"] = inbox_name_for_placeholders
        
        # AI Generation (if enabled): Generate unique content per recipient
        campaign_doc = await self.db.campaigns.find_one({"id": campaign_id}) if campaign_id else None
        if campaign_doc and campaign_doc.get("use_ai_generation"):
            try:
                ai_provider = campaign_doc.get("ai_generation_provider")
                ai_prompt = campaign_doc.get("ai_generation_prompt", "")
                
                if ai_provider and ai_prompt and self.llm_service:
                    # Construct context-aware prompt with contact data (use snake_case keys; title from custom_fields)
                    custom = contact.get("custom_fields") or {}
                    full_prompt = f"""{ai_prompt}

Recipient context:
- Name: {contact.get('first_name', '')} {contact.get('last_name', '')}
- Email: {contact.get('email', '')}
- Company: {contact.get('company', '')}
- Industry: {contact.get('industry', '')}
- Title: {custom.get('title', '')}

Original subject: {subject}
Original body: {body}

Generate a unique variation of the email that maintains the same core message but with different wording.
- Do NOT repeat or restate the subject line in the email body. The body should start with a greeting or opening, not the subject.
- Keep all placeholders exactly as-is: {{first_name}}, {{last_name}}, {{email}}, {{company}}, {{industry}}, and any {{custom_field}} names. Do not remove or rename them.
- If the original body is HTML, return HTML in the body (only the inner content—no <!DOCTYPE>, <html>, <head>, or <body> tags). If it is plain text, return plain text. Do not use markdown syntax (e.g. **bold** or [text](url)) unless the original uses it.
- Output format: put the subject on the first line after \"Subject:\", and the body on the lines after \"Body:\". Do not wrap the subject or body in quotes. Do not include ''html or any document-type fragments in the subject or at the start of the body."""
                    
                    # Generate AI variation
                    generated_content = await self.llm_service.generate_text(
                        user_id=campaign_doc["user_id"],
                        provider=ai_provider,
                        prompt=full_prompt
                    )
                    
                    # Parse AI response (expecting format: "Subject: ...\n\nBody: ...")
                    if "Subject:" in generated_content and "Body:" in generated_content:
                        parts = generated_content.split("Body:", 1)
                        ai_subject = parts[0].replace("Subject:", "").strip().strip("'\"").strip()
                        ai_body = parts[1].strip().strip("'\"").strip()
                        ai_body = self._strip_html_document_cruft(ai_body)
                        # Reject subject if it looks like a fragment or garbage (e.g. ''html, tag, empty)
                        bad_subjects = ("''html", "'html", "html")
                        if not ai_subject or ai_subject.startswith("<") or (len(ai_subject) < 10 and ai_subject.lower() in bad_subjects):
                            ai_subject = None
                        if ai_subject and len(ai_subject) > 200:
                            ai_subject = ai_subject[:200].strip()
                        
                        # Use AI-generated content if valid
                        if ai_subject and ai_body:
                            subject = ai_subject
                            body = ai_body
                            # Normalize AI output to match user's template type (HTML vs plain text)
                            if body_type == "html":
                                body = self._markdown_to_html(body)
                            else:
                                body = self._markdown_to_plain(body)
                            logging.info(f"AI generation successful for contact {contact_id}")
                        elif ai_body:
                            body = ai_body
                            if body_type == "html":
                                body = self._markdown_to_html(body)
                            else:
                                body = self._markdown_to_plain(body)
                            logging.info(f"AI generation partial for contact {contact_id} (kept original subject)")
                    else:
                        # Fallback: use AI output as body only
                        body = generated_content
                        body = self._strip_html_document_cruft(body)
                        if body_type == "html":
                            body = self._markdown_to_html(body)
                        else:
                            body = self._markdown_to_plain(body)
                        logging.info(f"AI generation partial for contact {contact_id}")
                        
            except Exception as e:
                # Fallback to spintax/original if AI fails
                logging.warning(f"AI generation failed for contact {contact_id}: {str(e)}. Using spintax/original content.")
        
        # Replace placeholders in subject and body (contact + inbox context)
        subject = self.replace_placeholders(subject, placeholder_context)
        body = self.replace_placeholders(body, placeholder_context)

        # Ensure {{inbox_name}} / {{inbox_email}} are always resolved even if
        # replace_placeholders missed them due to formatting quirks.
        if inbox_email_for_placeholders:
            for token in ("{{inbox_email}}", "{inbox_email}"):
                subject = subject.replace(token, inbox_email_for_placeholders)
                body = body.replace(token, inbox_email_for_placeholders)
        if inbox_name_for_placeholders:
            for token in ("{{inbox_name}}", "{inbox_name}"):
                subject = subject.replace(token, inbox_name_for_placeholders)
                body = body.replace(token, inbox_name_for_placeholders)
        
        # Create email log
        email_log_id = str(uuid.uuid4())
        
        tracking_base = await self._get_tracking_base(user_id=user_id, domain_id=sender_domain_id or None)

        # Create tracking pixel only when campaign-level open tracking is enabled.
        open_tracking_enabled = True if not campaign_doc else campaign_doc.get("open_tracking", True)
        pixel_id = None
        pixel_url = None
        if open_tracking_enabled:
            pixel_id = str(uuid.uuid4())
            pixel_url = f"{tracking_base}/api/track/pixel/{pixel_id}"
            await self.db.tracking_pixels.insert_one({
                "id": pixel_id,
                "email_log_id": email_log_id,
                "opened": False,
                "open_count": 0,
                "created_at": datetime.now(timezone.utc)
            })

        # Per-send unsubscribe URL (headers + optional {{unsubscribe_url}} in template body)
        unsubscribe_url = f"{tracking_base}/api/unsubscribe/{email_log_id}"
        body = self._inject_unsubscribe_url_placeholder(body, unsubscribe_url)
        subject = self._inject_unsubscribe_url_placeholder(subject, unsubscribe_url)

        # Wrap links for click tracking (includes href pointing at unsubscribe_url)
        body = await self.wrap_links(body, email_log_id, tracking_base_url=tracking_base)
        
        # When sending via SMTP, use user's Gmail as Reply-To so replies are delivered (SMTP From often can't receive mail).
        # Do not override when user explicitly chose Reply-To "none".
        if sender_type == "smtp" and not reply_to_email and not reply_to_explicitly_none:
            reply_to_email = await self.gmail_service.get_user_email(user_id)
            if not reply_to_email:
                logging.warning(
                    "SMTP campaign send: No Gmail connected for user. Replies to campaign emails will go to the SMTP From address, which may bounce. Connect Gmail in settings so Reply-To can be set."
                )

        # Personal Network Pool: one credit per send to a rented-pool contact
        pool_spend_key: Optional[str] = None
        pool_credit_spent = False
        _cf = contact.get("custom_fields") or {}
        if (
            campaign_id
            and isinstance(_cf, dict)
            and _cf.get("network_campaign_source") == "personal_network_pool"
        ):
            step_key = int(sequence_step or 0)
            pool_spend_key = f"campaign-pool-send:{campaign_id}:{contact_id}:{template_id}:{step_key}"
            ok, _ = await self._credit_service_lazy().spend_credits(
                user_id,
                SHARED_POOL_CREDITS_PER_SEND,
                reason="campaign_shared_pool_send",
                metadata={
                    "campaign_id": campaign_id,
                    "contact_id": contact_id,
                    "template_id": template_id,
                    "sequence_step": step_key,
                },
                idempotency_key=pool_spend_key,
            )
            if not ok:
                raise Exception(
                    "Insufficient credits to send to a Personal Network Pool recipient. "
                    "Top up credits or disable Personal Network Pool for this campaign."
                )
            pool_credit_spent = True

        # Send email based on sender type
        try:
            if sender_type == "gmail":
                if not sender_id:
                    sender_id = user_id  # Default to user's Gmail
                inbox = await self.db.inboxes.find_one({"id": sender_id}, {"gmail_auth_method": 1, "email": 1}) if sender_id else None
                if inbox and inbox.get("gmail_auth_method") == "app_password" and self.smtp_service:
                    msg_id_domain = "gmail.com"
                    if inbox.get("email") and "@" in str(inbox["email"]):
                        msg_id_domain = str(inbox["email"]).split("@", 1)[1].strip().lower()
                    outbound_message_id = f"{email_log_id}@{msg_id_domain}"
                    result = await self.smtp_service.send_email_via_smtp_gmail_app_password(
                        sender_id,
                        contact["email"],
                        subject,
                        body,
                        pixel_url,
                        reply_to_email,
                        outbound_message_id=outbound_message_id,
                        body_type=body_type,
                        unsubscribe_url=unsubscribe_url,
                    )
                    message_id = result.get("message_id")
                    thread_id = None
                else:
                    result = await self.gmail_service.send_email(
                        sender_id,
                        user_id,
                        contact["email"],
                        subject,
                        body,
                        pixel_url,
                        sender_name,
                        reply_to_email,
                        body_type=body_type,
                        unsubscribe_url=unsubscribe_url,
                    )
                    message_id = result.get("message_id")
                    thread_id = result.get("thread_id")
            elif sender_type == "smtp":
                # Use SMTP; set Message-ID so reply sync can match In-Reply-To when contact replies from Gmail
                if not self.smtp_service:
                    raise Exception("SMTP service not configured")
                if not sender_id:
                    raise Exception("Sender ID (inbox_id) required for SMTP")
                # Use inbox's email domain for Message-ID (no product branding in header)
                inbox = await self.db.inboxes.find_one({"id": sender_id}, {"email": 1})
                msg_id_domain = "gmail.com"
                if inbox and inbox.get("email") and "@" in str(inbox["email"]):
                    msg_id_domain = str(inbox["email"]).split("@", 1)[1].strip().lower()
                outbound_message_id = f"{email_log_id}@{msg_id_domain}"
                result = await self.smtp_service.send_email_via_smtp(
                    sender_id,
                    contact["email"],
                    subject,
                    body,
                    pixel_url,
                    reply_to_email,
                    outbound_message_id=outbound_message_id,
                    body_type=body_type,
                    email_log_id=email_log_id,
                    unsubscribe_url=unsubscribe_url,
                )
                message_id = result.get("message_id")
                thread_id = None
            else:
                raise Exception(f"Unknown sender type: {sender_type}")
            
            # Create email log with scheduled_at matching sent_at for immediate sends
            now = datetime.now(timezone.utc)
            _contact_email = contact.get("email", "")
            _recipient_domain = _contact_email.split("@", 1)[1].strip().lower() if "@" in _contact_email else ""
            email_log = {
                "id": email_log_id,
                "user_id": user_id,
                "campaign_id": campaign_id,
                "contact_id": contact_id,
                "template_id": template_id,
                "subject": subject,
                "body": body,
                "status": "sent",
                "scheduled_at": now,
                "sent_at": now,
                "tracking_pixel_id": pixel_id,
                "sender_id": sender_id,
                "sender_type": sender_type,
                "recipient_domain": _recipient_domain,
                "created_at": now,
                "send_source": "campaign",
            }
            
            # Add Gmail-specific fields if Gmail
            if sender_type == "gmail":
                email_log["gmail_message_id"] = message_id
                email_log["gmail_thread_id"] = thread_id
            else:
                email_log["smtp_message_id"] = message_id

            # If sent via Email Infra, persist sending IP when available
            if sender_type == "smtp" and isinstance(result, dict) and result.get("provider") == "email_infra":
                ip = result.get("ip")
                if ip:
                    email_log["email_infra_ip"] = ip

            # Gmail + app password uses SMTP transport; include in monthly SMTP cap count.
            if sender_type == "gmail" and sender_id:
                try:
                    _ib = await self.db.inboxes.find_one({"id": sender_id}, {"gmail_auth_method": 1})
                    if _ib and _ib.get("gmail_auth_method") == "app_password":
                        email_log["counts_as_smtp"] = True
                except Exception:
                    pass

            await self.db.email_logs.insert_one(email_log)
            if self.lifecycle_automation_service:
                try:
                    campaign_sends = await self.db.email_logs.count_documents(
                        {
                            "user_id": user_id,
                            "status": "sent",
                            "campaign_id": {"$exists": True, "$nin": [None, ""]},
                        }
                    )
                    if campaign_sends == 1:
                        await self.lifecycle_automation_service.emit_event(
                            user_id,
                            "first_campaign_sent",
                            {"campaign_id": campaign_id, "email_log_id": email_log_id},
                        )
                except Exception:
                    self._log.exception(
                        "Failed to emit lifecycle first_campaign_sent for user %s",
                        user_id,
                    )

            # Build metadata for CampaignContact event so frontend can track sequence steps
            event_metadata: dict = {
                "email_log_id": email_log_id,
                "sender_id": sender_id,
                "template_id": template_id,
            }
            if sequence_step is not None:
                try:
                    step_int = int(sequence_step)
                    if step_int > 0:
                        event_metadata["sequence_step"] = step_int
                except (TypeError, ValueError):
                    pass

            # Update CampaignContact status and add event
            await self.db.campaign_contacts.update_one(
                {"campaign_id": campaign_id, "contact_id": contact_id},
                {
                    "$set": {
                        "status": "sent",
                        "last_activity": now,
                        "updated_at": now
                    },
                    "$push": {
                        "events": {
                            "type": "sent",
                            "timestamp": now,
                            "metadata": event_metadata
                        }
                    }
                },
                upsert=True
            )
            
            # Update contact status (only if not already engaged/verified)
            await self.db.contacts.update_one(
                {"id": contact_id, "status": {"$nin": ["opened", "clicked", "replied"]}},
                {"$set": {"status": "sent"}}
            )

            # Trigger workflows and webhooks listening for onEmailSent / email.sent
            try:
                from services.workflow_service import WorkflowService  # local import
                from services.webhook_event_service import WebhookEventService  # local import
                from server import workflow_service as _wf_service, webhook_event_service as _wh_service  # type: ignore

                if isinstance(_wf_service, WorkflowService):
                    await _wf_service.trigger_matching_workflows(
                        event_type="onEmailSent",
                        trigger_context={
                            "email_log_id": email_log_id,
                            "campaign_id": campaign_id,
                            "contact_id": contact_id,
                        },
                    )

                if isinstance(_wh_service, WebhookEventService):
                    await _wh_service.send_email_event("email.sent", email_log)
            except Exception:
                # Never break sending because of workflow/webhook side-effects
                self._dev_warn(
                    "send_email: failed to trigger workflows/webhooks for email_log_id=%s",
                    email_log_id,
                )

            # Update sent_today only when campaign sends — increment the inbox that was used
            if sender_id:
                result = await self.db.inboxes.update_one(
                    {"id": sender_id},
                    {"$inc": {"sent_today": 1}, "$set": {"updated_at": now}}
                )
                # Legacy: sender_id may be user_id when no inbox ids were set; resolve to Gmail inbox
                if result.matched_count == 0 and sender_type == "gmail":
                    gmail_inbox = await self.db.inboxes.find_one(
                        {"user_id": user_id, "sender_type": "gmail"},
                        {"id": 1}
                    )
                    if gmail_inbox:
                        await self.db.inboxes.update_one(
                            {"id": gmail_inbox["id"]},
                            {"$inc": {"sent_today": 1}, "$set": {"updated_at": now}}
                        )
            
            return {
                "email_log_id": email_log_id,
                "message_id": message_id,
                "status": "sent"
            }
            
        except EmailInfraWarmupDelayError:
            # Do not create failed email logs / mark contact as failed.
            # Campaign batch runner will defer and reschedule sending.
            if pool_credit_spent:
                try:
                    await self._credit_service_lazy().add_credits(
                        user_id,
                        SHARED_POOL_CREDITS_PER_SEND,
                        reason="campaign_shared_pool_send_refund",
                        metadata={"campaign_id": campaign_id, "contact_id": contact_id, "original_key": pool_spend_key},
                        idempotency_key=f"{pool_spend_key}:refund:infra_delay" if pool_spend_key else None,
                    )
                except Exception:
                    logging.warning("campaign pool credit refund failed (infra delay) user_id=%s", user_id, exc_info=True)
            raise
        except Exception as e:
            if pool_credit_spent:
                try:
                    await self._credit_service_lazy().add_credits(
                        user_id,
                        SHARED_POOL_CREDITS_PER_SEND,
                        reason="campaign_shared_pool_send_refund",
                        metadata={"campaign_id": campaign_id, "contact_id": contact_id, "error": str(e)[:200]},
                        idempotency_key=f"{pool_spend_key}:refund:error" if pool_spend_key else None,
                    )
                except Exception:
                    logging.warning("campaign pool credit refund failed user_id=%s", user_id, exc_info=True)
            self._dev_warn("send_email: failed campaign_id=%s contact_id=%s error=%s", campaign_id, contact_id, e)
            # Log error with scheduled_at
            now = datetime.now(timezone.utc)
            await self.db.email_logs.insert_one({
                "id": email_log_id,
                "user_id": user_id,
                "campaign_id": campaign_id,
                "contact_id": contact_id,
                "template_id": template_id,
                "subject": subject,
                "body": body,
                "status": "failed",
                "scheduled_at": now,
                "error_message": str(e),
                "sender_id": sender_id,
                "sender_type": sender_type,
                "created_at": now
            })

            # Update CampaignContact status for failure
            await self.db.campaign_contacts.update_one(
                {"campaign_id": campaign_id, "contact_id": contact_id},
                {
                    "$set": {
                        "status": "failed",
                        "last_activity": now,
                        "updated_at": now
                    },
                    "$push": {
                        "events": {
                            "type": "failed",
                            "timestamp": now,
                            "metadata": {"error": str(e)}
                        }
                    }
                },
                upsert=True
            )

            # Mark contact as blocked in global contacts after 3 failed attempts
            try:
                from services.contact_blocking import maybe_mark_contact_blocked_for_failures
                await maybe_mark_contact_blocked_for_failures(self.db, user_id, contact_id)
            except Exception:
                pass

            # Trigger webhooks for email.bounced (failed delivery).
            try:
                from services.webhook_event_service import WebhookEventService  # local import
                from server import webhook_event_service as _wh_service  # type: ignore

                if isinstance(_wh_service, WebhookEventService):
                    failed_log = {
                        "id": email_log_id,
                        "user_id": user_id,
                        "campaign_id": campaign_id,
                        "contact_id": contact_id,
                        "template_id": template_id,
                        "subject": subject,
                        "body": body,
                        "status": "failed",
                        "scheduled_at": now,
                        "error_message": str(e),
                        "sender_id": sender_id,
                        "sender_type": sender_type,
                        "created_at": now,
                    }
                    await _wh_service.send_email_event("email.bounced", failed_log)
            except Exception:
                pass

            raise

    def _append_trailing_quote(
        self,
        body: str,
        previous_body_html: Optional[str],
        previous_body_plain: Optional[str],
        from_display: str,
        received_at: Optional[datetime],
    ) -> str:
        """Append quoted previous message to reply body so To and CC see the conversation trail (Gmail-style)."""
        if not previous_body_html and not previous_body_plain:
            return body
        # Avoid duplicating if user already included a quote
        if body and ("<blockquote" in body or "On " in body and " wrote:" in body):
            return body
        try:
            when = received_at.strftime("%a, %b %d, %Y at %I:%M %p") if received_at and hasattr(received_at, "strftime") else (str(received_at) if received_at else "earlier")
        except Exception:
            when = "earlier"
        # Safe display name (strip angle-bracket part for display)
        from_display = (from_display or "Someone").strip()
        if "<" in from_display and ">" in from_display:
            from_display = re.sub(r"\s*<[^>]+>\s*", "", from_display).strip() or from_display
        from_display = html.escape(from_display[:200])
        intro = f'<p style="margin-top:1em; color:#666; font-size:12px;">On {html.escape(when)}, {from_display} wrote:</p>'
        max_quote = 50000
        if previous_body_html and len(previous_body_html) <= max_quote:
            quoted = f'<blockquote style="border-left:2px solid #ccc; margin:0.5em 0; padding-left:1em; color:#555;">{previous_body_html}</blockquote>'
        elif previous_body_plain:
            plain = (previous_body_plain[:max_quote] + "...") if len(previous_body_plain) > max_quote else previous_body_plain
            escaped = html.escape(plain).replace("\n", "<br>\n")
            quoted = f'<blockquote style="border-left:2px solid #ccc; margin:0.5em 0; padding-left:1em; color:#555;">{escaped}</blockquote>'
        else:
            quoted = ""
        if not quoted:
            return body
        return (body or "").rstrip() + "\n\n" + intro + "\n" + quoted

    def _looks_like_html(self, s: Optional[str]) -> bool:
        """Heuristic: true if string contains HTML tags."""
        if not s or not isinstance(s, str):
            return False
        return bool(re.search(r"<[a-z!/][^>]*>", s, re.I))

    def _plain_text_to_html_preserve_whitespace(self, text: Optional[str]) -> str:
        """
        Convert plain text into safe HTML while preserving spaces/newlines.

        Email bodies are sent as HTML in multiple send paths. If we pass raw plain text,
        HTML rendering collapses whitespace, making replies look like "all spaces removed".
        """
        raw = text if isinstance(text, str) else ""
        escaped = html.escape(raw)
        # pre-wrap keeps newlines + repeated spaces; word-wrap prevents long URLs from overflowing.
        return (
            '<div data-er-plain="1" style="white-space:pre-wrap; word-wrap:break-word; font-family:inherit;">'
            + escaped
            + "</div>"
        )

    def _ensure_html_body(self, body: Optional[str]) -> str:
        """If body is plain text, wrap it as HTML preserving whitespace."""
        if self._looks_like_html(body):
            return body or ""
        return self._plain_text_to_html_preserve_whitespace(body)

    def _thread_headers_for_reply(self, log: dict, inbound: Optional[dict]) -> Tuple[Optional[str], Optional[str], str]:
        """Resolve In-Reply-To, References and a new outbound Message-ID for a reply so To and CC see the same thread (campaign → lead reply → our reply). Returns (in_reply_to, references, outbound_message_id)."""
        outbound_message_id = f"reply-{log['id']}-{datetime.now(timezone.utc).timestamp()}@reply"
        our_campaign_id = log.get("gmail_message_id") or log.get("smtp_message_id") or ""
        if our_campaign_id and not our_campaign_id.startswith("<"):
            our_campaign_id = f"<{our_campaign_id}>"
        inbound_msg_id = (inbound or {}).get("message_id") or ""
        if inbound_msg_id and not inbound_msg_id.startswith("<"):
            inbound_msg_id = f"<{inbound_msg_id}>"
        if inbound_msg_id:
            in_reply_to = inbound_msg_id
            ref_parts = [our_campaign_id, inbound_msg_id] if our_campaign_id else [inbound_msg_id]
            references = " ".join(ref_parts).strip()
        else:
            in_reply_to = our_campaign_id or None
            references = our_campaign_id or None
        return (in_reply_to, references, outbound_message_id)

    async def send_reply(
        self,
        user_id: str,
        email_log_id: str,
        subject: str,
        body: str,
        cc: str = None,
    ) -> dict:
        """Send a reply to an inbox email (no new email log, no tracking pixel). Uses In-Reply-To/References so To and CC see the full thread (campaign → lead reply → our reply)."""
        log = await self.db.email_logs.find_one({"id": email_log_id, "user_id": user_id})
        if not log:
            logging.warning("send_reply: email_log not found id=%s user_id=%s", email_log_id, user_id)
            raise Exception("Email not found")
        contact = await self.db.contacts.find_one({"id": log["contact_id"]})
        if not contact:
            logging.warning("send_reply: contact not found contact_id=%s", log["contact_id"])
            raise Exception("Contact not found")
        sender_type = log.get("sender_type", "gmail")
        to_email = contact.get("email")
        if not to_email:
            raise Exception("Contact has no email address")
        inbound = None
        if log.get("inbound_message_id"):
            inbound = await self.db.inbound_messages.find_one(
                {"id": log["inbound_message_id"], "user_id": user_id},
                {"message_id": 1, "body_text": 1, "body_html": 1, "from": 1, "received_at": 1},
            )
        in_reply_to, references, outbound_message_id = self._thread_headers_for_reply(log, inbound)
        # Body comes from a plain textarea; we send HTML, so preserve whitespace.
        body = self._ensure_html_body(body)
        # Append quoted previous message so To and CC see the conversation trail
        if inbound:
            body = self._append_trailing_quote(
                body,
                inbound.get("body_html"),
                inbound.get("body_text"),
                inbound.get("from") or contact.get("name") or to_email,
                inbound.get("received_at"),
            )
        else:
            reply_body = (log.get("reply_body") or "").strip()
            if reply_body:
                looks_html = reply_body.strip().lower().startswith("<") and ">" in reply_body
                body = self._append_trailing_quote(
                    body,
                    reply_body if looks_html else None,
                    reply_body if not looks_html else None,
                    contact.get("name") or to_email,
                    log.get("replied_at"),
                )
        sender_name = None  # optional: from campaign
        sender_id = log.get("sender_id") or user_id
        inbox_for_quota = await self.db.inboxes.find_one({"id": sender_id}, {"_id": 0}) if sender_id else None
        await self.assert_smtp_monthly_quota_if_needed(user_id, inbox_for_quota)

        if sender_type == "gmail":
            inbox = await self.db.inboxes.find_one({"id": sender_id}, {"gmail_auth_method": 1}) if sender_id else None
            if inbox and inbox.get("gmail_auth_method") == "app_password" and self.smtp_service:
                result = await self.smtp_service.send_email_via_smtp_gmail_app_password(
                    sender_id, to_email, subject, body, None, None, outbound_message_id, body_type="html", cc=cc,
                    in_reply_to=in_reply_to, references=references,
                )
            else:
                result = await self.gmail_service.send_email(
                    sender_id, user_id, to_email, subject, body, None, sender_name, body_type="html", cc=cc,
                    outbound_message_id=outbound_message_id, in_reply_to=in_reply_to, references=references,
                )
        elif sender_type == "smtp" and self.smtp_service:
            if not sender_id:
                raise Exception("No sender inbox configured for this email; cannot send reply via SMTP")
            result = await self.smtp_service.send_email_via_smtp(
                sender_id, to_email, subject, body, None, body_type="html", cc=cc,
                outbound_message_id=outbound_message_id, in_reply_to=in_reply_to, references=references,
            )
        else:
            raise Exception("Cannot send reply for this sender type")
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        sent_message_id = result.get("message_id")
        # Thread: append our_reply to thread_messages so UI can show reply-by-reply (Gmail-style)
        thread_entry = {"type": "our_reply", "body": body, "at": now_iso}
        if sent_message_id:
            thread_entry["message_id"] = sent_message_id
        await self.db.email_logs.update_one(
            {"id": email_log_id, "user_id": user_id},
            {
                "$set": {"status": "replied", "replied_at": now, "last_sent_reply_body": body},
                "$push": {"thread_messages": thread_entry},
            }
        )
        try:
            await self.record_outbound_send_for_usage(
                user_id=user_id,
                sender_id=sender_id,
                send_source="mailbox_reply_thread",
                to_email=to_email,
                subject=subject,
                inbox=inbox_for_quota,
                message_id=sent_message_id,
                campaign_id=log.get("campaign_id"),
                contact_id=log.get("contact_id"),
            )
        except Exception:
            self._log.exception("record_outbound_send_for_usage failed (mailbox_reply_thread) user_id=%s", user_id)
        contact_id = log["contact_id"]
        campaign_id = log["campaign_id"]
        await self.db.contacts.update_one(
            {"id": contact_id},
            {"$set": {"status": "replied"}}
        )
        await self.db.campaign_contacts.update_one(
            {"campaign_id": campaign_id, "contact_id": contact_id},
            {
                "$set": {
                    "status": "replied",
                    "last_activity": now,
                    "updated_at": now
                },
                "$push": {
                    "events": {
                        "type": "replied",
                        "timestamp": now,
                        "metadata": {"email_log_id": email_log_id, "source": "app_reply"}
                    }
                }
            }
        )
        return {"message_id": result.get("message_id"), "status": "sent"}

    async def send_reply_to_inbound(
        self,
        user_id: str,
        message_id: str,
        subject: str,
        body: str,
        cc: str = None,
    ) -> dict:
        """Send a reply to a received (inbound) email.

        Uses the inbox that received the email, or first available user inbox, and
        records the latest reply on the inbound_messages document so the app UI
        can show 'Your reply' in the Incoming domain mail view.
        Sets In-Reply-To/References so To and CC see the same thread.
        """
        msg = await self.db.inbound_messages.find_one({"id": message_id, "user_id": user_id})
        if not msg:
            raise Exception("Message not found")
        from_str = (msg.get("from") or "").strip()
        # Extract plain email from "Display Name <email@domain.com>" so SMTP/API get a valid To address
        to_email = from_str
        if "<" in from_str and ">" in from_str:
            match = re.search(r"<([^>]+)>", from_str)
            if match:
                to_email = match.group(1).strip().lower()
        else:
            to_email = from_str.lower()
        if not to_email or "@" not in to_email:
            raise Exception("Cannot determine reply address")
        # Threading: reply in same conversation so CC gets trailing emails
        inbound_rfc_id = (msg.get("message_id") or "").strip()
        if inbound_rfc_id and not inbound_rfc_id.startswith("<"):
            inbound_rfc_id = f"<{inbound_rfc_id}>"
        in_reply_to = inbound_rfc_id or None
        references = inbound_rfc_id or None
        outbound_message_id = f"reply-inbound-{message_id}-{datetime.now(timezone.utc).timestamp()}@reply"
        # Body comes from a plain textarea; we send HTML, so preserve whitespace.
        body = self._ensure_html_body(body)
        # Append quoted previous message so To and CC see the conversation trail
        body = self._append_trailing_quote(
            body,
            msg.get("body_html"),
            msg.get("body_text"),
            msg.get("from") or to_email,
            msg.get("received_at"),
        )
        inbox_id = msg.get("inbox_id")
        if inbox_id:
            inbox = await self.db.inboxes.find_one({"id": inbox_id, "user_id": user_id})
            if not inbox:
                raise Exception("Inbox not found")
        else:
            inbox = await self.db.inboxes.find_one(
                {"user_id": user_id, "status": "ready"},
                sort=[("created_at", 1)]
            )
            if not inbox:
                raise Exception("No sending inbox configured. Add an email account in Inboxes to reply.")
        await self.assert_smtp_monthly_quota_if_needed(user_id, inbox)
        sender_type = inbox.get("sender_type", "gmail")
        if sender_type == "gmail":
            if inbox.get("gmail_auth_method") == "app_password" and self.smtp_service:
                result = await self.smtp_service.send_email_via_smtp_gmail_app_password(
                    inbox["id"], to_email, subject, body, None, None, outbound_message_id, body_type="html", cc=cc,
                    in_reply_to=in_reply_to, references=references,
                )
            else:
                result = await self.gmail_service.send_email(
                    inbox["id"], user_id, to_email, subject, body, None, None, body_type="html", cc=cc,
                    outbound_message_id=outbound_message_id, in_reply_to=in_reply_to, references=references,
                )
        elif sender_type == "smtp" and self.smtp_service:
            result = await self.smtp_service.send_email_via_smtp(
                inbox["id"], to_email, subject, body, None, body_type="html", cc=cc,
                outbound_message_id=outbound_message_id, in_reply_to=in_reply_to, references=references,
            )
        else:
            raise Exception("Cannot send reply from this inbox type")
        now = datetime.now(timezone.utc)
        try:
            await self.record_outbound_send_for_usage(
                user_id=user_id,
                sender_id=inbox["id"],
                send_source="mailbox_reply_inbound",
                to_email=to_email,
                subject=subject,
                inbox=inbox,
                message_id=result.get("message_id"),
            )
        except Exception:
            self._log.exception("record_outbound_send_for_usage failed (mailbox_reply_inbound) user_id=%s", user_id)
        # Store latest reply metadata on inbound message for UI (backward compat)
        try:
            await self.db.inbound_messages.update_one(
                {"id": message_id, "user_id": user_id},
                {
                    "$set": {
                        "last_sent_reply_subject": subject,
                        "last_sent_reply_body": body,
                        "last_sent_reply_at": now,
                    }
                },
            )
        except Exception:
            pass
        # Thread: append our reply to thread so UI shows reply-by-reply (Gmail-style)
        try:
            thread_id = msg.get("thread_id") or message_id
            outbound_id = str(uuid.uuid4())
            await self.db.outbound_replies.insert_one({
                "id": outbound_id,
                "thread_id": thread_id,
                "user_id": user_id,
                "subject": subject,
                "body": body,
                "at": now,
            })
        except Exception:
            pass
        return {"message_id": result.get("message_id"), "status": "sent"}

    async def send_compose(
        self,
        user_id: str,
        to_email: str,
        subject: str,
        body: str,
        inbox_id: Optional[str] = None,
        cc: Optional[str] = None,
    ) -> dict:
        """Send a new (compose) email from an inbox. Used by MailBox Write mail."""
        to_email = (to_email or "").strip().lower()
        if not to_email or "@" not in to_email:
            raise Exception("Invalid recipient email")
        if inbox_id:
            inbox = await self.db.inboxes.find_one({"id": inbox_id, "user_id": user_id})
            if not inbox:
                raise Exception("Inbox not found")
        else:
            inbox = await self.db.inboxes.find_one(
                {"user_id": user_id, "status": "ready"},
                sort=[("created_at", 1)],
            )
            if not inbox:
                raise Exception("No sending inbox configured. Add an email account in Inboxes to send.")
        await self.assert_smtp_monthly_quota_if_needed(user_id, inbox)
        sender_type = inbox.get("sender_type", "gmail")
        body_type = "html"
        # Compose body is plain text from textarea; preserve whitespace in HTML.
        body = self._ensure_html_body(body)
        if sender_type == "gmail":
            if inbox.get("gmail_auth_method") == "app_password" and self.smtp_service:
                result = await self.smtp_service.send_email_via_smtp_gmail_app_password(
                    inbox["id"], to_email, subject, body, None, None, None, body_type=body_type, cc=cc
                )
            else:
                result = await self.gmail_service.send_email(
                    inbox["id"], user_id, to_email, subject, body, None, None, body_type=body_type, cc=cc
                )
        elif sender_type == "smtp" and self.smtp_service:
            result = await self.smtp_service.send_email_via_smtp(
                inbox["id"], to_email, subject, body, None, body_type=body_type, cc=cc
            )
        else:
            raise Exception("Cannot send from this inbox type")
        try:
            await self.record_outbound_send_for_usage(
                user_id=user_id,
                sender_id=inbox["id"],
                send_source="mailbox_compose",
                to_email=to_email,
                subject=subject,
                inbox=inbox,
                message_id=result.get("message_id"),
            )
        except Exception:
            self._log.exception("record_outbound_send_for_usage failed (mailbox_compose) user_id=%s", user_id)
        # Persist compose sends so MailBox "Sent" can show write-mail emails as threads.
        now = datetime.now(timezone.utc)
        outbound_id = str(uuid.uuid4())
        compose_thread_id = f"compose:{outbound_id}"
        await self.db.outbound_replies.insert_one({
            "id": outbound_id,
            "thread_id": compose_thread_id,
            "user_id": user_id,
            "inbox_id": inbox.get("id"),
            "to": to_email,
            "subject": subject,
            "body": body,
            "at": now,
            "compose_email": True,
        })
        return {"message_id": result.get("message_id"), "status": "sent"}

    def _credit_service_lazy(self) -> CreditService:
        if not hasattr(self, "_credit_service_inst"):
            self._credit_service_inst = CreditService(self.db)
        return self._credit_service_inst

    @staticmethod
    def _campaign_network_contact_id(campaign_id: str, email: str) -> str:
        h = hashlib.sha256(f"{campaign_id}:{email.strip().lower()}".encode()).hexdigest()[:24]
        return f"cn_{h}"

    @classmethod
    def _first_last_from_recipient_email(cls, email: str) -> Tuple[str, str]:
        """Derive first/last name for placeholders from a recipient address."""
        full = cls.get_inbox_name_from_email(email)
        if not full or full == "Team Wellwishers":
            local = (email or "").split("@", 1)[0].replace(".", " ").replace("_", " ")
            parts = [p for p in local.split() if p and not p.isdigit()]
            if len(parts) >= 2:
                return parts[0].title(), " ".join(parts[1:]).title()
            if parts:
                return parts[0].title(), ""
            return "Friend", ""
        parts = full.split(None, 1)
        if len(parts) >= 2:
            return parts[0], parts[1]
        return parts[0], ""

    async def _sample_company_from_contact_lists(
        self, user_id: str, contact_list_ids: List[str]
    ) -> str:
        if not contact_list_ids:
            return "Your Company"
        lists = await self.db.contact_lists.find({"id": {"$in": contact_list_ids}}).to_list(None)
        all_cids: List[str] = []
        for cl in lists or []:
            all_cids.extend(cl.get("contact_ids") or [])
        if not all_cids:
            return "Your Company"
        sample_ids = random.sample(all_cids, min(80, len(all_cids)))
        contacts = await self.db.contacts.find(
            {"id": {"$in": sample_ids}, "user_id": user_id},
            {"company": 1},
        ).to_list(None)
        companies = [c.get("company") for c in (contacts or []) if c and c.get("company")]
        if not companies:
            return "Your Company"
        return random.choice(companies)

    async def _contact_emails_for_ids(self, ids: Set[str]) -> Set[str]:
        if not ids:
            return set()
        docs = await self.db.contacts.find(
            {"id": {"$in": list(ids)}},
            {"email": 1},
        ).to_list(None)
        out: Set[str] = set()
        for d in docs or []:
            em = (d.get("email") or "").strip().lower()
            if em:
                out.add(em)
        return out

    async def _expand_campaign_network_recipients(
        self,
        campaign: dict,
        existing_contact_ids: Set[str],
    ) -> List[str]:
        """Create synthetic contacts for Warmup Network + optional shared pool; persist ids on the campaign."""
        campaign_id = campaign.get("id")
        user_id = campaign.get("user_id")
        if not campaign_id or not user_id:
            return []

        # Personal Network Pool is a sub-option of Real engagement (same as warmup UX).
        real_on = bool(campaign.get("campaign_real_engagement_network"))
        if not real_on:
            return []
        pool_on = bool(campaign.get("campaign_personal_network_pool"))
        raw_real_pct = campaign.get("campaign_real_engagement_percent")
        try:
            # Backward compatibility: old campaigns that enabled real engagement
            # but predate this field default to 20%.
            if raw_real_pct is None:
                real_pct = 20
            else:
                real_pct = int(raw_real_pct or 20)
        except Exception:
            real_pct = 20
        if real_pct <= 0:
            return []
        real_pct = max(20, min(100, real_pct))

        daily_limit = int(campaign.get("daily_limit") or 0)
        target_total_real_engagement = max(1, int(round(max(1, daily_limit) * (real_pct / 100.0))))

        contact_list_ids = list(campaign.get("contact_list_ids") or [])
        taken_emails = await self._contact_emails_for_ids(set(existing_contact_ids))

        new_ids: List[str] = []
        now = datetime.now(timezone.utc)

        async def _upsert_network_contact(
            email: str, source: str, company: str
        ) -> str:
            email = (email or "").strip().lower()
            if not email or "@" not in email:
                return ""
            cid = self._campaign_network_contact_id(campaign_id, email)
            first_name, last_name = self._first_last_from_recipient_email(email)
            doc = {
                "id": cid,
                "user_id": user_id,
                "email": email,
                "first_name": first_name,
                "last_name": last_name,
                "company": company,
                "status": "pending",
                "custom_fields": {
                    "network_campaign_source": source,
                    "network_campaign_id": campaign_id,
                },
                "updated_at": now,
            }
            await self.db.contacts.update_one(
                {"id": cid},
                {"$setOnInsert": {"created_at": now}, "$set": doc},
                upsert=True,
            )
            return cid

        # Respect the configured % by limiting total synthetic real-engagement recipients
        # attached to this campaign (existing + newly added).
        existing_network_count = 0
        if existing_contact_ids:
            try:
                existing_network_count = await self.db.contacts.count_documents(
                    {
                        "id": {"$in": list(existing_contact_ids)},
                        "custom_fields.network_campaign_id": campaign_id,
                        "custom_fields.network_campaign_source": {
                            "$in": ["real_engagement_network", "personal_network_pool"]
                        },
                    }
                )
            except Exception as e:
                logging.warning("expand network: existing synthetic count failed: %s", e)

        remaining_slots = max(0, target_total_real_engagement - int(existing_network_count))
        if remaining_slots <= 0:
            return []

        # --- Own Warmup Network (no credits) ---
        if real_on:
            try:
                wn = await self.db.warmup_network_contacts.find(
                    {"user_id": user_id},
                    {"_id": 0, "email": 1},
                ).to_list(None)
            except Exception as e:
                logging.warning("expand network: warmup_network_contacts load failed: %s", e)
                wn = []
            for row in wn or []:
                if remaining_slots <= 0:
                    break
                em = (row.get("email") or "").strip().lower()
                if not em or em in taken_emails:
                    continue
                co = await self._sample_company_from_contact_lists(user_id, contact_list_ids)
                cid = await _upsert_network_contact(em, "real_engagement_network", co)
                if cid:
                    new_ids.append(cid)
                    taken_emails.add(em)
                    remaining_slots -= 1

        # --- Shared pool (credits charged per send in send_email): add a few new recipients per batch ---
        if pool_on and remaining_slots > 0:
            pool_svc = WarmupSharedPoolService(self.db)
            contributor_ids = await pool_svc.get_eligible_contributor_user_ids(
                exclude_user_id=user_id
            )
            pool_contacts: List[dict] = []
            if contributor_ids:
                try:
                    pool_contacts = await self.db.warmup_network_contacts.find(
                        {"user_id": {"$in": contributor_ids}},
                        {"_id": 0, "email": 1, "user_id": 1},
                    ).to_list(None)
                except Exception as e:
                    logging.warning("expand network: shared pool contacts load failed: %s", e)
            try:
                ryn_listings = await self.db.ryn_listings.find(
                    {"status": "active"},
                    {"_id": 0, "email": 1},
                ).to_list(None)
                for listing in ryn_listings or []:
                    em = (listing.get("email") or "").strip().lower()
                    if em:
                        pool_contacts.append({"email": em, "user_id": listing.get("owner_id")})
            except Exception as e:
                logging.warning("expand network: ryn_listings load failed: %s", e)

            random.shuffle(pool_contacts)
            max_add = min(5, remaining_slots)
            added = 0
            for row in pool_contacts:
                if added >= max_add:
                    break
                em = (row.get("email") or "").strip().lower()
                if not em or em in taken_emails:
                    continue
                co = await self._sample_company_from_contact_lists(user_id, contact_list_ids)
                cid = await _upsert_network_contact(em, "personal_network_pool", co)
                if cid:
                    new_ids.append(cid)
                    taken_emails.add(em)
                    added += 1

        if not new_ids:
            return []

        try:
            await self.db.campaigns.update_one(
                {"id": campaign_id},
                {"$addToSet": {"contact_ids": {"$each": new_ids}}, "$set": {"updated_at": now}},
            )
        except Exception as e:
            logging.warning("expand network: failed to persist contact_ids on campaign: %s", e)

        self._batch_log(
            "campaign network expansion: added %d synthetic contact(s) (real=%s pool=%s)",
            len(new_ids),
            real_on,
            pool_on,
        )
        return new_ids
    
    async def send_campaign_batch(
        self,
        campaign_id: str,
        *,
        check_job_cancelled: Optional[Callable[[], Awaitable[bool]]] = None,
        update_job_heartbeat: Optional[Callable[[], Awaitable[None]]] = None,
    ) -> dict:
        """Send batch of emails for campaign (respects daily limit). Uses per-inbox human-like pacing.
        When check_job_cancelled is provided (e.g. from automation), the batch stops if the job is cancelled.
        When update_job_heartbeat is provided, updates last_heartbeat_at so stale checker can detect dead processes."""
        self._batch_log("send_campaign_batch START campaign_id=%s", campaign_id)

        campaign = await self.db.campaigns.find_one({"id": campaign_id})
        if not campaign:
            self._batch_log("send_campaign_batch ABORT: campaign_id=%s not found", campaign_id)
            self._dev_warn("send_campaign_batch: campaign_id=%s not found", campaign_id)
            raise Exception("Campaign not found")

        if campaign["status"] != "active":
            self._batch_log("send_campaign_batch ABORT: campaign_id=%s status=%s (not active)", campaign_id, campaign.get("status"))
            self._dev_warn("send_campaign_batch: campaign_id=%s status=%s (not active)", campaign_id, campaign.get("status"))
            raise Exception("Campaign is not active")

        user_id = campaign.get("user_id")
        if user_id:
            user = await self.db.users.find_one(
                {"id": user_id},
                {"_id": 0, "subscription_status": 1, "subscription_start": 1, "subscription_end": 1, "plan_id": 1},
            )
            if user and user_subscription_blocks_outbound(user):
                return await self._pause_campaigns_for_subscription_block(campaign_id, user_id, user)

        # Enforce per-tenant monthly SMTP email limit (SMTP inboxes + Gmail app-password transport).
        sender_type = (campaign.get("sender_type") or "gmail").strip()
        if self.plan_service and user_id:
            need_smtp_cap = sender_type == "smtp"
            if not need_smtp_cap and sender_type == "gmail":
                sids = [x for x in (campaign.get("sender_ids") or []) if isinstance(x, str) and x]
                if sids:
                    try:
                        _inboxes = await self.db.inboxes.find(
                            {"id": {"$in": sids[:50]}},
                            {"gmail_auth_method": 1, "sender_type": 1},
                        ).to_list(None)
                        need_smtp_cap = any(
                            self.inbox_counts_against_smtp_monthly_quota(ib) for ib in _inboxes
                        )
                    except Exception:
                        pass
            if need_smtp_cap:
                try:
                    await self.plan_service.assert_monthly_smtp_quota(user_id)
                except MonthlySmtpQuotaExceeded as e:
                    self._batch_log(
                        "send_campaign_batch ABORT: monthly SMTP limit reached (user_id=%s)",
                        user_id,
                    )
                    return {
                        "message": e.message,
                        "sent": 0,
                        "monthly_smtp_limit_reached": True,
                    }
                except Exception as e:
                    logging.warning("send_campaign_batch: monthly SMTP limit check failed for user_id=%s: %s", user_id, e)

        # Check start_date if set
        if campaign.get("start_date"):
            start_date = datetime.strptime(campaign["start_date"], "%Y-%m-%d")
            if datetime.now(timezone.utc).date() < start_date.date():
                self._batch_log("send_campaign_batch ABORT: start_date=%s not yet reached", campaign["start_date"])
                return {"message": f"Campaign scheduled to start on {campaign['start_date']}", "sent": 0}

        # Check send window (start_time - end_time in campaign timezone; supports overnight e.g. 20:00 - 10:00)
        start_time = (campaign.get("start_time") or "09:00").strip()
        end_time = (campaign.get("end_time") or "17:00").strip()
        tz_name = (campaign.get("timezone") or "America/New_York").strip()
        now_local = None
        try:
            tz = ZoneInfo(tz_name)
            now_local = datetime.now(tz)
            allowed_days = normalize_schedule_weekdays_from_campaign(campaign)
            if now_local.weekday() not in allowed_days:
                self._batch_log(
                    "send_campaign_batch ABORT: not a scheduled send day (weekday=%s allowed=%s tz=%s)",
                    now_local.weekday(),
                    sorted(allowed_days),
                    tz_name,
                )
                return {"message": "Waiting for scheduled send day", "sent": 0}
            current_str = now_local.strftime("%H:%M")
            if start_time <= end_time:
                in_window = start_time <= current_str <= end_time
            else:
                # Overnight: e.g. 20:00 - 10:00 → in window when current >= 20:00 OR current <= 10:00
                in_window = current_str >= start_time or current_str <= end_time
            if not in_window:
                self._batch_log("send_campaign_batch ABORT: outside send window (current=%s window=%s-%s tz=%s)", current_str, start_time, end_time, tz_name)
                return {"message": f"Waiting for specified time ({start_time} - {end_time})", "sent": 0}
        except Exception as e:
            logging.warning("send_campaign_batch: timezone check failed (tz=%s): %s; skipping window check", tz_name, e)

        # Check how many emails sent today (campaign-level)
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        sent_today = await self.db.email_logs.count_documents({
            "campaign_id": campaign_id,
            "sent_at": {"$gte": today_start},
            "status": "sent"
        })

        # Respect the campaign's configured daily_limit without an internal hard cap.
        # If daily_limit is missing or invalid, fall back to a safe default.
        try:
            campaign_daily_limit = int(campaign.get("daily_limit", 2000))
        except (TypeError, ValueError):
            campaign_daily_limit = 2000
        if campaign_daily_limit < 1:
            campaign_daily_limit = 2000

        # Pacing should honor both campaign limit and sender capacity.
        # If campaign limit is high but inbox limits are lower, spread against sender capacity
        # so we do not finish all inbox quota too early in the day.
        effective_pacing_daily_limit = campaign_daily_limit
        try:
            sender_type_for_pacing = campaign.get("sender_type", "gmail")
            sender_ids_for_pacing = list(campaign.get("sender_ids") or [])
            if not sender_ids_for_pacing:
                if sender_type_for_pacing == "gmail":
                    pacing_inboxes = await self.db.inboxes.find(
                        {
                            "user_id": campaign["user_id"],
                            "sender_type": "gmail",
                        },
                        {"id": 1},
                    ).to_list(None)
                    sender_ids_for_pacing = [inv["id"] for inv in pacing_inboxes if inv.get("id")]
                else:
                    pacing_inboxes = await self.db.inboxes.find(
                        {
                            "user_id": campaign["user_id"],
                            "sender_type": sender_type_for_pacing,
                            "status": "ready",
                        },
                        {"id": 1},
                    ).to_list(None)
                    sender_ids_for_pacing = [inv["id"] for inv in pacing_inboxes if inv.get("id")]

            if sender_ids_for_pacing:
                inbox_filter = {
                    "id": {"$in": sender_ids_for_pacing},
                    "user_id": campaign["user_id"],
                    "sender_type": sender_type_for_pacing,
                }
                if sender_type_for_pacing == "smtp":
                    inbox_filter["status"] = "ready"
                inboxes_for_capacity = await self.db.inboxes.find(
                    inbox_filter,
                    {"id": 1, "daily_limit": 1, "campaign_rampup": 1, "campaign_rampup_started_at": 1},
                ).to_list(None)
                total_sender_capacity = sum(
                    max(1, int(effective_campaign_daily_limit(inv) or 0))
                    for inv in inboxes_for_capacity
                )
                if total_sender_capacity > 0:
                    effective_pacing_daily_limit = min(
                        campaign_daily_limit, total_sender_capacity
                    )
                    self._batch_log(
                        "pacing daily limit: campaign=%s sender_capacity=%s effective=%s",
                        campaign_daily_limit,
                        total_sender_capacity,
                        effective_pacing_daily_limit,
                    )
        except Exception as e:
            logging.warning(
                "send_campaign_batch: sender-capacity pacing calc failed for campaign_id=%s: %s",
                campaign_id,
                e,
            )

        remaining = effective_pacing_daily_limit - sent_today
        if remaining <= 0:
            self._batch_log("send_campaign_batch ABORT: daily limit reached (sent_today=%s)", sent_today)
            return {"message": "Daily limit reached", "sent": 0, "daily_limit_reached": True}

        # Progressive pacing across the business window:
        # only allow a fraction of the campaign daily_limit based on elapsed window time.
        # This avoids consuming the entire daily quota in the first few scheduler ticks.
        if now_local is not None and effective_pacing_daily_limit > 0:
            try:
                start_h, start_m = map(int, start_time.split(":", 1))
                end_h, end_m = map(int, end_time.split(":", 1))
                today_local = now_local.date()
                window_start_local = datetime(
                    today_local.year,
                    today_local.month,
                    today_local.day,
                    start_h,
                    start_m,
                    tzinfo=tz,
                )
                window_end_local = datetime(
                    today_local.year,
                    today_local.month,
                    today_local.day,
                    end_h,
                    end_m,
                    tzinfo=tz,
                )
                if start_time > end_time:
                    # Overnight window (e.g. 20:00-10:00)
                    if now_local.time() < window_end_local.time():
                        window_start_local = window_start_local - timedelta(days=1)
                    else:
                        window_end_local = window_end_local + timedelta(days=1)

                total_window_seconds = max(
                    1.0, (window_end_local - window_start_local).total_seconds()
                )
                elapsed_seconds = min(
                    total_window_seconds,
                    max(0.0, (now_local - window_start_local).total_seconds()),
                )
                allowed_by_now = int((elapsed_seconds / total_window_seconds) * effective_pacing_daily_limit)

                if sent_today >= allowed_by_now:
                    next_quota_index = min(effective_pacing_daily_limit, sent_today + 1)
                    next_fraction = next_quota_index / float(effective_pacing_daily_limit)
                    next_local = window_start_local + timedelta(
                        seconds=total_window_seconds * next_fraction
                    )
                    next_at_utc = next_local.astimezone(timezone.utc)
                    self._batch_log(
                        "send_campaign_batch ABORT: paced across window (sent_today=%s allowed_now=%s next_at=%s)",
                        sent_today,
                        allowed_by_now,
                        next_at_utc.isoformat(),
                    )
                    return {
                        "message": "Pacing across business hours; waiting for next slot",
                        "sent": 0,
                        "pacing_deferred": True,
                        "next_send_at": next_at_utc,
                    }

                remaining = min(remaining, allowed_by_now - sent_today)
            except Exception as e:
                logging.warning(
                    "send_campaign_batch: progressive pacing calc failed for campaign_id=%s: %s",
                    campaign_id,
                    e,
                )

        # Get contact IDs from contact lists
        contact_list_ids = campaign.get("contact_list_ids", [])
        contact_ids = campaign.get("contact_ids", [])  # Backward compatibility

        all_contact_ids = set(contact_ids)

        # Get contacts from contact lists
        if contact_list_ids:
            contact_lists = await self.db.contact_lists.find(
                {"id": {"$in": contact_list_ids}}
            ).to_list(None)
            for cl in contact_lists:
                all_contact_ids.update(cl.get("contact_ids", []))

        # Warmup network + optional shared pool: merge synthetic contacts into this send universe
        try:
            extra_network = await self._expand_campaign_network_recipients(campaign, all_contact_ids)
            if extra_network:
                all_contact_ids.update(extra_network)
        except Exception as e:
            logging.warning("send_campaign_batch: network recipient expansion failed: %s", e)

        if not all_contact_ids:
            self._batch_log("send_campaign_batch ABORT: no contacts (contact_list_ids=%s contact_ids=%s)", contact_list_ids, list(contact_ids))
            return {"message": "No contacts in campaign", "sent": 0}

        # Resolve all contact IDs for this campaign (deduplicated list) and filter out blocked/unsubscribed contacts.
        all_contact_ids_list = list(all_contact_ids)
        sendable_contact_ids = await self._filter_blocked_contacts(
            campaign["user_id"], all_contact_ids_list
        )
        if not sendable_contact_ids:
            self._batch_log(
                "send_campaign_batch ABORT: no sendable contacts after block/unsubscribe filter (all=%d)",
                len(all_contact_ids_list),
            )
            return {
                "message": "No sendable contacts (all contacts are blocked, unsubscribed, or over global limit)",
                "sent": 0,
                "all_done": True,
            }

        # ------------------------------------------------------------------
        # Build sequence steps from email_sequence (grouped by delay_days)
        # so that all templates with the same delay are treated as variants
        # for a single sequence step (S1, S2, ...).
        # ------------------------------------------------------------------
        raw_sequence = campaign.get("email_sequence") or []
        if not raw_sequence:
            legacy_template_ids = campaign.get("template_ids") or []
            if legacy_template_ids:
                # Fallback: S1 delay 0, subsequent steps every 2 days (matches frontend default)
                fallback_delay_days = 2
                raw_sequence = []
                for idx, tid in enumerate(legacy_template_ids):
                    if not tid:
                        continue
                    delay = 0 if idx == 0 else idx * fallback_delay_days
                    raw_sequence.append({"template_id": tid, "delay_days": delay})

        by_delay = {}
        for step in raw_sequence:
            tid = step.get("template_id")
            if not tid:
                continue
            delay = step.get("delay_days") or 0
            if delay not in by_delay:
                by_delay[delay] = []
            by_delay[delay].append(tid)

        delays = sorted(by_delay.keys())
        if not delays:
            self._batch_log(
                "send_campaign_batch ABORT: campaign_id=%s has no templates in sequence",
                campaign_id,
            )
            return {"message": "No templates configured for this campaign", "sent": 0}

        steps = []
        template_to_step = {}
        for idx, delay in enumerate(delays, start=1):
            tids = by_delay.get(delay) or []
            if not tids:
                continue
            steps.append({"step_index": idx, "delay_days": delay, "template_ids": tids})
            for tid in tids:
                template_to_step[tid] = idx

        if not steps:
            self._batch_log(
                "send_campaign_batch ABORT: campaign_id=%s sequence steps empty after grouping",
                campaign_id,
            )
            return {"message": "No templates configured for this campaign", "sent": 0}

        total_steps = len(steps)

        sent_count = 0
        errors = []

        # ------------------------------------------------------------------
        # A/B auto-winner logic for the initial step only (step_index = 1).
        # We keep the same behavior as before, but now constrain it to
        # templates that belong to the first sequence step.
        # ------------------------------------------------------------------
        variant_ids = list(steps[0]["template_ids"])
        if not variant_ids:
            raise Exception("No templates configured for initial sequence step")

        all_variant_ids = list(variant_ids)  # Keep full list for re-evaluation
        ab_winner = campaign.get("ab_winner_template_id")
        ab_winner_set_at = campaign.get("ab_winner_set_at")
        # Normalize to timezone-aware UTC (MongoDB returns naive datetimes)
        if (
            ab_winner_set_at is not None
            and isinstance(ab_winner_set_at, datetime)
            and ab_winner_set_at.tzinfo is None
        ):
            ab_winner_set_at = ab_winner_set_at.replace(tzinfo=timezone.utc)
        now_utc = datetime.now(timezone.utc)

        if ab_winner:
            # Re-evaluation: after REEVAL_MIN_HOURS, re-check cumulative performance
            # and switch winner if another variant does better.
            if len(all_variant_ids) > 1:
                hours_since_winner_set = (
                    (now_utc - ab_winner_set_at).total_seconds() / 3600.0
                    if ab_winner_set_at
                    else float("inf")
                )
                if hours_since_winner_set >= REEVAL_MIN_HOURS:
                    pipeline = [
                        {
                            "$match": {
                                "campaign_id": campaign_id,
                                "status": {
                                    "$in": ["sent", "opened", "clicked", "replied"]
                                },
                                "template_id": {"$in": all_variant_ids},
                            }
                        },
                        {
                            "$group": {
                                "_id": "$template_id",
                                "sent": {"$sum": 1},
                                "opened": {
                                    "$sum": {
                                        "$cond": [
                                            {
                                                "$in": [
                                                    "$status",
                                                    ["opened", "clicked", "replied"],
                                                ]
                                            },
                                            1,
                                            0,
                                        ]
                                    }
                                },
                                "clicked": {
                                    "$sum": {
                                        "$cond": [
                                            {
                                                "$in": [
                                                    "$status",
                                                    ["clicked", "replied"],
                                                ]
                                            },
                                            1,
                                            0,
                                        ]
                                    }
                                },
                                "replied": {
                                    "$sum": {
                                        "$cond": [
                                            {"$eq": ["$status", "replied"]},
                                            1,
                                            0,
                                        ]
                                    }
                                },
                            }
                        },
                    ]
                    by_template = await self.db.email_logs.aggregate(pipeline).to_list(
                        None
                    )
                    by_tid = {r["_id"]: r for r in by_template}
                    total_replied = sum(
                        r.get("replied", 0) or 0 for r in by_template
                    )
                    if total_replied > 0:
                        reply_weight = 0.4
                        open_weight = 0.3
                        click_weight = 0.3
                    else:
                        reply_weight = 0.0
                        open_weight = 0.5
                        click_weight = 0.5
                    best_tid = None
                    best_score = -1.0
                    for tid in all_variant_ids:
                        r = by_tid.get(tid) or {}
                        sent = r.get("sent", 0) or 1
                        open_rate = (r.get("opened", 0) / sent) * 100
                        click_rate = (r.get("clicked", 0) / sent) * 100
                        reply_rate = (r.get("replied", 0) / sent) * 100
                        score = (
                            reply_weight * reply_rate
                            + open_weight * open_rate
                            + click_weight * click_rate
                        )
                        if score > best_score:
                            best_score = score
                            best_tid = tid
                    if best_tid and best_tid != ab_winner:
                        r_winner = by_tid.get(ab_winner) or {}
                        sent_w = r_winner.get("sent", 0) or 1
                        winner_open_rate = (r_winner.get("opened", 0) / sent_w) * 100
                        winner_click_rate = (
                            r_winner.get("clicked", 0) / sent_w
                        ) * 100
                        winner_reply_rate = (
                            r_winner.get("replied", 0) / sent_w
                        ) * 100
                        winner_score = (
                            reply_weight * winner_reply_rate
                            + open_weight * winner_open_rate
                            + click_weight * winner_click_rate
                        )
                        if (best_score - winner_score) >= REEVAL_MIN_IMPROVEMENT:
                            await self.db.campaigns.update_one(
                                {"id": campaign_id},
                                {
                                    "$set": {
                                        "ab_winner_template_id": best_tid,
                                        "ab_winner_set_at": now_utc,
                                    }
                                },
                            )
                            variant_ids = [best_tid]
                            self._batch_log(
                                "A/B: re-eval switched winner to template_id=%s (score=%.2f, prev=%.2f)",
                                best_tid,
                                best_score,
                                winner_score,
                            )
                        else:
                            variant_ids = [ab_winner]
                            # Throttle: next re-eval in REEVAL_MIN_HOURS
                            await self.db.campaigns.update_one(
                                {"id": campaign_id},
                                {"$set": {"ab_winner_set_at": now_utc}},
                            )
                    else:
                        variant_ids = [ab_winner]
                        await self.db.campaigns.update_one(
                            {"id": campaign_id},
                            {"$set": {"ab_winner_set_at": now_utc}},
                        )
                else:
                    variant_ids = [ab_winner]
                # Legacy campaigns may have no ab_winner_set_at; set it once so we don't re-eval every batch
                if not ab_winner_set_at and variant_ids == [ab_winner]:
                    await self.db.campaigns.update_one(
                        {"id": campaign_id},
                        {"$set": {"ab_winner_set_at": now_utc}},
                    )
            else:
                variant_ids = [ab_winner]
            if variant_ids == [ab_winner]:
                self._batch_log(
                    "A/B: using auto-selected winner template_id=%s", ab_winner
                )
        elif len(variant_ids) > 1:
            # Check whether we should declare a winner now (min sends per variant + time/total threshold)
            pipeline = [
                {
                    "$match": {
                        "campaign_id": campaign_id,
                        "status": {
                            "$in": ["sent", "opened", "clicked", "replied"]
                        },
                        "template_id": {"$in": variant_ids},
                    }
                },
                {
                    "$group": {
                        "_id": "$template_id",
                        "sent": {"$sum": 1},
                        "opened": {
                            "$sum": {
                                "$cond": [
                                    {
                                        "$in": [
                                            "$status",
                                            ["opened", "clicked", "replied"],
                                        ]
                                    },
                                    1,
                                    0,
                                ]
                            }
                        },
                        "clicked": {
                            "$sum": {
                                "$cond": [
                                    {
                                        "$in": ["$status", ["clicked", "replied"]],
                                    },
                                    1,
                                    0,
                                ]
                            }
                        },
                        "replied": {
                            "$sum": {
                                "$cond": [
                                    {"$eq": ["$status", "replied"]},
                                    1,
                                    0,
                                ]
                            }
                        },
                    }
                },
            ]
            by_template = await self.db.email_logs.aggregate(pipeline).to_list(None)
            by_tid = {r["_id"]: r for r in by_template}
            first_sent_at_doc = await self.db.email_logs.find_one(
                {"campaign_id": campaign_id, "status": {"$ne": "pending"}},
                {"sent_at": 1},
                sort=[("sent_at", 1)],
            )
            first_sent_at = first_sent_at_doc.get("sent_at") if first_sent_at_doc else None
            # Normalize to timezone-aware UTC (MongoDB returns naive datetimes)
            if (
                first_sent_at is not None
                and isinstance(first_sent_at, datetime)
                and first_sent_at.tzinfo is None
            ):
                first_sent_at = first_sent_at.replace(tzinfo=timezone.utc)
            total_sent = sum(r.get("sent", 0) for r in by_template)
            hours_since_first = (
                (now_utc - first_sent_at).total_seconds() / 3600.0
                if first_sent_at
                else 0
            )
            min_sends_ok = all(
                (by_tid.get(tid) or {}).get("sent", 0) >= MIN_SENDS_PER_VARIANT
                for tid in variant_ids
            )
            time_ok = (
                hours_since_first >= MIN_HOURS_FOR_WINNER
                or total_sent >= MIN_TOTAL_SENDS_FOR_WINNER
            )
            total_replied = sum(r.get("replied", 0) or 0 for r in by_template)
            if total_replied > 0:
                reply_weight = 0.4
                open_weight = 0.3
                click_weight = 0.3
            else:
                reply_weight = 0.0
                open_weight = 0.5
                click_weight = 0.5
            if min_sends_ok and time_ok:
                best_tid = None
                best_score = -1.0
                for tid in variant_ids:
                    r = by_tid.get(tid) or {}
                    sent = r.get("sent", 0) or 1
                    open_rate = (r.get("opened", 0) / sent) * 100
                    click_rate = (r.get("clicked", 0) / sent) * 100
                    reply_rate = (r.get("replied", 0) / sent) * 100
                    score = (
                        reply_weight * reply_rate
                        + open_weight * open_rate
                        + click_weight * click_rate
                    )
                    if score > best_score:
                        best_score = score
                        best_tid = tid
                if best_tid:
                    await self.db.campaigns.update_one(
                        {"id": campaign_id},
                        {
                            "$set": {
                                "ab_winner_template_id": best_tid,
                                "ab_winner_set_at": now_utc,
                            }
                        },
                    )
                    variant_ids = [best_tid]
                    self._batch_log(
                        "A/B: auto-selected winner template_id=%s (score=%.2f)",
                        best_tid,
                        best_score,
                    )

        # Update step 1 templates to reflect any auto-selected winner(s)
        steps[0]["template_ids"] = list(variant_ids)

        if variant_ids:
            err = await self.validate_campaign_templates_compliance(
                campaign["user_id"], variant_ids
            )
            if err:
                raise Exception(err)

        # ------------------------------------------------------------------
        # Build per-contact state (completed steps and last sent time per step)
        # and decide which contacts are eligible for their next sequence step
        # right now (respecting delay_days between steps).
        # ------------------------------------------------------------------
        contact_state = {}
        for cid in sendable_contact_ids:
            contact_state[cid] = {
                "completed_steps": set(),
                "last_sent_by_step": {},
                "failed_count_by_step": {},
                "has_any_logs": False,
                "fallback_last_sent_at": None,
                "last_sender_id": None,
                "last_sent_at_overall": None,
            }

        # Count failed attempts per contact per step (max 3 retries allowed)
        failed_logs_cursor = await self.db.email_logs.find(
            {
                "campaign_id": campaign_id,
                "contact_id": {"$in": list(sendable_contact_ids)},
                "status": "failed",
            },
            {"_id": 0, "contact_id": 1, "template_id": 1},
        ).to_list(None)
        for log in failed_logs_cursor:
            cid = log.get("contact_id")
            if cid not in contact_state:
                continue
            step_index = template_to_step.get(log.get("template_id"))
            if step_index is None:
                continue
            state = contact_state[cid]
            prev = state["failed_count_by_step"].get(step_index, 0)
            state["failed_count_by_step"][step_index] = prev + 1

        logs_cursor = await self.db.email_logs.find(
            {
                "campaign_id": campaign_id,
                "contact_id": {"$in": list(sendable_contact_ids)},
                "status": {"$in": ["sent", "opened", "clicked", "replied"]},
            },
            {
                "_id": 0,
                "contact_id": 1,
                "template_id": 1,
                "sent_at": 1,
                "created_at": 1,
                "sender_id": 1,
                "status": 1,
            },
        ).to_list(None)

        for _state in contact_state.values():
            _state["has_reply"] = False

        def _normalize_to_utc(dt):
            """MongoDB often returns naive datetimes; normalize to timezone-aware UTC for comparison/sort."""
            if dt is None or not isinstance(dt, datetime):
                return dt
            if dt.tzinfo is None:
                return dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)

        for log in logs_cursor:
            cid = log.get("contact_id")
            if cid not in contact_state:
                continue
            state = contact_state[cid]
            state["has_any_logs"] = True
            if (log.get("status") or "").lower() == "replied":
                state["has_reply"] = True
            sent_at = log.get("sent_at") or log.get("created_at")
            if sent_at is None:
                continue
            sent_at = _normalize_to_utc(sent_at)
            if sent_at is None:
                continue
            # Sticky inbox: remember sender_id from the most recent send for this contact
            prev_overall = state.get("last_sent_at_overall")
            if prev_overall is None or sent_at > prev_overall:
                state["last_sent_at_overall"] = sent_at
                state["last_sender_id"] = log.get("sender_id")
            tpl_id = log.get("template_id")
            step_index = template_to_step.get(tpl_id)
            if step_index is None:
                # Legacy log for template not in the current sequence; treat as generic
                # activity so we at least avoid re-sending "initial" to this contact.
                prev_fallback = state["fallback_last_sent_at"]
                if prev_fallback is None or sent_at > prev_fallback:
                    state["fallback_last_sent_at"] = sent_at
                continue
            state["completed_steps"].add(step_index)
            prev = state["last_sent_by_step"].get(step_index)
            if prev is None or sent_at > prev:
                state["last_sent_by_step"][step_index] = sent_at

        # Treat legacy logs without mapped templates as at least step 1 completed
        if total_steps >= 1:
            for cid, state in contact_state.items():
                if state["has_any_logs"] and not state["completed_steps"]:
                    state["completed_steps"].add(1)
                    if state["fallback_last_sent_at"] is not None:
                        state["last_sent_by_step"][1] = state["fallback_last_sent_at"]

        now_utc = datetime.now(timezone.utc)
        eligible_infos = []
        has_future_steps = False

        for cid in sendable_contact_ids:
            state = contact_state.get(cid)
            if not state:
                continue
            if state.get("has_reply"):
                continue
            completed = state["completed_steps"]
            if not completed:
                # No steps sent yet -> eligible for step 1 immediately
                next_step_index = 1
                eligible_at = now_utc
                has_future_steps = True
            else:
                max_completed = max(completed)
                if max_completed >= total_steps:
                    # Full sequence done for this contact
                    continue
                has_future_steps = True
                next_step_index = max_completed + 1
                if next_step_index == 1:
                    eligible_at = now_utc
                else:
                    prev_step_index = max_completed
                    prev_def = steps[prev_step_index - 1]
                    next_def = steps[next_step_index - 1]
                    prev_delay = prev_def.get("delay_days") or 0
                    next_delay = next_def.get("delay_days") or 0
                    gap_days = max(0, next_delay - prev_delay)
                    prev_sent_at = state["last_sent_by_step"].get(prev_step_index)
                    if prev_sent_at is None:
                        # Cannot compute timing for this contact's next step
                        continue
                    eligible_at = prev_sent_at + timedelta(days=gap_days)

            # Skip contacts that have failed MAX_FAILED_RETRIES or more times for this step
            failed_count = state.get("failed_count_by_step", {}).get(next_step_index, 0)
            if failed_count >= MAX_FAILED_RETRIES:
                self._batch_log(
                    "skipping contact_id=%s (failed %d times for step %d, limit=%d)",
                    cid, failed_count, next_step_index, MAX_FAILED_RETRIES,
                )
                continue

            if eligible_at <= now_utc:
                is_follow_up = next_step_index > 1
                is_retry = failed_count > 0
                # Priority tier: 0=follow-up, 1=pending (step 1 first-time), 2=failed (retries)
                if is_follow_up:
                    priority_tier = 0
                elif is_retry:
                    priority_tier = 2
                else:
                    priority_tier = 1
                eligible_infos.append(
                    {
                        "contact_id": cid,
                        "next_step": next_step_index,
                        "eligible_at": eligible_at,
                        "priority_tier": priority_tier,
                    }
                )

        self._batch_log(
            "contacts: all=%d sendable=%d eligible_now=%d remaining_slot=%d total_steps=%d",
            len(all_contact_ids_list),
            len(sendable_contact_ids),
            len(eligible_infos),
            remaining,
            total_steps,
        )

        if not eligible_infos:
            self._batch_log(
                "send_campaign_batch: 0 eligible contacts (has_future_steps=%s)",
                has_future_steps,
            )
            if not has_future_steps:
                # All sendable contacts have completed the full sequence
                return {
                    "message": "All sendable contacts have completed the full sequence.",
                    "sent": 0,
                    "all_done": True,
                }
            # Some contacts still have future steps, but none are due yet
            return {
                "message": "No contacts are ready for the next sequence step yet.",
                "sent": 0,
                "all_done": False,
            }

        # Sort eligible contacts: follow-ups first, then pending (step 1), then failed retries.
        # Within each tier, sort by eligible_at then contact_id.
        eligible_infos.sort(key=lambda x: (x["priority_tier"], x["eligible_at"], x["contact_id"]))
        limited_infos = eligible_infos[:remaining]
        selected_ids = [info["contact_id"] for info in limited_infos]

        contacts_docs = await self.db.contacts.find(
            {"id": {"$in": selected_ids}}
        ).to_list(None)
        contacts_by_id = {c["id"]: c for c in contacts_docs}

        pending_contacts = []
        for info in limited_infos:
            contact_doc = contacts_by_id.get(info["contact_id"])
            if not contact_doc:
                continue
            state = contact_state.get(info["contact_id"]) or {}
            preferred_sender_id = state.get("last_sender_id")
            pending_contacts.append(
                {
                    "contact": contact_doc,
                    "next_step": info["next_step"],
                    "preferred_sender_id": preferred_sender_id,
                }
            )

        if not pending_contacts:
            self._batch_log(
                "send_campaign_batch ABORT: eligible contacts found but none loaded from DB",
            )
            return {
                "message": "No contacts available to send after filtering.",
                "sent": 0,
                "all_done": False,
            }

        # Get sender name from campaign
        sender_name = campaign.get("sender_name")
        
        # Get sender configuration
        sender_type = campaign.get("sender_type", "gmail")
        sender_ids = campaign.get("sender_ids", [])
        sender_rotation = campaign.get("sender_rotation", "round_robin")
        
        # If no sender_ids specified, default to user's Gmail inbox(es) or SMTP inboxes
        if not sender_ids:
            if sender_type == "gmail":
                gmail_inboxes = await self.db.inboxes.find({
                    "user_id": campaign["user_id"],
                    "sender_type": "gmail",
                }).to_list(None)
                sender_ids = [inbox["id"] for inbox in gmail_inboxes]
                if not sender_ids:
                    # Backward compat: legacy single credential keyed by user_id
                    sender_ids = [campaign["user_id"]]
            else:
                inboxes = await self.db.inboxes.find({
                    "user_id": campaign["user_id"],
                    "sender_type": sender_type,
                    "status": "ready"
                }).to_list(None)
                sender_ids = [inbox["id"] for inbox in inboxes]
        
        if not sender_ids:
            self._batch_log("send_campaign_batch ABORT: no senders (sender_type=%s user_id=%s). Check inboxes: Gmail/SMTP must exist and for SMTP status=ready.", sender_type, campaign.get("user_id"))
            return {"message": "No senders available", "sent": 0}

        # When using explicit sender_ids (e.g. multiple Gmail/SMTP), for SMTP filter to existing + status=ready
        if sender_type == "smtp":
            inboxes = await self.db.inboxes.find({"id": {"$in": sender_ids}, "user_id": campaign["user_id"], "sender_type": "smtp", "status": "ready"}).to_list(None)
            valid_ids = [inb["id"] for inb in inboxes]
            if len(valid_ids) < len(sender_ids):
                missing = set(sender_ids) - set(valid_ids)
                self._batch_log("SMTP inbox(es) missing or not ready (filtered out): %s", list(missing))
            if not valid_ids:
                self._batch_log("send_campaign_batch ABORT: no SMTP inboxes with status=ready (check inbox status)", campaign_id)
                return {"message": "No SMTP senders ready (inbox status must be ready)", "sent": 0}
            sender_ids = valid_ids

        rotation_enabled = campaign.get("rotation_enabled", True)  # default True for backward compat
        if rotation_enabled:
            # Respect campaign-selected sender_ids for rotation; do not auto-expand
            # to every inbox on the account/domain.
            self._batch_log(
                "rotation on: using %d selected inbox(es) for rotation (sender_type=%s)",
                len(sender_ids),
                sender_type,
            )
        elif sender_ids:
            sender_ids = [sender_ids[0]]
            self._batch_log("rotation disabled: using single sender %s", sender_ids[0])
        self._batch_log("senders: sender_type=%s sender_ids=%s rotation=%s", sender_type, sender_ids, rotation_enabled)

        reply_to_email = await self._resolve_reply_to_email(campaign["user_id"], campaign)
        # Detect when user explicitly chose Reply-To "none" (or "custom" with missing email) so we don't override with Gmail for SMTP
        rt = campaign.get("reply_to_type")
        if rt in (None, "default"):
            settings_doc = await self.db.user_settings.find_one({"user_id": campaign["user_id"]}, {"_id": 0})
            rt = (settings_doc or {}).get("default_reply_to_type")
        # Don't use Gmail fallback when user chose "custom" (even if reply_to_email was missing in DB)
        reply_to_explicitly_none = (rt == "none" and reply_to_email is None) or (rt == "custom" and reply_to_email is None)

        # Load inbox docs for pattern selection, capacity, and weekly rhythm (one bulk query)
        inbox_docs = await self.db.inboxes.find(
            {"id": {"$in": sender_ids}},
            {
                "id": 1,
                "created_at": 1,
                "sent_today": 1,
                "daily_limit": 1,
                "weekly_rhythm_light_days": 1,
                "campaign_rampup": 1,
                "campaign_rampup_started_at": 1,
            },
        ).to_list(None)
        try:
            tz = ZoneInfo(tz_name)
            now_local = datetime.now(tz)
        except Exception:
            now_local = datetime.now(timezone.utc)
        pattern = self._choose_sending_pattern(
            campaign, inbox_docs, len(pending_contacts), now_local
        )
        self._batch_log(
            "sending pattern: %s (min=%.1f, max=%.1f, coffee_every=%d)",
            pattern.pattern_type, pattern.min_gap_minutes, pattern.max_gap_minutes, pattern.coffee_break_every,
        )
        last_sent_at, sends_since_coffee_break = await self._load_per_inbox_sending_state(sender_ids, today_start, pattern)

        # Per-inbox weekly rhythm: light days (randomly assigned per inbox, stored once) get longer gaps.
        # Batched: use inbox_docs from above, generate missing, bulk write if needed (no N sequential queries)
        rhythm_by_inbox = {}
        rhythm_updates: list[UpdateOne] = []
        inbox_by_id = {d["id"]: d for d in inbox_docs if d.get("id")}
        for sid in sender_ids:
            days = None
            d = inbox_by_id.get(sid)
            if d and isinstance(d.get("weekly_rhythm_light_days"), list):
                valid = [int(x) for x in d["weekly_rhythm_light_days"] if isinstance(x, (int, float)) and 0 <= int(x) <= 6]
                if valid:
                    days = valid
            if days is None:
                num_light = random.randint(1, 2)
                days = sorted(random.sample(range(7), num_light))
                rhythm_updates.append(UpdateOne({"id": sid}, {"$set": {"weekly_rhythm_light_days": days}}))
            rhythm_by_inbox[sid] = days
        if rhythm_updates:
            await self.db.inboxes.bulk_write(rhythm_updates, ordered=False)

        # In-memory inbox capacity: load once at batch start, update after each send. DB is updated by send_email.
        inbox_sent_today: dict[str, int] = {}
        inbox_daily_limit: dict[str, int] = {}
        for d in inbox_docs:
            sid = d.get("id")
            if sid:
                inbox_sent_today[sid] = int(d.get("sent_today") or 0)
                inbox_daily_limit[sid] = effective_campaign_daily_limit(d)
        for sid in sender_ids:
            if sid not in inbox_sent_today:
                inbox_sent_today[sid] = 0
            if sid not in inbox_daily_limit:
                inbox_daily_limit[sid] = 50

        pending_deque = deque(pending_contacts)
        sender_index = 0
        daily_limit_reached = False
        pacing_deferred = False
        next_send_at = None
        job_cancelled = False

        self._batch_log("send_campaign_batch: attempting to send to %d contact(s)", len(pending_deque))

        while pending_deque and sent_count < remaining:
            # Heartbeat: process is alive; stale checker uses this to detect dead processes
            if update_job_heartbeat:
                try:
                    await update_job_heartbeat()
                except Exception as e:
                    logging.warning("update_job_heartbeat failed: %s", e)
            # Link job and process: stop if job was cancelled (e.g. stale recovery or user Stop)
            if check_job_cancelled:
                try:
                    if await check_job_cancelled():
                        job_cancelled = True
                        self._batch_log("Job cancelled; stopping batch")
                        break
                except Exception as e:
                    logging.warning("check_job_cancelled failed: %s", e)
            # Get inboxes that still have capacity (use in-memory values, no DB read)
            inboxes_with_capacity = [
                sid for sid in sender_ids
                if inbox_sent_today.get(sid, 0) < inbox_daily_limit.get(sid, 50)
            ]
            if not inboxes_with_capacity:
                self._batch_log("all %d senders at daily limit; stopping batch", len(sender_ids))
                daily_limit_reached = True
                break

            # Current weekday in campaign TZ for weekly rhythm (light days = longer gaps)
            try:
                now_local = datetime.now(ZoneInfo(tz_name))
            except Exception:
                now_local = datetime.now(timezone.utc)
            today_weekday = now_local.weekday()

            # Next allowed time per inbox (per-inbox pacing)
            next_allowed_at = {}
            next_was_coffee_break = {}
            for sid in inboxes_with_capacity:
                # Treat as first send today when last_sent_at is before today's date.
                # Compare by date only to avoid offset-naive vs offset-aware datetime issues.
                first_send_today = last_sent_at[sid].date() < today_start.date()
                gap_min, was_coffee = self._next_gap_minutes(
                    pattern, sends_since_coffee_break[sid], first_send_today
                )
                is_light_day = today_weekday in rhythm_by_inbox.get(sid, [])
                if is_light_day:
                    if random.random() >= RHYTHM_BREAK_PROBABILITY:
                        gap_min *= WEEKLY_RHYTHM_LIGHT_DAY_GAP_MULTIPLIER
                else:
                    if random.random() < RHYTHM_SURPRISE_SLOW_PROBABILITY:
                        gap_min *= RHYTHM_SURPRISE_SLOW_MULTIPLIER
                next_allowed_at[sid] = last_sent_at[sid] + timedelta(minutes=gap_min)
                next_was_coffee_break[sid] = was_coffee

            # Pop contact first so we can prefer same inbox as prior send (sticky inbox)
            contact_info = pending_deque.popleft()
            preferred_sender_id = contact_info.get("preferred_sender_id")
            if preferred_sender_id and preferred_sender_id in inboxes_with_capacity:
                chosen_inbox = preferred_sender_id
                earliest = next_allowed_at[chosen_inbox]
            else:
                earliest = min(next_allowed_at[sid] for sid in inboxes_with_capacity)
                candidates = [sid for sid in inboxes_with_capacity if next_allowed_at[sid] == earliest]
                if len(candidates) == 1:
                    chosen_inbox = candidates[0]
                elif sender_rotation == "random":
                    chosen_inbox = random.choice(candidates)
                else:
                    chosen_inbox = candidates[sender_index % len(candidates)]
                    sender_index = (sender_index + 1) % max(len(sender_ids), 1)

            now_utc = datetime.now(timezone.utc)
            if earliest > now_utc:
                sleep_seconds = (earliest - now_utc).total_seconds()
                end_utc = None
                try:
                    end_time_str = (campaign.get("end_time") or "17:00").strip()
                    tz_sleep = ZoneInfo(tz_name)
                    today_local = datetime.now(tz_sleep).date()
                    end_time_only = datetime.strptime(end_time_str, "%H:%M").time()
                    end_dt_local = datetime.combine(today_local, end_time_only, tzinfo=tz_sleep)
                    end_utc = end_dt_local.astimezone(timezone.utc)
                    if end_utc < now_utc:
                        pending_deque.appendleft(contact_info)
                        break
                    sleep_seconds = min(sleep_seconds, (end_utc - now_utc).total_seconds())
                except Exception:
                    pass
                sleep_seconds = max(0, min(sleep_seconds, 3600))
                # If wait is long, exit batch and schedule next at that time (don't hold semaphore sleeping)
                if sleep_seconds > MAX_SLEEP_BEFORE_DEFER_MINUTES * 60:
                    pending_deque.appendleft(contact_info)
                    next_send_at = now_utc + timedelta(seconds=sleep_seconds)
                    if end_utc is not None:
                        next_send_at = min(next_send_at, end_utc)
                    pacing_deferred = True
                    self._batch_log(
                        "Per-inbox pacing: deferring (wait %.1f min); next batch at %s",
                        sleep_seconds / 60,
                        next_send_at.isoformat(),
                    )
                    break
                if sleep_seconds > 0:
                    logging.info("Per-inbox pacing: waiting %.1f min before next send...", sleep_seconds / 60)
                    # Chunked sleep so we notice job cancellation within ~15 sec
                    chunk_sec = 15
                    remaining = sleep_seconds
                    while remaining > 0:
                        if update_job_heartbeat:
                            try:
                                await update_job_heartbeat()
                            except Exception:
                                pass
                        if check_job_cancelled:
                            try:
                                if await check_job_cancelled():
                                    pending_deque.appendleft(contact_info)
                                    job_cancelled = True
                                    self._batch_log("Job cancelled during pacing sleep; stopping batch")
                                    break
                            except Exception:
                                pass
                        await asyncio.sleep(min(chunk_sec, remaining))
                        remaining -= chunk_sec
                    if job_cancelled:
                        break
                now_utc = datetime.now(timezone.utc)

            contact = contact_info["contact"]
            sequence_step_for_contact = int(contact_info.get("next_step", 1))
            was_coffee = next_was_coffee_break[chosen_inbox]
            try:
                # Pick template for this contact's current sequence step.
                step_def = steps[sequence_step_for_contact - 1]
                step_template_ids = step_def.get("template_ids") or []
                if not step_template_ids:
                    self._batch_log(
                        "send_campaign_batch: no templates for step=%d, skipping contact_id=%s",
                        sequence_step_for_contact,
                        contact["id"],
                    )
                    continue

                if len(step_template_ids) == 1:
                    template_id = step_template_ids[0]
                else:
                    # Stable hash per (contact, step) so variants are evenly distributed
                    selector_key = f"{contact['id']}|{sequence_step_for_contact}"
                    template_id = step_template_ids[
                        abs(hash(selector_key)) % len(step_template_ids)
                    ]
                template = await self.db.templates.find_one({"id": template_id})
                if not template:
                    self._batch_log("send_campaign_batch: template_id=%s not found, skipping contact_id=%s", template_id, contact["id"])
                    errors.append({"contact_id": contact["id"], "error": f"Template {template_id} not found"})
                    continue
                self._dev_warn("send_campaign_batch: sending to contact_id=%s via inbox=%s template_id=%s", contact["id"], chosen_inbox, template_id)
                subject = template["subject"]
                body = template["body"]
                body_type = template.get("body_type", "html")
                # Run lead lookup/enrichment only for the initial email (step 1), not follow-ups.
                # For follow-ups, skip external lookup and continue with ai_prompt/plain template flow.
                use_enrich = (
                    bool(campaign.get("use_external_enrichment"))
                    and self.llm_service
                    and sequence_step_for_contact == 1
                )
                enriched_ok = False
                enriched_artifact = None
                if use_enrich:
                    try:
                        enriched = await generate_enriched_email_content(
                            llm_service=self.llm_service,
                            user_id=campaign["user_id"],
                            campaign=campaign,
                            contact=contact,
                            template=template,
                        )
                        if enriched and enriched.get("body"):
                            subject = enriched["subject"]
                            body = enriched["body"]
                            enriched_artifact = enriched.get("lead_artifact")
                            enriched_ok = True
                    except Exception as e:
                        logging.warning(
                            "send_campaign_batch: external enrichment failed contact_id=%s: %s",
                            contact.get("id"),
                            e,
                        )
                if not enriched_ok and campaign.get("ai_prompt"):
                    provider = campaign.get("ai_provider", "openai")
                    content = await self.generate_email_content(
                        campaign["user_id"], contact["id"], template_id, provider
                    )
                    subject = content["subject"]
                    body = content["body"]
                    body_type = template.get("body_type", "html")
                send_result = await self.send_email(
                    campaign["user_id"],
                    campaign_id,
                    contact["id"],
                    template_id,
                    subject,
                    body,
                    body_type,
                    chosen_inbox,
                    sender_type,
                    sender_name,
                    reply_to_email=reply_to_email,
                    reply_to_explicitly_none=reply_to_explicitly_none,
                    sequence_step=sequence_step_for_contact,
                )
                if enriched_ok and isinstance(enriched_artifact, dict):
                    try:
                        now = datetime.now(timezone.utc)
                        await self.db.campaign_enrichment_leads.insert_one(
                            {
                                "id": str(uuid.uuid4()),
                                "user_id": campaign["user_id"],
                                "campaign_id": campaign_id,
                                "contact_id": contact["id"],
                                "template_id": template_id,
                                "email_log_id": send_result.get("email_log_id") if isinstance(send_result, dict) else None,
                                "provider": enriched_artifact.get("provider"),
                                "queries": enriched_artifact.get("queries") or [],
                                "phone_query": enriched_artifact.get("phone_query"),
                                "query_context": enriched_artifact.get("query_context") or {},
                                "serper_rows": enriched_artifact.get("serper_rows") or [],
                                "phone_search_rows": enriched_artifact.get("phone_search_rows") or [],
                                "selected_read_more_urls": enriched_artifact.get("selected_read_more_urls") or [],
                                "page_extractions": enriched_artifact.get("page_extractions") or [],
                                "compacted_facts": enriched_artifact.get("compacted_facts"),
                                "lead_object": enriched_artifact.get("lead_object") or {},
                                "status": "generated",
                                "error": None,
                                "created_at": now,
                                "updated_at": now,
                            }
                        )
                    except Exception:
                        logging.warning(
                            "send_campaign_batch: failed to persist enrichment lead campaign_id=%s contact_id=%s",
                            campaign_id,
                            contact.get("id"),
                            exc_info=True,
                        )
                sent_count += 1
                last_sent_at[chosen_inbox] = datetime.now(timezone.utc)
                if was_coffee:
                    sends_since_coffee_break[chosen_inbox] = 0
                else:
                    sends_since_coffee_break[chosen_inbox] = sends_since_coffee_break.get(chosen_inbox, 0) + 1
                inbox_sent_today[chosen_inbox] = inbox_sent_today.get(chosen_inbox, 0) + 1
                self._dev_warn("send_campaign_batch: sent email to contact_id=%s (sent_count=%d)", contact["id"], sent_count)
            except DomainRateLimitError as e:
                # Per-domain limit hit: skip this contact for today, do not mark as failed.
                self._batch_log(
                    "send_campaign_batch: domain rate limit (%d/day) reached for @%s via inbox=%s, skipping contact_id=%s",
                    e.limit, e.domain, chosen_inbox, contact["id"],
                )
                continue
            except EmailInfraWarmupDelayError as e:
                # Email Infra pacing: defer campaign sending until infra asks us to try again.
                # Important: this should not create a "failed" email log entry.
                try:
                    next_send_at_dt = None
                    next_send_at_str = getattr(e, "next_send_at", None)
                    if next_send_at_str:
                        next_send_at_dt = datetime.fromisoformat(next_send_at_str)
                        if getattr(next_send_at_dt, "tzinfo", None) is None:
                            next_send_at_dt = next_send_at_dt.replace(tzinfo=timezone.utc)
                except Exception:
                    next_send_at_dt = None

                errors.append({"contact_id": contact["id"], "error": str(e)})
                # Put this contact back so it can be retried on the next batch window.
                pending_deque.appendleft(contact_info)

                pacing_deferred = True
                next_send_at = next_send_at_dt or (datetime.now(timezone.utc) + timedelta(minutes=5))
                self._batch_log(
                    "Deferring due to Email Infra warmup/pacing until %s (contact_id=%s, inbox=%s)",
                    next_send_at.isoformat(),
                    contact["id"],
                    chosen_inbox,
                )
                break
            except Exception as e:
                self._batch_log("send FAILED contact_id=%s error=%s", contact["id"], e)
                # Gmail SMTP 534 WebLoginRequired: remove sender, in-app alert, continue (or pause if no senders left)
                if sender_type == "gmail" and is_gmail_smtp_web_login_required_error(e):
                    now_utc = datetime.now(timezone.utc)
                    uid = campaign["user_id"]
                    ib = await self.db.inboxes.find_one({"id": chosen_inbox}, {"email": 1})
                    inbox_email = (ib or {}).get("email")
                    if isinstance(inbox_email, str):
                        pass
                    else:
                        inbox_email = None
                    remaining_sender_ids = [sid for sid in sender_ids if sid != chosen_inbox]
                    await self.db.campaigns.update_one(
                        {"id": campaign_id},
                        {"$set": {"sender_ids": remaining_sender_ids, "updated_at": now_utc}},
                    )
                    sender_ids = remaining_sender_ids
                    inbox_note = (
                        f"Gmail SMTP blocked (Google sign-in required) on {now_utc.isoformat()}. "
                        "Removed from campaign senders. Fix in Settings → Integrations."
                    )
                    await self.db.inboxes.update_one(
                        {"id": chosen_inbox},
                        {"$set": {"error_note": inbox_note, "error_note_at": now_utc, "updated_at": now_utc}},
                    )
                    await self._notify_gmail_smtp_web_login_skipped_sender(
                        user_id=uid,
                        inbox_id=chosen_inbox,
                        inbox_email=inbox_email,
                        campaign_name=campaign.get("name"),
                    )
                    errors.append(
                        {
                            "contact_id": contact["id"],
                            "error": "Gmail SMTP sign-in required; sender removed, contact re-queued",
                        }
                    )
                    if not remaining_sender_ids:
                        await self.db.campaigns.update_one(
                            {"id": campaign_id},
                            {
                                "$set": {
                                    "status": "paused",
                                    "last_error_note": (
                                        "No senders left after removing an account that needs Google browser sign-in. "
                                        "Add a sender to the campaign or fix the Gmail connection in Settings."
                                    ),
                                    "last_error_at": now_utc,
                                    "updated_at": now_utc,
                                }
                            },
                        )
                        self._batch_log(
                            "send_campaign_batch STOPPED: no senders left after Gmail WebLoginRequired skip"
                        )
                        return {
                            "message": "No senders left after skipping a Gmail account that needs sign-in.",
                            "sent": sent_count,
                            "errors": errors,
                            "gmail_send_failed_stop_campaign": True,
                            "daily_limit_reached": daily_limit_reached,
                            "gmail_sender_skipped_web_login": True,
                        }
                    pending_deque.appendleft(contact_info)
                    self._batch_log(
                        "Skipped Gmail inbox %s (WebLoginRequired); %d sender(s) remain, contact re-queued",
                        chosen_inbox,
                        len(remaining_sender_ids),
                    )
                    continue

                errors.append({"contact_id": contact["id"], "error": str(e)})
                # Gmail send failure: stop batch, add error note, pause campaign; if multiple senders, remove failing inbox and add note
                if sender_type == "gmail":
                    now_utc = datetime.now(timezone.utc)
                    error_note = f"Gmail send failed: {str(e)}. Campaign stopped."
                    await self.db.campaigns.update_one(
                        {"id": campaign_id},
                        {
                            "$set": {
                                "status": "paused",
                                "last_error_note": error_note,
                                "last_error_at": now_utc,
                                "updated_at": now_utc,
                            }
                        },
                    )
                    inbox_note = f"Gmail send failed on {now_utc.isoformat()}: {str(e)[:200]}. Reconnect or check quota."
                    if len(sender_ids) > 1:
                        # Remove failing Gmail inbox from this campaign and add note to inbox
                        remaining_sender_ids = [sid for sid in sender_ids if sid != chosen_inbox]
                        await self.db.campaigns.update_one(
                            {"id": campaign_id},
                            {"$set": {"sender_ids": remaining_sender_ids, "updated_at": now_utc}},
                        )
                        sender_ids = remaining_sender_ids
                        inbox_note = f"Gmail send failed on {now_utc.isoformat()}: {str(e)[:200]}. Removed from campaign. Reconnect or check quota."
                        self._batch_log("Removed failing inbox %s from campaign; added note to inbox", chosen_inbox)
                    await self.db.inboxes.update_one(
                        {"id": chosen_inbox},
                        {"$set": {"error_note": inbox_note, "error_note_at": now_utc, "updated_at": now_utc}},
                    )
                    self._batch_log("send_campaign_batch STOPPED due to Gmail failure; campaign paused")
                    return {
                        "message": error_note,
                        "sent": sent_count,
                        "errors": errors,
                        "gmail_send_failed_stop_campaign": True,
                        "daily_limit_reached": daily_limit_reached,
                    }
                # SendGrid 403 Forbidden: stop batch, pause campaign, cancel jobs (same as Gmail failure)
                elif sender_type == "smtp" and (isinstance(e, SendGridForbiddenError) or ("403" in str(e) and "sendgrid" in str(e).lower())):
                    now_utc = datetime.now(timezone.utc)
                    error_note = f"SendGrid 403 Forbidden: {str(e)[:200]}. Campaign paused. Check API key and domain authentication."
                    await self.db.campaigns.update_one(
                        {"id": campaign_id},
                        {
                            "$set": {
                                "status": "paused",
                                "last_error_note": error_note,
                                "last_error_at": now_utc,
                                "updated_at": now_utc,
                            }
                        },
                    )
                    inbox_note = f"SendGrid 403 Forbidden on {now_utc.isoformat()}: {str(e)[:200]}. Check API key and domain."
                    await self.db.inboxes.update_one(
                        {"id": chosen_inbox},
                        {"$set": {"error_note": inbox_note, "error_note_at": now_utc, "updated_at": now_utc}},
                    )
                    self._batch_log("send_campaign_batch STOPPED due to SendGrid 403; campaign paused")
                    return {
                        "message": error_note,
                        "sent": sent_count,
                        "errors": errors,
                        "gmail_send_failed_stop_campaign": True,
                        "daily_limit_reached": daily_limit_reached,
                    }
                # Non-Gmail/SendGrid failure: continue to next contact (existing behavior)
                # (errors are already appended above)

        self._batch_log("send_campaign_batch DONE sent=%d errors=%d", sent_count, len(errors))
        if errors:
            self._batch_log("first error: %s", errors[0].get("error", str(errors[0])))
        if sent_count == 0 and not errors and daily_limit_reached:
            self._batch_log("send_campaign_batch: 0 sent because all senders at daily limit before first send")
        elif sent_count == 0 and not errors:
            self._batch_log("send_campaign_batch: 0 sent (no contacts in loop or all at limit)")
        # Use a descriptive message when 0 sent so Batch jobs Error/notes column shows the real reason
        if sent_count == 0:
            if daily_limit_reached:
                out_message = "0 sent: all senders at daily limit"
            elif errors:
                out_message = "0 sent: %d error(s); first: %s" % (len(errors), (errors[0].get("error") or str(errors[0]))[:80])
            else:
                out_message = "0 sent: no contacts in loop or all at limit (check contacts, templates, send window)"
        else:
            out_message = "Batch sent"
        out = {
            "message": out_message,
            "sent": sent_count,
            "errors": errors,
            "delay_info": "Human-like per-inbox pacing (pattern: %s)" % getattr(pattern, "pattern_type", "steady"),
            "daily_limit_reached": daily_limit_reached,
            "all_done": False,
        }
        if pacing_deferred and next_send_at is not None:
            out["pacing_deferred"] = True
            out["next_send_at"] = next_send_at
        if job_cancelled:
            out["job_cancelled"] = True
        return out
    
    def _normalize_msg_id_for_match(self, msg_id: str) -> str:
        """Normalize message id for In-Reply-To/References matching (strip angle brackets)."""
        if not msg_id:
            return ""
        s = (msg_id or "").strip()
        if s.startswith("<") and s.endswith(">"):
            s = s[1:-1]
        return s

    async def check_replies_from_inbox_for_smtp_logs(self, user_id: str) -> int:
        """Check Gmail/IMAP inbox(es) for replies to SMTP-sent emails (campaign-aware: reply_to_type/reply_to_id).
        Also includes logs already marked 'replied' but with empty reply_body so we can backfill the body from IMAP."""
        logs = await self.db.email_logs.find({
            "user_id": user_id,
            "gmail_thread_id": {"$exists": False},
            "smtp_message_id": {"$exists": True},
            "$or": [
                {"status": {"$in": ["sent", "opened", "clicked"]}},
                {"status": "replied", "$or": [{"reply_body": {"$exists": False}}, {"reply_body": ""}, {"reply_body": None}]},
            ],
        }).to_list(None)
        if not logs:
            return 0
        campaign_ids = list({log["campaign_id"] for log in logs})
        campaigns = await self.db.campaigns.find({"id": {"$in": campaign_ids}}, {"id": 1, "reply_to_type": 1, "reply_to_id": 1}).to_list(None)
        campaign_by_id = {c["id"]: c for c in campaigns}
        # Group logs by (reply_to_type, reply_to_id). Legacy = no reply_to_type → use ("gmail", user_id) with credential_id from first user Gmail
        groups = {}
        for log in logs:
            camp = campaign_by_id.get(log["campaign_id"]) or {}
            rtype = camp.get("reply_to_type")
            rid = camp.get("reply_to_id")
            if rtype == "none":
                key = ("none", rid or "")
            elif rtype == "imap" and rid:
                key = ("imap", rid)
            elif rtype == "gmail" and rid:
                key = ("gmail", rid)
            else:
                key = ("gmail", user_id)
            if key not in groups:
                groups[key] = []
            groups[key].append(log)
        replies_found = 0
        for (rtype, rid), group_logs in groups.items():
            if rtype == "none":
                continue
            if rtype == "imap":
                if self.imap_reply_service and rid:
                    replies_found += await self.imap_reply_service.check_replies_for_config(rid, group_logs)
                continue
            # Gmail: use IMAP for app-password inboxes, else Gmail API
            if rtype == "gmail" and rid and self.imap_reply_service:
                inbox = await self.db.inboxes.find_one(
                    {"id": rid, "user_id": user_id, "sender_type": "gmail"},
                    {"gmail_auth_method": 1},
                )
                if inbox and inbox.get("gmail_auth_method") == "app_password":
                    replies_found += await self.imap_reply_service.check_replies_for_gmail_app_password_inbox(
                        rid, group_logs
                    )
                    continue
            # Gmail OAuth: resolve credential_id (rid may be inbox id or credential id)
            credential_id = None
            if rid and rid != user_id:
                inbox = await self.db.inboxes.find_one({"id": rid, "user_id": user_id, "sender_type": "gmail"}, {"gmail_credentials_id": 1})
                credential_id = inbox.get("gmail_credentials_id") if inbox else rid
            inbox_msg_ids = await self.gmail_service.list_recent_inbox_message_ids(user_id, max_results=100, credential_id=credential_id)
            if not inbox_msg_ids:
                continue
            now = datetime.now(timezone.utc)
            updated_log_ids = set()
            for msg_id in inbox_msg_ids:
                info = await self.gmail_service.get_inbox_message_headers_and_body(user_id, msg_id, credential_id=credential_id)
                reply_to_ids = info.get("reply_to_ids") or set()
                body = info.get("body") or ""
                if not reply_to_ids:
                    continue
                for log in group_logs:
                    if log["id"] in updated_log_ids:
                        continue
                    smtp_id = log.get("smtp_message_id") or ""
                    normalized = self._normalize_msg_id_for_match(smtp_id)
                    if not normalized or normalized not in reply_to_ids:
                        continue
                    await self.db.email_logs.update_one(
                        {"id": log["id"], "user_id": user_id},
                        {"$set": {"status": "replied", "replied_at": now, "reply_body": body}},
                    )
                    contact_id = log.get("contact_id")
                    campaign_id = log.get("campaign_id")
                    if contact_id:
                        await self.db.contacts.update_one({"id": contact_id}, {"$set": {"status": "replied"}})
                    if campaign_id and contact_id:
                        await self.db.campaign_contacts.update_one(
                            {"campaign_id": campaign_id, "contact_id": contact_id},
                            {
                                "$set": {"status": "replied", "last_activity": now, "updated_at": now},
                                "$push": {"events": {"type": "replied", "timestamp": now, "metadata": {"source": "inbox_smtp", "reply_body": body[:500]}}},
                            },
                        )
                    updated_log_ids.add(log["id"])
                    replies_found += 1
                    break
        return replies_found

    async def check_replies(self, user_id: str) -> dict:
        """Check for replies to sent emails (Gmail threads + SMTP via inbox matching)."""
        replies_found = 0
        # 1) Gmail-sent emails: check by thread
        logs = await self.db.email_logs.find({
            "user_id": user_id,
            "status": {"$in": ["sent", "opened", "clicked"]},
            "gmail_thread_id": {"$exists": True}
        }).to_list(None)
        
        if logs:
            # Group by sender_id so we check each Gmail account's threads with correct credentials
            by_sender = {}
            for log in logs:
                sid = log.get("sender_id") or user_id
                if sid not in by_sender:
                    by_sender[sid] = []
                by_sender[sid].append(log)
            now = datetime.now(timezone.utc)
            all_replies = []
            for sender_id, group in by_sender.items():
                thread_ids = [log["gmail_thread_id"] for log in group]
                try:
                    replies = await self.gmail_service.check_replies(sender_id, user_id, thread_ids)
                    all_replies.extend(replies)
                except Exception:
                    # Skip senders whose inbox was removed or has no credentials (e.g. deleted inbox)
                    continue
            for reply in all_replies:
                # Update all logs in this thread to 'replied' status and store the latest reply body
                result = await self.db.email_logs.update_many(
                    {
                        "gmail_thread_id": reply["thread_id"]
                    },
                    {
                        "$set": {
                            "status": "replied",
                            "replied_at": now,
                            "reply_body": reply.get("reply_body"),
                        }
                    }
                )
                replies_found += result.modified_count
                
                # Update contact status and CampaignContact status
                log = next((l for l in logs if l["gmail_thread_id"] == reply["thread_id"]), None)
                if log:
                    contact_id = log["contact_id"]
                    campaign_id = log["campaign_id"]
                    
                    await self.db.contacts.update_one(
                        {"id": contact_id},
                        {"$set": {"status": "replied"}}
                    )

                    await self.db.campaign_contacts.update_one(
                        {"campaign_id": campaign_id, "contact_id": contact_id},
                        {
                            "$set": {
                                "status": "replied",
                                "last_activity": now,
                                "updated_at": now
                            },
                            "$push": {
                                "events": {
                                    "type": "replied",
                                    "timestamp": now,
                                    "metadata": {
                                        "thread_id": reply["thread_id"],
                                        "reply_body": reply.get("reply_body")
                                    }
                                }
                            }
                        }
                    )
        
        # 2) SMTP-sent emails: match inbox messages by In-Reply-To/References to smtp_message_id
        smtp_replies = await self.check_replies_from_inbox_for_smtp_logs(user_id)
        replies_found += smtp_replies

        if replies_found > 0:
            try:
                from services.notification_service import notification_service
                if notification_service:
                    from services.email_templates import reply_notification
                    subject, body_plain, body_html = reply_notification()
                    await notification_service.send_notification_if_enabled(
                        user_id,
                        "reply_notifications",
                        subject,
                        body_plain,
                        body_html,
                    )
            except Exception as e:
                logging.warning("Reply notification send failed: %s", e)
        
        logging.info("check_replies finished for user_id=%s: replies_found=%s (smtp=%s)", user_id, replies_found, smtp_replies)
        return {
            "message": "Reply check completed",
            "replies_found": replies_found
        }