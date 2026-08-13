"""Rent Your Network (RYN) routes.

Completely separate auth system (ryn_auth_token cookie) from the main app.
Users sign up, list emails they want to rent, earn credits when their emails
are rented by others, and can browse the marketplace.
"""
import os
import random
import string
import uuid
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from jose import jwt, JWTError
from pydantic import BaseModel, EmailStr, field_validator

from database import db
import math
from models import RYNUser, RYNEmailListing, RYNCreditTransaction, RYNWithdrawRequest
from routes.auth_utils import get_password_hash, verify_password, normalize_email, JWT_SECRET, JWT_ALGORITHM
import asyncio
from services.email_validation import (
    check_stop_forum_spam,
    has_mx_record,
    get_mx_records,
    detect_ryn_listing_provider,
    UnsupportedRynEmailProviderError,
    normalize_ryn_email_provider,
)

router = APIRouter()

# SMTP service injected from server.py (same pattern as auth.py)
smtp_service = None

def init_smtp_service(service) -> None:
    global smtp_service
    smtp_service = service

RYN_AUTH_COOKIE = "ryn_auth_token"
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
RYN_TOKEN_EXPIRE_DAYS = 30
RYN_OTP_EXPIRE_MINUTES = 15
RYN_SPAM_SCORE_MAX = 1  # stop_forum_spam frequency threshold for listing emails
CREDIT_HOLD_HOURS = 48  # Earned credits are held for this many hours before becoming spendable


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=RYN_TOKEN_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": user_id, "type": "ryn", "exp": expire, "jti": str(uuid.uuid4())},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


def _set_cookie(response: JSONResponse, token: str) -> None:
    response.set_cookie(
        key=RYN_AUTH_COOKIE,
        value=token,
        max_age=RYN_TOKEN_EXPIRE_DAYS * 24 * 3600,
        path="/",
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
    )


def _clear_cookie(response: JSONResponse) -> None:
    response.delete_cookie(key=RYN_AUTH_COOKIE, path="/")


