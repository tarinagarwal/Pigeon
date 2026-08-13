"""User settings and webhooks routes."""
from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid

from database import db
from routes.dependencies import get_current_user
from routes.schemas import (
    UserSettingsPayload,
    WebhookCreate,
    WebhookUpdate,
    GoogleOAuthConfigPayload,
    SerperSettingsPayload,
    ZeroBounceSettingsPayload,
    ZeroBounceValidateTestPayload,
)
from services.encryption_helper import encrypt_value
from services.email_validation import validate_email_full
from services.zerobounce_helpers import get_zerobounce_api_key_for_user

router = APIRouter()


DEFAULT_NOTIFICATIONS = {
    "campaign_updates": True,
    "reply_notifications": True,
    "health_alerts": False,
    "weekly_reports": True,
    "product_updates": True,
    "ticket_reply": True,
    "lifecycle_automation": True,
}

DEFAULT_COMPLIANCE = {
    "spam_words": (
        "100% free, Affordable, Bargain, Beneficiary, Best price, Cash, Cash bonus, Cheap, Claims, Collect, Cost, Credit, Credit bureaus, Debt, Discount, Earn, Earn $, Earn extra cash, Eliminate debt, Equity, Fast cash, Financial freedom, Free, Free gift, Free investment, Full refund, Hidden assets, Income, Investment, Loans, Lower interest rate, Lowest price, Million dollars, Money back, Mortgage, No cost, No fees, No hidden costs, No interest, No investment, Obligation, One hundred percent free, Pennies a day, Profits, Pure profit, Refinance, Save big, Save up to, Total freedom, Unsecured debt, US dollars, Act now, Apply now, Apply online, Call free, Call now, Can't live without, Do it today, Don't delete, Don't hesitate, Exclusive deal, Expire, For only, Get it now, Get started now, Great offer, Immediate, Instant, Limited time, New customers only, Now only, Offer expires, Once in a lifetime, Order now, Special promotion, Urgent, While supplies last, Ad, All natural, All new, Amazing, As seen on, Auto email removal, Believe me, Bonus, Cancel at any time, Cards accepted, Certified, Click below, Click here, Congratulations, Dear friend, Direct email, Direct marketing, Double your, Fantastic deal, For free, Free access, Free consultation, Free hosting, Free info, Free membership, Free preview, Free priority mail, Free quote, Free sample, Free trial, Guaranteed, Increase sales, Join millions, Multi-level marketing, No catch, No strings attached, Performance, Prize, Promise, Quotes, Removal, Risk-free, Satisfaction guaranteed, Search engine listing, Success, Thousands, Unlimited, Winner, Additional income, Age retrace, Cure, Diagnostics, Fast Viagra, Herbs, Life insurance, Lose weight, Lose weight spam, Medicine, No medical exams, No prescription, Online pharmacy, Pharmacy, Removes wrinkles, Reverses aging, Stop snoring, Valium, Vicodin, Weight loss, Xanax, Account compromised, Billing address, Form, Important information regarding, Information you requested, Legal, Message contains, Password, Recover, Security alert, Social Security Number, This isn't junk, This isn't spam, Unauthorized, Verify your account"
    ),
    "max_links_per_email": 3,
    "max_images_per_email": 2,
    "require_unsubscribe_link": False,
}

DEFAULT_EMAIL_INFRA = {
    "enabled": False,
}


async def create_default_settings_for_user(user_id: str) -> None:
    """Create and store default settings (notifications + compliance) for a new user. Called at registration."""
    now = datetime.now(timezone.utc)
    await db.user_settings.insert_one({
        "user_id": user_id,
        "notifications": DEFAULT_NOTIFICATIONS,
        "compliance": dict(DEFAULT_COMPLIANCE),
        "email_infra": dict(DEFAULT_EMAIL_INFRA),
        "updated_at": now,
    })


async def _get_settings_for_user(user_id: str):
    doc = await db.user_settings.find_one({"user_id": user_id}, {"_id": 0})
    if not doc:
        return {
            "user_id": user_id,
            "notifications": DEFAULT_NOTIFICATIONS,
            "compliance": DEFAULT_COMPLIANCE,
            "email_infra": DEFAULT_EMAIL_INFRA,
            "default_reply_to_type": None,
            "default_reply_to_id": None,
        }
    out = {
        "user_id": user_id,
        "notifications": {**DEFAULT_NOTIFICATIONS, **doc.get("notifications", {})},
        "compliance": {**DEFAULT_COMPLIANCE, **doc.get("compliance", {})},
        "email_infra": {**DEFAULT_EMAIL_INFRA, **doc.get("email_infra", {})},
    }
    out["default_reply_to_type"] = doc.get("default_reply_to_type")
    out["default_reply_to_id"] = doc.get("default_reply_to_id")
    return out


@router.get("/settings")
async def get_settings(current_user: dict = Depends(get_current_user)):
    """Get current user settings (notifications, compliance)."""
    return await _get_settings_for_user(current_user["id"])


