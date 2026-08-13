"""Warm-up sender: platform-level job that sends warm-up emails from all warming inboxes to the pool of receiver accounts."""
import asyncio
import hashlib
import logging
import os
import random
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set
from zoneinfo import ZoneInfo

from services.credit_service import CreditService
from services.email_service import EmailService
from services.plan_service import MonthlySmtpQuotaExceeded
from services.plan_service import user_subscription_blocks_outbound
from services.warmup_shared_pool_service import (
    SHARED_POOL_CREDITS_PER_SEND,
    WarmupSharedPoolService,
)

logger = logging.getLogger(__name__)

# Robust warmup: human-like spacing and bounded runs
MIN_DELAY_BETWEEN_SENDS_SEC = 25
MAX_DELAY_BETWEEN_SENDS_SEC = 65
MIN_DELAY_BETWEEN_INBOXES_SEC = 2
MAX_DELAY_BETWEEN_INBOXES_SEC = 8
MAX_INBOXES_PER_RUN = 80  # Process up to N inboxes per 10-min cycle to spread load and avoid burst
SHARED_POOL_CREDIT_HOLD_HOURS = 48  # Hold credits for 48h; refund if no reply, reward owner if qualified
# Per contact list owner: max warmup emails any single network address may receive in a rolling 24h window
# (across all of that owner's inboxes, plus shared-pool sends that use their contacts).
DEFAULT_WARMUP_NETWORK_CONTACT_DAILY_LIMIT = 20
MIN_WARMUP_NETWORK_CONTACT_DAILY_LIMIT = 1
MAX_WARMUP_NETWORK_CONTACT_DAILY_LIMIT = 100
DEFAULT_TZ = "America/New_York"
WARMUP_CLOSE_NETWORK_MODE = (os.getenv("WARMUP_CLOSE_NETWORK_MODE") or "shadow").strip().lower()
WARMUP_CLOSE_NETWORK_PAIR_COOLDOWN_DAYS = max(1, int(os.getenv("WARMUP_CLOSE_NETWORK_PAIR_COOLDOWN_DAYS") or "5"))
WARMUP_CLOSE_NETWORK_RECIPROCITY_WINDOW_DAYS = max(
    1, int(os.getenv("WARMUP_CLOSE_NETWORK_RECIPROCITY_WINDOW_DAYS") or "7")
)
WARMUP_CLOSE_NETWORK_RECIPROCITY_CAP = max(1, int(os.getenv("WARMUP_CLOSE_NETWORK_RECIPROCITY_CAP") or "3"))
WARMUP_CLOSE_NETWORK_PROVIDER_DAILY_CAP = max(1, int(os.getenv("WARMUP_CLOSE_NETWORK_PROVIDER_DAILY_CAP") or "8"))
WARMUP_CLOSE_NETWORK_DOMAIN_DAILY_CAP = max(1, int(os.getenv("WARMUP_CLOSE_NETWORK_DOMAIN_DAILY_CAP") or "4"))
WARMUP_CLOSE_NETWORK_RISK_THRESHOLD = max(
    0.0, min(1.0, float(os.getenv("WARMUP_CLOSE_NETWORK_RISK_THRESHOLD") or "0.65"))
)
WARMUP_CLOSE_NETWORK_ALERT_REJECTION_RATE = max(
    0.0, min(1.0, float(os.getenv("WARMUP_CLOSE_NETWORK_ALERT_REJECTION_RATE") or "0.25"))
)
WARMUP_CLOSE_NETWORK_MIN_CANDIDATES_PER_CYCLE = max(
    1, int(os.getenv("WARMUP_CLOSE_NETWORK_MIN_CANDIDATES_PER_CYCLE") or "2")
)
SYNTHETIC_PERSONAS = [
    {"name": "early_bird", "start": (6, 8), "end": (16, 19), "drop": (0.18, 0.30), "gap": (90, 420)},
    {"name": "office_worker", "start": (8, 10), "end": (18, 21), "drop": (0.15, 0.28), "gap": (120, 720)},
    {"name": "night_owl", "start": (10, 12), "end": (21, 23), "drop": (0.22, 0.40), "gap": (150, 900)},
]

# Neutral warm-up subject and body snippets (no AI; random pick per send)
WARMUP_SUBJECTS = [
    "Quick check-in",
    "Following up",
    "Hope you're doing well",
    "Quick question",
    "Catching up",
    "Re: our conversation",
    "Checking in",
    "Hello",
]

def _warmup_send_body_type(template: Optional[Dict[str, Any]]) -> str:
    """Match campaign templates: html, rich (WYSIWYG HTML), or plain. Auto-detect HTML for legacy docs."""
    if not template:
        return "plain"
    body = str(template.get("body") or "")
    bt = template.get("body_type")
    if bt == "html" or bt == "rich":
        return "html"
    if bt == "plain":
        # Some saved templates are mislabeled as plain while containing HTML.
        return "html" if re.search(r"<[a-zA-Z][^>]*>", body) else "plain"
    # Legacy warmup templates may not have body_type stored.
    return "html" if re.search(r"<[a-zA-Z][^>]*>", body) else "plain"


WARMUP_BODIES = [
    "Hope you're having a good week. Just wanted to say hi.",
    "No rush—just following up when you have a moment.",
    "Let me know if you have any questions.",
    "Thanks for your time. Talk soon.",
    "Reaching out to stay in touch. Hope all is well.",
    "Quick note to say hello. Have a great day.",
    "Let me know when works for you.",
    "Thanks and talk soon.",
]

# Common public suffixes that require 3 labels for registrable/root domain.
# This avoids collapsing unrelated tenants on suffixes like co.uk/com.au.
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


def _root_domain_from_email(email: str) -> str:
    """
    Normalize an email's host to its root domain so subdomains collapse together.
    Example: grace@cloud.pigeon.com -> pigeon.com
    """
    value = (email or "").strip().lower()
    if "@" not in value:
        return ""
    host = value.split("@", 1)[1]
    return _root_domain_from_host(host)


def _provider_from_domain_or_email(value: str) -> str:
    host = (value or "").strip().lower()
    if "@" in host:
        host = host.split("@", 1)[1]
    if not host:
        return "other"
    root = _root_domain_from_host(host)
    if root in {"gmail.com", "googlemail.com"}:
        return "gmail"
    if root in {"outlook.com", "hotmail.com", "live.com", "msn.com"}:
        return "outlook"
    if root in {"yahoo.com", "ymail.com", "rocketmail.com"}:
        return "yahoo"
    return "other"


def _stable_pair_key(sender_email: str, receiver_email: str) -> str:
    base = f"{(sender_email or '').strip().lower()}|{(receiver_email or '').strip().lower()}"
    return hashlib.sha1(base.encode("utf-8")).hexdigest()