async def _get_ryn_user(request: Request) -> dict:
    """Extract and validate RYN JWT from cookie; return raw DB doc."""
    token = request.cookies.get(RYN_AUTH_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "ryn":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user_id: str = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = await db.ryn_users.find_one({"id": user_id}, {"_id": 0})
    if not user or user.get("status") != "active":
        raise HTTPException(status_code=401, detail="Account not found or suspended")
    return user


def _safe_user(user: dict) -> dict:
    """Strip sensitive fields before returning to client."""
    return {k: v for k, v in user.items() if k != "password_hash"}


def _enc(data: dict) -> dict:
    """Run jsonable_encoder so datetime objects become ISO strings."""
    return jsonable_encoder(data)


def _generate_otp() -> str:
    return "".join(random.choices(string.digits, k=6))


async def _send_listing_otp(to_email: str, code: str) -> bool:
    """Send OTP to the email being listed for verification."""
    subject = "Verify your email for Rent Your Network"
    body_plain = (
        f"Your verification code is: {code}\n\n"
        f"Enter this code to confirm ownership of {to_email} and list it on Rent Your Network.\n"
        f"This code expires in {RYN_OTP_EXPIRE_MINUTES} minutes."
    )
    body_html = f"""
<div style="font-family:sans-serif;max-width:480px;margin:auto">
  <h2 style="font-size:20px;margin-bottom:8px">Verify your email</h2>
  <p style="color:#555">Enter the code below to confirm ownership of <strong>{to_email}</strong> and list it on Rent Your Network.</p>
  <div style="font-size:36px;font-weight:700;letter-spacing:8px;text-align:center;padding:24px 0;color:#1a1a1a">{code}</div>
  <p style="color:#888;font-size:13px">This code expires in {RYN_OTP_EXPIRE_MINUTES} minutes. If you didn&rsquo;t request this, ignore this email.</p>
</div>
"""
    if smtp_service:
        return await smtp_service.send_app_notification_email(
            to_email=to_email,
            subject=subject,
            body_plain=body_plain,
            body_html=body_html,
        )
    import logging
    logging.warning("RYN: smtp_service not injected; listing OTP not sent to %s", to_email)
    return False


async def _settle_held_credits(user_id: str) -> None:
    """Lazily settle warmup_sent records where this RYN user is the receiver owner.

    The warmup background job (settle_held_shared_pool_credits) handles settlement
    platform-wide.  This lazy version runs on page-load so the RYN dashboard always
    shows an up-to-date balance without waiting for the next background cycle.

    Logic mirrors WarmupSenderService.settle_held_shared_pool_credits for RYN entries.
    """
    now = datetime.now(timezone.utc)
    settle_cutoff = now - timedelta(hours=CREDIT_HOLD_HOURS)

    held_entries = await db.warmup_sent.find(
        {"ryn_owner_user_id": user_id, "credit_status": "held"},
        {"_id": 0},
    ).to_list(None)

    if not held_entries:
        return

    for entry in held_entries:
        warmup_sent_id = entry.get("id")
        sender_user_id = entry.get("user_id")
        ryn_listing_id = entry.get("ryn_listing_id")
        credits_charged = int(entry.get("credits_charged") or 1)
        replied_at = entry.get("replied_at")
        sent_at = entry.get("sent_at")

        if sent_at is not None and getattr(sent_at, "tzinfo", None) is None:
            sent_at = sent_at.replace(tzinfo=timezone.utc)

        is_qualified = replied_at is not None
        is_timed_out = sent_at is not None and sent_at <= settle_cutoff

        if not is_qualified and not is_timed_out:
            continue

        if is_qualified:
            # Release credits to owner's available balance
            await db.ryn_users.update_one(
                {"id": user_id},
                {"$inc": {"credits_balance": credits_charged, "credits_held": -credits_charged}, "$set": {"updated_at": now}},
            )
            await db.ryn_transactions.update_one(
                {"warmup_sent_id": warmup_sent_id, "type": "earn_held"},
                {"$set": {"type": "earn", "released_at": now, "hold_until": None, "settled_reason": "reply_detected", "updated_at": now}},
            )
            if ryn_listing_id:
                await db.ryn_listings.update_one(
                    {"id": ryn_listing_id},
                    {"$inc": {"credits_earned": credits_charged}, "$set": {"updated_at": now}},
                )
            await db.warmup_sent.update_one(
                {"id": warmup_sent_id},
                {"$set": {"credit_status": "settled_rewarded", "credits_rewarded": credits_charged, "updated_at": now}},
            )
        else:
            # Timed out — remove from held, refund the warmup sender
            await db.ryn_users.update_one(
                {"id": user_id},
                {"$inc": {"credits_held": -credits_charged}, "$set": {"updated_at": now}},
            )
            await db.ryn_transactions.update_one(
                {"warmup_sent_id": warmup_sent_id, "type": "earn_held"},
                {"$set": {"type": "earn_expired", "released_at": now, "hold_until": None, "settled_reason": "no_response_48h", "updated_at": now}},
            )
            await db.warmup_sent.update_one(
                {"id": warmup_sent_id},
                {"$set": {"credit_status": "settled_refunded", "credits_rewarded": 0, "updated_at": now}},
            )
            # Refund the warmup sender (main platform user)
            if sender_user_id:
                from services.credit_service import CreditService
                from database import db as _db
                credit_svc = CreditService(_db)
                await credit_svc.add_credits(
                    sender_user_id,
                    credits_charged,
                    reason="shared_pool_send_refund",
                    metadata={"warmup_sent_id": warmup_sent_id, "settled_reason": "no_response_48h"},
                    idempotency_key=f"ryn-lazy-refund:{warmup_sent_id}",
                )


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class RYNSignupRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

    @field_validator("full_name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Full name is required")
        return v.strip()


class RYNLoginRequest(BaseModel):
    email: EmailStr
    password: str


class RYNEmailListingRequest(BaseModel):
    email: EmailStr
    otp: str            # 6-digit code from /ryn/emails/verify/send
    note: str = ""      # optional short label/note


class RYNEmailListingUpdateRequest(BaseModel):
    note: str | None = None
    daily_receive_limit: int | None = None
    status: str | None = None  # active, paused

    @field_validator("daily_receive_limit")
    @classmethod
    def limit_range(cls, v: int | None) -> int | None:
        if v is not None and not (1 <= v <= 20):
            raise ValueError("daily_receive_limit must be between 1 and 20")
        return v

    @field_validator("status")
    @classmethod
    def valid_status(cls, v: str | None) -> str | None:
        if v is not None and v not in ("active", "paused"):
            raise ValueError("status must be 'active' or 'paused'")
        return v



# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------

class RYNVerifySendRequest(BaseModel):
    email: EmailStr


class RYNVerifyConfirmRequest(BaseModel):
    email: EmailStr
    otp: str


async def _send_signup_otp(to_email: str, code: str) -> bool:
    """Send the account-verification code for a new RYN signup."""
    subject = "Verify your Rent & Earn account"
    body_plain = (
        f"Your verification code is: {code}\n\n"
        f"Enter this code to finish creating your Rent & Earn account.\n"
        f"This code expires in {RYN_OTP_EXPIRE_MINUTES} minutes."
    )
    body_html = f"""
<div style="font-family:sans-serif;max-width:480px;margin:auto">
  <h2 style="font-size:20px;margin-bottom:8px">Verify your account</h2>
  <p style="color:#555">Enter the code below to finish creating your Rent &amp; Earn account.</p>
  <div style="font-size:36px;font-weight:700;letter-spacing:8px;text-align:center;padding:24px 0;color:#1a1a1a">{code}</div>
  <p style="color:#888;font-size:13px">This code expires in {RYN_OTP_EXPIRE_MINUTES} minutes. If you didn&rsquo;t request this, ignore this email.</p>
</div>
"""
    if smtp_service:
        return await smtp_service.send_app_notification_email(
            to_email=to_email, subject=subject, body_plain=body_plain, body_html=body_html
        )
    import logging
    logging.warning("RYN: smtp_service not injected; signup OTP not sent to %s", to_email)
    return False


@router.post("/ryn/auth/signup")
async def ryn_signup(body: RYNSignupRequest):
    """Create an unverified RYN account and email a code. No session is issued
    until POST /ryn/auth/verify-email succeeds."""
    normalized = normalize_email(body.email)
    existing = await db.ryn_users.find_one({"email": normalized})
    if existing:
        if existing.get("email_verified"):
            raise HTTPException(status_code=409, detail="An account with this email already exists")
        # Unverified signup being retried: refresh credentials and re-send the code.
        await db.ryn_users.update_one(
            {"id": existing["id"]},
            {"$set": {
                "password_hash": get_password_hash(body.password),
                "full_name": body.full_name,
                "updated_at": datetime.now(timezone.utc),
            }},
        )
        user_id = existing["id"]
    else:
        user = RYNUser(
            email=normalized,
            password_hash=get_password_hash(body.password),
            full_name=body.full_name,
            email_verified=False,
        )
        await db.ryn_users.insert_one({**user.model_dump(), "_id": user.id})
        user_id = user.id

    code = _generate_otp()
    await db.ryn_email_otps.update_one(
        {"email": normalized},
        {"$set": {
            "email": normalized,
            "code": code,
            "purpose": "signup",
            "user_id": user_id,
            "verified": False,
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=RYN_OTP_EXPIRE_MINUTES),
        }},
        upsert=True,
    )
    await _send_signup_otp(normalized, code)
    return {"verification_required": True, "email": normalized,
            "message": "We sent a 6-digit code to your email."}


