"""Authentication routes"""
import hashlib
import os
import random
import secrets
import string
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from datetime import datetime, timezone, timedelta
import uuid
import logging

from database import db
from models import User
from routes.dependencies import get_current_user
from routes.settings import create_default_settings_for_user
from routes.auth_utils import get_password_hash, verify_password, create_access_token, normalize_email, JWT_SECRET, JWT_ALGORITHM
from routes.region import get_client_ip
from services.slack_service import notify_new_user_signup
from services.email_templates import verification_otp, login_2fa_otp, password_reset, mailbox_password_reset
from routes.schemas import (
    RegisterRequest,
    LoginRequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
    ImpersonateRequest,
    ProfileUpdateRequest,
    ChangePasswordRequest,
    TwoFARequest,
    VerifyEmailRequest,
    ResendVerificationRequest,
    Verify2FARequest,
    Resend2FARequest,
    MailboxLoginRequest,
    MailboxForgotPasswordRequest,
    MailboxResetPasswordRequest,
)

router = APIRouter()

# Cookie name for JWT (HTTP-only; used instead of storing token in localStorage)
AUTH_COOKIE_NAME = "auth_token"
# Mailbox login uses a separate cookie so main app and mailbox app can coexist
MAILBOX_AUTH_COOKIE_NAME = "mailbox_auth_token"
# Secure cookie only when explicitly enabled (e.g. production HTTPS)
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"

# Injected from server.py
plan_service = None
smtp_service = None
lifecycle_automation_service = None


def _set_auth_cookie(response: JSONResponse, token: str, remember_me: bool = False) -> None:
    """Set HTTP-only auth cookie on response."""
    max_age = 30 * 24 * 3600 if remember_me else 24 * 3600  # 30 days vs 24 hours
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        max_age=max_age,
        path="/",
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
    )


def _clear_auth_cookie(response: JSONResponse) -> None:
    """Clear auth cookie on response."""
    response.delete_cookie(key=AUTH_COOKIE_NAME, path="/")


def _set_mailbox_auth_cookie(response: JSONResponse, token: str, max_age_days: int = 7) -> None:
    """Set HTTP-only mailbox auth cookie."""
    response.set_cookie(
        key=MAILBOX_AUTH_COOKIE_NAME,
        value=token,
        max_age=max_age_days * 24 * 3600,
        path="/",
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
    )


def _clear_mailbox_auth_cookie(response: JSONResponse) -> None:
    """Clear mailbox auth cookie."""
    response.delete_cookie(key=MAILBOX_AUTH_COOKIE_NAME, path="/")


def init_plan_service(service):
    global plan_service
    plan_service = service


def init_smtp_service(service):
    global smtp_service
    smtp_service = service


def init_lifecycle_automation_service(service):
    """Inject lifecycle automation service."""
    global lifecycle_automation_service
    lifecycle_automation_service = service


# StopForumSpam: block registration if email (or IP) has frequency >= this threshold
SFS_BLOCK_FREQUENCY_THRESHOLD = 50

# Registration rate limit: max N signups per IP and per cookie in a 24h window
REGISTRATION_RATE_LIMIT_MAX = 2
REGISTRATION_RATE_LIMIT_WINDOW_HOURS = 24
# Cookie name is intentionally non-obvious so users cannot easily guess its purpose (signup rate-limit fingerprint)
REGISTRATION_FINGERPRINT_COOKIE_NAME = "_sgr"