class WarmupSenderService:
    """Sends warm-up emails from all platform inboxes with status=warming to the platform receiver pool."""

    def __init__(
        self,
        db: Any,
        admin_db: Any,
        smtp_service: Any,
        gmail_service: Any,
        warmup_llm_service: Any = None,
        email_service: Any = None,
    ):
        self.db = db
        self.admin_db = admin_db
        self.smtp_service = smtp_service
        self.gmail_service = gmail_service
        self.warmup_llm_service = warmup_llm_service
        self.email_service = email_service
        self.credit_service = CreditService(db)
        self.shared_pool_service = WarmupSharedPoolService(db)
        self.multiturn_enabled = (os.getenv("WARMUP_MULTITURN_ENABLED") or "1").lower() in ("1", "true", "yes")

    async def _warmup_assert_smtp_quota(self, user_id: str, inbox: dict) -> None:
        if not self.email_service:
            return
        await self.email_service.assert_smtp_monthly_quota_if_needed(user_id, inbox)

    async def _warmup_meter_send(
        self,
        user_id: str,
        inbox: dict,
        to_email: str,
        subject: str,
        message_id: str,
    ) -> None:
        if not self.email_service or not inbox.get("id"):
            return
        try:
            await self.email_service.record_outbound_send_for_usage(
                user_id=user_id,
                sender_id=inbox["id"],
                send_source="warmup",
                to_email=to_email,
                subject=subject,
                inbox=inbox,
                message_id=message_id,
            )
        except Exception as e:
            logger.warning("Warmup metering failed user=%s: %s", user_id, e)

    async def _get_network_contact_daily_limit(self, owner_user_id: str) -> int:
        """User-configurable cap (My Network); default DEFAULT_WARMUP_NETWORK_CONTACT_DAILY_LIMIT."""
        try:
            user = await self.db.users.find_one(
                {"id": owner_user_id},
                {"_id": 0, "warmup_network_contact_daily_limit": 1},
            )
        except Exception:
            user = None
        raw = (user or {}).get("warmup_network_contact_daily_limit")
        if raw is None:
            return DEFAULT_WARMUP_NETWORK_CONTACT_DAILY_LIMIT
        try:
            v = int(raw)
        except (TypeError, ValueError):
            return DEFAULT_WARMUP_NETWORK_CONTACT_DAILY_LIMIT
        return max(
            MIN_WARMUP_NETWORK_CONTACT_DAILY_LIMIT,
            min(v, MAX_WARMUP_NETWORK_CONTACT_DAILY_LIMIT),
        )

    async def _warmup_inbound_counts_by_receiver_for_owner(
        self, owner_user_id: str, since: datetime
    ) -> Dict[str, int]:
        """
        Count warmup emails received per receiver address in the rolling window for this contact-list owner:
        own network + quick sends (user_id) and shared-pool rentals (shared_pool_owner_user_id).
        """
        pipeline = [
            {
                "$match": {
                    "sent_at": {"$gte": since},
                    "$or": [
                        {"user_id": owner_user_id, "engagement_mode": {"$in": ["network", "quick"]}},
                        {
                            "shared_pool_owner_user_id": owner_user_id,
                            "engagement_mode": "shared_pool",
                        },
                    ],
                }
            },
            {"$group": {"_id": {"$toLower": "$receiver_email"}, "c": {"$sum": 1}}},
        ]
        out: Dict[str, int] = {}
        try:
            async for row in self.db.warmup_sent.aggregate(pipeline):
                email = (row.get("_id") or "").strip().lower()
                if email:
                    out[email] = int(row.get("c") or 0)
        except Exception as e:
            logger.warning(
                "Warmup: aggregate inbound counts failed for owner %s: %s", owner_user_id, e
            )
        return out

    async def _record_close_network_event(
        self,
        inbox_id: str,
        user_id: str,
        receiver_email: str,
        mode: str,
        action: str,
        score: float,
        reasons: List[str],
        risk: Dict[str, float],
    ) -> None:
        now = datetime.now(timezone.utc)
        try:
            await self.db.warmup_close_network_events.insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "inbox_id": inbox_id,
                    "user_id": user_id,
                    "receiver_email": receiver_email,
                    "mode": mode,
                    "action": action,
                    "risk_score": round(float(score), 4),
                    "reasons": reasons,
                    "risk": risk,
                    "created_at": now,
                    "updated_at": now,
                }
            )
        except Exception:
            # Telemetry only; never fail warmup flow on event write.
            pass

    async def _build_close_network_state(
        self,
        inbox: Dict[str, Any],
        inbox_id: str,
        user_id: str,
        now_utc: datetime,
    ) -> Dict[str, Any]:
        sender_email = (inbox.get("email") or "").strip().lower()
        daily_cutoff = now_utc - timedelta(hours=24)
        reciprocity_cutoff = now_utc - timedelta(days=WARMUP_CLOSE_NETWORK_RECIPROCITY_WINDOW_DAYS)
        cooldown_cutoff = now_utc - timedelta(days=WARMUP_CLOSE_NETWORK_PAIR_COOLDOWN_DAYS)
        history_cutoff = min(daily_cutoff, reciprocity_cutoff, cooldown_cutoff)
        docs = await self.db.warmup_sent.find(
            {"inbox_id": inbox_id, "sent_at": {"$gte": history_cutoff}},
            {
                "_id": 0,
                "receiver_email": 1,
                "receiver_domain_root": 1,
                "receiver_provider": 1,
                "sender_email": 1,
                "sent_at": 1,
            },
        ).to_list(None)
        provider_counts_24h: Dict[str, int] = {}
        domain_counts_24h: Dict[str, int] = {}
        pair_last_sent_at: Dict[str, datetime] = {}
        reciprocity_counts: Dict[str, int] = {}
        sent_24h_total = 0
        for d in docs:
            recv = (d.get("receiver_email") or "").strip().lower()
            if not recv:
                continue
            sent_at = d.get("sent_at")
            if sent_at and getattr(sent_at, "tzinfo", None) is None:
                sent_at = sent_at.replace(tzinfo=timezone.utc)
            if not sent_at:
                continue
            key = _stable_pair_key(sender_email, recv)
            prev = pair_last_sent_at.get(key)
            if prev is None or sent_at > prev:
                pair_last_sent_at[key] = sent_at
            if sent_at >= reciprocity_cutoff:
                reciprocity_counts[key] = reciprocity_counts.get(key, 0) + 1
            if sent_at >= daily_cutoff:
                sent_24h_total += 1
                prov = (d.get("receiver_provider") or "").strip().lower() or _provider_from_domain_or_email(recv)
                dom = (d.get("receiver_domain_root") or "").strip().lower() or _root_domain_from_email(recv)
                provider_counts_24h[prov] = provider_counts_24h.get(prov, 0) + 1
                domain_counts_24h[dom] = domain_counts_24h.get(dom, 0) + 1
        return {
            "sender_email": sender_email,
            "provider_counts_24h": provider_counts_24h,
            "domain_counts_24h": domain_counts_24h,
            "pair_last_sent_at": pair_last_sent_at,
            "reciprocity_counts": reciprocity_counts,
            "sent_24h_total": sent_24h_total,
            "daily_cutoff": daily_cutoff,
            "now_utc": now_utc,
        }

    def _score_close_network_candidate(
        self,
        state: Dict[str, Any],
        receiver_email: str,
        receiver_provider: str,
        receiver_domain_root: str,
    ) -> Dict[str, Any]:
        sender_email = state.get("sender_email", "")
        now_utc = state.get("now_utc") or datetime.now(timezone.utc)
        pair_key = _stable_pair_key(sender_email, receiver_email)
        pair_last_sent_at = state.get("pair_last_sent_at", {}).get(pair_key)
        reciprocity_count = int(state.get("reciprocity_counts", {}).get(pair_key, 0))
        provider_count = int(state.get("provider_counts_24h", {}).get(receiver_provider, 0))
        domain_count = int(state.get("domain_counts_24h", {}).get(receiver_domain_root, 0))

        pair_repeat_risk = 0.0
        reasons: List[str] = []
        if pair_last_sent_at:
            age = now_utc - pair_last_sent_at
            cooldown = timedelta(days=WARMUP_CLOSE_NETWORK_PAIR_COOLDOWN_DAYS)
            if age < cooldown:
                pair_repeat_risk = 1.0
                reasons.append("pair_cooldown")

        reciprocity_risk = 1.0 if reciprocity_count >= WARMUP_CLOSE_NETWORK_RECIPROCITY_CAP else 0.0
        if reciprocity_risk > 0:
            reasons.append("reciprocity_cap")

        provider_risk = min(1.0, provider_count / max(1, WARMUP_CLOSE_NETWORK_PROVIDER_DAILY_CAP))
        if provider_count >= WARMUP_CLOSE_NETWORK_PROVIDER_DAILY_CAP:
            reasons.append("provider_concentration")

        domain_risk = min(1.0, domain_count / max(1, WARMUP_CLOSE_NETWORK_DOMAIN_DAILY_CAP))
        if domain_count >= WARMUP_CLOSE_NETWORK_DOMAIN_DAILY_CAP:
            reasons.append("domain_concentration")

        risk = {
            "pair_repeat_risk": pair_repeat_risk,
            "reciprocity_risk": reciprocity_risk,
            "provider_concentration_risk": round(provider_risk, 4),
            "domain_concentration_risk": round(domain_risk, 4),
            "network_bucket_risk": 0.0,
        }
        score = (
            (0.45 * pair_repeat_risk)
            + (0.20 * reciprocity_risk)
            + (0.20 * provider_risk)
            + (0.15 * domain_risk)
        )
        score = max(0.0, min(1.0, score))
        if WARMUP_CLOSE_NETWORK_MODE == "off":
            return {"allowed": True, "score": score, "reasons": reasons, "risk": risk}
        if WARMUP_CLOSE_NETWORK_MODE == "shadow":
            return {"allowed": True, "score": score, "reasons": reasons, "risk": risk, "shadow_block": score >= WARMUP_CLOSE_NETWORK_RISK_THRESHOLD}
        if WARMUP_CLOSE_NETWORK_MODE == "high_confidence":
            return {"allowed": pair_repeat_risk < 1.0, "score": score, "reasons": reasons, "risk": risk}
        return {"allowed": score < WARMUP_CLOSE_NETWORK_RISK_THRESHOLD, "score": score, "reasons": reasons, "risk": risk}

    @staticmethod
    def _warmup_placeholder_contact(inbox: Dict[str, Any], receiver: Dict[str, Any]) -> Dict[str, Any]:
        """Warmup merge context: only sender_* and receiver_* (no first_name / inbox_* / contact-style keys)."""
        recv_email = (receiver.get("email") or "").strip()
        fn = (receiver.get("first_name") or receiver.get("firstName") or "").strip()
        ln = (receiver.get("last_name") or receiver.get("lastName") or "").strip()
        if not fn:
            derived_full = EmailService.get_inbox_name_from_email(recv_email)
            parts = derived_full.split(None, 1)
            fn = parts[0] if parts else ""
            if not ln and len(parts) > 1:
                ln = parts[1]
        inbox_email = str(inbox.get("email") or "").strip()
        inbox_name = (inbox.get("sender_name") or inbox.get("from_name") or "").strip()
        if not inbox_name:
            inbox_name = EmailService.get_inbox_name_from_email(inbox_email)
        recv_display = (fn + " " + ln).strip() or fn
        return {
            "first_name": "",
            "last_name": "",
            "email": "",
            "company": "",
            "industry": "",
            "inbox_email": "",
            "inbox_name": "",
            "receiver_email": recv_email,
            "receiver_name": recv_display,
            "sender_email": inbox_email,
            "sender_name": inbox_name,
        }

    @staticmethod
    def _template_pair_key(subject: str, body: str) -> str:
        """Canonical key for de-duplicating warmup template pairs."""
        subj = " ".join((subject or "").strip().lower().split())
        msg = " ".join((body or "").strip().lower().split())
        return f"{subj}||{msg}"

    async def _load_used_template_keys_for_receiver(self, receiver_account_id: str) -> set:
        """
        Return template-pair keys that were already sent to a receiver account.
        Uses recent history window for performance while still preventing repeats in practice.
        """
        if not receiver_account_id:
            return set()
        try:
            rows = await self.db.warmup_messages.find(
                {"receiver_account_id": receiver_account_id, "role": "inbox"},
                {"subject": 1, "body": 1},
            ).sort("sent_at", -1).limit(5000).to_list(None)
            keys = {
                self._template_pair_key(r.get("subject", ""), r.get("body", ""))
                for r in rows
                if (r.get("subject") or r.get("body"))
            }
            return keys
        except Exception as e:
            logger.warning(
                "Warmup sender: failed loading used template keys for receiver %s: %s",
                receiver_account_id,
                e,
            )
            return set()

    def _in_human_window(self, now_utc: datetime, tz_name: str, start_hour: int = 8, end_hour: int = 21) -> bool:
        try:
            local_now = now_utc.astimezone(ZoneInfo(tz_name or DEFAULT_TZ))
        except Exception:
            local_now = now_utc
        hour = local_now.hour
        if local_now.weekday() >= 5 and random.random() < 0.40:
            return False
        return start_hour <= hour <= end_hour

    @staticmethod
    def _parse_dt_utc(value: Any) -> Optional[datetime]:
        if not value:
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

    def _next_window_start_utc(self, now_utc: datetime, tz_name: str, start_hour: int) -> datetime:
        try:
            local_now = now_utc.astimezone(ZoneInfo(tz_name or DEFAULT_TZ))
        except Exception:
            local_now = now_utc
        start_local = local_now.replace(
            hour=max(0, min(23, int(start_hour))),
            minute=random.randint(5, 35),
            second=0,
            microsecond=0,
        )
        if local_now >= start_local:
            start_local = start_local + timedelta(days=1)
        return start_local.astimezone(timezone.utc)

    def _compute_next_warmup_send_at(
        self,
        now_utc: datetime,
        tz_name: str,
        behavior_profile: Dict[str, Any],
        daily_limit: int,
        sent_today_after_send: int,
        receiver_scarcity_factor: float = 1.0,
    ) -> datetime:
        """Schedule next sender action with larger human-like gaps across active hours."""
        start_hour = max(6, min(12, int(behavior_profile.get("active_start_hour") or 8)))
        end_hour = max(start_hour + 6, min(23, int(behavior_profile.get("active_end_hour") or 21)))
        try:
            local_now = now_utc.astimezone(ZoneInfo(tz_name or DEFAULT_TZ))
        except Exception:
            local_now = now_utc

        window_start = local_now.replace(hour=start_hour, minute=0, second=0, microsecond=0)
        window_end = local_now.replace(hour=end_hour, minute=59, second=0, microsecond=0)
        if local_now >= window_end:
            window_start = window_start + timedelta(days=1)
            window_end = window_end + timedelta(days=1)
        elif local_now < window_start:
            return (window_start + timedelta(minutes=random.randint(5, 45))).astimezone(timezone.utc)

        remaining_today = max(0, int(daily_limit) - int(sent_today_after_send))
        if remaining_today <= 0:
            next_day = (window_start + timedelta(days=1)) + timedelta(minutes=random.randint(10, 90))
            return next_day.astimezone(timezone.utc)

        minutes_left = max(45, int((window_end - local_now).total_seconds() / 60))
        target_gap = max(30, int(minutes_left / max(1, remaining_today)))
        gap_floor = max(35, int(target_gap * 0.8))
        gap_ceiling = max(gap_floor + 35, int(target_gap * 1.9))

        profile_min = int(behavior_profile.get("next_action_min") or 120)
        profile_max = int(behavior_profile.get("next_action_max") or 720)
        profile_min = max(35, min(240, int(profile_min * 0.5)))
        profile_max = max(profile_min + 45, min(480, int(profile_max * 0.75)))
        gap_floor = max(gap_floor, profile_min)
        gap_ceiling = min(max(gap_ceiling, gap_floor + 35), profile_max)
        # If receiver capacity is scarce, naturally stretch gaps and reduce pressure.
        scarcity = max(0.25, min(1.0, float(receiver_scarcity_factor or 1.0)))
        scarcity_mult = 1.0 + ((1.0 - scarcity) * 1.35)
        gap_floor = int(gap_floor * scarcity_mult)
        gap_ceiling = int(gap_ceiling * scarcity_mult)
        if local_now.weekday() >= 5:
            gap_floor = int(gap_floor * 1.15)
            gap_ceiling = int(gap_ceiling * 1.35)
        if gap_ceiling < gap_floor:
            gap_ceiling = gap_floor + 35

        next_local = local_now + timedelta(minutes=random.randint(gap_floor, gap_ceiling))
        if next_local > window_end:
            next_local = (window_start + timedelta(days=1)) + timedelta(minutes=random.randint(10, 120))
        return next_local.astimezone(timezone.utc)

    def _compute_due_send_quota(
        self,
        now_utc: datetime,
        tz_name: str,
        behavior_profile: Dict[str, Any],
        remaining: int,
        max_sends_per_inbox_per_run: int,
        receiver_scarcity_factor: float = 1.0,
    ) -> int:
        """Allow 1 send usually, optional 2 based on inbox personality and receiver capacity."""
        start_hour = max(6, min(12, int(behavior_profile.get("active_start_hour") or 8)))
        end_hour = max(start_hour + 6, min(23, int(behavior_profile.get("active_end_hour") or 21)))
        try:
            local_now = now_utc.astimezone(ZoneInfo(tz_name or DEFAULT_TZ))
        except Exception:
            local_now = now_utc
        window_end = local_now.replace(hour=end_hour, minute=59, second=0, microsecond=0)
        if local_now >= window_end:
            return 0
        minutes_left = max(1, int((window_end - local_now).total_seconds() / 60))
        # Roughly one slot every ~150 minutes; if remaining exceeds slots, allow up to 2.
        slots_left = max(1, int(minutes_left / 150))
        needed_now = 2 if remaining > slots_left else 1
        scarcity = max(0.25, min(1.0, float(receiver_scarcity_factor or 1.0)))
        max_due = int(behavior_profile.get("max_sends_per_due_cycle") or 1)
        if scarcity < 0.45:
            max_due = 1
        elif scarcity > 0.85 and random.random() < 0.35:
            max_due = max(1, min(2, max_due + 1))
        return max(1, min(max_due, max_sends_per_inbox_per_run, remaining, needed_now))

    @staticmethod
    def _receiver_scarcity_factor(total_receivers: int, candidate_receivers: int) -> float:
        if total_receivers <= 0:
            return 0.0
        return max(0.0, min(1.0, candidate_receivers / total_receivers))

    def _compute_scarcity_pause_minutes(self, behavior_profile: Dict[str, Any], scarcity_factor: float) -> int:
        scarcity = max(0.25, min(1.0, float(scarcity_factor or 1.0)))
        base_min = int(behavior_profile.get("idle_pause_min") or 45)
        base_max = int(behavior_profile.get("idle_pause_max") or 180)
        mult = 1.0 + ((1.0 - scarcity) * float(behavior_profile.get("scarcity_sensitivity") or 0.8))
        lo = max(20, int(base_min * mult))
        hi = max(lo + 15, int(base_max * mult))
        return random.randint(lo, hi)

    def _should_skip_cycle(self, behavior_profile: Dict[str, Any], scarcity_factor: float) -> bool:
        base_skip = float(behavior_profile.get("cycle_skip_chance") or 0.0)
        scarcity = max(0.25, min(1.0, float(scarcity_factor or 1.0)))
        bump = (1.0 - scarcity) * 0.18
        skip_prob = min(0.55, max(0.03, base_skip + bump))
        return random.random() < skip_prob

    def _history_requires_answer(self, history: List[Dict[str, str]]) -> bool:
        if not history:
            return False
        last = (history[-1].get("body") or "").strip().lower()
        if not last:
            return False
        if "?" in last:
            return True
        return any(k in last for k in ("can you", "could you", "what", "when", "where", "why", "how", "do you"))

    def _select_sender_intent(self, active_thread: Dict, history: List[Dict[str, str]]) -> str:
        turn_count = int((active_thread or {}).get("turn_count") or 1)
        max_turns = max(1, int((active_thread or {}).get("max_turns") or 3))
        near_end = turn_count >= max(2, max_turns - 1)
        if self._history_requires_answer(history):
            return random.choice(["answer_directly", "clarify_and_continue", "continue"])
        if near_end:
            return random.choice(["close_softly", "continue"])
        return random.choice(["acknowledge", "continue"])

    async def _build_inbox_behavior_profile(self, inbox_id: str) -> Dict[str, Any]:
        async def _synthetic_profile() -> Dict[str, Any]:
            p = random.choice(SYNTHETIC_PERSONAS)
            s = random.randint(*p["start"])
            e = random.randint(*p["end"])
            gmin, gmax = p["gap"]
            return {
                "profile_source": "synthetic",
                "persona": p["name"],
                "active_start_hour": s,
                "active_end_hour": e,
                "turn_dropoff_chance": round(random.uniform(*p["drop"]), 2),
                "next_action_min": gmin,
                "next_action_max": gmax,
                "cycle_skip_chance": round(random.uniform(0.08, 0.22), 2),
                "idle_pause_min": random.randint(35, 70),
                "idle_pause_max": random.randint(120, 260),
                "scarcity_sensitivity": round(random.uniform(0.55, 0.95), 2),
                "max_sends_per_due_cycle": 1 if random.random() < 0.75 else 2,
            }

        default_profile: Dict[str, Any] = {
            "profile_source": "default",
            "persona": "office_worker",
            "active_start_hour": 8,
            "active_end_hour": 21,
            "turn_dropoff_chance": 0.25,
            "next_action_min": 120,
            "next_action_max": 720,
            "cycle_skip_chance": 0.14,
            "idle_pause_min": 45,
            "idle_pause_max": 180,
            "scarcity_sensitivity": 0.80,
            "max_sends_per_due_cycle": 1,
        }
        try:
            inbox_doc = await self.db.inboxes.find_one({"id": inbox_id}, {"warmup_behavior_profile": 1})
            existing = (inbox_doc or {}).get("warmup_behavior_profile")
            # Reuse persisted synthetic/default profile so behavior is stable across runs.
            if existing and existing.get("profile_source") in ("synthetic", "default"):
                return existing

            warm_msgs = await self.db.warmup_messages.find(
                {"inbox_id": inbox_id, "role": "inbox"}
            ).sort("sent_at", -1).limit(250).to_list(None)
            if len(warm_msgs) < 6:
                profile = await _synthetic_profile()
                await self.db.inboxes.update_one(
                    {"id": inbox_id},
                    {"$set": {"warmup_behavior_profile": profile, "updated_at": datetime.now(timezone.utc)}},
                )
                return profile
            hours: List[int] = []
            ts: List[datetime] = []
            weekend = 0
            weekdays = 0
            for m in warm_msgs:
                sent_at = m.get("sent_at")
                if not sent_at:
                    continue
                if isinstance(sent_at, str):
                    from dateutil import parser
                    sent_at = parser.parse(sent_at)
                if getattr(sent_at, "tzinfo", None) is None and hasattr(sent_at, "replace"):
                    sent_at = sent_at.replace(tzinfo=timezone.utc)
                hours.append(sent_at.hour)
                ts.append(sent_at)
                if sent_at.weekday() >= 5:
                    weekend += 1
                else:
                    weekdays += 1
            if len(hours) < 6:
                profile = await _synthetic_profile()
                await self.db.inboxes.update_one(
                    {"id": inbox_id},
                    {"$set": {"warmup_behavior_profile": profile, "updated_at": datetime.now(timezone.utc)}},
                )
                return profile
            sorted_hours = sorted(hours)
            i15 = sorted_hours[max(0, int(len(sorted_hours) * 0.15) - 1)]
            i85 = sorted_hours[min(len(sorted_hours) - 1, int(len(sorted_hours) * 0.85))]
            ts_sorted = sorted(ts)
            gaps: List[float] = []
            for i in range(1, len(ts_sorted)):
                d = (ts_sorted[i] - ts_sorted[i - 1]).total_seconds() / 60.0
                if 5 <= d <= 60 * 48:
                    gaps.append(d)
            gaps_sorted = sorted(gaps) if gaps else []
            median_gap = int(gaps_sorted[len(gaps_sorted) // 2]) if gaps_sorted else 360
            weekend_ratio = weekend / max(1, weekend + weekdays)
            profile = {
                "profile_source": "learned",
                "persona": "learned",
                "active_start_hour": max(6, min(11, i15)),
                "active_end_hour": max(max(6, min(11, i15)) + 6, min(23, i85 + 1)),
                "turn_dropoff_chance": round(min(0.55, max(0.12, 0.20 + weekend_ratio * 0.25)), 2),
                "next_action_min": max(90, int(median_gap * 0.6)),
                "next_action_max": min(1440, max(max(90, int(median_gap * 0.6)) + 60, int(median_gap * 1.8))),
                "cycle_skip_chance": round(min(0.35, max(0.06, 0.10 + weekend_ratio * 0.18)), 2),
                "idle_pause_min": max(35, min(90, int(median_gap * 0.25))),
                "idle_pause_max": max(120, min(360, int(median_gap * 0.8))),
                "scarcity_sensitivity": round(min(1.05, max(0.55, 0.70 + weekend_ratio * 0.20)), 2),
                "max_sends_per_due_cycle": 1 if median_gap >= 240 else 2,
            }
            await self.db.inboxes.update_one(
                {"id": inbox_id},
                {"$set": {"warmup_behavior_profile": profile, "updated_at": datetime.now(timezone.utc)}},
            )
            return profile
        except Exception:
            return default_profile

    async def _run_network_sends(
        self,
        inbox: Dict[str, Any],
        inbox_id: str,
        user_id: str,
        behavior_profile: Dict[str, Any],
        max_sends_per_inbox_per_run: int = 3,
    ) -> tuple:
        """Send warmup emails to user's Warmup Network contacts (real engagement path).
        No pool receiver accounts, no multiturn, no automated open/reply from platform."""
        sent_count = 0
        error_count = 0
        try:
            contacts = await self.db.warmup_network_contacts.find(
                {"user_id": user_id}, {"_id": 0}
            ).to_list(None)
        except Exception as e:
            logger.warning("Warmup sender (network): failed to load contacts for user %s: %s", user_id, e)
            return (0, 0)
        if not contacts:
            return (0, 0)

        sent_today = int(inbox.get("sent_today", 0) or 0)
        daily_limit = max(1, inbox.get("daily_limit", 50))
        remaining = daily_limit - sent_today
        if remaining <= 0:
            return (0, 0)

        tz_name = (inbox.get("timezone") or DEFAULT_TZ).strip() if isinstance(inbox.get("timezone"), str) else DEFAULT_TZ
        start_hour = int(behavior_profile.get("active_start_hour") or 8)
        end_hour = int(behavior_profile.get("active_end_hour") or 21)
        now_for_schedule = datetime.now(timezone.utc)

        next_send_at = self._parse_dt_utc(inbox.get("warmup_next_send_at"))
        if next_send_at and next_send_at > now_for_schedule:
            return (0, 0)
        if not self._in_human_window(now_for_schedule, tz_name, start_hour, end_hour):
            defer_to = self._next_window_start_utc(now_for_schedule, tz_name, start_hour)
            try:
                await self.db.inboxes.update_one(
                    {"id": inbox_id},
                    {"$set": {"warmup_next_send_at": defer_to, "updated_at": now_for_schedule}},
                )
            except Exception:
                pass
            return (0, 0)

        # Dedup: contacts sent to in last 24h from this inbox
        cutoff = now_for_schedule - timedelta(hours=24)
        try:
            recent_sent_emails = set()
            recent_docs = await self.db.warmup_sent.find(
                {"inbox_id": inbox_id, "engagement_mode": "network", "sent_at": {"$gte": cutoff}},
                {"receiver_email": 1},
            ).to_list(None)
            recent_sent_emails = {d.get("receiver_email", "").lower() for d in recent_docs}
        except Exception as e:
            logger.warning("Warmup sender (network): failed to load recent sends for inbox %s: %s", inbox_id, e)
            recent_sent_emails = set()

        daily_receive_cap = await self._get_network_contact_daily_limit(user_id)
        receive_counts = await self._warmup_inbound_counts_by_receiver_for_owner(user_id, cutoff)
        close_state = await self._build_close_network_state(inbox, inbox_id, user_id, now_for_schedule)
        blocked_count = 0
        shadow_block_count = 0

        def _contact_under_daily_cap(c: Dict[str, Any]) -> bool:
            em = (c.get("email") or "").strip().lower()
            if not em:
                return False
            return receive_counts.get(em, 0) < daily_receive_cap

        candidates: List[Dict[str, Any]] = []
        for c in contacts:
            receiver_email = (c.get("email") or "").strip().lower()
            if not receiver_email:
                continue
            if receiver_email in recent_sent_emails or not _contact_under_daily_cap(c):
                continue
            receiver_domain_root = (c.get("domain_root") or "").strip().lower() or _root_domain_from_email(receiver_email)
            receiver_provider = (c.get("provider") or "").strip().lower() or _provider_from_domain_or_email(receiver_email)
            decision = self._score_close_network_candidate(
                close_state, receiver_email, receiver_provider, receiver_domain_root
            )
            if decision.get("shadow_block"):
                shadow_block_count += 1
            if not decision.get("allowed", True):
                blocked_count += 1
                await self._record_close_network_event(
                    inbox_id=inbox_id,
                    user_id=user_id,
                    receiver_email=receiver_email,
                    mode=WARMUP_CLOSE_NETWORK_MODE,
                    action="blocked",
                    score=float(decision.get("score") or 0.0),
                    reasons=list(decision.get("reasons") or []),
                    risk=dict(decision.get("risk") or {}),
                )
                continue
            c["_receiver_domain_root"] = receiver_domain_root
            c["_receiver_provider"] = receiver_provider
            c["_close_network_score"] = float(decision.get("score") or 0.0)
            c["_close_network_reasons"] = list(decision.get("reasons") or [])
            c["_close_network_risk"] = dict(decision.get("risk") or {})
            candidates.append(c)
        random.shuffle(candidates)
        total_eval = len(candidates) + blocked_count
        if total_eval > 0:
            rejection_rate = blocked_count / total_eval
            if rejection_rate > WARMUP_CLOSE_NETWORK_ALERT_REJECTION_RATE:
                logger.warning(
                    "Warmup close-network rejection spike inbox=%s mode=%s rate=%.2f blocked=%d total=%d",
                    inbox_id,
                    WARMUP_CLOSE_NETWORK_MODE,
                    rejection_rate,
                    blocked_count,
                    total_eval,
                )
            if WARMUP_CLOSE_NETWORK_MODE == "shadow" and shadow_block_count > 0:
                logger.info(
                    "Warmup close-network shadow inbox=%s shadow_blocked=%d total=%d",
                    inbox_id,
                    shadow_block_count,
                    total_eval,
                )

        to_send = self._compute_due_send_quota(
            now_for_schedule, tz_name, behavior_profile, remaining, max_sends_per_inbox_per_run
        )
        if len(candidates) < WARMUP_CLOSE_NETWORK_MIN_CANDIDATES_PER_CYCLE:
            to_send = min(to_send, max(1, len(candidates)))
        to_send = min(to_send, len(candidates))
        if to_send <= 0:
            return (0, 0)

        try:
            templates = await self.db.warmup_send_templates.find(
                {"user_id": user_id, "subject": {"$exists": True}, "body": {"$exists": True}}
            ).to_list(None)
        except Exception as e:
            logger.warning("Warmup sender (network): failed to load templates for user %s: %s", user_id, e)
            templates = []

        sender_type = inbox.get("sender_type", "smtp")

        for i in range(to_send):
            if i >= len(candidates):
                break
            contact = candidates[i]
            receiver_email = (contact.get("email") or "").strip()
            if not receiver_email:
                continue
            receiver_domain_root = (contact.get("_receiver_domain_root") or "").strip().lower() or _root_domain_from_email(receiver_email)
            receiver_provider = (contact.get("_receiver_provider") or "").strip().lower() or _provider_from_domain_or_email(receiver_email)
            close_network_score = float(contact.get("_close_network_score") or 0.0)
            close_network_reasons = list(contact.get("_close_network_reasons") or [])
            close_network_risk = dict(contact.get("_close_network_risk") or {})

            if i > 0:
                send_delay = random.uniform(MIN_DELAY_BETWEEN_SENDS_SEC, MAX_DELAY_BETWEEN_SENDS_SEC)
                await asyncio.sleep(send_delay)

            message_id = str(uuid.uuid4())
            if templates:
                t = random.choice(templates)
                subject = (t.get("subject") or "").strip() or "Hello"
                body = (t.get("body") or "").strip() or "Hope you're well."
                send_body_type = _warmup_send_body_type(t)
            else:
                subject = random.choice(WARMUP_SUBJECTS)
                body = random.choice(WARMUP_BODIES)
                send_body_type = "plain"

            if self.email_service is not None:
                try:
                    ctx = self._warmup_placeholder_contact(inbox, {"email": receiver_email})
                    subject = self.email_service.parse_spintax(subject or "")
                    body = self.email_service.parse_spintax(body or "")
                    subject = self.email_service.replace_placeholders(subject, ctx)
                    body = self.email_service.replace_placeholders(body, ctx)
                except Exception as pe:
                    logger.warning("Warmup sender (network): placeholder/spintax failed for inbox %s: %s", inbox_id, pe)

            warmup_sent_id = str(uuid.uuid4())

            try:
                await self._warmup_assert_smtp_quota(user_id, inbox)
                if sender_type == "gmail":
                    if inbox.get("gmail_auth_method") == "app_password":
                        await self.smtp_service.send_email_via_smtp_gmail_app_password(
                            inbox_id, receiver_email, subject, body,
                            tracking_pixel_url=None, reply_to_email=None,
                            outbound_message_id=message_id, body_type=send_body_type,
                        )
                    else:
                        await self.gmail_service.send_email(
                            inbox_id, user_id, receiver_email, subject, body,
                            tracking_pixel_url=None, body_type=send_body_type,
                            outbound_message_id=message_id,
                        )
                else:
                    await self.smtp_service.send_email_via_smtp(
                        inbox_id, receiver_email, subject, body,
                        tracking_pixel_url=None, reply_to_email=None,
                        outbound_message_id=message_id, body_type=send_body_type,
                    )
                await self._warmup_meter_send(user_id, inbox, receiver_email, subject, message_id)
            except MonthlySmtpQuotaExceeded:
                logger.warning(
                    "Warmup sender (network): SMTP monthly quota reached for user %s; stopping network sends for this inbox",
                    user_id,
                )
                error_count += 1
                break
            except Exception as e:
                logger.exception("Warmup sender (network): failed to send from inbox %s to %s: %s", inbox_id, receiver_email, e)
                error_count += 1
                continue

            now = datetime.now(timezone.utc)
            try:
                await self.db.warmup_sent.insert_one({
                    "id": warmup_sent_id,
                    "inbox_id": inbox_id,
                    "user_id": user_id,
                    "receiver_account_id": None,
                    "engagement_mode": "network",
                    "receiver_email": receiver_email,
                    "sender_email": (inbox.get("email") or "").strip().lower(),
                    "sender_domain_root": _root_domain_from_email((inbox.get("email") or "").strip().lower()),
                    "sender_provider": _provider_from_domain_or_email((inbox.get("email") or "").strip().lower()),
                    "receiver_domain_root": receiver_domain_root,
                    "receiver_provider": receiver_provider,
                    "receiver_domain_group": receiver_domain_root,
                    "close_network_mode": WARMUP_CLOSE_NETWORK_MODE,
                    "close_network_pair_key": _stable_pair_key((inbox.get("email") or "").strip().lower(), receiver_email),
                    "close_network_risk_score": round(close_network_score, 4),
                    "close_network_reasons": close_network_reasons,
                    "close_network_risk": close_network_risk,
                    "thread_id": str(uuid.uuid4()),
                    "turn_index": 0,
                    "message_id": message_id,
                    "subject": subject,
                    "reply_generation_source": None,
                    "reply_quality_score": None,
                    "sent_at": now,
                    "opened_at": None,
                    "replied_at": None,
                    "link_clicked_at": None,
                    "receiver_message_uid": None,
                    "receiver_gmail_id": None,
                    "created_at": now,
                    "updated_at": now,
                })
            except Exception as e:
                logger.exception("Warmup sender (network): failed to insert warmup_sent: %s", e)
                error_count += 1
                continue

            try:
                next_scheduled_at = self._compute_next_warmup_send_at(
                    now, tz_name, behavior_profile, daily_limit,
                    sent_today_after_send=sent_today + 1,
                )
                await self.db.inboxes.update_one(
                    {"id": inbox_id},
                    {
                        "$inc": {"sent_today": 1},
                        "$set": {
                            "warmup_last_sent_at": now,
                            "warmup_next_send_at": next_scheduled_at,
                            "updated_at": now,
                        },
                    },
                )
                sent_today += 1
            except Exception as e:
                logger.warning("Warmup sender (network): failed to update sent_today for inbox %s: %s", inbox_id, e)

            sent_count += 1

        return (sent_count, error_count)

    async def _run_shared_pool_sends(
        self,
        inbox: Dict[str, Any],
        inbox_id: str,
        user_id: str,
        behavior_profile: Dict[str, Any],
        max_sends_per_inbox_per_run: int = 3,
    ) -> tuple:
        """Send warmup emails to the rentable personal-network pool and settle credits."""
        sent_count = 0
        error_count = 0

        contributor_ids = await self.shared_pool_service.get_eligible_contributor_user_ids(
            exclude_user_id=user_id
        )

        # Load warmup_network_contacts from eligible contributors
        contacts: List[Dict[str, Any]] = []
        if contributor_ids:
            try:
                contacts = await self.db.warmup_network_contacts.find(
                    {"user_id": {"$in": contributor_ids}},
                    {"_id": 0},
                ).to_list(None)
            except Exception as e:
                logger.warning("Warmup sender (shared pool): failed to load contacts: %s", e)

        # Also load active RYN listings — they participate as pool receivers
        try:
            ryn_listings = await self.db.ryn_listings.find(
                {"status": "active"},
                {"_id": 0, "id": 1, "email": 1, "owner_id": 1, "daily_receive_limit": 1},
            ).to_list(None)
            # Tag each as a RYN-sourced candidate with a compatible shape
            for listing in ryn_listings:
                contacts.append({
                    "email": listing.get("email"),
                    "user_id": listing.get("owner_id"),  # used for dedup key only
                    "_ryn": True,
                    "_ryn_listing_id": listing.get("id"),
                    "_ryn_owner_id": listing.get("owner_id"),
                    "_ryn_daily_limit": int(listing.get("daily_receive_limit") or 10),
                })
        except Exception as e:
            logger.warning("Warmup sender (shared pool): failed to load RYN listings: %s", e)

        if not contacts:
            return (0, 0)

        sent_today = int(inbox.get("sent_today", 0) or 0)
        daily_limit = max(1, inbox.get("daily_limit", 50))
        remaining = daily_limit - sent_today
        if remaining <= 0:
            return (0, 0)

        balance = await self.credit_service.get_balance(user_id)
        if balance < SHARED_POOL_CREDITS_PER_SEND:
            return (0, 0)

        tz_name = (inbox.get("timezone") or DEFAULT_TZ).strip() if isinstance(inbox.get("timezone"), str) else DEFAULT_TZ
        start_hour = int(behavior_profile.get("active_start_hour") or 8)
        end_hour = int(behavior_profile.get("active_end_hour") or 21)
        now_for_schedule = datetime.now(timezone.utc)

        next_send_at = self._parse_dt_utc(inbox.get("warmup_next_send_at"))
        if next_send_at and next_send_at > now_for_schedule:
            return (0, 0)
        if not self._in_human_window(now_for_schedule, tz_name, start_hour, end_hour):
            defer_to = self._next_window_start_utc(now_for_schedule, tz_name, start_hour)
            try:
                await self.db.inboxes.update_one(
                    {"id": inbox_id},
                    {"$set": {"warmup_next_send_at": defer_to, "updated_at": now_for_schedule}},
                )
            except Exception:
                pass
            return (0, 0)

        cutoff = now_for_schedule - timedelta(hours=24)
        close_state = await self._build_close_network_state(inbox, inbox_id, user_id, now_for_schedule)
        blocked_count = 0
        shadow_block_count = 0
        try:
            recent_docs = await self.db.warmup_sent.find(
                {"inbox_id": inbox_id, "engagement_mode": "shared_pool", "sent_at": {"$gte": cutoff}},
                {"receiver_email": 1},
            ).to_list(None)
            recent_sent_emails = {d.get("receiver_email", "").lower() for d in recent_docs}
        except Exception as e:
            logger.warning("Warmup sender (shared pool): failed to load recent sends for inbox %s: %s", inbox_id, e)
            recent_sent_emails = set()

        # For RYN emails, fetch their per-listing receive counts in last 24h
        ryn_receive_counts: Dict[str, int] = {}
        try:
            ryn_emails = [c.get("email", "").lower() for c in contacts if c.get("_ryn")]
            if ryn_emails:
                ryn_count_docs = await self.db.warmup_sent.find(
                    {"receiver_email": {"$in": ryn_emails}, "sent_at": {"$gte": cutoff}},
                    {"receiver_email": 1},
                ).to_list(None)
                for d in ryn_count_docs:
                    em = (d.get("receiver_email") or "").lower()
                    ryn_receive_counts[em] = ryn_receive_counts.get(em, 0) + 1
        except Exception as e:
            logger.warning("Warmup sender (shared pool): failed to count RYN receive counts: %s", e)

        pool_prefilter = [c for c in contacts if (c.get("email") or "").lower() not in recent_sent_emails]
        candidates: List[Dict[str, Any]] = []
        owners_seen: Dict[str, Dict[str, int]] = {}
        caps: Dict[str, int] = {}
        for c in pool_prefilter:
            em = (c.get("email") or "").strip().lower()
            if not em:
                continue
            if c.get("_ryn"):
                # RYN listing: check per-listing daily receive limit
                limit = c.get("_ryn_daily_limit", 10)
                if ryn_receive_counts.get(em, 0) < limit:
                    receiver_domain_root = (c.get("domain_root") or "").strip().lower() or _root_domain_from_email(em)
                    receiver_provider = (c.get("provider") or "").strip().lower() or _provider_from_domain_or_email(em)
                    decision = self._score_close_network_candidate(
                        close_state, em, receiver_provider, receiver_domain_root
                    )
                    if decision.get("shadow_block"):
                        shadow_block_count += 1
                    if not decision.get("allowed", True):
                        blocked_count += 1
                        await self._record_close_network_event(
                            inbox_id=inbox_id,
                            user_id=user_id,
                            receiver_email=em,
                            mode=WARMUP_CLOSE_NETWORK_MODE,
                            action="blocked",
                            score=float(decision.get("score") or 0.0),
                            reasons=list(decision.get("reasons") or []),
                            risk=dict(decision.get("risk") or {}),
                        )
                        continue
                    c["_receiver_domain_root"] = receiver_domain_root
                    c["_receiver_provider"] = receiver_provider
                    c["_close_network_score"] = float(decision.get("score") or 0.0)
                    c["_close_network_reasons"] = list(decision.get("reasons") or [])
                    c["_close_network_risk"] = dict(decision.get("risk") or {})
                    candidates.append(c)
            else:
                owner_id = (c.get("user_id") or "").strip()
                if not owner_id:
                    continue
                if owner_id not in owners_seen:
                    owners_seen[owner_id] = await self._warmup_inbound_counts_by_receiver_for_owner(
                        owner_id, cutoff
                    )
                    caps[owner_id] = await self._get_network_contact_daily_limit(owner_id)
                if owners_seen[owner_id].get(em, 0) < caps[owner_id]:
                    receiver_domain_root = (c.get("domain_root") or "").strip().lower() or _root_domain_from_email(em)
                    receiver_provider = (c.get("provider") or "").strip().lower() or _provider_from_domain_or_email(em)
                    decision = self._score_close_network_candidate(
                        close_state, em, receiver_provider, receiver_domain_root
                    )
                    if decision.get("shadow_block"):
                        shadow_block_count += 1
                    if not decision.get("allowed", True):
                        blocked_count += 1
                        await self._record_close_network_event(
                            inbox_id=inbox_id,
                            user_id=user_id,
                            receiver_email=em,
                            mode=WARMUP_CLOSE_NETWORK_MODE,
                            action="blocked",
                            score=float(decision.get("score") or 0.0),
                            reasons=list(decision.get("reasons") or []),
                            risk=dict(decision.get("risk") or {}),
                        )
                        continue
                    c["_receiver_domain_root"] = receiver_domain_root
                    c["_receiver_provider"] = receiver_provider
                    c["_close_network_score"] = float(decision.get("score") or 0.0)
                    c["_close_network_reasons"] = list(decision.get("reasons") or [])
                    c["_close_network_risk"] = dict(decision.get("risk") or {})
                    candidates.append(c)
        random.shuffle(candidates)
        total_eval = len(candidates) + blocked_count
        if total_eval > 0:
            rejection_rate = blocked_count / total_eval
            if rejection_rate > WARMUP_CLOSE_NETWORK_ALERT_REJECTION_RATE:
                logger.warning(
                    "Warmup shared-pool close-network rejection spike inbox=%s mode=%s rate=%.2f blocked=%d total=%d",
                    inbox_id,
                    WARMUP_CLOSE_NETWORK_MODE,
                    rejection_rate,
                    blocked_count,
                    total_eval,
                )
            if WARMUP_CLOSE_NETWORK_MODE == "shadow" and shadow_block_count > 0:
                logger.info(
                    "Warmup shared-pool close-network shadow inbox=%s shadow_blocked=%d total=%d",
                    inbox_id,
                    shadow_block_count,
                    total_eval,
                )

        to_send = self._compute_due_send_quota(
            now_for_schedule, tz_name, behavior_profile, remaining, max_sends_per_inbox_per_run
        )
        if len(candidates) < WARMUP_CLOSE_NETWORK_MIN_CANDIDATES_PER_CYCLE:
            to_send = min(to_send, max(1, len(candidates)))
        to_send = min(to_send, len(candidates))
        if to_send <= 0:
            return (0, 0)

        try:
            templates = await self.db.warmup_send_templates.find(
                {"user_id": user_id, "subject": {"$exists": True}, "body": {"$exists": True}}
            ).to_list(None)
        except Exception as e:
            logger.warning("Warmup sender (shared pool): failed to load templates for user %s: %s", user_id, e)
            templates = []

        sender_type = inbox.get("sender_type", "smtp")

        for i in range(to_send):
            if i >= len(candidates):
                break
            contact = candidates[i]
            receiver_email = (contact.get("email") or "").strip()
            is_ryn = bool(contact.get("_ryn"))
            ryn_listing_id = contact.get("_ryn_listing_id") if is_ryn else None
            ryn_owner_id = contact.get("_ryn_owner_id") if is_ryn else None
            owner_user_id = ryn_owner_id if is_ryn else contact.get("user_id")
            if not receiver_email or not owner_user_id:
                continue
            receiver_domain_root = (contact.get("_receiver_domain_root") or "").strip().lower() or _root_domain_from_email(receiver_email)
            receiver_provider = (contact.get("_receiver_provider") or "").strip().lower() or _provider_from_domain_or_email(receiver_email)
            close_network_score = float(contact.get("_close_network_score") or 0.0)
            close_network_reasons = list(contact.get("_close_network_reasons") or [])
            close_network_risk = dict(contact.get("_close_network_risk") or {})

            if i > 0:
                send_delay = random.uniform(MIN_DELAY_BETWEEN_SENDS_SEC, MAX_DELAY_BETWEEN_SENDS_SEC)
                await asyncio.sleep(send_delay)

            warmup_sent_id = str(uuid.uuid4())
            spend_ok, _ = await self.credit_service.spend_credits(
                user_id,
                SHARED_POOL_CREDITS_PER_SEND,
                reason="shared_pool_send",
                metadata={
                    "warmup_sent_id": warmup_sent_id,
                    "inbox_id": inbox_id,
                    "receiver_email": receiver_email,
                    "provider_user_id": owner_user_id,
                },
                idempotency_key=f"shared-pool-spend:{warmup_sent_id}",
            )
            if not spend_ok:
                break

            message_id = str(uuid.uuid4())
            if templates:
                t = random.choice(templates)
                subject = (t.get("subject") or "").strip() or "Hello"
                body = (t.get("body") or "").strip() or "Hope you're well."
                send_body_type = _warmup_send_body_type(t)
            else:
                subject = random.choice(WARMUP_SUBJECTS)
                body = random.choice(WARMUP_BODIES)
                send_body_type = "plain"

            if self.email_service is not None:
                try:
                    ctx = self._warmup_placeholder_contact(inbox, {"email": receiver_email})
                    subject = self.email_service.parse_spintax(subject or "")
                    body = self.email_service.parse_spintax(body or "")
                    subject = self.email_service.replace_placeholders(subject, ctx)
                    body = self.email_service.replace_placeholders(body, ctx)
                except Exception as pe:
                    logger.warning("Warmup sender (shared pool): placeholder/spintax failed for inbox %s: %s", inbox_id, pe)

            try:
                await self._warmup_assert_smtp_quota(user_id, inbox)
                if sender_type == "gmail":
                    if inbox.get("gmail_auth_method") == "app_password":
                        await self.smtp_service.send_email_via_smtp_gmail_app_password(
                            inbox_id, receiver_email, subject, body,
                            tracking_pixel_url=None, reply_to_email=None,
                            outbound_message_id=message_id, body_type=send_body_type,
                        )
                    else:
                        await self.gmail_service.send_email(
                            inbox_id, user_id, receiver_email, subject, body,
                            tracking_pixel_url=None, body_type=send_body_type,
                            outbound_message_id=message_id,
                        )
                else:
                    await self.smtp_service.send_email_via_smtp(
                        inbox_id, receiver_email, subject, body,
                        tracking_pixel_url=None, reply_to_email=None,
                        outbound_message_id=message_id, body_type=send_body_type,
                    )
                await self._warmup_meter_send(user_id, inbox, receiver_email, subject, message_id)
            except MonthlySmtpQuotaExceeded:
                logger.warning(
                    "Warmup sender (shared pool): SMTP monthly quota reached for user %s",
                    user_id,
                )
                error_count += 1
                await self.credit_service.add_credits(
                    user_id,
                    SHARED_POOL_CREDITS_PER_SEND,
                    reason="shared_pool_send_refund",
                    metadata={
                        "warmup_sent_id": warmup_sent_id,
                        "inbox_id": inbox_id,
                        "receiver_email": receiver_email,
                        "reason": "smtp_monthly_quota",
                    },
                    idempotency_key=f"shared-pool-refund:{warmup_sent_id}",
                )
                break
            except Exception as e:
                logger.exception(
                    "Warmup sender (shared pool): failed to send from inbox %s to %s: %s",
                    inbox_id,
                    receiver_email,
                    e,
                )
                error_count += 1
                await self.credit_service.add_credits(
                    user_id,
                    SHARED_POOL_CREDITS_PER_SEND,
                    reason="shared_pool_send_refund",
                    metadata={
                        "warmup_sent_id": warmup_sent_id,
                        "inbox_id": inbox_id,
                        "receiver_email": receiver_email,
                    },
                    idempotency_key=f"shared-pool-refund:{warmup_sent_id}",
                )
                continue

            now = datetime.now(timezone.utc)
            try:
                doc = {
                    "id": warmup_sent_id,
                    "inbox_id": inbox_id,
                    "user_id": user_id,
                    "receiver_account_id": None,
                    "engagement_mode": "shared_pool",
                    "receiver_email": receiver_email,
                    "sender_email": (inbox.get("email") or "").strip().lower(),
                    "sender_domain_root": _root_domain_from_email((inbox.get("email") or "").strip().lower()),
                    "sender_provider": _provider_from_domain_or_email((inbox.get("email") or "").strip().lower()),
                    "receiver_domain_root": receiver_domain_root,
                    "receiver_provider": receiver_provider,
                    "receiver_domain_group": receiver_domain_root,
                    "close_network_mode": WARMUP_CLOSE_NETWORK_MODE,
                    "close_network_pair_key": _stable_pair_key((inbox.get("email") or "").strip().lower(), receiver_email),
                    "close_network_risk_score": round(close_network_score, 4),
                    "close_network_reasons": close_network_reasons,
                    "close_network_risk": close_network_risk,
                    "thread_id": str(uuid.uuid4()),
                    "turn_index": 0,
                    "message_id": message_id,
                    "subject": subject,
                    "shared_pool_owner_user_id": owner_user_id if not is_ryn else None,
                    "ryn_listing_id": ryn_listing_id,
                    "ryn_owner_user_id": ryn_owner_id,
                    "credits_charged": SHARED_POOL_CREDITS_PER_SEND,
                    "credits_rewarded": 0,
                    "credit_status": "held",
                    "reply_generation_source": None,
                    "reply_quality_score": None,
                    "sent_at": now,
                    "opened_at": None,
                    "replied_at": None,
                    "link_clicked_at": None,
                    "receiver_message_uid": None,
                    "receiver_gmail_id": None,
                    "created_at": now,
                    "updated_at": now,
                }
                await self.db.warmup_sent.insert_one(doc)
            except Exception as e:
                logger.exception("Warmup sender (shared pool): failed to insert warmup_sent: %s", e)
                error_count += 1
                await self.credit_service.add_credits(
                    user_id,
                    SHARED_POOL_CREDITS_PER_SEND,
                    reason="shared_pool_send_refund",
                    metadata={"warmup_sent_id": warmup_sent_id, "stage": "insert_failed"},
                    idempotency_key=f"shared-pool-refund:{warmup_sent_id}",
                )
                continue

            # Credits are now held — owner will be rewarded (or sender refunded) by the settlement job
            if is_ryn and ryn_owner_id:
                # Increment RYN user's held balance and create earn_held transaction
                try:
                    ryn_now = datetime.now(timezone.utc)
                    hold_until = ryn_now + timedelta(hours=48)
                    await self.db.ryn_users.update_one(
                        {"id": ryn_owner_id},
                        {"$inc": {"credits_held": SHARED_POOL_CREDITS_PER_SEND, "credits_total_earned": SHARED_POOL_CREDITS_PER_SEND}, "$set": {"updated_at": ryn_now}},
                    )
                    ryn_tx = {
                        "id": str(uuid.uuid4()),
                        "user_id": ryn_owner_id,
                        "amount": SHARED_POOL_CREDITS_PER_SEND,
                        "type": "earn_held",
                        "description": f"Warmup email sent to {receiver_email} — releases on reply",
                        "listing_id": ryn_listing_id,
                        "listing_email": receiver_email,
                        "renter_user_id": user_id,
                        "hold_until": hold_until,
                        "released_at": None,
                        "settled_reason": None,
                        "warmup_sent_id": warmup_sent_id,
                        "created_at": ryn_now,
                        "updated_at": ryn_now,
                    }
                    await self.db.ryn_transactions.insert_one({**ryn_tx, "_id": ryn_tx["id"]})
                    # Update listing stats
                    await self.db.ryn_listings.update_one(
                        {"id": ryn_listing_id},
                        {"$inc": {"times_rented": 1}, "$set": {"updated_at": ryn_now}},
                    )
                except Exception as e:
                    logger.warning("Warmup sender (shared pool): failed to create RYN earn_held for listing %s: %s", ryn_listing_id, e)
            else:
                try:
                    await self.db.warmup_network_contacts.update_one(
                        {"id": contact.get("id")},
                        {"$set": {"shared_pool_last_rented_at": now, "updated_at": now}},
                    )
                except Exception as e:
                    logger.warning("Warmup sender (shared pool): failed to update last_rented_at for contact %s: %s", contact.get("id"), e)

            try:
                next_scheduled_at = self._compute_next_warmup_send_at(
                    now, tz_name, behavior_profile, daily_limit,
                    sent_today_after_send=sent_today + 1,
                )
                await self.db.inboxes.update_one(
                    {"id": inbox_id},
                    {
                        "$inc": {"sent_today": 1},
                        "$set": {
                            "warmup_last_sent_at": now,
                            "warmup_next_send_at": next_scheduled_at,
                            "updated_at": now,
                        },
                    },
                )
                sent_today += 1
            except Exception as e:
                logger.warning("Warmup sender (shared pool): failed to update sent_today for inbox %s: %s", inbox_id, e)

            sent_count += 1

        return (sent_count, error_count)

    async def settle_held_shared_pool_credits(self) -> Dict[str, int]:
        """
        Settle credits that were held when a shared-pool email was sent.

        Rules (applied once per held warmup_sent record):
        - Qualified (replied_at set): reward the contact owner.
          Settled immediately whenever detected, even before the 48-hour window expires.
        - Timed-out (sent_at older than SHARED_POOL_CREDIT_HOLD_HOURS with no reply):
          refund the sender — contact did not generate a genuine interaction.

        The sender's own inbox is excluded from the pool at send-time (exclude_user_id), so
        self-sends never contribute to the quality check.
        """
        now = datetime.now(timezone.utc)
        settle_cutoff = now - timedelta(hours=SHARED_POOL_CREDIT_HOLD_HOURS)
        rewarded = 0
        refunded = 0

        try:
            held_entries = await self.db.warmup_sent.find(
                {"engagement_mode": "shared_pool", "credit_status": "held"},
                {"_id": 0},
            ).to_list(None)
        except Exception as e:
            logger.error("settle_held_shared_pool_credits: failed to fetch held entries: %s", e)
            return {"rewarded": 0, "refunded": 0}

        for entry in held_entries:
            warmup_sent_id = entry.get("id")
            sender_user_id = entry.get("user_id")
            owner_user_id = entry.get("shared_pool_owner_user_id")
            ryn_owner_user_id = entry.get("ryn_owner_user_id")
            ryn_listing_id = entry.get("ryn_listing_id")
            credits_charged = int(entry.get("credits_charged") or SHARED_POOL_CREDITS_PER_SEND)
            replied_at = entry.get("replied_at")

            # Parse sent_at robustly
            sent_at = entry.get("sent_at")
            if isinstance(sent_at, str):
                try:
                    from dateutil import parser as dtparser
                    sent_at = dtparser.parse(sent_at)
                except Exception:
                    sent_at = None
            if sent_at is not None and getattr(sent_at, "tzinfo", None) is None:
                sent_at = sent_at.replace(tzinfo=timezone.utc)

            is_qualified = replied_at is not None
            is_timed_out = sent_at is not None and sent_at <= settle_cutoff

            if not is_qualified and not is_timed_out:
                # Still within hold window and not yet engaged — leave as held
                continue

            if is_qualified:
                # Reply confirmed — reward the owner
                if ryn_owner_user_id and credits_charged > 0:
                    # RYN listing — credit the ryn_users collection
                    try:
                        settle_now = datetime.now(timezone.utc)
                        await self.db.ryn_users.update_one(
                            {"id": ryn_owner_user_id},
                            {"$inc": {"credits_balance": credits_charged, "credits_held": -credits_charged}, "$set": {"updated_at": settle_now}},
                        )
                        # Update the earn_held transaction to earn
                        await self.db.ryn_transactions.update_one(
                            {"warmup_sent_id": warmup_sent_id, "type": "earn_held"},
                            {"$set": {"type": "earn", "released_at": settle_now, "hold_until": None, "settled_reason": "reply_detected", "updated_at": settle_now}},
                        )
                        # Update listing credits_earned
                        if ryn_listing_id:
                            await self.db.ryn_listings.update_one(
                                {"id": ryn_listing_id},
                                {"$inc": {"credits_earned": credits_charged}, "$set": {"updated_at": settle_now}},
                            )
                    except Exception as e:
                        logger.warning(
                            "settle_held: failed to reward RYN owner %s for entry %s: %s",
                            ryn_owner_user_id, warmup_sent_id, e,
                        )
                        continue
                elif owner_user_id and credits_charged > 0:
                    # Regular shared pool — credit the main users collection
                    try:
                        await self.credit_service.add_credits(
                            owner_user_id,
                            credits_charged,
                            reason="shared_pool_rental_income",
                            metadata={
                                "warmup_sent_id": warmup_sent_id,
                                "renter_user_id": sender_user_id,
                                "receiver_email": entry.get("receiver_email"),
                                "settled_reason": "reply_detected",
                            },
                            idempotency_key=f"shared-pool-income:{warmup_sent_id}",
                            earned=True,
                        )
                    except Exception as e:
                        logger.warning(
                            "settle_held: failed to reward owner %s for entry %s: %s",
                            owner_user_id, warmup_sent_id, e,
                        )
                        continue
                try:
                    await self.db.warmup_sent.update_one(
                        {"id": warmup_sent_id},
                        {"$set": {"credit_status": "settled_rewarded", "credits_rewarded": credits_charged, "updated_at": now}},
                    )
                except Exception as e:
                    logger.warning("settle_held: failed to mark settled_rewarded for %s: %s", warmup_sent_id, e)
                rewarded += 1
            else:
                # Timed out — no qualifying response; refund sender
                if ryn_owner_user_id and credits_charged > 0:
                    # Release the held credits from RYN user (no reward — mark expired)
                    try:
                        expire_now = datetime.now(timezone.utc)
                        await self.db.ryn_users.update_one(
                            {"id": ryn_owner_user_id},
                            {"$inc": {"credits_held": -credits_charged}, "$set": {"updated_at": expire_now}},
                        )
                        await self.db.ryn_transactions.update_one(
                            {"warmup_sent_id": warmup_sent_id, "type": "earn_held"},
                            {"$set": {"type": "earn_expired", "released_at": expire_now, "hold_until": None, "settled_reason": "no_response_48h", "updated_at": expire_now}},
                        )
                    except Exception as e:
                        logger.warning(
                            "settle_held: failed to expire RYN held credits for %s: %s",
                            ryn_owner_user_id, e,
                        )
                if sender_user_id and credits_charged > 0:
                    try:
                        await self.credit_service.add_credits(
                            sender_user_id,
                            credits_charged,
                            reason="shared_pool_send_refund",
                            metadata={
                                "warmup_sent_id": warmup_sent_id,
                                "receiver_email": entry.get("receiver_email"),
                                "settled_reason": "no_response_48h",
                            },
                            idempotency_key=f"shared-pool-refund:{warmup_sent_id}",
                        )
                    except Exception as e:
                        logger.warning(
                            "settle_held: failed to refund sender %s for entry %s: %s",
                            sender_user_id, warmup_sent_id, e,
                        )
                        continue
                try:
                    await self.db.warmup_sent.update_one(
                        {"id": warmup_sent_id},
                        {"$set": {"credit_status": "settled_refunded", "credits_rewarded": 0, "updated_at": now}},
                    )
                except Exception as e:
                    logger.warning("settle_held: failed to mark settled_refunded for %s: %s", warmup_sent_id, e)
                refunded += 1

        if rewarded or refunded:
            logger.info("settle_held_shared_pool_credits: rewarded=%d refunded=%d", rewarded, refunded)
        return {"rewarded": rewarded, "refunded": refunded}

    async def run(self, max_sends_per_inbox_per_run: int = 3) -> Dict[str, int]:
        """
        Run one sender cycle: for all warming inboxes (platform-wide, no user filter), pick receivers,
        send warm-up emails, record in warmup_sent, increment sent_today.
        Uses human-like spacing between sends and between inboxes; isolates per-inbox errors.
        Returns dict with sent_count and error_count.
        """
        sent_count = 0
        error_count = 0

        # All inboxes on the platform that are warming and have capacity
        warming_inboxes = await self.db.inboxes.find(
            {
                "status": "warming",
                "auto_warmup": True,
                "$expr": {"$lt": ["$sent_today", "$daily_limit"]},
            }
        ).to_list(None)

        if not warming_inboxes:
            return {"sent_count": 0, "error_count": 0}

        user_ids = list({i.get("user_id") for i in warming_inboxes if i.get("user_id")})
        blocked_user_ids: Set[str] = set()
        if user_ids:
            try:
                cursor = self.db.users.find(
                    {"id": {"$in": user_ids}},
                    {"id": 1, "subscription_status": 1, "subscription_start": 1, "subscription_end": 1, "plan_id": 1},
                )
                async for u in cursor:
                    if u and user_subscription_blocks_outbound(u):
                        uid = u.get("id")
                        if uid:
                            blocked_user_ids.add(uid)
            except Exception as e:
                logger.warning("Warmup sender: subscription gate lookup failed: %s", e)

        if blocked_user_ids:
            warming_inboxes = [i for i in warming_inboxes if i.get("user_id") not in blocked_user_ids]

        if not warming_inboxes:
            return {"sent_count": 0, "error_count": 0}

        # Shuffle so we don't always process the same inboxes first (fairness + natural spread)
        random.shuffle(warming_inboxes)
        # Cap inboxes per run to avoid one huge burst and spread over multiple cycles
        warming_inboxes = warming_inboxes[:MAX_INBOXES_PER_RUN]

        # Active receiver accounts from platform pool (only needed for pool-mode inboxes)
        receivers = await self.admin_db.warmup_receiver_accounts.find(
            {"is_active": True}
        ).to_list(None)

        if not receivers:
            logger.warning("Warmup sender: no active receiver accounts in pool; network-mode inboxes will still run")

        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        receiver_ids = [r.get("id") for r in receivers if r.get("id")]
        receiver_seen_root_domains: Dict[str, set] = {}
        try:
            recent_global_sent = await self.db.warmup_sent.find(
                {
                    "sent_at": {"$gte": cutoff},
                    "receiver_account_id": {"$in": receiver_ids},
                },
                {"receiver_account_id": 1, "inbox_id": 1},
            ).to_list(None)
            recent_inbox_ids = list({
                row.get("inbox_id")
                for row in recent_global_sent
                if row.get("inbox_id")
            })
            inbox_root_by_id: Dict[str, str] = {}
            if recent_inbox_ids:
                recent_inboxes = await self.db.inboxes.find(
                    {"id": {"$in": recent_inbox_ids}},
                    {"id": 1, "email": 1},
                ).to_list(None)
                inbox_root_by_id = {
                    i.get("id"): _root_domain_from_email(i.get("email") or "")
                    for i in recent_inboxes
                    if i.get("id")
                }
            for row in recent_global_sent:
                receiver_id = row.get("receiver_account_id")
                sender_root = inbox_root_by_id.get(row.get("inbox_id"))
                if not receiver_id or not sender_root:
                    continue
                receiver_seen_root_domains.setdefault(receiver_id, set()).add(sender_root)
        except Exception as e:
            logger.warning("Warmup sender: failed to build receiver domain guard map: %s", e)

        for inbox_index, inbox in enumerate(warming_inboxes):
            # Human-like spacing: short delay before processing next inbox (except first)
            if inbox_index > 0:
                delay = random.uniform(
                    MIN_DELAY_BETWEEN_INBOXES_SEC, MAX_DELAY_BETWEEN_INBOXES_SEC
                )
                await asyncio.sleep(delay)

            try:
                inbox_id = inbox.get("id")
                user_id = inbox.get("user_id")
                if not inbox_id or not user_id:
                    continue
            except Exception:
                continue
            behavior_profile = await self._build_inbox_behavior_profile(inbox_id)

            # Branch: network (real engagement) vs hybrid vs pool (platform receivers)
            engagement_mode = inbox.get("warmup_engagement_mode") or "pool"
            if engagement_mode == "network":
                n_sent, n_err = await self._run_network_sends(
                    inbox=inbox,
                    inbox_id=inbox_id,
                    user_id=user_id,
                    behavior_profile=behavior_profile,
                    max_sends_per_inbox_per_run=max_sends_per_inbox_per_run,
                )
                sent_count += n_sent
                error_count += n_err
                continue  # skip pool logic

            if engagement_mode == "network_plus_shared":
                n_sent, n_err = await self._run_network_sends(
                    inbox=inbox,
                    inbox_id=inbox_id,
                    user_id=user_id,
                    behavior_profile=behavior_profile,
                    max_sends_per_inbox_per_run=max_sends_per_inbox_per_run,
                )
                sent_count += n_sent
                error_count += n_err
                inbox = dict(inbox)
                inbox["sent_today"] = int(inbox.get("sent_today", 0) or 0) + n_sent
                remaining_quota = max(0, max_sends_per_inbox_per_run - n_sent)
                if remaining_quota <= 0:
                    continue
                s_sent, s_err = await self._run_shared_pool_sends(
                    inbox=inbox,
                    inbox_id=inbox_id,
                    user_id=user_id,
                    behavior_profile=behavior_profile,
                    max_sends_per_inbox_per_run=remaining_quota,
                )
                sent_count += s_sent
                error_count += s_err
                continue

            if engagement_mode == "shared_pool":
                n_sent, n_err = await self._run_shared_pool_sends(
                    inbox=inbox,
                    inbox_id=inbox_id,
                    user_id=user_id,
                    behavior_profile=behavior_profile,
                    max_sends_per_inbox_per_run=max_sends_per_inbox_per_run,
                )
                sent_count += n_sent
                error_count += n_err
                continue

            if engagement_mode == "hybrid":
                # 60% real engagement via Warmup Network, 40% artificial pool
                network_quota = max(1, round(max_sends_per_inbox_per_run * 0.6))
                pool_quota = max(1, max_sends_per_inbox_per_run - network_quota)
                n_sent, n_err = await self._run_network_sends(
                    inbox=inbox,
                    inbox_id=inbox_id,
                    user_id=user_id,
                    behavior_profile=behavior_profile,
                    max_sends_per_inbox_per_run=network_quota,
                )
                sent_count += n_sent
                error_count += n_err
                # Reflect network sends in local sent_today so pool quota is accurate
                inbox = dict(inbox)
                inbox["sent_today"] = int(inbox.get("sent_today", 0) or 0) + n_sent
                _pool_max = pool_quota
                # Fall through to pool path below
            else:
                _pool_max = max_sends_per_inbox_per_run

            # Pool mode: require receivers
            if not receivers:
                continue

            sent_today = int(inbox.get("sent_today", 0) or 0)
            daily_limit = max(1, inbox.get("daily_limit", 50))
            remaining = daily_limit - sent_today
            if remaining <= 0:
                continue
            inbox_root_domain = _root_domain_from_email(inbox.get("email") or "")
            tz_name = (inbox.get("timezone") or DEFAULT_TZ).strip() if isinstance(inbox.get("timezone"), str) else DEFAULT_TZ
            start_hour = int(behavior_profile.get("active_start_hour") or 8)
            end_hour = int(behavior_profile.get("active_end_hour") or 21)
            now_for_schedule = datetime.now(timezone.utc)
            next_send_at = self._parse_dt_utc(inbox.get("warmup_next_send_at"))
            if next_send_at and next_send_at > now_for_schedule:
                continue
            if not self._in_human_window(now_for_schedule, tz_name, start_hour, end_hour):
                defer_to = self._next_window_start_utc(now_for_schedule, tz_name, start_hour)
                try:
                    await self.db.inboxes.update_one(
                        {"id": inbox_id},
                        {"$set": {"warmup_next_send_at": defer_to, "updated_at": now_for_schedule}},
                    )
                except Exception:
                    pass
                continue

            to_send = self._compute_due_send_quota(
                now_for_schedule,
                tz_name,
                behavior_profile,
                remaining,
                _pool_max,
            )
            if to_send <= 0:
                continue

            try:
                recent_sent = await self.db.warmup_sent.find(
                    {
                        "inbox_id": inbox_id,
                        "sent_at": {"$gte": cutoff},
                    }
                ).to_list(None)
            except Exception as e:
                logger.warning("Warmup sender: failed to load recent_sent for inbox %s: %s", inbox_id, e)
                continue

            recent_receiver_ids = {r["receiver_account_id"] for r in recent_sent}
            candidates = []
            for r in receivers:
                receiver_id = r.get("id")
                if receiver_id in recent_receiver_ids:
                    continue
                if inbox_root_domain and inbox_root_domain in receiver_seen_root_domains.get(receiver_id, set()):
                    # Prevent a receiver from getting multiple warmups from same root domain
                    # across different subdomains/accounts in the same recent window.
                    continue
                candidates.append(r)
            random.shuffle(candidates)
            scarcity_factor = self._receiver_scarcity_factor(len(receivers), len(candidates))
            if self._should_skip_cycle(behavior_profile, scarcity_factor):
                pause_minutes = self._compute_scarcity_pause_minutes(behavior_profile, scarcity_factor)
                try:
                    await self.db.inboxes.update_one(
                        {"id": inbox_id},
                        {
                            "$set": {
                                "warmup_next_send_at": now_for_schedule + timedelta(minutes=pause_minutes),
                                "updated_at": now_for_schedule,
                            }
                        },
                    )
                except Exception:
                    pass
                continue
            if not candidates:
                pause_minutes = self._compute_scarcity_pause_minutes(behavior_profile, scarcity_factor)
                try:
                    await self.db.inboxes.update_one(
                        {"id": inbox_id},
                        {
                            "$set": {
                                "warmup_next_send_at": now_for_schedule + timedelta(minutes=pause_minutes),
                                "updated_at": now_for_schedule,
                            }
                        },
                    )
                except Exception:
                    pass
                continue
            # Recompute quota with receiver scarcity so pool pressure reduces automatically.
            to_send = self._compute_due_send_quota(
                now_for_schedule,
                tz_name,
                behavior_profile,
                remaining,
                _pool_max,
                receiver_scarcity_factor=scarcity_factor,
            )
            to_send = min(to_send, len(candidates))

            try:
                templates = await self.db.warmup_send_templates.find(
                    {"user_id": user_id, "subject": {"$exists": True}, "body": {"$exists": True}}
                ).to_list(None)
            except Exception as e:
                logger.warning("Warmup sender: failed to load templates for user %s: %s", user_id, e)
                templates = []
            subjects_fb = WARMUP_SUBJECTS
            bodies_fb = WARMUP_BODIES
            used_template_keys_by_receiver: Dict[str, set] = {}

            for i in range(to_send):
                if i >= len(candidates):
                    break
                receiver = candidates[i]
                receiver_email = (receiver.get("email") or "").strip()
                receiver_account_id = receiver.get("id")
                if not receiver_email or not receiver_account_id:
                    continue
                if receiver_account_id not in used_template_keys_by_receiver:
                    used_template_keys_by_receiver[receiver_account_id] = await self._load_used_template_keys_for_receiver(
                        receiver_account_id
                    )
                used_template_keys = used_template_keys_by_receiver[receiver_account_id]

                # Human-like spacing: delay before this send (except first send of this inbox)
                if i > 0:
                    send_delay = random.uniform(
                        MIN_DELAY_BETWEEN_SENDS_SEC, MAX_DELAY_BETWEEN_SENDS_SEC
                    )
                    await asyncio.sleep(send_delay)

                message_id = str(uuid.uuid4())
                warmup_sent_id = str(uuid.uuid4())
                send_body_type = "plain"
                selected_template_key = ""
                if templates:
                    unused_templates = []
                    for t in templates:
                        t_subject = (t.get("subject") or "").strip() or "Hello"
                        t_body = (t.get("body") or "").strip() or "Hope you're well."
                        if self._template_pair_key(t_subject, t_body) not in used_template_keys:
                            unused_templates.append(t)
                    t = random.choice(unused_templates or templates)
                    subject = (t.get("subject") or "").strip() or "Hello"
                    body = (t.get("body") or "").strip() or "Hope you're well."
                    send_body_type = _warmup_send_body_type(t)
                    selected_template_key = self._template_pair_key(subject, body)
                else:
                    all_fallback_pairs = [(s, b) for s in subjects_fb for b in bodies_fb]
                    unused_pairs = [
                        (s, b)
                        for (s, b) in all_fallback_pairs
                        if self._template_pair_key(s, b) not in used_template_keys
                    ]
                    subject, body = random.choice(unused_pairs or all_fallback_pairs)
                    selected_template_key = self._template_pair_key(subject, body)
                thread_id = str(uuid.uuid4())
                turn_index = 0
                in_reply_to = None
                references = None
                active_thread = None

                now_utc = datetime.now(timezone.utc)
                # Continue existing thread sometimes to mimic realistic multi-turn chat.
                if self.multiturn_enabled and random.random() < 0.45:
                    active_thread = await self.db.warmup_threads.find_one(
                        {
                            "inbox_id": inbox_id,
                            "receiver_account_id": receiver_account_id,
                            "stage": {"$in": ["new", "active", "cooldown"]},
                        },
                        sort=[("updated_at", -1)],
                    )
                    if active_thread:
                        next_action_at = active_thread.get("next_action_at")
                        if next_action_at and next_action_at > now_utc:
                            continue
                        tz_name = active_thread.get("persona_timezone") or DEFAULT_TZ
                        if not self._in_human_window(
                            now_utc,
                            tz_name,
                            int(active_thread.get("active_start_hour") or 8),
                            int(active_thread.get("active_end_hour") or 21),
                        ):
                            continue
                        thread_id = active_thread["id"]
                        turn_index = int(active_thread.get("turn_count") or 1)
                        in_reply_to = active_thread.get("root_message_id")
                        references = in_reply_to
                        # Build style samples from user templates for follow-up tone.
                        style_samples = [t.get("body", "") for t in templates[:5]]
                        if self.warmup_llm_service:
                            history_docs = await self.db.warmup_messages.find(
                                {"thread_id": thread_id}
                            ).sort("sent_at", -1).limit(4).to_list(None)
                            history = [
                                {"role": d.get("role", "other"), "body": d.get("body", "")}
                                for d in reversed(history_docs)
                            ]
                            generated = await self.warmup_llm_service.generate_reply(
                                style_samples=style_samples,
                                thread_history=history,
                                turn_index=turn_index,
                                intent=self._select_sender_intent(active_thread, history),
                                banned_phrases=[h.get("body", "") for h in history[-3:]],
                            )
                            if generated.get("body"):
                                body = generated["body"]
                                send_body_type = "plain"
                        subject = f"Re: {active_thread.get('last_subject') or subject}"[:200]
                # For new thread starts, avoid unnatural overnight bursts.
                if turn_index == 0 and not self._in_human_window(now_utc, DEFAULT_TZ):
                    continue

                if self.email_service is not None:
                    try:
                        ctx = self._warmup_placeholder_contact(inbox, receiver)
                        subject = self.email_service.parse_spintax(subject or "")
                        body = self.email_service.parse_spintax(body or "")
                        subject = self.email_service.replace_placeholders(subject, ctx)
                        body = self.email_service.replace_placeholders(body, ctx)
                    except Exception as pe:
                        logger.warning(
                            "Warmup sender: spintax/placeholders failed for inbox %s: %s",
                            inbox_id,
                            pe,
                        )

                sender_type = inbox.get("sender_type", "smtp")
                try:
                    await self._warmup_assert_smtp_quota(user_id, inbox)
                    if sender_type == "gmail":
                        if inbox.get("gmail_auth_method") == "app_password":
                            await self.smtp_service.send_email_via_smtp_gmail_app_password(
                                inbox_id,
                                receiver_email,
                                subject,
                                body,
                                tracking_pixel_url=None,
                                reply_to_email=None,
                                outbound_message_id=message_id,
                                in_reply_to=in_reply_to,
                                references=references,
                                body_type=send_body_type,
                            )
                        else:
                            await self.gmail_service.send_email(
                                inbox_id,
                                user_id,
                                receiver_email,
                                subject,
                                body,
                                tracking_pixel_url=None,
                                body_type=send_body_type,
                                outbound_message_id=message_id,
                                in_reply_to=in_reply_to,
                                references=references,
                            )
                    else:
                        await self.smtp_service.send_email_via_smtp(
                            inbox_id,
                            receiver_email,
                            subject,
                            body,
                            tracking_pixel_url=None,
                            reply_to_email=None,
                            outbound_message_id=message_id,
                            in_reply_to=in_reply_to,
                            references=references,
                            body_type=send_body_type,
                        )
                    await self._warmup_meter_send(user_id, inbox, receiver_email, subject, message_id)
                except MonthlySmtpQuotaExceeded:
                    logger.warning(
                        "Warmup sender (pool): SMTP monthly quota reached for user %s; stopping pool sends for this inbox",
                        user_id,
                    )
                    error_count += 1
                    break
                except Exception as e:
                    logger.exception(
                        "Warmup sender: failed to send from inbox %s to %s: %s",
                        inbox_id,
                        receiver_email,
                        e,
                    )
                    error_count += 1
                    continue

                now = datetime.now(timezone.utc)
                try:
                    await self.db.warmup_sent.insert_one({
                        "id": warmup_sent_id,
                        "inbox_id": inbox_id,
                        "user_id": user_id,
                        "receiver_account_id": receiver_account_id,
                        "engagement_mode": "pool",
                        "receiver_email": receiver_email,
                        "thread_id": thread_id,
                        "turn_index": turn_index,
                        "message_id": message_id,
                        "subject": subject,
                        "reply_generation_source": "groq" if turn_index > 0 else None,
                        "reply_quality_score": None,
                        "sent_at": now,
                        "opened_at": None,
                        "replied_at": None,
                        "link_clicked_at": None,
                        "receiver_message_uid": None,
                        "receiver_gmail_id": None,
                        "created_at": now,
                        "updated_at": now,
                    })
                    await self.db.warmup_messages.insert_one({
                        "id": str(uuid.uuid4()),
                        "thread_id": thread_id,
                        "inbox_id": inbox_id,
                        "user_id": user_id,
                        "receiver_account_id": receiver_account_id,
                        "role": "inbox",
                        "message_id": message_id,
                        "in_reply_to": in_reply_to,
                        "references": references,
                        "subject": subject,
                        "body": body,
                        "from_email": inbox.get("email"),
                        "to_email": receiver_email,
                        "provider": sender_type,
                        "sent_at": now,
                        "created_at": now,
                        "updated_at": now,
                    })
                    max_turns = random.randint(2, 6)
                    await self.db.warmup_threads.update_one(
                        {"id": thread_id},
                        {
                            "$set": {
                                "inbox_id": inbox_id,
                                "user_id": user_id,
                                "receiver_account_id": receiver_account_id,
                                "receiver_email": receiver_email,
                                "root_message_id": in_reply_to or message_id,
                                "stage": "active",
                                "turn_count": turn_index + 1,
                                "max_turns": max_turns,
                                "persona_timezone": (active_thread or {}).get("persona_timezone", DEFAULT_TZ),
                                "active_start_hour": (active_thread or {}).get("active_start_hour", behavior_profile.get("active_start_hour", random.randint(7, 10))),
                                "active_end_hour": (active_thread or {}).get("active_end_hour", behavior_profile.get("active_end_hour", random.randint(18, 22))),
                                "turn_dropoff_chance": (active_thread or {}).get("turn_dropoff_chance", behavior_profile.get("turn_dropoff_chance", round(random.uniform(0.15, 0.45), 2))),
                                "last_sender_role": "inbox",
                                "last_subject": subject,
                                "last_activity_at": now,
                                "next_action_at": now + timedelta(
                                    minutes=random.randint(
                                        int(behavior_profile.get("next_action_min", 120)),
                                        int(behavior_profile.get("next_action_max", 720)),
                                    )
                                ),
                                "updated_at": now,
                            },
                            "$setOnInsert": {
                                "created_at": now,
                                "started_at": now,
                            },
                        },
                        upsert=True,
                    )
                except Exception as e:
                    logger.exception("Warmup sender: failed to insert warmup_sent: %s", e)
                    error_count += 1
                    continue
                if selected_template_key:
                    used_template_keys.add(selected_template_key)

                try:
                    next_scheduled_at = self._compute_next_warmup_send_at(
                        now,
                        tz_name,
                        behavior_profile,
                        daily_limit,
                        sent_today_after_send=sent_today + 1,
                        receiver_scarcity_factor=scarcity_factor,
                    )
                    await self.db.inboxes.update_one(
                        {"id": inbox_id},
                        {
                            "$inc": {"sent_today": 1},
                            "$set": {
                                "warmup_last_sent_at": now,
                                "warmup_next_send_at": next_scheduled_at,
                                "updated_at": now,
                            },
                        },
                    )
                    sent_today += 1
                except Exception as e:
                    logger.warning("Warmup sender: failed to update sent_today for inbox %s: %s", inbox_id, e)

                sent_count += 1

                try:
                    await self.admin_db.warmup_receiver_accounts.update_one(
                        {"id": receiver_account_id},
                        {"$set": {"last_used_at": now, "updated_at": now}},
                    )
                except Exception as e:
                    pass  # Non-critical
                if inbox_root_domain:
                    receiver_seen_root_domains.setdefault(receiver_account_id, set()).add(inbox_root_domain)

        return {"sent_count": sent_count, "error_count": error_count}

    async def quick_send(
        self,
        user_id: str,
        inbox_id: str,
        recipient_email: str,
        subject_override: Optional[str] = None,
        body_override: Optional[str] = None,
        body_type_override: Optional[str] = None,
    ) -> str:
        """Send a single warmup email immediately to a specific recipient (Quick Engagement).
        Returns the warmup_sent id for status tracking.
        """
        inbox = await self.db.inboxes.find_one({"id": inbox_id, "user_id": user_id})
        if not inbox:
            raise ValueError("Inbox not found")

        em = recipient_email.strip().lower()
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        receive_counts = await self._warmup_inbound_counts_by_receiver_for_owner(user_id, cutoff)
        cap = await self._get_network_contact_daily_limit(user_id)
        if receive_counts.get(em, 0) >= cap:
            raise ValueError(
                f"Daily receive limit ({cap} per contact per 24h) reached for this address. "
                "Increase the limit under Warmup → My Network or try again later."
            )

        templates = []
        try:
            templates = await self.db.warmup_send_templates.find(
                {"user_id": user_id, "subject": {"$exists": True}, "body": {"$exists": True}}
            ).to_list(None)
        except Exception:
            pass

        if subject_override is not None or body_override is not None:
            subject = (subject_override or "").strip() or "Quick check-in"
            body = (body_override or "").strip() or "Warmup probe."
            send_body_type = (body_type_override or "plain").strip().lower()
            if send_body_type not in ("plain", "html"):
                send_body_type = "plain"
        elif templates:
            t = random.choice(templates)
            subject = (t.get("subject") or "").strip() or "Hello"
            body = (t.get("body") or "").strip() or "Hope you're well."
            send_body_type = _warmup_send_body_type(t)
        else:
            subject = random.choice(WARMUP_SUBJECTS)
            body = random.choice(WARMUP_BODIES)
            send_body_type = "plain"

        if self.email_service is not None:
            try:
                ctx = self._warmup_placeholder_contact(inbox, {"email": recipient_email})
                subject = self.email_service.parse_spintax(subject)
                body = self.email_service.parse_spintax(body)
                subject = self.email_service.replace_placeholders(subject, ctx)
                body = self.email_service.replace_placeholders(body, ctx)
            except Exception as e:
                logger.warning("Quick send: placeholder/spintax failed for inbox %s: %s", inbox_id, e)

        warmup_sent_id = str(uuid.uuid4())
        message_id = str(uuid.uuid4())
        sender_type = inbox.get("sender_type", "smtp")
        try:
            await self._warmup_assert_smtp_quota(user_id, inbox)
            if sender_type == "gmail":
                if inbox.get("gmail_auth_method") == "app_password":
                    await self.smtp_service.send_email_via_smtp_gmail_app_password(
                        inbox_id, recipient_email, subject, body,
                        tracking_pixel_url=None, reply_to_email=None,
                        outbound_message_id=message_id, body_type=send_body_type,
                    )
                else:
                    await self.gmail_service.send_email(
                        inbox_id, user_id, recipient_email, subject, body,
                        tracking_pixel_url=None, body_type=send_body_type,
                        outbound_message_id=message_id,
                    )
            else:
                await self.smtp_service.send_email_via_smtp(
                    inbox_id, recipient_email, subject, body,
                    tracking_pixel_url=None, reply_to_email=None,
                    outbound_message_id=message_id, body_type=send_body_type,
                )
            await self._warmup_meter_send(user_id, inbox, recipient_email, subject, message_id)
        except MonthlySmtpQuotaExceeded:
            raise
        except Exception as e:
            logger.exception("Quick send: failed from inbox %s to %s: %s", inbox_id, recipient_email, e)
            raise

        now = datetime.now(timezone.utc)
        try:
            await self.db.warmup_sent.insert_one({
                "id": warmup_sent_id,
                "inbox_id": inbox_id,
                "user_id": user_id,
                "receiver_account_id": None,
                "engagement_mode": "quick",
                "receiver_email": recipient_email,
                "thread_id": str(uuid.uuid4()),
                "turn_index": 0,
                "message_id": message_id,
                "subject": subject,
                "reply_generation_source": None,
                "reply_quality_score": None,
                "sent_at": now,
                "opened_at": None,
                "replied_at": None,
                "link_clicked_at": None,
                "receiver_message_uid": None,
                "receiver_gmail_id": None,
                "created_at": now,
                "updated_at": now,
            })
        except Exception as e:
            logger.warning("Quick send: failed to record warmup_sent: %s", e)
        return warmup_sent_id