@router.post("/ryn/auth/verify-email")
async def ryn_verify_signup(body: RYNVerifyConfirmRequest):
    """Confirm the signup code, mark the account verified and start the session."""
    normalized = normalize_email(str(body.email))
    doc = await db.ryn_email_otps.find_one({"email": normalized, "purpose": "signup"})
    if not doc:
        raise HTTPException(status_code=400, detail="No verification code found. Please sign up again.")
    expires_at = doc.get("expires_at")
    if expires_at and getattr(expires_at, "tzinfo", None) is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Code expired. Request a new one.")
    if doc.get("code") != body.otp.strip():
        raise HTTPException(status_code=400, detail="Incorrect verification code.")

    user = await db.ryn_users.find_one({"email": normalized})
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")
    await db.ryn_users.update_one(
        {"id": user["id"]},
        {"$set": {"email_verified": True, "updated_at": datetime.now(timezone.utc)}},
    )
    await db.ryn_email_otps.delete_one({"email": normalized, "purpose": "signup"})

    user["email_verified"] = True
    response = JSONResponse(_enc({"user": _safe_user(user), "message": "Account verified"}))
    _set_cookie(response, _make_token(user["id"]))
    return response


@router.post("/ryn/auth/resend-verification")
async def ryn_resend_verification(body: RYNVerifySendRequest):
    """Re-send the signup code for an account that has not been verified yet."""
    normalized = normalize_email(str(body.email))
    user = await db.ryn_users.find_one({"email": normalized})
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")
    if user.get("email_verified"):
        raise HTTPException(status_code=400, detail="This account is already verified.")
    code = _generate_otp()
    await db.ryn_email_otps.update_one(
        {"email": normalized},
        {"$set": {
            "email": normalized, "code": code, "purpose": "signup",
            "user_id": user["id"], "verified": False,
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=RYN_OTP_EXPIRE_MINUTES),
        }},
        upsert=True,
    )
    await _send_signup_otp(normalized, code)
    return {"message": "Verification code sent."}