@router.put("/settings")
async def update_settings(
    payload: UserSettingsPayload,
    current_user: dict = Depends(get_current_user),
):
    """Update user settings (notifications, compliance, default reply-to)."""
    user_id = current_user["id"]
    update_data = {"updated_at": datetime.now(timezone.utc)}
    if payload.notifications is not None:
        update_data["notifications"] = payload.notifications.model_dump()
    if payload.compliance is not None:
        update_data["compliance"] = payload.compliance.model_dump()
    if payload.email_infra is not None:
        update_data["email_infra"] = payload.email_infra.model_dump()
    dump = payload.model_dump(exclude_unset=True)
    if "default_reply_to_type" in dump:
        update_data["default_reply_to_type"] = dump["default_reply_to_type"]
    if "default_reply_to_id" in dump:
        update_data["default_reply_to_id"] = dump["default_reply_to_id"]
    if len(update_data) == 1:
        return await _get_settings_for_user(user_id)
    update_data["user_id"] = user_id
    await db.user_settings.update_one(
        {"user_id": user_id},
        {"$set": update_data},
        upsert=True,
    )
    return await _get_settings_for_user(user_id)


# --- Google OAuth (user's own credentials) ---


@router.get("/settings/google-oauth")
async def get_google_oauth_config(current_user: dict = Depends(get_current_user)):
    """Get whether user has configured their own Google OAuth credentials and per-user use-app-default. Never returns client_secret."""
    user_id = current_user["id"]
    doc = await db.user_settings.find_one(
        {"user_id": user_id},
        {"_id": 0, "google_oauth_client_id": 1, "google_oauth_client_secret_encrypted": 1, "use_app_google_oauth": 1},
    )
    has_id = bool(doc and doc.get("google_oauth_client_id"))
    has_secret = bool(doc and doc.get("google_oauth_client_secret_encrypted"))
    use_app_default = bool(doc and doc.get("use_app_google_oauth") is True)
    return {
        "user_oauth_configured": has_id and has_secret,
        "google_client_id_configured": has_id,
        "use_app_google_oauth": use_app_default,
    }


@router.put("/settings/google-oauth")
async def update_google_oauth_config(
    payload: GoogleOAuthConfigPayload,
    current_user: dict = Depends(get_current_user),
):
    """Save user's Google OAuth client ID, optional client secret (encrypted at rest), and per-user use-app-default."""
    user_id = current_user["id"]
    update_data = {"updated_at": datetime.now(timezone.utc)}
    if payload.google_client_id is not None:
        update_data["google_oauth_client_id"] = payload.google_client_id.strip() or None
    if payload.google_client_secret is not None:
        if payload.google_client_secret.strip():
            update_data["google_oauth_client_secret_encrypted"] = encrypt_value(
                payload.google_client_secret.strip()
            )
        else:
            update_data["google_oauth_client_secret_encrypted"] = None
    # use_app_google_oauth is admin-only; do not allow users to set it via this endpoint
    if len(update_data) == 1:
        return await get_google_oauth_config(current_user)
    await db.user_settings.update_one(
        {"user_id": user_id},
        {"$set": update_data},
        upsert=True,
    )
    return await get_google_oauth_config(current_user)


@router.get("/settings/serper")
async def get_serper_settings(current_user: dict = Depends(get_current_user)):
    """Return whether the user has a Serper API key saved (never returns the key)."""
    user_id = current_user["id"]
    doc = await db.user_settings.find_one(
        {"user_id": user_id},
        {"_id": 0, "serper_api_key_encrypted": 1},
    )
    enc = doc.get("serper_api_key_encrypted") if doc else None
    return {"serper_configured": bool(enc)}


@router.put("/settings/serper")
async def update_serper_settings(
    payload: SerperSettingsPayload,
    current_user: dict = Depends(get_current_user),
):
    """Save or clear encrypted Serper API key for Smart Leads."""
    user_id = current_user["id"]
    update_data = {"updated_at": datetime.now(timezone.utc)}
    if payload.serper_api_key is not None:
        if payload.serper_api_key.strip():
            update_data["serper_api_key_encrypted"] = encrypt_value(payload.serper_api_key.strip())
        else:
            update_data["serper_api_key_encrypted"] = None
    if len(update_data) == 1:
        return await get_serper_settings(current_user)
    await db.user_settings.update_one(
        {"user_id": user_id},
        {"$set": update_data},
        upsert=True,
    )
    return await get_serper_settings(current_user)


@router.get("/settings/zerobounce")
async def get_zerobounce_settings(current_user: dict = Depends(get_current_user)):
    """Return whether the user has a ZeroBounce API key saved (never returns the key)."""
    user_id = current_user["id"]
    doc = await db.user_settings.find_one(
        {"user_id": user_id},
        {"_id": 0, "zerobounce_api_key_encrypted": 1},
    )
    enc = doc.get("zerobounce_api_key_encrypted") if doc else None
    return {"zerobounce_configured": bool(enc)}


