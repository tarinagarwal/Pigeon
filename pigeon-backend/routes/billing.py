"""Billing routes: Razorpay (India) and Lemon Squeezy (international) subscription create, webhooks."""
import json
import logging
import os
import uuid
from datetime import datetime, timezone, date, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request

from database import db
from routes.dependencies import get_current_user
from routes.region import get_region_from_request
from services.billing_webhook_log_service import flush_billing_webhook_log
from services.credit_service import CreditService
from services.email_templates import subscription_payment_failed_notification
from services.plan_service import user_had_successful_subscription_charge, user_subscription_blocks_outbound
from services.lemonsqueezy_service import LemonSqueezyService
from services.razorpay_service import get_razorpay_service

router = APIRouter(prefix="/billing", tags=["billing"])
logger = logging.getLogger(__name__)

# Plan service is optional; when set, Razorpay/Lemon Squeezy plan IDs are read from DB with env fallback.
_plan_service = None
_lemonsqueezy_service = None
lifecycle_automation_service = None
_billing_notification_service = None
_billing_automation_service = None
_credit_service = CreditService(db)

_PAYMENT_FAILURE_EMAIL_COOLDOWN_HOURS = 24

CREDIT_TOPUP_CREDITS = 900
CREDIT_TOPUP_INR_SUBUNITS = 1000 * 100
CREDIT_TOPUP_USD_CENTS = 10 * 100
CREDIT_TOPUP_LEMON_VARIANT_ENV = "LEMONSQUEEZY_VARIANT_CREDIT_TOPUP"


def init_plan_service(service):
    global _plan_service
    _plan_service = service


def init_lemonsqueezy_service(service):
    global _lemonsqueezy_service
    _lemonsqueezy_service = service


def init_lifecycle_automation_service(service):
    """Inject lifecycle automation service."""
    global lifecycle_automation_service
    lifecycle_automation_service = service


def init_billing_notification_service(service):
    global _billing_notification_service
    _billing_notification_service = service


def init_billing_automation_service(service):
    global _billing_automation_service
    _billing_automation_service = service


async def _pause_campaigns_if_outbound_blocked(user_id: str) -> None:
    """Pause active campaigns and warming inboxes when user is pending or outside paid From/To window."""
    try:
        user = await db.users.find_one(
            {"id": user_id},
            {"subscription_status": 1, "subscription_start": 1, "subscription_end": 1, "plan_id": 1},
        )
        if not user or not user_subscription_blocks_outbound(user):
            return
        now = datetime.now(timezone.utc)
        inbox_result = await db.inboxes.update_many(
            {"user_id": user_id, "status": "warming"},
            {"$set": {"status": "paused", "auto_warmup": False, "updated_at": now}},
        )
        if inbox_result.modified_count:
            logger.info(
                "Paused %d warming inbox(es) for user_id=%s (subscription outbound gate)",
                inbox_result.modified_count,
                user_id,
            )
        if _billing_automation_service:
            await _billing_automation_service.pause_all_active_campaigns_for_user(user_id)
    except Exception:
        logger.exception(
            "Failed to pause campaigns/warmup for subscription gate (user_id=%s)", user_id
        )


async def _emit_payment_confirmed(user_id: str, source: str, cycle_end: str | None = None) -> None:
    """Best-effort lifecycle event for paid conversion."""
    if not lifecycle_automation_service:
        return
    try:
        await lifecycle_automation_service.emit_event(
            user_id,
            "payment_confirmed",
            {"source": source, "cycle_end": cycle_end} if cycle_end else {"source": source},
        )
    except Exception:
        logger.exception("Failed to emit lifecycle payment_confirmed for user %s", user_id)


async def _emit_subscription_renewed(user_id: str, source: str, cycle_end: str | None = None) -> None:
    """Best-effort lifecycle event for subscription renewal."""
    if not lifecycle_automation_service:
        return
    try:
        payload = {"source": source}
        if cycle_end:
            payload["cycle_end"] = cycle_end
        await lifecycle_automation_service.emit_event(user_id, "subscription_renewed", payload)
    except Exception:
        logger.exception("Failed to emit lifecycle subscription_renewed for user %s", user_id)