@router.post("/ryn/auth/login")
async def ryn_login(body: RYNLoginRequest):
    """Log in to RYN portal."""
    normalized = normalize_email(body.email)
    user = await db.ryn_users.find_one({"email": normalized}, {"_id": 0})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.get("status") != "active":
        raise HTTPException(status_code=403, detail="Account suspended")
    # Without this, an unverified account could skip verification by logging in.
    if not user.get("email_verified"):
        raise HTTPException(
            status_code=403,
            detail="Please verify your email first. Check your inbox for the code.",
        )

    token = _make_token(user["id"])
    response = JSONResponse(_enc({"user": _safe_user(user), "message": "Logged in"}))
    _set_cookie(response, token)
    return response


@router.post("/ryn/auth/logout")
async def ryn_logout():
    response = JSONResponse({"message": "Logged out"})
    _clear_cookie(response)
    return response


@router.get("/ryn/auth/me")
async def ryn_me(request: Request):
    """Return current RYN user profile."""
    user = await _get_ryn_user(request)
    await _settle_held_credits(user["id"])
    # Re-fetch after potential release
    user = await db.ryn_users.find_one({"id": user["id"]}, {"_id": 0})
    return _enc({"user": _safe_user(user)})


# ---------------------------------------------------------------------------
# Email listing routes
# ---------------------------------------------------------------------------

@router.get("/ryn/emails")
async def list_my_emails(request: Request):
    """List all email listings owned by the current user."""
    user = await _get_ryn_user(request)
    cursor = db.ryn_listings.find(
        {"owner_id": user["id"], "status": {"$ne": "removed"}},
        {"_id": 0},
    ).sort("created_at", -1)
    listings = await cursor.to_list(length=200)
    for row in listings:
        row["provider"] = normalize_ryn_email_provider(row.get("provider"))
    return _enc({"listings": listings})


@router.post("/ryn/emails/verify/send")
async def ryn_verify_send(body: RYNVerifySendRequest, request: Request):
    """Step 1: MX check + spam check, then send a 6-digit OTP to the email."""
    await _get_ryn_user(request)
    normalized = normalize_email(str(body.email))
    domain = normalized.split("@")[-1]

    # MX check — block immediately if domain can't receive email
    loop = asyncio.get_event_loop()
    mx_ok, mx_err = await loop.run_in_executor(None, has_mx_record, domain)
    if not mx_ok:
        raise HTTPException(
            status_code=422,
            detail=f"The domain '{domain}' has no valid MX records and cannot receive email{': ' + mx_err if mx_err else ''}.",
        )

    # Spam check — block if frequency > RYN_SPAM_SCORE_MAX (1)
    ok, reason = check_stop_forum_spam(normalized, threshold=RYN_SPAM_SCORE_MAX)
    if not ok:
        raise HTTPException(
            status_code=422,
            detail=f"This email address has a poor reputation and cannot be listed ({reason}).",
        )

    # Detect provider and cache alongside the OTP so listing creation doesn't re-query DNS
    mx_hosts: list[str] = await loop.run_in_executor(None, get_mx_records, domain)
    try:
        provider: str = detect_ryn_listing_provider(mx_hosts, domain)
    except UnsupportedRynEmailProviderError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Generate and persist OTP (overwrite any existing pending code for this email)
    code = _generate_otp()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=RYN_OTP_EXPIRE_MINUTES)
    await db.ryn_email_otps.update_one(
        {"email": normalized},
        {"$set": {
            "email": normalized,
            "code": code,
            "expires_at": expires_at,
            "verified": False,
            "mx_ok": True,
            "mx_records": mx_hosts,
            "provider": provider,
        }},
        upsert=True,
    )

    sent = await _send_listing_otp(normalized, code)
    if not sent:
        raise HTTPException(status_code=500, detail="Failed to send verification email. Please try again.")

    return {"message": f"Verification code sent to {normalized}", "provider": provider}


