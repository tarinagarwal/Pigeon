"""Plan and subscription limits: lookup plans, resolve user limits, count usage."""
import os
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

DEFAULT_PLAN_ID = "free"
UNLIMITED = -1

MONTHLY_SMTP_QUOTA_MESSAGE = "Monthly SMTP email limit reached for your plan."


class MonthlySmtpQuotaExceeded(Exception):
    """Raised when the user has reached max_monthly_smtp_emails for the current billing window."""

    def __init__(self, message: str = MONTHLY_SMTP_QUOTA_MESSAGE):
        self.message = message
        super().__init__(message)


def subscription_blocks_outbound(subscription_status: Optional[str]) -> bool:
    """True when outbound campaign / marketing email must not send (e.g. Razorpay subscription pending)."""
    return (subscription_status or "").strip().lower() == "pending"


def _parse_user_calendar_date(val: Any) -> Optional[date]:
    """Parse subscription_start / subscription_end from DB (ISO date string or datetime)."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.astimezone(timezone.utc).date()
    if isinstance(val, date):
        return val
    s = str(val).strip()
    if not s:
        return None
    try:
        if "T" in s:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def paid_tier_billing_period_ended(user: Dict[str, Any]) -> bool:
    """True when user still has a non-free plan_id in DB but subscription_end (To) is in the past (UTC)."""
    pid = (user.get("plan_id") or "").strip().lower()
    if not pid or pid == "free":
        return False
    end_d = _parse_user_calendar_date(user.get("subscription_end"))
    if end_d is None:
        return False
    today = datetime.now(timezone.utc).date()
    return today > end_d


def cancelled_paid_period_ended(user: Dict[str, Any]) -> bool:
    """True when subscription is cancelled and paid access past subscription_end (ignore From-in-future quirks).

    Cancelled users keep access until To; we do not block because From is missing or still in the future.
    """
    status = (user.get("subscription_status") or "").strip().lower()
    if status != "cancelled":
        return False
    return paid_tier_billing_period_ended(user)


def subscription_outside_paid_window(
    subscription_start: Any,
    subscription_end: Any,
    *,
    plan_id: Optional[str],
) -> bool:
    """True when today (UTC) is after subscription_end for a non-free plan.

    Second gate after pending: uses billing To date. Skipped for free/no plan so casual users are not blocked.
    Not used when status is cancelled — see cancelled_paid_period_ended instead.
    """
    pid = (plan_id or "").strip().lower()
    if not pid or pid == "free":
        return False
    end_d = _parse_user_calendar_date(subscription_end)
    if end_d is None:
        return False
    today = datetime.now(timezone.utc).date()
    if end_d is not None and today > end_d:
        return True
    return False


def user_had_successful_subscription_charge(user: Optional[Dict[str, Any]]) -> bool:
    """True if we have evidence of at least one successful subscription payment (Razorpay or Lemon)."""
    if not user:
        return False
    if user.get("billing_last_paid_at"):
        return True
    return bool(user.get("billing_has_successful_subscription_charge"))


def user_entitled_to_paid_plan_limits(user: Optional[Dict[str, Any]]) -> bool:
    """False when plan_id is paid in DB but the user must not receive paid limits (Razorpay pre-charge, cancelled without payment, etc.)."""
    if not user:
        return False
    plan_id = (user.get("plan_id") or "").strip().lower()
    if not plan_id or plan_id == DEFAULT_PLAN_ID:
        return True

    status = (user.get("subscription_status") or "").strip().lower()
    lemon_sub = (user.get("lemon_squeezy_subscription_id") or "").strip()
    had_charge = user_had_successful_subscription_charge(user)

    # Lemon Squeezy tenants: plan + LS webhooks remain source of truth (do not apply Razorpay gates).
    if lemon_sub and not (user.get("razorpay_subscription_id") or "").strip():
        return True

    if status == "active":
        return True
    if status == "trial":
        return True
    if status in ("authenticated", "created", "pending"):
        return had_charge
    if status == "cancelled":
        if not had_charge:
            return False
        return not cancelled_paid_period_ended(user)
    if status == "halted":
        if not had_charge:
            return False
        return not paid_tier_billing_period_ended(user)
    if status in ("past_due", "expired"):
        if not had_charge:
            return False
        return not paid_tier_billing_period_ended(user)
    return True


async def sync_stored_plan_with_entitlements_if_needed(db, user: Dict[str, Any]) -> Dict[str, Any]:
    """If MongoDB has a paid plan_id but the user is not entitled to paid limits, persist free tier fields.

    Aligns DB with Razorpay/app rules so admin and API do not disagree (e.g. cancelled without payment).
    """
    if not user:
        return user
    uid = user.get("id")
    if not uid:
        return user
    pid = (user.get("plan_id") or "").strip().lower()
    if not pid or pid == DEFAULT_PLAN_ID:
        return user
    if user_entitled_to_paid_plan_limits(user):
        return user
    now = datetime.now(timezone.utc)
    await db.users.update_one(
        {"id": uid},
        {
            "$set": {
                "plan_id": DEFAULT_PLAN_ID,
                "subscription_start": None,
                "subscription_end": None,
                "updated_at": now,
            }
        },
    )
    out = dict(user)
    out["plan_id"] = DEFAULT_PLAN_ID
    out["subscription_start"] = None
    out["subscription_end"] = None
    return out


def user_subscription_blocks_outbound(user: Optional[Dict[str, Any]]) -> bool:
    """Block campaign/test outbound: pending; or cancelled after paid To; else outside active From/To window."""
    if not user:
        return False
    if subscription_blocks_outbound(user.get("subscription_status")):
        return True
    status = (user.get("subscription_status") or "").strip().lower()
    if status == "cancelled":
        # Do not use generic From/To (avoids blocking when From is future/stale); only block after To.
        return cancelled_paid_period_ended(user)
    if subscription_outside_paid_window(
        user.get("subscription_start"),
        user.get("subscription_end"),
        plan_id=user.get("plan_id"),
    ):
        return True
    return False


def outbound_subscription_block_message(user: Optional[Dict[str, Any]]) -> Optional[str]:
    """User-facing reason to show when sends are blocked, or None if not blocked."""
    if not user or not user_subscription_blocks_outbound(user):
        return None
    if subscription_blocks_outbound(user.get("subscription_status")):
        return (
            "Your subscription payment is pending. Update billing in Settings → Billing to send email."
        )
    if cancelled_paid_period_ended(user):
        return (
            "Your subscription is cancelled and the current billing period has ended. "
            "Renew in Settings → Billing to send email."
        )
    return (
        "Your subscription is outside the current billing period (From/To dates). "
        "Check Settings → Billing to renew or fix your plan before sending."
    )


class PlanService:
    def __init__(self, db, admin_db):
        self.db = db
        self.admin_db = admin_db

    async def get_plan_by_id(self, plan_id: str) -> Optional[Dict[str, Any]]:
        """Return plan document from admin_db.plans or None."""
        if not plan_id:
            return None
        doc = await self.admin_db.plans.find_one({"id": plan_id}, {"_id": 0})
        return doc

    async def get_paid_plan_ids(self) -> List[str]:
        """Return list of plan ids that are payable (exist in DB and are not free).
        Used by billing routes to validate plan_id; no need to hardcode PAID_PLANS.
        Returns lowercase ids for consistent comparison with request body."""
        cursor = self.admin_db.plans.find(
            {"id": {"$exists": True, "$ne": ""}},
            {"_id": 0, "id": 1},
        )
        ids = []
        async for doc in cursor:
            plan_id = (doc.get("id") or "").strip()
            if plan_id and plan_id.lower() != "free":
                ids.append(plan_id.lower())
        return ids

    async def get_razorpay_plan_id_from_plan(self, plan_id: str, annual: bool) -> Optional[str]:
        """Get Razorpay plan id from plan document (razorpay_plan_id_monthly or razorpay_plan_id_annual). Returns None if not set."""
        plan = await self.get_plan_by_id(plan_id)
        if not plan:
            return None
        key = "razorpay_plan_id_annual" if annual else "razorpay_plan_id_monthly"
        value = (plan.get(key) or "").strip() or None
        return value

    async def get_app_plan_id_from_razorpay_plan(self, razorpay_plan_id: str) -> tuple[Optional[str], bool]:
        """Reverse map Razorpay plan id to (app plan id, is_annual). Scans admin_db.plans. Returns (None, False) if not found."""
        rp_id = (razorpay_plan_id or "").strip()
        if not rp_id:
            return None, False
        cursor = self.admin_db.plans.find({}, {"_id": 0, "id": 1, "razorpay_plan_id_monthly": 1, "razorpay_plan_id_annual": 1})
        async for plan in cursor:
            if (plan.get("razorpay_plan_id_monthly") or "").strip() == rp_id:
                return (plan.get("id") or "").strip() or None, False
            if (plan.get("razorpay_plan_id_annual") or "").strip() == rp_id:
                return (plan.get("id") or "").strip() or None, True
        return None, False

    async def get_lemon_squeezy_variant_id_from_plan(self, plan_id: str, annual: bool) -> Optional[str]:
        """Get Lemon Squeezy variant id from plan document (lemon_squeezy_variant_id_monthly/annual). Fallback to env LEMONSQUEEZY_VARIANT_<PLAN>_MONTHLY/ANNUAL."""
        plan = await self.get_plan_by_id(plan_id)
        if plan:
            key = "lemon_squeezy_variant_id_annual" if annual else "lemon_squeezy_variant_id_monthly"
            value = (plan.get(key) or "").strip() or None
            if value:
                return value
        name = (plan_id or "").strip().upper().replace("-", "_")
        if not name or name in ("FREE", "ENTERPRISE", "CUSTOM"):
            return None
        env_key = f"LEMONSQUEEZY_VARIANT_{name}_ANNUAL" if annual else f"LEMONSQUEEZY_VARIANT_{name}_MONTHLY"
        return (os.getenv(env_key) or "").strip() or None

    async def get_app_plan_id_from_lemon_squeezy_variant(self, variant_id: str) -> tuple[Optional[str], bool]:
        """Reverse map Lemon Squeezy variant id to (app plan id, is_annual). Scans admin_db.plans then env. Returns (None, False) if not found."""
        v_id = (variant_id or "").strip()
        if not v_id:
            return None, False
        cursor = self.admin_db.plans.find(
            {}, {"_id": 0, "id": 1, "lemon_squeezy_variant_id_monthly": 1, "lemon_squeezy_variant_id_annual": 1}
        )
        async for plan in cursor:
            if (plan.get("lemon_squeezy_variant_id_monthly") or "").strip() == v_id:
                return (plan.get("id") or "").strip() or None, False
            if (plan.get("lemon_squeezy_variant_id_annual") or "").strip() == v_id:
                return (plan.get("id") or "").strip() or None, True
        for name in ("STARTER", "GROWTH", "PRO", "SCALE"):
            if (os.getenv(f"LEMONSQUEEZY_VARIANT_{name}_MONTHLY", "").strip() or None) == v_id:
                return name.lower(), False
            if (os.getenv(f"LEMONSQUEEZY_VARIANT_{name}_ANNUAL", "").strip() or None) == v_id:
                return name.lower(), True
        return None, False

    async def get_user_plan(self, user: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Return plan document for the user. Uses free tier when not entitled to paid limits."""
        plan_id = (user or {}).get("plan_id") or DEFAULT_PLAN_ID
        if str(plan_id).lower() != DEFAULT_PLAN_ID and not user_entitled_to_paid_plan_limits(user):
            plan_id = DEFAULT_PLAN_ID
        plan = await self.get_plan_by_id(plan_id)
        if plan is not None:
            return plan
        return await self.get_plan_by_id(DEFAULT_PLAN_ID)

    def _limit_value(self, plan: Optional[Dict], key: str, default: int) -> int:
        """Get numeric limit from plan; -1 means unlimited."""
        if not plan:
            return default
        v = plan.get(key)
        if v is None:
            return default
        if isinstance(v, int):
            return v
        if isinstance(v, str) and v.lower() in ("custom", "unlimited", "—", ""):
            return UNLIMITED
        try:
            return int(v)
        except (TypeError, ValueError):
            return default

    async def get_user_limits(self, user: Dict[str, Any]) -> Dict[str, Any]:
        """Return effective limits for user (max_domains, max_subdomains, etc.). -1 = unlimited.

        IMPORTANT:
        - max_subdomains controls how many domain-based (SMTP) inboxes you can create.
        - max_google_accounts controls how many Gmail/Google inboxes you can connect.
        These are intentionally kept separate for billing and usage.
        """
        plan = await self.get_user_plan(user)

        # Defaults when no plan is found – mirror the "free" tier semantics.
        if not plan:
            base_limits = {
                "max_domains": 1,
                "max_subdomains": 1,
                "max_google_accounts": 0,
                "max_campaigns": 1,
                "max_monthly_smtp_emails": -1,
                "warmup": False,
            }
        else:
            base_limits = {
                "max_domains": self._limit_value(plan, "max_domains", 1),
                "max_subdomains": self._limit_value(plan, "max_subdomains", 1),
                "max_google_accounts": self._limit_value(plan, "max_google_accounts", 0),
                "max_campaigns": self._limit_value(plan, "max_campaigns", 1),
                "max_monthly_smtp_emails": self._limit_value(plan, "max_monthly_smtp_emails", -1),
                "warmup": bool(plan.get("warmup", False)),
            }

        # Per-user bonus limits (admin-only override), applied only when the user
        # is on a non-free plan. This lets support increase capacity for a single
        # tenant without modifying the underlying plan document.
        plan_id = (user or {}).get("plan_id") or DEFAULT_PLAN_ID
        is_paid_plan = user_entitled_to_paid_plan_limits(user) and str(plan_id).lower() != DEFAULT_PLAN_ID

        if is_paid_plan:
            # Map from user.extra_* field -> base_limits key
            bonus_map = {
                "extra_max_domains": "max_domains",
                "extra_max_subdomains": "max_subdomains",
                "extra_max_google_accounts": "max_google_accounts",
                "extra_max_campaigns": "max_campaigns",
                "extra_max_monthly_smtp_emails": "max_monthly_smtp_emails",
            }

            for bonus_field, limit_key in bonus_map.items():
                try:
                    raw_bonus = (user or {}).get(bonus_field)
                    bonus = int(raw_bonus) if raw_bonus is not None else 0
                except (TypeError, ValueError):
                    bonus = 0
                current = base_limits.get(limit_key, 0)
                # If the plan is unlimited for this key, keep it unlimited.
                if current == UNLIMITED or bonus <= 0:
                    continue
                base_limits[limit_key] = max(0, current + bonus)

        return base_limits

    async def monthly_smtp_emails_sent(self, user_id: str) -> int:
        """Return number of SMTP emails sent by this user in the current billing period.

        The billing period is determined as:
        - If the user has subscription_start/subscription_end forming a ~monthly cycle
          (20–45 days apart, as returned by the billing provider), use subscription_start
          (midnight UTC) as the window start.
        - Otherwise, fall back to the current calendar month (UTC) for backwards compatibility
          and for non-recurring / yearly / free users.
        """
        now = datetime.now(timezone.utc)
        period_start = None

        try:
            user = await self.db.users.find_one(
                {"id": user_id},
                {"_id": 0, "subscription_start": 1, "subscription_end": 1},
            )
        except Exception:
            user = None

        if user:
            start_str = (user.get("subscription_start") or "").strip() or None
            end_str = (user.get("subscription_end") or "").strip() or None
            if start_str and end_str:
                try:
                    start_date = datetime.strptime(start_str, "%Y-%m-%d").date()
                    end_date = datetime.strptime(end_str, "%Y-%m-%d").date()
                    delta_days = (end_date - start_date).days
                    # Treat ~30-day windows as a monthly billing cycle; anything much shorter/longer
                    # (e.g. trials, annual terms) will fall back to calendar-month behaviour.
                    if 20 <= delta_days <= 45:
                        period_start = datetime.combine(
                            start_date, datetime.min.time()
                        ).replace(tzinfo=timezone.utc)
                except Exception:
                    period_start = None

        if period_start is None:
            period_start = now.replace(
                day=1, hour=0, minute=0, second=0, microsecond=0
            )

        # Count domain SMTP sends and Gmail app-password sends (SMTP transport), via sender_type or flag.
        return await self.db.email_logs.count_documents(
            {
                "user_id": user_id,
                "status": "sent",
                "sent_at": {"$gte": period_start},
                "$or": [
                    {"sender_type": "smtp"},
                    {"counts_as_smtp": True},
                ],
            }
        )

    async def assert_monthly_smtp_quota(self, user_id: str) -> None:
        """Raise MonthlySmtpQuotaExceeded if the user is at or over max_monthly_smtp_emails (-1 = unlimited)."""
        user = await self.db.users.find_one({"id": user_id}, {"_id": 0})
        if not user:
            return
        limits = await self.get_user_limits(user)
        max_monthly = limits.get("max_monthly_smtp_emails", -1)
        if max_monthly is None or max_monthly == UNLIMITED:
            return
        sent_this_month = await self.monthly_smtp_emails_sent(user_id)
        if sent_this_month >= max_monthly:
            raise MonthlySmtpQuotaExceeded()

    async def domains_count(self, user_id: str) -> int:
        return await self.db.domains.count_documents({"user_id": user_id})

    async def subdomains_count(self, user_id: str) -> int:
        cursor = self.db.domains.find({"user_id": user_id}, {"id": 1})
        domain_ids = [d["id"] async for d in cursor]
        if not domain_ids:
            return 0
        return await self.db.subdomains.count_documents(
            {"domain_id": {"$in": domain_ids}}
        )

    async def campaigns_count(self, user_id: str) -> int:
        return await self.db.campaigns.count_documents({"user_id": user_id})

    async def active_campaigns_count(self, user_id: str) -> int:
        """Return number of campaigns that are currently active (running) for this user."""
        return await self.db.campaigns.count_documents(
            {"user_id": user_id, "status": "active"}
        )

    async def inboxes_count(self, user_id: str) -> int:
        """Total inboxes (SMTP + Gmail) for backward compatibility."""
        return await self.db.inboxes.count_documents({"user_id": user_id})

    async def smtp_inboxes_count(self, user_id: str) -> int:
        """Domain-based (SMTP) inboxes only."""
        return await self.db.inboxes.count_documents(
            {"user_id": user_id, "sender_type": "smtp"}
        )

    async def gmail_inboxes_count(self, user_id: str) -> int:
        """Gmail/Google inboxes only."""
        return await self.db.inboxes.count_documents(
            {"user_id": user_id, "sender_type": "gmail"}
        )

    async def daily_emails_sent(self, user_id: str) -> int:
        today_start = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        return await self.db.email_logs.count_documents(
            {
                "user_id": user_id,
                "status": "sent",
                "sent_at": {"$gte": today_start},
            }
        )

    async def monthly_gmail_emails_sent(self, user_id: str) -> int:
        """Return number of Gmail emails sent by this user in the current billing period.

        Uses the same billing-period detection as monthly_smtp_emails_sent so that UI
        and analytics remain consistent with enforcement logic.
        """
        now = datetime.now(timezone.utc)
        period_start = None

        try:
            user = await self.db.users.find_one(
                {"id": user_id},
                {"_id": 0, "subscription_start": 1, "subscription_end": 1},
            )
        except Exception:
            user = None

        if user:
            start_str = (user.get("subscription_start") or "").strip() or None
            end_str = (user.get("subscription_end") or "").strip() or None
            if start_str and end_str:
                try:
                    start_date = datetime.strptime(start_str, "%Y-%m-%d").date()
                    end_date = datetime.strptime(end_str, "%Y-%m-%d").date()
                    delta_days = (end_date - start_date).days
                    if 20 <= delta_days <= 45:
                        period_start = datetime.combine(
                            start_date, datetime.min.time()
                        ).replace(tzinfo=timezone.utc)
                except Exception:
                    period_start = None

        if period_start is None:
            period_start = now.replace(
                day=1, hour=0, minute=0, second=0, microsecond=0
            )

        return await self.db.email_logs.count_documents(
            {
                "user_id": user_id,
                "status": "sent",
                "sender_type": "gmail",
                "sent_at": {"$gte": period_start},
            }
        )

    async def get_usage(self, user_id: str) -> Dict[str, int]:
        """Return current usage counts for user."""
        smtp_inboxes = await self.smtp_inboxes_count(user_id)
        gmail_inboxes = await self.gmail_inboxes_count(user_id)
        campaigns_total = await self.campaigns_count(user_id)
        campaigns_active = await self.active_campaigns_count(user_id)
        smtp_month = await self.monthly_smtp_emails_sent(user_id)
        gmail_month = await self.monthly_gmail_emails_sent(user_id)
        return {
            "domains": await self.domains_count(user_id),
            "subdomains": await self.subdomains_count(user_id),
            # For backward compatibility, keep total campaigns under `campaigns`,
            # but also expose `active_campaigns` and `campaigns_active` for
            # concurrent-campaign plan enforcement and UI.
            "campaigns": campaigns_total,
            "campaigns_total": campaigns_total,
            "active_campaigns": campaigns_active,
            "campaigns_active": campaigns_active,
            # Keep total inboxes for existing UI, but also expose split usage.
            "inboxes": smtp_inboxes + gmail_inboxes,
            "smtp_inboxes": smtp_inboxes,
            "gmail_inboxes": gmail_inboxes,
            "emails_today": await self.daily_emails_sent(user_id),
            "smtp_emails_month": smtp_month,
            "gmail_emails_month": gmail_month,
        }