async def _recent_billing_payment_failed_email(user_id: str) -> bool:
    """True if we already emailed this user about a failed payment within the cooldown window."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=_PAYMENT_FAILURE_EMAIL_COOLDOWN_HOURS)
    doc = await db.notification_logs.find_one(
        {
            "user_id": user_id,
            "notification_type": "billing_payment_failed",
            "sent_at": {"$gte": cutoff},
        }
    )
    return doc is not None


async def _notify_subscription_payment_failed(
    user_id: str,
    *,
    provider: str,
    error_hint: str | None = None,
) -> None:
    """Email the user that a subscription charge failed (Razorpay or Lemon Squeezy). Best-effort; no raise."""
    if not _billing_notification_service:
        return
    if await _recent_billing_payment_failed_email(user_id):
        return
    base = (os.getenv("FRONTEND_URL") or "http://localhost:8080").rstrip("/")
    billing_url = f"{base}/settings?tab=billing"
    provider_label = "Razorpay" if provider == "razorpay" else "Lemon Squeezy"
    subject, plain, html = subscription_payment_failed_notification(
        billing_url,
        provider_display=provider_label,
        error_hint=error_hint,
        provider_key=provider,
    )
    try:
        await _billing_notification_service.send_notification_always(
            user_id,
            "billing_payment_failed",
            subject,
            plain,
            html,
        )
    except Exception:
        logger.exception("Failed to send billing_payment_failed email for user %s", user_id)


def get_lemonsqueezy_service() -> LemonSqueezyService:
    if _lemonsqueezy_service is None:
        return LemonSqueezyService(plan_service=_plan_service)
    return _lemonsqueezy_service


def _get_credit_topup_variant_id() -> str | None:
    return (os.getenv(CREDIT_TOPUP_LEMON_VARIANT_ENV) or "").strip() or None


async def _fulfill_credit_topup(
    *,
    user_id: str,
    topup_id: str,
    provider: str,
    external_reference: str,
    metadata: dict | None = None,
) -> int:
    await _credit_service.add_credits(
        user_id,
        CREDIT_TOPUP_CREDITS,
        reason="credits_topup",
        metadata={
            "topup_id": topup_id,
            "provider": provider,
            "external_reference": external_reference,
            **(metadata or {}),
        },
        idempotency_key=f"credits-topup:{provider}:{external_reference}",
        purchased=True,
    )
    await db.credit_topups.update_one(
        {"id": topup_id},
        {
            "$set": {
                "status": "paid",
                "paid_at": datetime.now(timezone.utc),
                "external_reference": external_reference,
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )
    return await _credit_service.get_balance(user_id)


# Fallback when plan_service is not initialized (e.g. no admin DB); billing loads paid plans from DB when available.
_DEFAULT_PAID_PLANS = ("starter", "growth", "pro", "scale", "google-only", "pro-50")


async def _get_paid_plan_ids() -> tuple[str, ...]:
    """Paid plan ids from DB (plan_service) or fallback to default list."""
    if _plan_service:
        ids = await _plan_service.get_paid_plan_ids()
        if ids:
            return tuple(ids)
    return _DEFAULT_PAID_PLANS


# Only Starter gets a 7-day trial; other paid plans start immediately. Users who already used trial also start immediately.
TRIAL_PLANS = ("starter",)


async def _require_india(request: Request) -> None:
    region = await get_region_from_request(request)
    if region.get("is_india") is not True:
        raise HTTPException(status_code=403, detail="Razorpay billing is only available in India. Please create a support ticket for your region.")


@router.get("/credits/topup-config")
async def get_credit_topup_config(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    region = await get_region_from_request(request)
    is_india = region.get("is_india") is True
    ls = get_lemonsqueezy_service()
    return {
        "credits": CREDIT_TOPUP_CREDITS,
        "is_india": is_india,
        "provider": "razorpay" if is_india else "lemon_squeezy",
        "amount": {
            "value": 1000 if is_india else 10,
            "display": "₹1000" if is_india else "$10",
            "currency": "INR" if is_india else "USD",
            "subunits": CREDIT_TOPUP_INR_SUBUNITS if is_india else CREDIT_TOPUP_USD_CENTS,
        },
        "provider_configured": get_razorpay_service().is_configured() if is_india else bool(ls.is_configured() and _get_credit_topup_variant_id()),
        "current_balance": int(current_user.get("credits_balance", 0) or 0),
    }


def _razorpay_paid_count(entity: dict) -> int:
    try:
        return int((entity or {}).get("paid_count") or 0)
    except (TypeError, ValueError):
        return 0


def _razorpay_subscription_never_successfully_charged(entity: dict, user_row: dict | None) -> bool:
    """True when Razorpay shows no completed cycle and we have no local record of a successful charge."""
    if _razorpay_paid_count(entity) > 0:
        return False
    if user_row and user_had_successful_subscription_charge(user_row):
        return False
    return True


def _subscription_to_dates(sub: dict, *, is_annual: bool = False) -> tuple[str | None, str | None]:
    """Extract current period start/end (YYYY-MM-DD) from Razorpay subscription.

    Uses Razorpay timestamps (current_start / current_end / charge_at / ended_at).
    Monthly: normalize To = From + 30 days when From is known (product display rule).
    Annual: keep parsed cycle bounds when both exist; otherwise infer ~365-day window.
    """
    start = sub.get("current_start") or sub.get("start_at")
    # current_end = cycle end; ended_at = when sub ended; charge_at = next charge (same as cycle end for active)
    end = sub.get("current_end") or sub.get("ended_at") or sub.get("charge_at")
    start_str = None
    end_str = None
    if start:
        try:
            start_str = datetime.utcfromtimestamp(int(start)).strftime("%Y-%m-%d")
        except (TypeError, ValueError):
            pass
    if end:
        try:
            end_str = datetime.utcfromtimestamp(int(end)).strftime("%Y-%m-%d")
        except (TypeError, ValueError):
            pass
    cycle_days = 365 if is_annual else 30
    # If start is missing but end exists: derive start from cycle length.
    if end_str and start_str is None:
        try:
            end_dt = datetime.strptime(end_str, "%Y-%m-%d")
            start_dt = end_dt - timedelta(days=cycle_days)
            start_str = start_dt.strftime("%Y-%m-%d")
        except (ValueError, TypeError):
            pass
    # Monthly: canonical display To = From + 30 days. Annual: keep Razorpay end when already parsed.
    if start_str and not is_annual:
        try:
            start_dt = datetime.strptime(start_str, "%Y-%m-%d")
            end_str = (start_dt + timedelta(days=30)).strftime("%Y-%m-%d")
        except (ValueError, TypeError):
            pass
    elif start_str and is_annual and not end_str:
        try:
            start_dt = datetime.strptime(start_str, "%Y-%m-%d")
            end_str = (start_dt + timedelta(days=365)).strftime("%Y-%m-%d")
        except (ValueError, TypeError):
            pass
    return start_str, end_str


async def _clear_user_subscription(user_id: str, *, subscription_never_activated: bool = False) -> None:
    """Clear subscription fields on user and set plan to free.
    If subscription_never_activated is True (e.g. user closed payment without paying), do not mark trial as used
    so they can claim trial again. Otherwise mark trial as used."""
    set_payload = {
        "plan_id": "free",
        "subscription_status": "active",
        "subscription_start": None,
        "subscription_end": None,
        "razorpay_subscription_id": None,
        "trial_ends_at": None,
        "billing_payment_failed_at": None,
        "billing_last_paid_at": None,
        "billing_has_successful_subscription_charge": False,
        "updated_at": datetime.now(timezone.utc),
    }
    if not subscription_never_activated:
        set_payload["trial_used_at"] = datetime.now(timezone.utc)
    update_op: dict = {"$set": set_payload}
    if subscription_never_activated:
        update_op["$unset"] = {"trial_used_at": ""}
    await db.users.update_one(
        {"id": user_id},
        update_op,
    )


@router.post("/credits/razorpay/create-order")
async def create_razorpay_credit_topup_order(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    await _require_india(request)
    rp = get_razorpay_service()
    if not rp.is_configured():
        raise HTTPException(status_code=503, detail="Payment gateway is not configured")

    topup_id = f"credit-topup-{uuid.uuid4()}"
    try:
        order = await rp.create_order(
            amount=CREDIT_TOPUP_INR_SUBUNITS,
            currency="INR",
            receipt=topup_id[:40],
            notes={"user_id": current_user["id"], "credit_topup_id": topup_id},
        )
    except Exception as e:
        logger.exception("Razorpay create_order failed: %s", e)
        raise HTTPException(status_code=502, detail="Failed to create top-up order")

    now = datetime.now(timezone.utc)
    await db.credit_topups.insert_one(
        {
            "id": topup_id,
            "user_id": current_user["id"],
            "provider": "razorpay",
            "status": "created",
            "credits": CREDIT_TOPUP_CREDITS,
            "amount": CREDIT_TOPUP_INR_SUBUNITS,
            "currency": "INR",
            "razorpay_order_id": order.get("id"),
            "created_at": now,
            "updated_at": now,
        }
    )
    return {
        "topup_id": topup_id,
        "order_id": order.get("id"),
        "amount": CREDIT_TOPUP_INR_SUBUNITS,
        "currency": "INR",
        "credits": CREDIT_TOPUP_CREDITS,
        "key_id": rp.key_id,
    }


@router.post("/credits/razorpay/verify")
async def verify_razorpay_credit_topup(
    request: Request,
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    await _require_india(request)
    order_id = (body.get("order_id") or body.get("razorpay_order_id") or "").strip()
    payment_id = (body.get("payment_id") or body.get("razorpay_payment_id") or "").strip()
    signature = (body.get("signature") or body.get("razorpay_signature") or "").strip()
    if not order_id or not payment_id or not signature:
        raise HTTPException(status_code=400, detail="order_id, payment_id, and signature are required")

    topup = await db.credit_topups.find_one(
        {"user_id": current_user["id"], "provider": "razorpay", "razorpay_order_id": order_id},
        {"_id": 0},
    )
    if not topup:
        raise HTTPException(status_code=404, detail="Top-up order not found")

    rp = get_razorpay_service()
    if not rp.verify_payment_signature(order_id=order_id, payment_id=payment_id, signature=signature):
        raise HTTPException(status_code=400, detail="Invalid payment signature")

    balance = await _fulfill_credit_topup(
        user_id=current_user["id"],
        topup_id=topup["id"],
        provider="razorpay",
        external_reference=payment_id,
        metadata={"order_id": order_id},
    )
    return {
        "message": "Credits added successfully",
        "credits_added": CREDIT_TOPUP_CREDITS,
        "balance": balance,
    }


@router.post("/razorpay/create-subscription")
async def create_razorpay_subscription(
    request: Request,
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Create a Razorpay subscription for the given plan. Body: plan_id, optional annual (bool). Returns subscription_id and short_url for Checkout. India-only."""
    await _require_india(request)
    plan_id = (body.get("plan_id") or "").strip().lower()
    annual = bool(body.get("annual", False))
    paid_plans = await _get_paid_plan_ids()
    if plan_id not in paid_plans:
        raise HTTPException(status_code=400, detail=f"Invalid plan_id. Must be one of: {', '.join(paid_plans)}")
    rp = get_razorpay_service()
    if not rp.is_configured():
        raise HTTPException(status_code=503, detail="Payment gateway is not configured")
    # Prefer Razorpay plan ID from plan document (DB); fallback to env (RAZORPAY_PLAN_*)
    razorpay_plan_id = None
    if _plan_service:
        razorpay_plan_id = await _plan_service.get_razorpay_plan_id_from_plan(plan_id, annual)
    if not razorpay_plan_id:
        razorpay_plan_id = rp.get_razorpay_plan_id(plan_id, annual=annual)
    if not razorpay_plan_id:
        if annual:
            raise HTTPException(
                status_code=400,
                detail=f"Annual plan not configured for {plan_id}. Add RAZORPAY_PLAN_{plan_id.upper()}_ANNUAL to your env with the Razorpay annual plan id.",
            )
        raise HTTPException(status_code=400, detail=f"No Razorpay plan configured for {plan_id}")
    total_count = 10 if annual else 120  # 10 years of annual cycles, or 120 monthly
    user_id = current_user["id"]
    existing_sub_id = (current_user.get("razorpay_subscription_id") or "").strip()
    if existing_sub_id:
        try:
            existing = await rp.fetch_subscription(existing_sub_id)
        except Exception as e:
            logger.warning("Razorpay fetch_subscription failed in create: %s", e)
            await db.users.update_one(
                {"id": user_id},
                {"$set": {"razorpay_subscription_id": None, "updated_at": datetime.now(timezone.utc)}},
            )
            existing = None
        if existing:
            status = (existing.get("status") or "").lower()
            if status in ("active", "authenticated"):
                raise HTTPException(
                    status_code=400,
                    detail="You already have an active subscription; use Change plan to upgrade/downgrade.",
                )
            if status == "created":
                existing_razorpay_plan = (existing.get("plan_id") or "").strip()
                if existing_razorpay_plan == razorpay_plan_id:
                    return {
                        "subscription_id": existing.get("id"),
                        "short_url": existing.get("short_url"),
                        "key_id": rp.key_id,
                    }
                try:
                    await rp.cancel_subscription(existing_sub_id, cancel_at_cycle_end=False)
                except httpx.HTTPStatusError:
                    pass
                except Exception:
                    pass
            elif status in ("cancelled", "expired", "completed"):
                await _clear_user_subscription(user_id)
            elif status == "halted":
                # Halted subscriptions are recoverable (e.g. payment method update/resume).
                # Keep the linked subscription id so user/admin can manage it.
                return {
                    "subscription_id": existing.get("id"),
                    "short_url": existing.get("short_url"),
                    "key_id": rp.key_id,
                }
    import time
    now_ts = int(time.time())
    # Trial only for Starter/Growth; Pro/Scale and users who already used trial start immediately
    offer_trial = (
        plan_id in TRIAL_PLANS
        and not current_user.get("trial_used_at")
    )
    start_at: int | None = (now_ts + 7 * 24 * 3600) if offer_trial else None  # 7 days from now, or None for immediate
    try:
        sub = await rp.create_subscription(
            razorpay_plan_id,
            user_id,
            total_count=total_count,
            start_at=start_at,
            customer_notify=True,
        )
    except Exception as e:
        logger.exception("Razorpay create_subscription failed: %s", e)
        raise HTTPException(status_code=502, detail="Failed to create subscription")
    sub_id = sub.get("id")
    short_url = sub.get("short_url")
    if not sub_id:
        raise HTTPException(status_code=502, detail="Razorpay did not return subscription id")
    update_payload: dict = {
        "razorpay_subscription_id": sub_id,
        "updated_at": datetime.now(timezone.utc),
    }
    if offer_trial:
        today = date.today()
        trial_end_date = today + timedelta(days=7)
        trial_ends_at_dt = datetime.combine(trial_end_date, datetime.max.time()).replace(tzinfo=timezone.utc)
        update_payload["trial_used_at"] = datetime.now(timezone.utc)
        update_payload["plan_id"] = plan_id
        update_payload["subscription_status"] = "trial"
        update_payload["subscription_start"] = today.isoformat()
        update_payload["subscription_end"] = trial_end_date.isoformat()
        update_payload["trial_ends_at"] = trial_ends_at_dt
    await db.users.update_one(
        {"id": user_id},
        {"$set": update_payload},
    )
    key_id = rp.key_id
    return {
        "subscription_id": sub_id,
        "short_url": short_url,
        "key_id": key_id,
    }