@router.post("/ryn/emails/verify/confirm")
async def ryn_verify_confirm(body: RYNVerifyConfirmRequest, request: Request):
    """Step 2 (optional pre-check): verify OTP without creating the listing yet.
    The listing creation in POST /ryn/emails also verifies the OTP atomically.
    """
    await _get_ryn_user(request)
    normalized = normalize_email(str(body.email))
    doc = await db.ryn_email_otps.find_one({"email": normalized})
    if not doc:
        raise HTTPException(status_code=400, detail="No verification code found. Please request a new one.")
    expires_at = doc.get("expires_at")
    if expires_at and getattr(expires_at, "tzinfo", None) is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Verification code has expired. Please request a new one.")
    if doc.get("code") != body.otp.strip():
        raise HTTPException(status_code=400, detail="Incorrect verification code.")
    await db.ryn_email_otps.update_one({"email": normalized}, {"$set": {"verified": True}})
    return {"message": "Email verified"}


@router.get("/ryn/linked-inboxes")
async def get_linked_inboxes(request: Request):
    """Return main-platform inboxes for this RYN user.

    Matches by email: finds the main-platform User with the same email address
    as the RYN user, then returns all their connected inboxes.  If no main
    account with that email is found an empty list is returned.
    """
    ryn_user = await _get_ryn_user(request)

    # Find the matching main-platform user
    main_user = await db.users.find_one({"email": ryn_user["email"]}, {"_id": 0, "id": 1})
    if not main_user:
        return _enc({"inboxes": []})

    # Get all non-removed inboxes for that user
    inbox_cursor = db.inboxes.find(
        {"user_id": main_user["id"], "status": {"$ne": "removed"}},
        {"_id": 0, "id": 1, "email": 1, "sender_type": 1, "status": 1},
    )
    inboxes = await inbox_cursor.to_list(length=200)

    # Find already-listed emails so UI can mark them
    listed_cursor = db.ryn_listings.find(
        {"owner_id": ryn_user["id"], "status": {"$ne": "removed"}},
        {"_id": 0, "email": 1},
    )
    listed_docs = await listed_cursor.to_list(length=200)
    already_listed = {d["email"] for d in listed_docs}

    result = []
    for inbox in inboxes:
        result.append({
            "id": inbox["id"],
            "email": inbox["email"],
            "sender_type": inbox.get("sender_type", ""),
            "status": inbox.get("status", ""),
            "already_listed": inbox["email"] in already_listed,
        })

    return _enc({"inboxes": result})