def _hash_fingerprint(value: str) -> str:
    """Return SHA256 hex digest of the fingerprint value (we store hash, not raw)."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


async def _registration_rate_limit_exceeded(ip: str | None, cookie_value: str | None) -> bool:
    """Return True if this IP or this cookie has already reached the max registrations in the window."""
    if not ip and not cookie_value:
        return False
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(hours=REGISTRATION_RATE_LIMIT_WINDOW_HOURS)
    coll = db.registration_rate_limits
    if ip:
        ip_count = await coll.count_documents({"ip": ip, "created_at": {"$gte": window_start}})
        if ip_count >= REGISTRATION_RATE_LIMIT_MAX:
            return True
    if cookie_value:
        cookie_hash = _hash_fingerprint(cookie_value)
        cookie_count = await coll.count_documents({"cookie_hash": cookie_hash, "created_at": {"$gte": window_start}})
        if cookie_count >= REGISTRATION_RATE_LIMIT_MAX:
            return True
    return False


async def _record_registration_for_rate_limit(ip: str | None, cookie_value_to_store: str) -> None:
    """Record one registration for rate limiting. cookie_value_to_store is the new token we set in the response."""
    now = datetime.now(timezone.utc)
    cookie_hash = _hash_fingerprint(cookie_value_to_store)
    await db.registration_rate_limits.insert_one({
        "ip": ip or "",
        "cookie_hash": cookie_hash,
        "created_at": now,
    })


async def _is_email_blocked_by_stopforumspam(email: str, ip: str | None = None) -> bool:
    """Return True if email (or IP) should be blocked based on StopForumSpam (frequency >= 50).
    On timeout or API error, returns False (fail open) so legitimate users are not blocked."""
    if not email or not email.strip():
        return False
    try:
        params = {"email": email.strip(), "f": "json"}
        if ip and ip.strip():
            params["ip"] = ip.strip()
        url = "https://www.stopforumspam.com/api?" + urlencode(params)
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
        data = resp.json()
        # Response can contain "email" and/or "ip" keys with appears, frequency
        for key in ("email", "ip"):
            block_info = data.get(key)
            if not block_info or not isinstance(block_info, dict):
                continue
            appears = block_info.get("appears")
            if appears in (None, 0, False, "no", ""):
                continue
            try:
                freq = int(block_info.get("frequency") or 0)
            except (TypeError, ValueError):
                freq = 0
            if freq >= SFS_BLOCK_FREQUENCY_THRESHOLD:
                return True
        return False
    except Exception:
        return False


def _device_from_user_agent(ua: str) -> str:
    """Return a short device/browser string from User-Agent."""
    if not ua or not ua.strip():
        return "Unknown"
    ua_lower = ua.lower()
    if "chrome" in ua_lower and "edg" not in ua_lower:
        return "Chrome"
    if "firefox" in ua_lower:
        return "Firefox"
    if "safari" in ua_lower and "chrome" not in ua_lower:
        return "Safari"
    if "edg" in ua_lower:
        return "Edge"
    if "mobile" in ua_lower or "android" in ua_lower or "iphone" in ua_lower:
        return "Mobile"
    return "Browser"


async def _create_session(user_id: str, jti: str, request: Request) -> None:
    """Create a session record for the given user and jti."""
    user_agent = request.headers.get("user-agent") or ""
    client_host = getattr(request.client, "host", None) if request.client else None
    now = datetime.now(timezone.utc)
    await db.sessions.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "jti": jti,
        "user_agent": user_agent[:512] if user_agent else "",
        "ip": client_host or "",
        "created_at": now,
        "last_active": now,
    })


def _generate_verification_code() -> str:
    """Generate a 6-digit numeric OTP."""
    return "".join(random.choices(string.digits, k=6))


async def _send_verification_email(to_email: str, code: str) -> bool:
    """Send email verification OTP. Returns True if sent."""
    subject, body_plain, body_html = verification_otp(code, expires_minutes=15)
    if smtp_service:
        return await smtp_service.send_app_notification_email(
            to_email=to_email,
            subject=subject,
            body_plain=body_plain,
            body_html=body_html,
        )
    logging.warning("SMTPService not injected; verification email not sent to %s", to_email)
    return False


async def _send_login_2fa_email(to_email: str, code: str) -> bool:
    """Send login 2FA OTP. Returns True if sent."""
    subject, body_plain, body_html = login_2fa_otp(code, expires_minutes=5)
    if smtp_service:
        return await smtp_service.send_app_notification_email(
            to_email=to_email,
            subject=subject,
            body_plain=body_plain,
            body_html=body_html,
        )
    logging.warning("SMTPService not injected; login 2FA email not sent to %s", to_email)
    return False


# Self-serve signup is closed: accounts are provisioned by an admin after payment.
# Set ALLOW_PUBLIC_SIGNUP=true to reopen public registration.
ALLOW_PUBLIC_SIGNUP = (os.environ.get("ALLOW_PUBLIC_SIGNUP") or "").strip().lower() in ("1", "true", "yes")


@router.post("/auth/register")
async def register(body: RegisterRequest, request: Request):
    """Register a new user. Disabled unless ALLOW_PUBLIC_SIGNUP is set."""
    if not ALLOW_PUBLIC_SIGNUP:
        raise HTTPException(
            status_code=403,
            detail="Public sign-up is closed. Contact us to have an account created for you.",
        )
    email = normalize_email(body.email)
    client_ip = get_client_ip(request)
    # StopForumSpam: block known spam emails/IPs (frequency >= 50)
    if await _is_email_blocked_by_stopforumspam(email, client_ip):
        raise HTTPException(
            status_code=400,
            detail="We can't complete registration for this email. Please use a different email or contact support.",
        )
    # Rate limit: max 2 registrations per IP and per fingerprint cookie in 24h
    fingerprint_cookie = (request.cookies.get(REGISTRATION_FINGERPRINT_COOKIE_NAME) or "").strip() or None
    if await _registration_rate_limit_exceeded(client_ip, fingerprint_cookie):
        raise HTTPException(
            status_code=400,
            detail="Too many registration attempts. Please try again later or contact support.",
        )
    # Check if user already exists (case-insensitive: any casing is considered taken)
    existing_user = await db.users.find_one({
        "$or": [{"email": email}, {"email": body.email.strip()}]
    })
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Parse full_name into first_name and last_name (first word / rest)
    parts = (body.full_name or "").strip().split(None, 1)
    first_name = (parts[0].strip() or None) if parts else None
    last_name = (parts[1].strip() or None) if len(parts) > 1 else None
    company = (body.company or "").strip() or None

    # Create new user with email_verified=False (two-step verification), two_fa_enabled=True by default
    now = datetime.now(timezone.utc)
    user = User(
        email=email,
        password_hash=get_password_hash(body.password),
        first_name=first_name,
        last_name=last_name,
        company=company,
        plan_id="free",
        subscription_status="free",
        trial_ends_at=None,
        subscription_start=None,
        subscription_end=None,
        email_verified=False,
        two_fa_enabled=True,
    )
    user_dict = user.model_dump()
    await db.users.insert_one(user_dict)
    
    await create_default_settings_for_user(user.id)
    await notify_new_user_signup(email=user.email, user_id=user.id)

    # Generate and store 6-digit OTP (expires in 15 minutes)
    code = _generate_verification_code()
    expires_at = now + timedelta(minutes=15)
    await db.email_verification_codes.update_one(
        {"user_id": user.id},
        {
            "$set": {
                "user_id": user.id,
                "email": email,
                "code": code,
                "expires_at": expires_at,
                "created_at": now,
            }
        },
        upsert=True,
    )
    await _send_verification_email(email, code)

    # Record this registration for IP + cookie rate limit; set opaque fingerprint cookie (name is non-obvious)
    fingerprint_token = secrets.token_urlsafe(32)
    await _record_registration_for_rate_limit(client_ip, fingerprint_token)

    # Do not create session or token until email is verified
    response = JSONResponse(content=jsonable_encoder({
        "verification_required": True,
        "email": email,
        "message": "Check your email for the verification code.",
    }))
    response.set_cookie(
        key=REGISTRATION_FINGERPRINT_COOKIE_NAME,
        value=fingerprint_token,
        max_age=365 * 24 * 3600,
        path="/",
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
    )
    return response


@router.post("/auth/login")
async def login(body: LoginRequest, request: Request):
    """Login user and return JWT token (email is case-insensitive)."""
    email_norm = normalize_email(body.email)
    # Find user by normalized or exact email so existing mixed-case emails still work
    user = await db.users.find_one({
        "$or": [{"email": email_norm}, {"email": body.email.strip()}]
    })
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Verify password before revealing email_verified status
    if not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Check if user is banned
    if user.get("status") == "banned":
        raise HTTPException(status_code=403, detail="Account is banned and cannot be accessed")

    # Require email verification for new users (email_verified False); redirect to verify-email like after registration
    if user.get("email_verified") is False:
        return JSONResponse(content=jsonable_encoder({
            "requires_email_verification": True,
            "email": user["email"],
            "message": "Please verify your email to continue.",
        }))

    # 2FA: default True for users without the field; if enabled, send OTP and return token for verify-2fa step
    if user.get("two_fa_enabled", True):
        two_fa_token = str(uuid.uuid4())
        code = _generate_verification_code()
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(minutes=5)
        await db.login_2fa_pending.update_one(
            {"token": two_fa_token},
            {
                "$set": {
                    "token": two_fa_token,
                    "user_id": user["id"],
                    "email": user["email"],
                    "code": code,
                    "expires_at": expires_at,
                    "remember_me": body.remember_me,
                    "created_at": now,
                }
            },
            upsert=True,
        )
        await _send_login_2fa_email(user["email"], code)
        return JSONResponse(content=jsonable_encoder({
            "requires_2fa": True,
            "two_fa_token": two_fa_token,
            "message": "Check your email for the verification code.",
        }))

    expires_delta = timedelta(days=30) if body.remember_me else timedelta(hours=24)
    jti = str(uuid.uuid4())
    access_token = create_access_token(data={"sub": user["id"]}, expires_delta=expires_delta, jti=jti)
    await _create_session(user["id"], jti, request)
    
    user_dict = {k: v for k, v in user.items() if k != "password_hash" and k != "_id"}
    
    response = JSONResponse(content=jsonable_encoder({
        "user": user_dict,
        "access_token": access_token,
        "token_type": "bearer"
    }))
    _set_auth_cookie(response, access_token, remember_me=body.remember_me)
    return response


@router.post("/auth/verify-2fa")
async def verify_2fa(body: Verify2FARequest, request: Request):
    """Verify login 2FA code; on success create session and return user + token."""
    now = datetime.now(timezone.utc)
    pending = await db.login_2fa_pending.find_one({"token": body.two_fa_token.strip()})
    if not pending:
        raise HTTPException(status_code=400, detail="Invalid or expired code. Please sign in again.")
    expires_at = pending.get("expires_at")
    if expires_at and (expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)) < now:
        await db.login_2fa_pending.delete_one({"token": body.two_fa_token})
        raise HTTPException(status_code=400, detail="Code has expired. Please sign in again.")
    if pending.get("code", "").strip() != body.code.strip():
        raise HTTPException(status_code=400, detail="Invalid verification code")
    user_id = pending["user_id"]
    remember_me = pending.get("remember_me", False)
    await db.login_2fa_pending.delete_one({"token": body.two_fa_token})
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=400, detail="User not found. Please sign in again.")
    jti = str(uuid.uuid4())
    expires_delta = timedelta(days=30) if remember_me else timedelta(hours=24)
    access_token = create_access_token(data={"sub": user_id}, expires_delta=expires_delta, jti=jti)
    await _create_session(user_id, jti, request)
    user_dict = {k: v for k, v in user.items() if k != "password_hash" and k != "_id"}
    response = JSONResponse(content=jsonable_encoder({
        "user": user_dict,
        "access_token": access_token,
        "token_type": "bearer",
        "remember_me": remember_me,
    }))
    _set_auth_cookie(response, access_token, remember_me=remember_me)
    return response


@router.post("/auth/resend-2fa")
async def resend_2fa(body: Resend2FARequest):
    """Resend login 2FA code (rate limit: once per 60 seconds per token)."""
    pending = await db.login_2fa_pending.find_one({"token": body.two_fa_token.strip()})
    if not pending:
        raise HTTPException(status_code=400, detail="Invalid or expired. Please sign in again.")
    created = pending.get("created_at")
    if created:
        created_utc = created.replace(tzinfo=timezone.utc) if created.tzinfo is None else created
        if datetime.now(timezone.utc) < created_utc + timedelta(seconds=60):
            raise HTTPException(status_code=429, detail="Please wait a minute before requesting another code.")
    code = _generate_verification_code()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=5)
    await db.login_2fa_pending.update_one(
        {"token": body.two_fa_token},
        {"$set": {"code": code, "expires_at": expires_at, "created_at": now}},
    )
    await _send_login_2fa_email(pending["email"], code)
    return {"message": "A new code has been sent to your email."}


@router.post("/auth/verify-email")
async def verify_email(body: VerifyEmailRequest, request: Request):
    """Verify email with 6-digit OTP sent after registration; on success, log the user in."""
    email = normalize_email(body.email)
    user = await db.users.find_one({
        "$or": [{"email": email}, {"email": body.email.strip()}]
    })
    if not user:
        raise HTTPException(status_code=400, detail="Invalid verification code or email")
    if user.get("email_verified") is True:
        # Already verified; could issue token and redirect, but keep flow simple: tell them to log in
        raise HTTPException(status_code=400, detail="Email is already verified. Please log in.")
    code_doc = await db.email_verification_codes.find_one({
        "user_id": user["id"],
        "email": email,
    })
    if not code_doc:
        raise HTTPException(status_code=400, detail="Invalid or expired verification code")
    expires_at = code_doc.get("expires_at")
    if expires_at and (expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)) < datetime.now(timezone.utc):
        await db.email_verification_codes.delete_one({"user_id": user["id"]})
        raise HTTPException(status_code=400, detail="Verification code has expired. Please request a new one.")
    if code_doc.get("code", "").strip() != body.code.strip():
        raise HTTPException(status_code=400, detail="Invalid verification code")
    # Mark email verified and delete the code
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"email_verified": True, "updated_at": datetime.now(timezone.utc)}},
    )
    if lifecycle_automation_service:
        try:
            await lifecycle_automation_service.emit_event(
                user["id"],
                "signup_confirmed",
                {"email": email},
            )
        except Exception:
            logging.exception("Failed to emit lifecycle signup_confirmed for user %s", user["id"])
    await db.email_verification_codes.delete_one({"user_id": user["id"]})
    # Log the user in (create session and set cookie)
    jti = str(uuid.uuid4())
    access_token = create_access_token(data={"sub": user["id"]}, jti=jti)
    await _create_session(user["id"], jti, request)
    user_dict = {k: v for k, v in user.items() if k != "password_hash" and k != "_id"}
    user_dict["email_verified"] = True
    response = JSONResponse(content=jsonable_encoder({
        "user": user_dict,
        "access_token": access_token,
        "token_type": "bearer",
    }))
    _set_auth_cookie(response, access_token, remember_me=False)
    return response


@router.post("/auth/resend-verification")
async def resend_verification(body: ResendVerificationRequest):
    """Resend the 6-digit verification code (rate limit: once per minute per email)."""
    email = normalize_email(body.email)
    user = await db.users.find_one({
        "$or": [{"email": email}, {"email": body.email.strip()}]
    })
    if not user:
        # Don't reveal whether email exists
        return {"message": "If an account exists with this email, a new verification code has been sent."}
    if user.get("email_verified") is True:
        return {"message": "Email is already verified. You can log in."}
    # Rate limit: require at least 60 seconds since last code
    existing = await db.email_verification_codes.find_one({"user_id": user["id"]})
    if existing:
        created = existing.get("created_at")
        if created:
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) < created + timedelta(seconds=60):
                raise HTTPException(
                    status_code=429,
                    detail="Please wait a minute before requesting another code.",
                )
    code = _generate_verification_code()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=15)
    await db.email_verification_codes.update_one(
        {"user_id": user["id"]},
        {
            "$set": {
                "user_id": user["id"],
                "email": email,
                "code": code,
                "expires_at": expires_at,
                "created_at": now,
            }
        },
        upsert=True,
    )
    await _send_verification_email(email, code)
    return {"message": "A new verification code has been sent to your email."}


@router.get("/auth/me")
async def get_me(request: Request, current_user: dict = Depends(get_current_user)):
    """Get current user information plus plan, usage, limits, and region (country_code, is_india).

    In demo mode, returns a synthetic demo user with placeholder plan/usage instead of
    querying the database.
    """
    from routes.region import get_region_from_request

    is_demo_request = (
        current_user.get("_is_demo")
        or request.query_params.get("demo") == "1"
        or request.headers.get("x-demo-mode") == "1"
    )
    if is_demo_request and current_user.get("id") == "demo-user":
        region = await get_region_from_request(request)
        now = datetime.now(timezone.utc)
        return {
            "id": "demo-user",
            "email": "demo@pigeon.local",
            "first_name": "Demo",
            "last_name": "User",
            "plan_id": "demo",
            "subscription_status": "demo",
            "trial_ends_at": None,
            "trial_used_at": None,
            "subscription_start": None,
            "subscription_end": None,
            "two_fa_enabled": False,
            "credits_balance": 250,
            "credits_total_purchased": 250,
            "credits_total_earned": 40,
            "credits_total_spent": 30,
            "warmup_shared_pool_enabled": False,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
            "plan": {
                "id": "demo",
                "name": "Demo",
                "price": "0",
                "description": "Read-only demo plan with placeholder data.",
                "max_domains": 2,
                "max_subdomains": 3,
                "max_google_accounts": 1,
                "max_campaigns": 3,
                "warmup": True,
                "support": "Demo",
            },
            "limits": {
                "max_domains": 2,
                "max_subdomains": 3,
                "max_google_accounts": 1,
                "max_campaigns": 3,
                "max_monthly_smtp_emails": 3000,
                "warmup": True,
            },
            "usage": {
                "domains": 2,
                "subdomains": 2,
                "campaigns": 2,
                "inboxes": 3,
                "smtp_inboxes": 2,
                "gmail_inboxes": 1,
                "emails_today": 42,
                "smtp_emails_month": 1200,
                "gmail_emails_month": 1800,
            },
            "country_code": region.get("country_code"),
            "is_india": region.get("is_india"),
        }

    payload = {k: v for k, v in current_user.items() if not k.startswith("_")}
    payload["two_fa_enabled"] = current_user.get("two_fa_enabled", True)
    if plan_service:
        plan = await plan_service.get_user_plan(current_user)
        limits = await plan_service.get_user_limits(current_user)
        usage = await plan_service.get_usage(current_user["id"])
        payload["plan"] = plan
        payload["limits"] = limits
        payload["usage"] = usage
        if plan and isinstance(plan.get("id"), str) and plan.get("id"):
            payload["plan_id"] = plan["id"]
    region = await get_region_from_request(request)
    payload["country_code"] = region.get("country_code")
    payload["is_india"] = region.get("is_india")
    return payload

@router.post("/auth/impersonate")
async def impersonate_user(body: ImpersonateRequest, request: Request):
    """Exchange an admin-issued impersonation token for a user session (sets auth cookie). For admin debug use."""
    from jose import jwt

    if not body.token or not body.token.strip():
        raise HTTPException(status_code=400, detail="Token is required")
    try:
        payload = jwt.decode(body.token.strip(), JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired impersonation token")
    if payload.get("type") != "impersonation":
        raise HTTPException(status_code=400, detail="Invalid impersonation token")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid token")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.get("status") == "banned":
        raise HTTPException(status_code=403, detail="Account is banned")
    jti = str(uuid.uuid4())
    access_token = create_access_token(data={"sub": user["id"]}, expires_delta=timedelta(hours=1), jti=jti)
    await _create_session(user["id"], jti, request)
    user_dict = {k: v for k, v in user.items() if k not in ("password_hash", "_id")}
    response = JSONResponse(content=jsonable_encoder({"user": user_dict}))
    _set_auth_cookie(response, access_token, remember_me=False)
    return response


@router.post("/auth/logout")
async def logout(current_user: dict = Depends(get_current_user)):
    """Logout user: clear auth cookie and return success."""
    response = JSONResponse(content={"message": "Logged out successfully"})
    _clear_auth_cookie(response)
    return response

@router.post("/auth/forgot-password")
async def forgot_password(request: ForgotPasswordRequest):
    """Request password reset (email is case-insensitive)."""
    email_norm = normalize_email(request.email)
    # Find user by normalized or exact email so existing mixed-case emails still work
    user = await db.users.find_one({
        "$or": [{"email": email_norm}, {"email": request.email.strip()}]
    })
    if not user:
        # Don't reveal if email exists for security
        return {"message": "If an account exists with this email, a password reset link has been sent."}
    
    # Generate reset token (do not log this value; would expose reset links)
    reset_token = str(uuid.uuid4())
    reset_expiry = datetime.now(timezone.utc) + timedelta(hours=1)  # Token valid for 1 hour
    
    # Store reset token (use normalized email for consistency)
    await db.password_resets.update_one(
        {"user_id": user["id"]},
        {
            "$set": {
                "user_id": user["id"],
                "email": email_norm,
                "reset_token": reset_token,
                "expires_at": reset_expiry,
                "used": False,
                "created_at": datetime.now(timezone.utc)
            }
        },
        upsert=True
    )

    # Send reset email via app notification SMTP (NOTIFICATION_SMTP_* from .env).
    # Be resilient if FRONTEND_URL is not configured in the current environment.
    frontend_url = (os.getenv("FRONTEND_URL") or os.getenv("FRONTEND_URL_MAILBOX") or "").rstrip("/")
    if not frontend_url:
        # Fallback to BACKEND_URL so emails still go out in misconfigured environments.
        frontend_url = (os.getenv("BACKEND_URL") or "").rstrip("/")
    reset_path = f"/reset-password?token={reset_token}"
    reset_url = f"{frontend_url}{reset_path}" if frontend_url else reset_path
    subject, body_plain, body_html = password_reset(reset_url, expires_hours=1)
    if smtp_service:
        sent = await smtp_service.send_app_notification_email(
            to_email=email_norm,
            subject=subject,
            body_plain=body_plain,
            body_html=body_html,
        )
        if sent:
            logging.info("Password reset email sent to %s", email_norm)
        else:
            logging.warning("Password reset email not sent (SMTP not configured or send failed) for %s", email_norm)
    else:
        if not reset_url:
            logging.warning("FRONTEND_URL not set; password reset email not sent for %s", email_norm)
        else:
            logging.warning("SMTPService not injected; password reset email not sent for %s", email_norm)

    return {"message": "If an account exists with this email, a password reset link has been sent."}


@router.post("/auth/reset-password")
async def reset_password(body: ResetPasswordRequest):
    """Set new password using a valid reset token from the forgot-password email."""
    now = datetime.now(timezone.utc)
    doc = await db.password_resets.find_one({
        "reset_token": body.token,
        "used": False,
    })
    if not doc:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")
    expires_at = doc.get("expires_at")
    if expires_at and (expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)) < now:
        raise HTTPException(status_code=400, detail="Reset link has expired")
    user_id = doc["user_id"]
    new_hash = get_password_hash(body.new_password)
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"password_hash": new_hash, "updated_at": now}},
    )
    await db.password_resets.update_one(
        {"reset_token": body.token},
        {"$set": {"used": True, "used_at": now}},
    )
    return {"message": "Password has been reset. You can now log in."}


@router.patch("/auth/me")
async def update_profile(
    payload: ProfileUpdateRequest,
    current_user: dict = Depends(get_current_user),
):
    """Update current user profile (first_name, last_name, company)."""
    user_id = current_user["id"]
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return current_user
    update_data["updated_at"] = datetime.now(timezone.utc)
    await db.users.update_one(
        {"id": user_id},
        {"$set": update_data},
    )
    updated = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return updated


@router.post("/auth/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    current_user: dict = Depends(get_current_user),
):
    """Change password for the current user."""
    user = await db.users.find_one({"id": current_user["id"]})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not verify_password(payload.current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    new_hash = get_password_hash(payload.new_password)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"password_hash": new_hash, "updated_at": datetime.now(timezone.utc)}},
    )
    return {"message": "Password updated successfully"}


@router.put("/auth/2fa")
async def update_2fa(
    payload: TwoFARequest,
    current_user: dict = Depends(get_current_user),
):
    """Enable or disable two-factor authentication (email OTP at login). Default is True; user can disable here."""
    user_id = current_user["id"]
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"two_fa_enabled": payload.enabled, "updated_at": datetime.now(timezone.utc)}},
    )
    updated = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    # Default True when field missing (existing users before 2FA was added)
    return {"two_fa_enabled": updated.get("two_fa_enabled", True), "user": updated}


@router.get("/auth/sessions")
async def get_sessions(current_user: dict = Depends(get_current_user)):
    """Return active sessions for the current user."""
    user_id = current_user["id"]
    current_jti = current_user.get("_jti")
    cursor = db.sessions.find({"user_id": user_id}).sort("last_active", -1)
    sessions = await cursor.to_list(None)
    result = []
    for s in sessions:
        last_active = s.get("last_active") or s.get("created_at")
        if isinstance(last_active, datetime) and last_active.tzinfo is None:
            last_active = last_active.replace(tzinfo=timezone.utc)
        result.append({
            "id": s.get("id") or s.get("jti", ""),
            "jti": s.get("jti", ""),
            "device": _device_from_user_agent(s.get("user_agent", "")),
            "location": s.get("ip") or "Unknown",
            "last_active": last_active.isoformat() if hasattr(last_active, "isoformat") else str(last_active),
            "current": current_jti is not None and s.get("jti") == current_jti,
        })
    return result


@router.post("/auth/sessions/revoke-others")
async def revoke_other_sessions(current_user: dict = Depends(get_current_user)):
    """Revoke all sessions except the current one."""
    user_id = current_user["id"]
    current_jti = current_user.get("_jti")
    if not current_jti:
        return {"message": "Other sessions have been revoked"}
    result = await db.sessions.delete_many({"user_id": user_id, "jti": {"$ne": current_jti}})
    return {"message": "Other sessions have been revoked", "revoked": result.deleted_count}


# --- Mailbox (inbox) login: separate auth for mailbox view ---

@router.post("/auth/mailbox/forgot-password")
async def mailbox_forgot_password(body: MailboxForgotPasswordRequest):
    """Request set/reset password for a mailbox. Sends reset link to the account owner's email."""
    inbox_email = normalize_email(body.inbox_email)
    inbox = await db.inboxes.find_one({
        "$or": [{"email": inbox_email}, {"email": body.inbox_email.strip()}]
    }, {"_id": 0, "id": 1, "user_id": 1, "email": 1})
    if not inbox:
        return {"message": "If this mailbox exists, a password set/reset link has been sent to the account owner's email."}

    user = await db.users.find_one({"id": inbox["user_id"]}, {"_id": 0, "email": 1})
    if not user:
        return {"message": "If this mailbox exists, a password set/reset link has been sent to the account owner's email."}

    owner_email = (user.get("email") or "").strip().lower()
    if not owner_email:
        return {"message": "If this mailbox exists, a password set/reset link has been sent to the account owner's email."}

    reset_token = str(uuid.uuid4())
    reset_expiry = datetime.now(timezone.utc) + timedelta(hours=1)
    await db.mailbox_password_resets.update_one(
        {"inbox_id": inbox["id"]},
        {
            "$set": {
                "inbox_id": inbox["id"],
                "inbox_email": inbox.get("email") or inbox_email,
                "reset_token": reset_token,
                "expires_at": reset_expiry,
                "used": False,
                "created_at": datetime.now(timezone.utc),
            }
        },
        upsert=True,
    )

    # Build reset URL, falling back gracefully if FRONTEND_URL is missing.
    frontend_url = (os.getenv("FRONTEND_URL") or os.getenv("FRONTEND_URL_MAILBOX") or "").rstrip("/")
    if not frontend_url:
        frontend_url = (os.getenv("BACKEND_URL") or "").rstrip("/")
    reset_path = f"/mailbox/reset-password?token={reset_token}"
    reset_url = f"{frontend_url}{reset_path}" if frontend_url else reset_path
    subject, body_plain, body_html = mailbox_password_reset(
        reset_url,
        inbox.get("email") or inbox_email,
        expires_hours=1,
    )
    if smtp_service:
        sent = await smtp_service.send_app_notification_email(
            to_email=owner_email,
            subject=subject,
            body_plain=body_plain,
            body_html=body_html,
        )
        if sent:
            logging.info(
                "Mailbox password reset email sent to owner %s for inbox %s",
                owner_email,
                inbox_email,
            )
        else:
            logging.warning(
                "Mailbox reset email not sent for inbox %s",
                inbox_email,
            )
    else:
        logging.warning(
            "SMTPService not injected; mailbox reset email not sent for %s",
            inbox_email,
        )

    return {
        "message": "If this mailbox exists, a password set/reset link has been sent to the account owner's email."
    }