@router.put("/settings/zerobounce")
async def update_zerobounce_settings(
    payload: ZeroBounceSettingsPayload,
    current_user: dict = Depends(get_current_user),
):
    """Save or clear encrypted ZeroBounce API key (required for Smart Leads pipeline validation)."""
    user_id = current_user["id"]
    update_data = {"updated_at": datetime.now(timezone.utc)}
    if payload.zerobounce_api_key is not None:
        if payload.zerobounce_api_key.strip():
            update_data["zerobounce_api_key_encrypted"] = encrypt_value(payload.zerobounce_api_key.strip())
        else:
            update_data["zerobounce_api_key_encrypted"] = None
    if len(update_data) == 1:
        return await get_zerobounce_settings(current_user)
    await db.user_settings.update_one(
        {"user_id": user_id},
        {"$set": update_data},
        upsert=True,
    )
    return await get_zerobounce_settings(current_user)


@router.post("/settings/zerobounce/test-validate")
async def test_zerobounce_validate(
    payload: ZeroBounceValidateTestPayload,
    current_user: dict = Depends(get_current_user),
):
    """Validate one email via stored ZeroBounce key and return raw API payload."""
    user_id = current_user["id"]
    key = await get_zerobounce_api_key_for_user(user_id)
    if not key:
        raise HTTPException(
            status_code=400,
            detail="ZeroBounce key not configured. Add it first in Settings → Integrations.",
        )

    email = payload.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")

    # validate_email_full already calls ZeroBounce /v2/validate when key is present.
    result = validate_email_full(
        email,
        ip=None,
        zerobounce_api_key=key,
        zerobounce_timeout=payload.timeout,
        zerobounce_activity_data=payload.activity_data,
        zerobounce_verify_plus=payload.verify_plus,
    )
    zb = result.get("zerobounce")
    zb_error = result.get("zerobounce_error")

    # Optional flags are currently accepted for UI parity and surfaced back.
    # validate_email_full today uses default ZeroBounce validate behavior.
    return {
        "request": {
            "url": "https://api.zerobounce.net/v2/validate",
            "email": email,
            "timeout": payload.timeout,
            "activity_data": payload.activity_data,
            "verify_plus": payload.verify_plus,
            "api_key_present": True,
        },
        "ok": zb is not None and not zb_error,
        "zerobounce_response": zb,
        "error": zb_error,
        "validation": result,
    }


@router.get("/settings/gmail-oauth-status")
async def get_gmail_oauth_status(current_user: dict = Depends(get_current_user)):
    """Return whether user has own OAuth config and whether this user has use-app-default enabled (per-user, default False)."""
    user_id = current_user["id"]
    doc = await db.user_settings.find_one(
        {"user_id": user_id},
        {"_id": 0, "google_oauth_client_id": 1, "google_oauth_client_secret_encrypted": 1, "use_app_google_oauth": 1},
    )
    user_oauth_configured = bool(
        doc and doc.get("google_oauth_client_id") and doc.get("google_oauth_client_secret_encrypted")
    )
    app_default_enabled = bool(doc and doc.get("use_app_google_oauth") is True)
    return {
        "user_oauth_configured": user_oauth_configured,
        "app_default_enabled": app_default_enabled,
    }


# --- Webhooks ---


@router.get("/webhooks")
async def list_webhooks(current_user: dict = Depends(get_current_user)):
    """List webhooks for the current user."""
    user_id = current_user["id"]
    cursor = db.webhooks.find({"user_id": user_id}, {"_id": 0})
    items = await cursor.to_list(None)
    return items


@router.post("/webhooks")
async def create_webhook(
    payload: WebhookCreate,
    current_user: dict = Depends(get_current_user),
):
    """Create a webhook."""
    user_id = current_user["id"]
    webhook_id = str(uuid.uuid4())
    doc = {
        "id": webhook_id,
        "user_id": user_id,
        "url": payload.url,
        "events": payload.events or [],
        "created_at": datetime.now(timezone.utc),
    }
    await db.webhooks.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/webhooks/{webhook_id}")
async def update_webhook(
    webhook_id: str,
    payload: WebhookUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Update a webhook."""
    user_id = current_user["id"]
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")
    update_data["updated_at"] = datetime.now(timezone.utc)
    result = await db.webhooks.update_one(
        {"id": webhook_id, "user_id": user_id},
        {"$set": update_data},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Webhook not found")
    doc = await db.webhooks.find_one({"id": webhook_id, "user_id": user_id}, {"_id": 0})
    return doc


@router.delete("/webhooks/{webhook_id}")
async def delete_webhook(
    webhook_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Delete a webhook."""
    user_id = current_user["id"]
    result = await db.webhooks.delete_one({"id": webhook_id, "user_id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Webhook not found")
    return {"message": "Webhook deleted"}