@router.post("/ryn/emails")
async def add_email_listing(body: RYNEmailListingRequest, request: Request):
    """Add a new email to rent out. Requires a valid OTP from /ryn/emails/verify/send."""
    user = await _get_ryn_user(request)
    normalized_email = normalize_email(str(body.email))

    # Verify OTP atomically
    otp_doc = await db.ryn_email_otps.find_one({"email": normalized_email})
    if not otp_doc:
        raise HTTPException(status_code=400, detail="No verification code found. Please request a new one.")
    expires_at = otp_doc.get("expires_at")
    if expires_at and getattr(expires_at, "tzinfo", None) is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Verification code has expired. Please request a new one.")
    if otp_doc.get("code") != body.otp.strip():
        raise HTTPException(status_code=400, detail="Incorrect verification code.")

    # Re-check MX immediately before creating the listing. DNS can change after verify/send,
    # and legacy OTP docs may lack fresh data — do not consume the OTP if MX is bad.
    loop = asyncio.get_event_loop()
    domain = normalized_email.split("@")[-1]
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
        provider: str = detect_ryn_listing_provider(mx_hosts, domain)
    except UnsupportedRynEmailProviderError as e:
        raise HTTPException(status_code=422, detail=str(e))

    await db.ryn_email_otps.delete_one({"email": normalized_email})

    # Prevent duplicate active listings for the same email by the same user
    existing = await db.ryn_listings.find_one({
        "owner_id": user["id"],
        "email": normalized_email,
        "status": {"$ne": "removed"},
    })
    if existing:
        raise HTTPException(status_code=409, detail="You already have an active listing for this email")

    listing = RYNEmailListing(
        owner_id=user["id"],
        email=normalized_email,
        note=body.note.strip() or None,
        credits_per_use=1,  # fixed
        mx_ok=mx_ok_now,
        mx_records=mx_hosts,
        provider=provider,
    )
    await db.ryn_listings.insert_one({**listing.model_dump(), "_id": listing.id})
    return _enc({"listing": listing.model_dump(), "message": "Email listed successfully"})


@router.patch("/ryn/emails/{listing_id}")
async def update_email_listing(listing_id: str, body: RYNEmailListingUpdateRequest, request: Request):
    """Update listing details or pause/resume it."""
    user = await _get_ryn_user(request)
    listing = await db.ryn_listings.find_one({"id": listing_id, "owner_id": user["id"]}, {"_id": 0})
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    updates: dict = {"updated_at": datetime.now(timezone.utc)}
    if body.note is not None:
        updates["note"] = body.note.strip() or None
    if body.daily_receive_limit is not None:
        updates["daily_receive_limit"] = body.daily_receive_limit
    if body.status is not None:
        updates["status"] = body.status

    await db.ryn_listings.update_one({"id": listing_id}, {"$set": updates})
    updated = await db.ryn_listings.find_one({"id": listing_id}, {"_id": 0})
    if updated:
        updated["provider"] = normalize_ryn_email_provider(updated.get("provider"))
    return _enc({"listing": updated, "message": "Listing updated"})


@router.delete("/ryn/emails/{listing_id}")
async def remove_email_listing(listing_id: str, request: Request):
    """Remove/delist an email listing."""
    user = await _get_ryn_user(request)
    listing = await db.ryn_listings.find_one({"id": listing_id, "owner_id": user["id"]})
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    await db.ryn_listings.update_one(
        {"id": listing_id},
        {"$set": {"status": "removed", "updated_at": datetime.now(timezone.utc)}},
    )
    return {"message": "Listing removed"}




# ---------------------------------------------------------------------------
# Credits routes
# ---------------------------------------------------------------------------

@router.get("/ryn/credits")
async def get_credits(request: Request):
    """Return current credits balance and transaction history.

    Lazily releases any held credits whose 48-hr window has passed before
    returning the response, so the balance is always accurate.
    """
    user = await _get_ryn_user(request)
    await _settle_held_credits(user["id"])
    # Re-fetch after potential release
    user = await db.ryn_users.find_one({"id": user["id"]}, {"_id": 0})

    cursor = db.ryn_transactions.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", -1).limit(50)
    transactions = await cursor.to_list(length=50)

    # Pending holds still in the window
    now = datetime.now(timezone.utc)
    pending_holds = await db.ryn_transactions.find(
        {"user_id": user["id"], "type": "earn_held", "hold_until": {"$gt": now}},
        {"_id": 0, "id": 1, "amount": 1, "description": 1, "hold_until": 1, "created_at": 1},
    ).sort("hold_until", 1).to_list(None)

    return _enc({
        "credits_balance": user.get("credits_balance", 0),
        "credits_held": user.get("credits_held", 0),
        "credits_total_earned": user.get("credits_total_earned", 0),
        "credits_total_spent": user.get("credits_total_spent", 0),
        "hold_hours": CREDIT_HOLD_HOURS,
        "pending_holds": pending_holds,
        "transactions": transactions,
    })


# ---------------------------------------------------------------------------
# Activity routes — warmup activity for the user's listed email accounts
# ---------------------------------------------------------------------------