@router.post("/auth/mailbox/reset-password")
async def mailbox_reset_password(body: MailboxResetPasswordRequest):
    """Set or reset mailbox password using token from the forgot-password email."""
    now = datetime.now(timezone.utc)
    doc = await db.mailbox_password_resets.find_one({
        "reset_token": body.token,
        "used": False,
    })
    if not doc:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")
    expires_at = doc.get("expires_at")
    if expires_at and (expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)) < now:
        raise HTTPException(status_code=400, detail="Reset link has expired")
    inbox_id = doc["inbox_id"]
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    new_hash = get_password_hash(body.new_password)
    await db.inboxes.update_one(
        {"id": inbox_id},
        {"$set": {"mailbox_password_hash": new_hash, "updated_at": now}},
    )
    await db.mailbox_password_resets.update_one(
        {"reset_token": body.token},
        {"$set": {"used": True, "used_at": now}},
    )
    return {"message": "Mailbox password has been set. You can now log in to the mailbox."}


@router.post("/auth/mailbox/login")
async def mailbox_login(body: MailboxLoginRequest):
    """Log in with inbox email and mailbox password. Returns JWT for mailbox-scoped API."""
    inbox_email = normalize_email(body.inbox_email)
    inbox = await db.inboxes.find_one({
        "$or": [{"email": inbox_email}, {"email": body.inbox_email.strip()}]
    }, {"_id": 0, "id": 1, "user_id": 1, "email": 1, "mailbox_password_hash": 1})
    if not inbox:
        raise HTTPException(status_code=401, detail="Invalid mailbox email or password")

    mailbox_hash = inbox.get("mailbox_password_hash")
    if not mailbox_hash:
        raise HTTPException(
            status_code=400,
            detail="No password set for this mailbox. Use “Forgot password?” to receive a set-password link at the account owner’s email.",
        )
    if not verify_password(body.password, mailbox_hash):
        raise HTTPException(status_code=401, detail="Invalid mailbox email or password")

    expires_delta = timedelta(days=7)
    access_token = create_access_token(
        data={
            "sub": inbox["id"],
            "type": "mailbox",
            "user_id": inbox["user_id"],
        },
        expires_delta=expires_delta,
    )
    inbox_safe = {k: v for k, v in inbox.items() if k != "mailbox_password_hash"}
    response = JSONResponse(content=jsonable_encoder({
        "inbox": inbox_safe,
        "access_token": access_token,
        "token_type": "bearer",
    }))
    _set_mailbox_auth_cookie(response, access_token, max_age_days=7)
    return response


@router.post("/auth/mailbox/logout")
async def mailbox_logout():
    """Clear mailbox auth cookie."""
    response = JSONResponse(content={"message": "Logged out"})
    _clear_mailbox_auth_cookie(response)
    return response