@router.get("/razorpay/subscription")
async def get_razorpay_subscription(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Get current user's Razorpay subscription details. India-only."""
    await _require_india(request)
    sub_id = (current_user.get("razorpay_subscription_id") or "").strip()
    if not sub_id:
        return {"subscription": None, "short_url": None}
    rp = get_razorpay_service()
    if not rp.is_configured():
        return {"subscription": None, "short_url": None}
    try:
        sub = await rp.fetch_subscription(sub_id)
    except Exception as e:
        logger.warning("Razorpay fetch_subscription failed: %s", e)
        return {"subscription": None, "short_url": None}
    status = (sub.get("status") or "").lower()
    user_id = current_user["id"]
    if _razorpay_paid_count(sub) > 0:
        await db.users.update_one(
            {"id": user_id, "billing_has_successful_subscription_charge": {"$ne": True}},
            {
                "$set": {
                    "billing_has_successful_subscription_charge": True,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )
    razorpay_plan_id = (sub.get("plan_id") or "").strip()
    app_plan_id = None
    is_annual = False
    if _plan_service:
        app_plan_id, is_annual = await _plan_service.get_app_plan_id_from_razorpay_plan(razorpay_plan_id)
    if app_plan_id is None:
        app_plan_id = rp.get_app_plan_id_from_razorpay_plan(razorpay_plan_id)
        is_annual = rp.is_annual_plan(razorpay_plan_id)
    start_str, end_str = _subscription_to_dates(sub, is_annual=is_annual)
    u_billing = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "billing_last_paid_at": 1, "billing_has_successful_subscription_charge": 1},
    )
    had_charge = _razorpay_paid_count(sub) > 0 or user_had_successful_subscription_charge(u_billing or {})
    billing_display_start: str | None = None
    billing_display_end: str | None = None
    billing_cycle = "annual" if is_annual else "monthly"

    # Cancelled: never grant paid access without a successful charge; else keep plan until subscription_end.
    if status == "cancelled":
        urow = await db.users.find_one(
            {"id": user_id},
            {"_id": 0, "billing_last_paid_at": 1, "billing_has_successful_subscription_charge": 1},
        )
        if _razorpay_subscription_never_successfully_charged(sub, urow):
            await _clear_user_subscription(user_id)
            return {"subscription": None, "short_url": None}
        set_payload = {
            "subscription_status": "cancelled",
            "updated_at": datetime.now(timezone.utc),
        }
        if start_str is not None:
            set_payload["subscription_start"] = start_str
        if end_str is not None:
            set_payload["subscription_end"] = end_str
        if app_plan_id:
            set_payload["plan_id"] = app_plan_id
        await db.users.update_one(
            {"id": user_id},
            {"$set": set_payload},
        )
        return {
            "subscription": {
                "id": sub.get("id"),
                "status": sub.get("status"),
                "plan_id": app_plan_id or current_user.get("plan_id") or sub.get("plan_id"),
                "current_start": start_str or current_user.get("subscription_start"),
                "current_end": end_str or current_user.get("subscription_end"),
                "charge_at": sub.get("charge_at"),
                "billing_cycle": billing_cycle,
            },
            "short_url": sub.get("short_url"),
        }
    # Ended states (expired, completed): clear user; cancelled/halted are handled without clearing
    if status in ("expired", "completed"):
        await _clear_user_subscription(user_id)
        return {"subscription": None, "short_url": None}
    if status == "halted":
        # Keep subscription details for payment-method recovery/resume flows.
        set_payload = {
            "subscription_status": "halted",
            "updated_at": datetime.now(timezone.utc),
        }
        if had_charge:
            if start_str is not None:
                set_payload["subscription_start"] = start_str
            if end_str is not None:
                set_payload["subscription_end"] = end_str
            billing_display_start = start_str
            billing_display_end = end_str
        set_payload["plan_id"] = app_plan_id if had_charge else "free"
        await db.users.update_one(
            {"id": user_id},
            {"$set": set_payload},
        )
        return {
            "subscription": {
                "id": sub.get("id"),
                "status": sub.get("status"),
                "plan_id": set_payload["plan_id"],
                "current_start": billing_display_start,
                "current_end": billing_display_end,
                "charge_at": sub.get("charge_at"),
                "billing_cycle": billing_cycle,
            },
            "short_url": sub.get("short_url"),
        }
    # Sync user plan from Razorpay. Starter trial: 7-day window until first charge. Paid month: only after a successful charge.
    response_plan_id = app_plan_id
    if status in ("active", "authenticated", "pending") and app_plan_id:
        aid = (app_plan_id or "").strip().lower()
        set_payload: dict = {"updated_at": datetime.now(timezone.utc)}
        if status in ("authenticated", "created"):
            if aid in TRIAL_PLANS:
                set_payload["plan_id"] = app_plan_id
                set_payload["subscription_status"] = "trial"
                if not current_user.get("subscription_start") or not current_user.get("subscription_end"):
                    today = date.today()
                    trial_end_date = today + timedelta(days=7)
                    trial_ends_at_dt = datetime.combine(trial_end_date, datetime.max.time()).replace(tzinfo=timezone.utc)
                    set_payload["subscription_start"] = today.isoformat()
                    set_payload["subscription_end"] = trial_end_date.isoformat()
                    set_payload["trial_ends_at"] = trial_ends_at_dt
                    billing_display_start = set_payload["subscription_start"]
                    billing_display_end = set_payload["subscription_end"]
                else:
                    billing_display_start = (current_user.get("subscription_start") or "").strip() or None
                    billing_display_end = (current_user.get("subscription_end") or "").strip() or None
            else:
                set_payload["plan_id"] = "free"
                set_payload["subscription_status"] = str(status or "authenticated").lower()
                set_payload["subscription_start"] = None
                set_payload["subscription_end"] = None
                set_payload["trial_ends_at"] = None
        elif had_charge:
            set_payload["plan_id"] = app_plan_id
            set_payload["subscription_status"] = "active" if status == "active" else status
            if start_str is not None:
                set_payload["subscription_start"] = start_str
            if end_str is not None:
                set_payload["subscription_end"] = end_str
            set_payload["trial_ends_at"] = None
            billing_display_start = start_str
            billing_display_end = end_str
        else:
            # pending / active without a captured charge yet — do not persist Razorpay's next-charge window as the paid period
            set_payload["plan_id"] = "free"
            set_payload["subscription_status"] = "active" if status == "active" else status
            set_payload["subscription_start"] = None
            set_payload["subscription_end"] = None
            set_payload["trial_ends_at"] = None
        response_plan_id = set_payload.get("plan_id", app_plan_id)
        await db.users.update_one(
            {"id": user_id},
            {"$set": set_payload},
        )
        await _pause_campaigns_if_outbound_blocked(user_id)
    return {
        "subscription": {
            "id": sub.get("id"),
            "status": sub.get("status"),
            "plan_id": response_plan_id or sub.get("plan_id"),
            "current_start": billing_display_start,
            "current_end": billing_display_end,
            "charge_at": sub.get("charge_at"),
            "billing_cycle": billing_cycle,
        },
        "short_url": sub.get("short_url"),
    }


@router.post("/razorpay/cancel-subscription")
async def cancel_razorpay_subscription(
    request: Request,
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Cancel Razorpay subscription. Body: cancel_at_cycle_end (boolean). India-only."""
    await _require_india(request)
    sub_id = (current_user.get("razorpay_subscription_id") or "").strip()
    if not sub_id:
        raise HTTPException(status_code=400, detail="No active subscription to cancel")
    cancel_at_cycle_end = bool(body.get("cancel_at_cycle_end", False))
    rp = get_razorpay_service()
    if not rp.is_configured():
        raise HTTPException(status_code=503, detail="Payment gateway is not configured")
    user_id = current_user["id"]
    # Fetch current status before cancelling
    try:
        sub = await rp.fetch_subscription(sub_id)
    except Exception as e:
        logger.warning("Razorpay fetch_subscription failed in cancel: %s", e)
        raise HTTPException(status_code=502, detail="Failed to fetch subscription")
    status = (sub.get("status") or "").lower()
    # Already ended: sync DB and return 200
    if status in ("cancelled", "expired", "completed"):
        await _clear_user_subscription(user_id)
        return {"message": "Subscription already cancelled", "subscription": "cancelled"}
    # Draft (created, never paid): cancel in Razorpay; clear user and allow them to claim trial again
    if status == "created":
        try:
            await rp.cancel_subscription(sub_id, cancel_at_cycle_end=False)
        except httpx.HTTPStatusError as e:
            if e.response.status_code != 400:
                logger.exception("Razorpay cancel_subscription failed: %s", e)
                raise HTTPException(status_code=502, detail="Failed to cancel subscription")
        await _clear_user_subscription(user_id, subscription_never_activated=True)
        return {"message": "Subscription cancelled", "subscription": "cancelled"}
    # active, authenticated, pending, halted: call Razorpay cancel
    try:
        sub = await rp.cancel_subscription(sub_id, cancel_at_cycle_end=cancel_at_cycle_end)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 400:
            await _clear_user_subscription(user_id)
            return {"message": "Subscription cancelled or already ended.", "subscription": "cancelled"}
        logger.exception("Razorpay cancel_subscription failed: %s", e)
        raise HTTPException(status_code=502, detail="Failed to cancel subscription")
    except Exception as e:
        logger.exception("Razorpay cancel_subscription failed: %s", e)
        raise HTTPException(status_code=502, detail="Failed to cancel subscription")
    if cancel_at_cycle_end:
        rp_plan = (sub.get("plan_id") or "").strip()
        is_annual_c = False
        if _plan_service and rp_plan:
            _, is_annual_c = await _plan_service.get_app_plan_id_from_razorpay_plan(rp_plan)
        if not is_annual_c and rp_plan:
            is_annual_c = rp.is_annual_plan(rp_plan)
        start_str, end_str = _subscription_to_dates(sub, is_annual=is_annual_c)
        set_payload = {
            "subscription_status": "cancelled",
            "updated_at": datetime.now(timezone.utc),
        }
        if start_str is not None:
            set_payload["subscription_start"] = start_str
        if end_str is not None:
            set_payload["subscription_end"] = end_str
        await db.users.update_one(
            {"id": user_id},
            {"$set": set_payload},
        )
    else:
        # Immediate cancel: keep Plan, Subscribed from, Subscribed to (handled in our software); only mark cancelled and clear Razorpay link
        await db.users.update_one(
            {"id": user_id},
            {
                "$set": {
                    "subscription_status": "cancelled",
                    "razorpay_subscription_id": None,
                    "updated_at": datetime.now(timezone.utc),
                },
            },
        )
    return {"message": "Subscription cancelled", "subscription": sub.get("status")}


@router.post("/razorpay/update-plan")
async def update_razorpay_plan(
    request: Request,
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Change subscription to another plan. Body: plan_id (app), schedule_change_at ('now' | 'cycle_end'). India-only."""
    await _require_india(request)
    sub_id = (current_user.get("razorpay_subscription_id") or "").strip()
    if not sub_id:
        raise HTTPException(status_code=400, detail="No active subscription to update")
    plan_id = (body.get("plan_id") or "").strip().lower()
    paid_plans = await _get_paid_plan_ids()
    if plan_id not in paid_plans:
        raise HTTPException(status_code=400, detail=f"Invalid plan_id. Must be one of: {', '.join(paid_plans)}")
    schedule = (body.get("schedule_change_at") or "now").strip().lower()
    if schedule not in ("now", "cycle_end"):
        schedule = "now"
    rp = get_razorpay_service()
    if not rp.is_configured():
        raise HTTPException(status_code=503, detail="Payment gateway is not configured")
    try:
        existing = await rp.fetch_subscription(sub_id)
    except Exception as e:
        logger.warning("Razorpay fetch_subscription failed in update-plan: %s", e)
        raise HTTPException(status_code=502, detail="Failed to fetch subscription")
    status = (existing.get("status") or "").lower()
    if status == "created":
        raise HTTPException(status_code=400, detail="Complete your payment first before changing plan.")
    # Razorpay allows plan change only for active and authenticated subscriptions
    if status not in ("active", "authenticated"):
        raise HTTPException(
            status_code=400,
            detail="Subscription is not in a state that allows plan change. Only active subscriptions can be updated.",
        )
    existing_razorpay_plan = (existing.get("plan_id") or "").strip()
    existing_app_plan = None
    is_annual = False
    if _plan_service:
        existing_app_plan, is_annual = await _plan_service.get_app_plan_id_from_razorpay_plan(existing_razorpay_plan)
    if existing_app_plan is None:
        existing_app_plan = rp.get_app_plan_id_from_razorpay_plan(existing_razorpay_plan)
        is_annual = rp.is_annual_plan(existing_razorpay_plan)
    if existing_app_plan and existing_app_plan.lower() == plan_id:
        raise HTTPException(status_code=400, detail="You are already on this plan.")
    # New plan's Razorpay id (same billing cycle: monthly or annual as current subscription)
    razorpay_plan_id = None
    if _plan_service:
        razorpay_plan_id = await _plan_service.get_razorpay_plan_id_from_plan(plan_id, is_annual)
    if not razorpay_plan_id:
        razorpay_plan_id = rp.get_razorpay_plan_id(plan_id, annual=is_annual)
    if not razorpay_plan_id:
        raise HTTPException(status_code=400, detail=f"No Razorpay plan configured for {plan_id}")
    try:
        sub = await rp.update_subscription(sub_id, razorpay_plan_id, schedule_change_at=schedule)
    except httpx.HTTPStatusError as e:
        logger.warning("Razorpay update_subscription %s: %s", e.response.status_code, e.response.text)
        if e.response.status_code == 400:
            try:
                err_body = e.response.json()
                msg = err_body.get("error", {}).get("description") or err_body.get("error", {}).get("reason") or e.response.text
            except Exception:
                msg = e.response.text or "Razorpay rejected the plan change."
            # Friendlier message when plan change is blocked due to UPI payment method
            if msg and ("upi" in msg.lower() or "payment mode" in msg.lower()):
                msg = (
                    "Plan changes aren't allowed when your subscription is paid via UPI. "
                    "Go to Manage subscription to change your payment method to card, then try upgrading again."
                )
            raise HTTPException(status_code=400, detail=msg)
        raise HTTPException(status_code=502, detail="Failed to update plan")
    except Exception as e:
        logger.exception("Razorpay update_subscription failed: %s", e)
        raise HTTPException(status_code=502, detail="Failed to update plan")
    # Sync user plan immediately if schedule is now; else webhook will update at cycle_end
    if schedule == "now":
        start_str, end_str = _subscription_to_dates(sub, is_annual=is_annual)
        set_payload = {"plan_id": plan_id, "updated_at": datetime.now(timezone.utc)}
        if start_str is not None:
            set_payload["subscription_start"] = start_str
        if end_str is not None:
            set_payload["subscription_end"] = end_str
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": set_payload},
        )
    return {"message": "Plan update scheduled", "subscription": sub.get("status")}


@router.post("/razorpay/webhook")
async def razorpay_webhook(request: Request):
    """Razorpay webhook: verify signature and sync user subscription state. No auth."""
    body_raw = await request.body()
    signature = (request.headers.get("X-Razorpay-Signature") or "").strip()
    rp = get_razorpay_service()
    sig_ok = rp.verify_webhook_signature(body_raw, signature)

    payload: dict | None = None
    event = ""
    parse_error: str | None = None
    try:
        payload = json.loads(body_raw.decode("utf-8"))
        event = payload.get("event") or ""
    except Exception as e:
        parse_error = str(e)

    log_user_id: str | None = None
    log_external: str | None = None
    outcome = "received"

    async def _flush_razorpay_log() -> None:
        await flush_billing_webhook_log(
            provider="razorpay",
            body_length=len(body_raw),
            signature_valid=sig_ok,
            event_name=event or None,
            payload=payload,
            user_id=log_user_id,
            external_id=log_external,
            outcome=outcome,
        )

    if parse_error:
        outcome = "invalid_json"
        await _flush_razorpay_log()
        raise HTTPException(status_code=400, detail="Invalid JSON")
    if not sig_ok:
        outcome = "invalid_signature"
        await _flush_razorpay_log()
        raise HTTPException(status_code=400, detail="Invalid webhook signature")
    if not event.startswith("subscription."):
        outcome = "ignored_non_subscription"
        await _flush_razorpay_log()
        return {"ok": True}
    pl = payload.get("payload") or {}
    sub_wrapper = pl.get("subscription") or {}
    entity = sub_wrapper.get("entity") or sub_wrapper
    sub_id = entity.get("id")
    if not sub_id:
        outcome = "no_subscription_id_in_payload"
        await _flush_razorpay_log()
        return {"ok": True}
    log_external = str(sub_id)
    user = await db.users.find_one({"razorpay_subscription_id": sub_id})
    if not user:
        logger.warning("Razorpay webhook: no user found for subscription %s", sub_id)
        outcome = "user_not_found_for_subscription"
        await _flush_razorpay_log()
        return {"ok": True}
    user_id = user["id"]
    log_user_id = user_id
    status = entity.get("status") or ""
    razorpay_plan_id = entity.get("plan_id") or ""
    app_plan_id = None
    is_annual = False
    if _plan_service:
        app_plan_id, is_annual = await _plan_service.get_app_plan_id_from_razorpay_plan(razorpay_plan_id)
    if app_plan_id is None:
        app_plan_id = rp.get_app_plan_id_from_razorpay_plan(razorpay_plan_id)
        is_annual = rp.is_annual_plan(razorpay_plan_id)
    start_str, end_str = _subscription_to_dates(entity, is_annual=is_annual)
    if event in ("subscription.authenticated", "subscription.activated", "subscription.charged", "subscription.updated", "subscription.resumed"):
        now = datetime.now(timezone.utc)
        st_lower = str(status).lower()
        app_pid = (app_plan_id or "").strip().lower()
        trial_like = st_lower in ("authenticated", "created") and app_pid in TRIAL_PLANS
        trial_active = (user.get("subscription_status") or "").lower() == "trial" and app_pid in TRIAL_PLANS
        billing_touch = event == "subscription.charged" or (event == "subscription.activated" and st_lower == "active")
        paid_ok = (
            billing_touch
            or _razorpay_paid_count(entity) > 0
            or user_had_successful_subscription_charge(user)
            or trial_like
            or trial_active
        )
        resolved_plan_id = (app_plan_id if paid_ok else "free") or "free"
        set_payload = {
            "plan_id": resolved_plan_id,
            "subscription_status": "active" if status == "active" else status,
            "billing_payment_failed_at": None,
            "updated_at": now,
        }
        if billing_touch:
            set_payload["billing_last_paid_at"] = now
            set_payload["billing_has_successful_subscription_charge"] = True
        elif _razorpay_paid_count(entity) > 0:
            set_payload["billing_has_successful_subscription_charge"] = True
        # Paid billing window (From / To): only on successful invoice capture — not on mandate/auth alone.
        if event == "subscription.charged" and start_str and end_str:
            set_payload["subscription_start"] = start_str
            set_payload["subscription_end"] = end_str
            set_payload["trial_ends_at"] = None
        elif event in ("subscription.updated", "subscription.resumed") and (start_str or end_str):
            if _razorpay_paid_count(entity) > 0 or user_had_successful_subscription_charge(user):
                if start_str is not None:
                    set_payload["subscription_start"] = start_str
                if end_str is not None:
                    set_payload["subscription_end"] = end_str
        # subscription.authenticated: do not overwrite subscription_start/end (trial dates set at create)
        await db.users.update_one(
            {"id": user_id},
            {"$set": set_payload},
        )
        await _pause_campaigns_if_outbound_blocked(user_id)
    elif event == "subscription.cancelled":
        urow = await db.users.find_one(
            {"id": user_id},
            {"_id": 0, "billing_last_paid_at": 1, "billing_has_successful_subscription_charge": 1},
        )
        if _razorpay_subscription_never_successfully_charged(entity, urow):
            await _clear_user_subscription(user_id)
        else:
            set_payload = {
                "subscription_status": "cancelled",
                "billing_payment_failed_at": None,
                "updated_at": datetime.now(timezone.utc),
            }
            if start_str is not None:
                set_payload["subscription_start"] = start_str
            if end_str is not None:
                set_payload["subscription_end"] = end_str
            if app_plan_id:
                set_payload["plan_id"] = app_plan_id
            await db.users.update_one(
                {"id": user_id},
                {"$set": set_payload},
            )
    elif event in ("subscription.completed", "subscription.expired"):
        await db.users.update_one(
            {"id": user_id},
            {
                "$set": {
                    "plan_id": "free",
                    "subscription_status": "active",
                    "subscription_start": None,
                    "subscription_end": end_str or None,
                    "razorpay_subscription_id": None,
                    "trial_ends_at": None,
                    "trial_used_at": datetime.now(timezone.utc),
                    "billing_payment_failed_at": None,
                    "billing_last_paid_at": None,
                    "billing_has_successful_subscription_charge": False,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )
    elif event == "subscription.halted":
        # Halted should not detach subscription id. Downgrade to free only if they never had a successful charge.
        set_payload = {
            "subscription_status": "halted",
            "billing_payment_failed_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }
        if _razorpay_paid_count(entity) > 0 or user_had_successful_subscription_charge(user):
            if start_str is not None:
                set_payload["subscription_start"] = start_str
            if end_str is not None:
                set_payload["subscription_end"] = end_str
            if app_plan_id:
                set_payload["plan_id"] = app_plan_id
        else:
            set_payload["plan_id"] = "free"
        await db.users.update_one(
            {"id": user_id},
            {"$set": set_payload},
        )
    elif event == "subscription.charge_failed":
        pay_entity = (pl.get("payment") or {}).get("entity") or {}
        err = (
            (pay_entity.get("error_description") or pay_entity.get("error_code") or "")
            .strip()
            or None
        )
        await _notify_subscription_payment_failed(user_id, provider="razorpay", error_hint=err)
        await db.users.update_one(
            {"id": user_id},
            {
                "$set": {
                    "billing_payment_failed_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )
    outcome = "processed"
    await _flush_razorpay_log()
    return {"ok": True}


# ---------- Lemon Squeezy (international) ----------


async def _require_not_india(request: Request) -> None:
    """Raise 403 if request is from India (India uses Razorpay)."""
    region = await get_region_from_request(request)
    if region.get("is_india") is True:
        raise HTTPException(
            status_code=403,
            detail="Lemon Squeezy billing is for international only. Use Razorpay in India.",
        )


def _parse_ls_date(iso_str: str | None) -> str | None:
    """Return YYYY-MM-DD from ISO 8601 datetime or None."""
    if not iso_str:
        return None
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        return None


def _lemon_subscription_to_dates(
    created_at: str | None,
    renews_at: str | None = None,
    ends_at: str | None = None,
) -> tuple[str | None, str | None]:
    """From/To for Lemon Squeezy: From=created_at (or derived), To=From+30 days."""
    start_str = _parse_ls_date(created_at)
    if not start_str:
        fallback_end = _parse_ls_date(renews_at) or _parse_ls_date(ends_at)
        if fallback_end:
            try:
                fallback_end_dt = datetime.strptime(fallback_end, "%Y-%m-%d")
                start_str = (fallback_end_dt - timedelta(days=30)).strftime("%Y-%m-%d")
            except (ValueError, TypeError):
                start_str = None
    end_str = None
    if start_str:
        try:
            start_dt = datetime.strptime(start_str, "%Y-%m-%d")
            end_str = (start_dt + timedelta(days=30)).strftime("%Y-%m-%d")
        except (ValueError, TypeError):
            end_str = None
    return start_str, end_str


@router.post("/credits/lemon-squeezy/create-checkout")
async def create_lemon_squeezy_credit_topup_checkout(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    await _require_not_india(request)
    ls = get_lemonsqueezy_service()
    if not ls.is_configured():
        raise HTTPException(status_code=503, detail="Lemon Squeezy is not configured")
    variant_id = _get_credit_topup_variant_id()
    if not variant_id:
        raise HTTPException(
            status_code=503,
            detail=f"Credit top-up variant is not configured. Set {CREDIT_TOPUP_LEMON_VARIANT_ENV}.",
        )

    topup_id = f"credit-topup-{uuid.uuid4()}"
    try:
        result = await ls.create_checkout(
            variant_id,
            current_user["id"],
            custom_data={
                "credit_topup_id": topup_id,
                "purpose": "credits_topup",
            },
        )
    except Exception as e:
        logger.exception("Lemon Squeezy credit top-up checkout failed: %s", e)
        raise HTTPException(status_code=502, detail="Failed to create credit top-up checkout")

    now = datetime.now(timezone.utc)
    await db.credit_topups.insert_one(
        {
            "id": topup_id,
            "user_id": current_user["id"],
            "provider": "lemonsqueezy",
            "status": "created",
            "credits": CREDIT_TOPUP_CREDITS,
            "amount": CREDIT_TOPUP_USD_CENTS,
            "currency": "USD",
            "lemonsqueezy_checkout_id": result.get("checkout_id"),
            "created_at": now,
            "updated_at": now,
        }
    )
    checkout_url = (result.get("checkout_url") or "").strip()
    if not checkout_url:
        raise HTTPException(status_code=502, detail="No checkout URL returned")
    return {
        "checkout_url": checkout_url,
        "credits": CREDIT_TOPUP_CREDITS,
    }


@router.post("/lemon-squeezy/create-checkout")
async def create_lemon_squeezy_checkout(
    request: Request,
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Create a Lemon Squeezy checkout for the given plan. International only (non-India)."""
    await _require_not_india(request)
    plan_id = (body.get("plan_id") or "").strip().lower()
    annual = bool(body.get("annual", False))
    paid_plans = await _get_paid_plan_ids()
    if plan_id not in paid_plans:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid plan_id. Must be one of: {', '.join(paid_plans)}",
        )
    ls = get_lemonsqueezy_service()
    if not ls.is_configured():
        raise HTTPException(status_code=503, detail="Lemon Squeezy is not configured")
    variant_id = await ls.get_variant_id(plan_id, annual)
    if not variant_id:
        raise HTTPException(
            status_code=400,
            detail=f"No Lemon Squeezy variant configured for {plan_id} ({'annual' if annual else 'monthly'}).",
        )
    # If user already used a trial (Razorpay or previous Lemon Squeezy), skip trial on this checkout
    skip_trial = bool(current_user.get("trial_used_at"))
    try:
        result = await ls.create_checkout(variant_id, current_user["id"], skip_trial=skip_trial)
    except Exception as e:
        logger.exception("Lemon Squeezy create_checkout failed: %s", e)
        detail = "Failed to create checkout"
        if "401" in str(e) or "Unauthorized" in str(e):
            detail = "Payment provider authentication failed. Please contact support or try again later."
        raise HTTPException(status_code=502, detail=detail)
    checkout_url = (result.get("checkout_url") or "").strip()
    if not checkout_url:
        raise HTTPException(status_code=502, detail="No checkout URL returned")
    return {"checkout_url": checkout_url}


@router.get("/lemon-squeezy/subscription")
async def get_lemon_squeezy_subscription(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Get current user's Lemon Squeezy subscription and a fresh customer portal URL. International only."""
    await _require_not_india(request)
    sub_id = (current_user.get("lemon_squeezy_subscription_id") or "").strip()
    if not sub_id:
        return {"subscription": None, "customer_portal_url": None}
    ls = get_lemonsqueezy_service()
    if not ls.is_configured():
        return {"subscription": None, "customer_portal_url": None}
    attrs = await ls.get_subscription(sub_id)
    if not attrs:
        return {"subscription": None, "customer_portal_url": None}
    status = (attrs.get("status") or "").lower()
    variant_id = str(attrs.get("variant_id") or "")
    renews_at = attrs.get("renews_at")
    created_at = attrs.get("created_at")
    urls = attrs.get("urls") or {}
    customer_portal_url = (urls.get("customer_portal") or "").strip() or None

    app_plan_id = None
    is_annual = False
    if _plan_service and variant_id:
        app_plan_id, is_annual = await _plan_service.get_app_plan_id_from_lemon_squeezy_variant(variant_id)
    if not app_plan_id:
        app_plan_id = current_user.get("plan_id") or "free"

    start_str, end_str = _lemon_subscription_to_dates(created_at, renews_at)

    return {
        "subscription": {
            "id": sub_id,
            "status": status,
            "plan_id": app_plan_id,
            "current_start": start_str or current_user.get("subscription_start"),
            "current_end": end_str or current_user.get("subscription_end"),
            "billing_cycle": "annual" if is_annual else "monthly",
        },
        "customer_portal_url": customer_portal_url,
    }


@router.post("/lemon-squeezy/update-plan")
async def update_lemon_squeezy_plan(
    request: Request,
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Change Lemon Squeezy subscription to another plan immediately (invoice prorated amount now). International only."""
    await _require_not_india(request)
    sub_id = (current_user.get("lemon_squeezy_subscription_id") or "").strip()
    if not sub_id:
        raise HTTPException(status_code=400, detail="No active subscription to update")
    plan_id = (body.get("plan_id") or "").strip().lower()
    paid_plans = await _get_paid_plan_ids()
    if plan_id not in paid_plans:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid plan_id. Must be one of: {', '.join(paid_plans)}",
        )

    ls = get_lemonsqueezy_service()
    if not ls.is_configured():
        raise HTTPException(status_code=503, detail="Lemon Squeezy is not configured")

    # Determine current billing cycle (monthly/annual) from existing subscription
    attrs = await ls.get_subscription(sub_id)
    if not attrs:
        raise HTTPException(status_code=400, detail="Failed to fetch current subscription")
    billing_cycle = (attrs.get("billing_interval") or "").lower()
    is_annual = billing_cycle == "year"
    status = (attrs.get("status") or "").lower()

    # Resolve new variant id for requested plan + current billing cycle
    try:
        variant_id = await ls.get_variant_id(plan_id, is_annual)
    except Exception:
        variant_id = None
    if not variant_id:
        raise HTTPException(
            status_code=400,
            detail=f"No Lemon Squeezy variant configured for {plan_id} ({'annual' if is_annual else 'monthly'}).",
        )

    try:
        sub_attrs = await ls.update_subscription_variant(
            sub_id,
            variant_id,
            invoice_immediately=True,
            clear_trial=(status == "on_trial"),
        )
    except httpx.HTTPStatusError as e:
        logger.warning(
            "Lemon Squeezy update_subscription_variant %s: %s",
            e.response.status_code,
            e.response.text,
        )
        detail = "Failed to update plan"
        try:
            err_body = e.response.json()
            msg = (
                err_body.get("error", {}).get("message")
                or err_body.get("message")
                or e.response.text
            )
            if msg:
                detail = msg
        except Exception:
            pass
        raise HTTPException(status_code=400, detail=detail)
    except Exception as e:
        logger.exception("Lemon Squeezy update_subscription_variant failed: %s", e)
        raise HTTPException(status_code=502, detail="Failed to update plan")

    # Sync user plan immediately; webhook will keep things in sync afterwards as well.
    app_plan_id = plan_id
    start_str, end_str = _lemon_subscription_to_dates(
        sub_attrs.get("created_at"),
        sub_attrs.get("renews_at"),
        sub_attrs.get("ends_at"),
    )
    set_payload = {
        "plan_id": app_plan_id,
        "subscription_status": (sub_attrs.get("status") or "").lower() or "active",
        "updated_at": datetime.now(timezone.utc),
    }
    if start_str:
        set_payload["subscription_start"] = start_str
    if end_str:
        set_payload["subscription_end"] = end_str
    await db.users.update_one({"id": current_user["id"]}, {"$set": set_payload})
    await _pause_campaigns_if_outbound_blocked(current_user["id"])

    return {"message": "Plan updated", "subscription": sub_attrs.get("status")}

@router.post("/lemon-squeezy/webhook")
async def lemon_squeezy_webhook(request: Request):
    """Lemon Squeezy webhook: verify signature and sync user subscription. No auth."""
    body_raw = await request.body()
    signature = (request.headers.get("X-Signature") or "").strip()

    payload: dict | None = None
    parse_error: str | None = None
    try:
        payload = json.loads(body_raw.decode("utf-8"))
    except Exception as e:
        parse_error = str(e)

    event_name = ""
    if payload is not None:
        event_name = (
            request.headers.get("X-Event-Name") or payload.get("meta", {}).get("event_name") or ""
        ).strip()

    ls = get_lemonsqueezy_service()
    sig_ok = ls.verify_webhook_signature(body_raw, signature)

    log_user_id: str | None = None
    log_external: str | None = None
    outcome = "received"

    async def _flush_lemon_log() -> None:
        await flush_billing_webhook_log(
            provider="lemonsqueezy",
            body_length=len(body_raw),
            signature_valid=sig_ok,
            event_name=event_name or None,
            payload=payload,
            user_id=log_user_id,
            external_id=log_external,
            outcome=outcome,
        )

    if parse_error:
        outcome = "invalid_json"
        await _flush_lemon_log()
        raise HTTPException(status_code=400, detail="Invalid JSON")
    if not sig_ok:
        outcome = "invalid_signature"
        await _flush_lemon_log()
        raise HTTPException(status_code=400, detail="Invalid webhook signature")
    if not event_name:
        outcome = "no_event_name"
        await _flush_lemon_log()
        return {"ok": True}

    # Subscription events: data = subscription object (type "subscriptions", id, attributes)
    if event_name.startswith("subscription_"):
        data = payload.get("data") or {}
        attrs = data.get("attributes") or {}
        if data.get("type") != "subscriptions":
            outcome = "ignored_subscription_wrong_data_type"
            await _flush_lemon_log()
            return {"ok": True}
        sub_id = str((data.get("id") or ""))
        log_external = sub_id or log_external
        variant_id = str(attrs.get("variant_id") or "")
        customer_id = str(attrs.get("customer_id") or "") if attrs.get("customer_id") is not None else None
        status = (attrs.get("status") or "").lower()
        renews_at = attrs.get("renews_at")
        ends_at = attrs.get("ends_at")
        created_at = attrs.get("created_at")
        user_id = ls._get_user_id_from_payload(payload)
        if not user_id:
            logger.warning("Lemon Squeezy webhook %s: no user_id in custom_data", event_name)
            outcome = "no_user_in_custom_data"
            await _flush_lemon_log()
            return {"ok": True}
        log_user_id = user_id
        app_plan_id, is_annual = None, False
        if _plan_service and variant_id:
            app_plan_id, is_annual = await _plan_service.get_app_plan_id_from_lemon_squeezy_variant(variant_id)
        if not app_plan_id:
            app_plan_id = "free"

        start_str, end_str = _lemon_subscription_to_dates(created_at, renews_at, ends_at)

        if event_name in ("subscription_created", "subscription_payment_success", "subscription_updated", "subscription_resumed", "subscription_unpaused"):
            set_payload = {
                "plan_id": app_plan_id,
                "subscription_status": "active" if status == "active" else ("trial" if status == "on_trial" else status),
                "lemon_squeezy_subscription_id": sub_id,
                "billing_payment_failed_at": None,
                "updated_at": datetime.now(timezone.utc),
            }
            if event_name == "subscription_payment_success":
                now = datetime.now(timezone.utc)
                set_payload["billing_last_paid_at"] = now
                set_payload["billing_has_successful_subscription_charge"] = True
            if customer_id:
                set_payload["lemon_squeezy_customer_id"] = customer_id
            if start_str:
                set_payload["subscription_start"] = start_str
            if end_str:
                set_payload["subscription_end"] = end_str
            if status == "active":
                set_payload["trial_ends_at"] = None
            # Mark trial as used so they cannot get another trial (same logic as Razorpay)
            if status in ("active", "on_trial"):
                set_payload["trial_used_at"] = datetime.now(timezone.utc)
            await db.users.update_one({"id": user_id}, {"$set": set_payload})
            await _pause_campaigns_if_outbound_blocked(user_id)
            # Send renewal/payment emails only on explicit payment-success webhook.
            if event_name == "subscription_payment_success" and set_payload.get("subscription_status") == "active":
                await _emit_payment_confirmed(user_id, source=f"lemonsqueezy_webhook:{event_name}", cycle_end=end_str)
                await _emit_subscription_renewed(user_id, source=f"lemonsqueezy_webhook:{event_name}", cycle_end=end_str)

        elif event_name == "subscription_cancelled":
            set_payload = {
                "subscription_status": "cancelled",
                "billing_payment_failed_at": None,
                "updated_at": datetime.now(timezone.utc),
            }
            if end_str:
                set_payload["subscription_end"] = end_str
            if app_plan_id:
                set_payload["plan_id"] = app_plan_id
            await db.users.update_one({"id": user_id}, {"$set": set_payload})

        elif event_name == "subscription_payment_failed":
            hint = ", ".join(
                p
                for p in (
                    f"status: {status}" if status else "",
                    str(attrs.get("payment_failed_at") or "").strip() or "",
                )
                if p
            ) or None
            await _notify_subscription_payment_failed(
                user_id, provider="lemonsqueezy", error_hint=hint
            )
            await db.users.update_one(
                {"id": user_id},
                {
                    "$set": {
                        "billing_payment_failed_at": datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )

        elif event_name == "subscription_expired":
            await db.users.update_one(
                {"id": user_id},
                {
                    "$set": {
                        "plan_id": "free",
                        "subscription_status": "active",
                        "subscription_start": None,
                        "subscription_end": end_str or None,
                        "lemon_squeezy_subscription_id": None,
                        "lemon_squeezy_customer_id": None,
                        "trial_ends_at": None,
                        "billing_payment_failed_at": None,
                        "billing_last_paid_at": None,
                        "billing_has_successful_subscription_charge": False,
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )

    elif event_name.startswith("order_"):
        data = payload.get("data") or {}
        attrs = data.get("attributes") or {}
        if data.get("type") != "orders":
            outcome = "ignored_order_wrong_data_type"
            await _flush_lemon_log()
            return {"ok": True}
        custom_data = (payload.get("meta") or {}).get("custom_data") or {}
        if custom_data.get("purpose") != "credits_topup":
            outcome = "ignored_order_not_credit_topup"
            await _flush_lemon_log()
            return {"ok": True}
        order_user_id = ls._get_user_id_from_payload(payload)
        topup_id = str(custom_data.get("credit_topup_id") or "").strip()
        order_id = str(data.get("id") or "").strip()
        log_user_id = order_user_id
        log_external = order_id or log_external
        if not order_user_id or not topup_id or not order_id:
            logger.warning("Lemon Squeezy order webhook missing top-up identifiers")
            outcome = "order_missing_identifiers"
            await _flush_lemon_log()
            return {"ok": True}
        topup = await db.credit_topups.find_one(
            {"id": topup_id, "user_id": order_user_id, "provider": "lemonsqueezy"},
            {"_id": 0},
        )
        if not topup:
            logger.warning("Lemon Squeezy order webhook: no top-up doc found for %s", topup_id)
            outcome = "order_topup_doc_not_found"
            await _flush_lemon_log()
            return {"ok": True}
        if event_name in ("order_created", "order_paid"):
            await db.credit_topups.update_one(
                {"id": topup_id},
                {
                    "$set": {
                        "lemonsqueezy_order_id": order_id,
                        "order_identifier": attrs.get("identifier"),
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )
            await _fulfill_credit_topup(
                user_id=order_user_id,
                topup_id=topup_id,
                provider="lemonsqueezy",
                external_reference=order_id,
                metadata={"identifier": attrs.get("identifier")},
            )

    if outcome == "received":
        if event_name.startswith("subscription_") or event_name.startswith("order_"):
            outcome = "processed"
        else:
            outcome = "ignored_unhandled_event"

    await _flush_lemon_log()
    return {"ok": True}