@router.get("/ryn/activity")
async def get_activity(
    request: Request,
    since_hours: int = 24,
    limit: int = 100,
    offset: int = 0,
):
    """Return warmup activity (sends/replies) for this user's listed emails.

    Queries ``warmup_sent`` using the inbox email addresses that match the
    user's active RYN listings, so they can see how their emails are being
    warmed up from the main dashboard.

    since_hours: 24 | 48 | 168 (7 days) | 720 (30 days)
    """
    user = await _get_ryn_user(request)

    if since_hours not in (24, 48, 168, 720):
        raise HTTPException(status_code=400, detail="since_hours must be 24, 48, 168, or 720")

    # Get all active email addresses listed by this RYN user
    listing_cursor = db.ryn_listings.find(
        {"owner_id": user["id"], "status": {"$in": ["active", "paused"]}},
        {"_id": 0, "email": 1},
    )
    listings = await listing_cursor.to_list(length=200)
    listed_emails = [l["email"] for l in listings]

    if not listed_emails:
        return _enc({"items": [], "total": 0, "stats": {
            "sent": 0, "replied": 0,
        }})

    # Find matching inboxes in the main app by email address
    inbox_docs = await db.inboxes.find(
        {"email": {"$in": listed_emails}},
        {"_id": 0, "id": 1, "email": 1},
    ).to_list(None)
    inbox_id_to_email = {i["id"]: i["email"] for i in inbox_docs}
    inbox_ids = list(inbox_id_to_email.keys())

    cutoff = datetime.now(timezone.utc) - timedelta(hours=since_hours)
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    query: dict = {"sent_at": {"$gte": cutoff}}
    if inbox_ids:
        # Match by inbox_id (SMTP inboxes) OR by a receiver_email that is one of
        # the listed addresses (meaning someone warmed UP our email)
        query["$or"] = [
            {"inbox_id": {"$in": inbox_ids}},
            {"receiver_email": {"$in": listed_emails}},
        ]
    else:
        # No inboxes found by ID — still try receiver side
        query["receiver_email"] = {"$in": listed_emails}

    total = await db.warmup_sent.count_documents(query)
    docs = await db.warmup_sent.find(
        query,
        {"_id": 0, "id": 1, "inbox_id": 1, "receiver_email": 1, "engagement_mode": 1,
         "subject": 1, "sent_at": 1, "replied_at": 1},
    ).sort("sent_at", -1).skip(offset).limit(limit).to_list(None)

    items = []
    for d in docs:
        inbox_email = inbox_id_to_email.get(d.get("inbox_id"), "")
        items.append({
            "id": d["id"],
            "inbox_email": inbox_email,
            "receiver_email": d.get("receiver_email", ""),
            "engagement_mode": d.get("engagement_mode", "pool"),
            "subject": d.get("subject", ""),
            "sent_at": d.get("sent_at"),
            "replied_at": d.get("replied_at"),
        })

    stats = {
        "sent": total,
        "replied": sum(1 for d in docs if d.get("replied_at")),
    }

    return _enc({"items": items, "total": total, "stats": stats})


# ---------------------------------------------------------------------------
# Withdraw routes
# ---------------------------------------------------------------------------

MIN_WITHDRAW_CREDITS = 500
PLATFORM_FEE_PERCENT = 10


class RYNWithdrawBankRequest(BaseModel):
    credits_requested: int
    payment_method: str = "bank"
    bank_account_holder: str
    bank_name: str
    bank_account_number: str
    bank_ifsc: str

    @field_validator("credits_requested")
    @classmethod
    def check_min(cls, v: int) -> int:
        if v < MIN_WITHDRAW_CREDITS:
            raise ValueError(f"Minimum withdrawal is {MIN_WITHDRAW_CREDITS} credits")
        return v

    @field_validator("bank_account_holder", "bank_name", "bank_account_number", "bank_ifsc")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("This field is required")
        return v.strip()


class RYNWithdrawUPIRequest(BaseModel):
    credits_requested: int
    payment_method: str = "upi"
    upi_id: str
    upi_name: str

    @field_validator("credits_requested")
    @classmethod
    def check_min(cls, v: int) -> int:
        if v < MIN_WITHDRAW_CREDITS:
            raise ValueError(f"Minimum withdrawal is {MIN_WITHDRAW_CREDITS} credits")
        return v

    @field_validator("upi_id", "upi_name")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("This field is required")
        return v.strip()


class RYNWithdrawRequest_(BaseModel):
    """Generic withdraw request — either bank or UPI fields required."""
    credits_requested: int
    payment_method: str   # "bank" | "upi"

    # Bank
    bank_account_holder: str | None = None
    bank_name: str | None = None
    bank_account_number: str | None = None
    bank_ifsc: str | None = None

    # UPI
    upi_id: str | None = None
    upi_name: str | None = None

    @field_validator("credits_requested")
    @classmethod
    def check_min(cls, v: int) -> int:
        if v < MIN_WITHDRAW_CREDITS:
            raise ValueError(f"Minimum withdrawal is {MIN_WITHDRAW_CREDITS} credits")
        return v

    @field_validator("payment_method")
    @classmethod
    def valid_method(cls, v: str) -> str:
        if v not in ("bank", "upi"):
            raise ValueError("payment_method must be 'bank' or 'upi'")
        return v


@router.post("/ryn/withdraw")
async def create_withdraw_request(body: RYNWithdrawRequest_, request: Request):
    """Submit a withdrawal request. Deducts credits immediately (pending admin approval).

    Minimum 500 credits. 10% platform + transaction fee deducted from requested amount.
    """
    user = await _get_ryn_user(request)

    # Validate payment details
    if body.payment_method == "bank":
        missing = [f for f in ("bank_account_holder", "bank_name", "bank_account_number", "bank_ifsc")
                   if not getattr(body, f, None) or not str(getattr(body, f)).strip()]
        if missing:
            raise HTTPException(status_code=422, detail=f"Missing bank fields: {', '.join(missing)}")
    else:
        missing = [f for f in ("upi_id", "upi_name")
                   if not getattr(body, f, None) or not str(getattr(body, f)).strip()]
        if missing:
            raise HTTPException(status_code=422, detail=f"Missing UPI fields: {', '.join(missing)}")

    # Re-fetch fresh balance
    fresh_user = await db.ryn_users.find_one({"id": user["id"]}, {"_id": 0})
    available = fresh_user.get("credits_balance", 0)
    if available < body.credits_requested:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient balance. You have {available} credits available.",
        )

    fee = math.ceil(body.credits_requested * PLATFORM_FEE_PERCENT / 100)
    net = body.credits_requested - fee
    now = datetime.now(timezone.utc)

    withdraw = RYNWithdrawRequest(
        user_id=user["id"],
        user_email=user["email"],
        user_name=user["full_name"],
        credits_requested=body.credits_requested,
        credits_fee=fee,
        credits_net=net,
        payment_method=body.payment_method,
        bank_account_holder=body.bank_account_holder,
        bank_name=body.bank_name,
        bank_account_number=body.bank_account_number,
        bank_ifsc=body.bank_ifsc,
        upi_id=body.upi_id,
        upi_name=body.upi_name,
    )

    # Deduct credits atomically
    result = await db.ryn_users.update_one(
        {"id": user["id"], "credits_balance": {"$gte": body.credits_requested}},
        {
            "$inc": {"credits_balance": -body.credits_requested, "credits_total_spent": body.credits_requested},
            "$set": {"updated_at": now},
        },
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient balance. Please try again.")

    await db.ryn_withdrawals.insert_one({**withdraw.model_dump(), "_id": withdraw.id})

    # Record transaction
    tx_id = str(uuid.uuid4())
    await db.ryn_transactions.insert_one({
        "id": tx_id,
        "user_id": user["id"],
        "amount": -body.credits_requested,
        "type": "withdraw",
        "description": f"Withdrawal request ({body.payment_method.upper()}) — {body.credits_requested} credits (fee: {fee}, net: {net})",
        "withdraw_id": withdraw.id,
        "created_at": now,
    })

    return _enc({"withdraw": withdraw.model_dump(), "message": "Withdrawal request submitted successfully"})


@router.get("/ryn/withdraw")
async def list_withdraw_requests(request: Request):
    """Return the current user's withdrawal requests."""
    user = await _get_ryn_user(request)
    cursor = db.ryn_withdrawals.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", -1).limit(50)
    withdrawals = await cursor.to_list(length=50)
    return _enc({"withdrawals": withdrawals})
