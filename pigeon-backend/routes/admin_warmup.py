"""Admin routes for platform warm-up: receiver accounts and reply templates."""
import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from email.mime.text import MIMEText
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import RedirectResponse
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from pydantic import BaseModel, EmailStr

from database import admin_db, db
from routes.dependencies import get_current_admin, require_admin_permissions
from services import warmup_sender_service as warmup_close_cfg
from services.gmail_oauth_receiver import (
    build_gmail_service,
    get_access_token_async as get_gmail_access_token_async,
    gmail_api_list_inbox,
    gmail_api_send_mail,
)
from services.outlook_oauth_service import (
    MICROSOFT_AUTHORITY,
    MICROSOFT_TOKEN_URL,
    OUTLOOK_SCOPES_STR,
    get_access_token_async,
    graph_get_inbox_count,
    graph_send_mail,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin")

smtp_service = None


def init_smtp_service(service):
    global smtp_service
    smtp_service = service


# Gmail IMAP/SMTP defaults
GMAIL_IMAP_HOST = "imap.gmail.com"
GMAIL_IMAP_PORT = 993
GMAIL_SMTP_HOST = "smtp.gmail.com"
GMAIL_SMTP_PORT = 587


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class WarmupReceiverAccountCreate(BaseModel):
    provider: str  # gmail, outlook, yahoo, custom
    email: EmailStr
    imap_host: str
    imap_port: int = 993
    imap_username: str
    imap_password: Optional[str] = None  # required for password-based; omit for Outlook OAuth (use callback)
    smtp_host: str
    smtp_port: int = 587
    smtp_username: str
    smtp_password: Optional[str] = None
    auth_method: Optional[str] = "password"  # "password" | "oauth" (outlook only)
    is_active: bool = True
    daily_reply_cap: Optional[int] = None


class WarmupReceiverAccountUpdate(BaseModel):
    provider: Optional[str] = None
    email: Optional[EmailStr] = None
    imap_host: Optional[str] = None
    imap_port: Optional[int] = None
    imap_username: Optional[str] = None
    imap_password: Optional[str] = None
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_username: Optional[str] = None
    smtp_password: Optional[str] = None
    auth_method: Optional[str] = None
    is_active: Optional[bool] = None
    daily_reply_cap: Optional[int] = None


class GmailReceiverAuthRequest(BaseModel):
    """Request body for starting Gmail OAuth for a warm-up receiver account."""

    client_id: str
    client_secret: str
    account_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Receiver accounts
# ---------------------------------------------------------------------------


def _receiver_account_projection():
    """Exclude secrets from receiver account responses."""
    return {
        "_id": 0,
        "imap_password": 0,
        "smtp_password": 0,
        "outlook_refresh_token": 0,
        "outlook_access_token": 0,
        "gmail_refresh_token": 0,
        "google_client_secret_encrypted": 0,
    }


@router.get(
    "/warmup/receiver-accounts",
    dependencies=[Depends(require_admin_permissions(["system.read"]))],
)
async def list_warmup_receiver_accounts(current_admin: dict = Depends(get_current_admin)):
    """List all warm-up receiver accounts (no passwords or tokens)."""
    cursor = admin_db.warmup_receiver_accounts.find(
        {},
        _receiver_account_projection(),
    ).sort("created_at", -1)
    items = await cursor.to_list(None)
    for item in items:
        item["oauth_connected"] = item.get("auth_method") == "oauth"
    return items


@router.post(
    "/warmup/receiver-accounts",
    dependencies=[Depends(require_admin_permissions(["system.write"]))],
)
async def create_warmup_receiver_account(
    payload: WarmupReceiverAccountCreate,
    current_admin: dict = Depends(get_current_admin),
):
    """Create a warm-up receiver account.

    Passwords are encrypted at rest. Outlook and Gmail OAuth accounts are created via their
    respective OAuth callbacks, not via this POST endpoint.
    """
    if smtp_service is None:
        raise HTTPException(status_code=503, detail="Service not configured")
    auth_method_raw = (payload.auth_method or "password").lower()
    if payload.provider == "outlook" and auth_method_raw == "oauth":
        raise HTTPException(
            status_code=400,
            detail="Use Connect with Microsoft to add an Outlook account (OAuth).",
        )
    if payload.provider == "gmail" and auth_method_raw == "oauth":
        raise HTTPException(
            status_code=400,
            detail="Use Connect with Google to add a Gmail OAuth receiver account.",
        )
    if not payload.imap_password or not payload.smtp_password:
        raise HTTPException(
            status_code=400,
            detail="IMAP and SMTP passwords are required when creating a password-based account.",
        )
    existing = await admin_db.warmup_receiver_accounts.find_one({"email": payload.email})
    if existing:
        raise HTTPException(status_code=400, detail="A receiver account with this email already exists")
    now = datetime.now(timezone.utc)
    auth_method = auth_method_raw
    if auth_method not in ("password", "oauth"):
        auth_method = "password"
    doc = {
        "id": str(uuid.uuid4()),
        "provider": payload.provider,
        "email": payload.email,
        "imap_host": payload.imap_host,
        "imap_port": payload.imap_port,
        "imap_username": payload.imap_username,
        "imap_password": smtp_service._encrypt_password(payload.imap_password),
        "smtp_host": payload.smtp_host,
        "smtp_port": payload.smtp_port,
        "smtp_username": payload.smtp_username,
        "smtp_password": smtp_service._encrypt_password(payload.smtp_password),
        "auth_method": auth_method,
        "is_active": payload.is_active,
        "last_used_at": None,
        "daily_reply_cap": payload.daily_reply_cap,
        "created_at": now,
        "updated_at": now,
    }
    await admin_db.warmup_receiver_accounts.insert_one(doc)
    doc.pop("_id", None)
    doc.pop("imap_password", None)
    doc.pop("smtp_password", None)
    doc["oauth_connected"] = doc.get("auth_method") == "oauth"
    return doc


@router.get(
    "/warmup/receiver-accounts/{account_id}",
    dependencies=[Depends(require_admin_permissions(["system.read"]))],
)
async def get_warmup_receiver_account(
    account_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    """Get one receiver account (no passwords or tokens)."""
    doc = await admin_db.warmup_receiver_accounts.find_one(
        {"id": account_id},
        _receiver_account_projection(),
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Receiver account not found")
    doc["oauth_connected"] = doc.get("auth_method") == "oauth"
    return doc


@router.put(
    "/warmup/receiver-accounts/{account_id}",
    dependencies=[Depends(require_admin_permissions(["system.write"]))],
)
async def update_warmup_receiver_account(
    account_id: str,
    payload: WarmupReceiverAccountUpdate,
    current_admin: dict = Depends(get_current_admin),
):
    """Update a warm-up receiver account."""
    if smtp_service is None:
        raise HTTPException(status_code=503, detail="Service not configured")
    existing = await admin_db.warmup_receiver_accounts.find_one({"id": account_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Receiver account not found")
    update_data = payload.model_dump(exclude_unset=True)
    if "imap_password" in update_data and update_data["imap_password"]:
        update_data["imap_password"] = smtp_service._encrypt_password(update_data["imap_password"])
    if "smtp_password" in update_data and update_data["smtp_password"]:
        update_data["smtp_password"] = smtp_service._encrypt_password(update_data["smtp_password"])
    update_data["updated_at"] = datetime.now(timezone.utc)
    await admin_db.warmup_receiver_accounts.update_one(
        {"id": account_id},
        {"$set": update_data},
    )
    doc = await admin_db.warmup_receiver_accounts.find_one(
        {"id": account_id},
        _receiver_account_projection(),
    )
    doc["oauth_connected"] = doc.get("auth_method") == "oauth"
    return doc


@router.delete(
    "/warmup/receiver-accounts/{account_id}",
    dependencies=[Depends(require_admin_permissions(["system.write"]))],
)
async def delete_warmup_receiver_account(
    account_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    """Delete a warm-up receiver account."""
    result = await admin_db.warmup_receiver_accounts.delete_one({"id": account_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Receiver account not found")
    return {"message": "Receiver account deleted"}


# ---------------------------------------------------------------------------
    # -----------------------------------------------------------------------
    # Outlook OAuth (receiver accounts)
    # -----------------------------------------------------------------------

OUTLOOK_IMAP_HOST = "outlook.office365.com"
OUTLOOK_IMAP_PORT = 993
OUTLOOK_SMTP_HOST = "smtp.office365.com"
OUTLOOK_SMTP_PORT = 587


@router.post(
    "/warmup/gmail-receiver/auth-url",
    dependencies=[Depends(require_admin_permissions(["system.write"]))],
)
async def gmail_receiver_auth_url(
    payload: GmailReceiverAuthRequest,
    current_admin: dict = Depends(get_current_admin),
):
    """
    Return Google OAuth authorization URL for adding or reconnecting a Gmail receiver account.

    This endpoint accepts a Google OAuth client_id and client_secret so that different deployments
    can use their own Google Cloud projects for receiver accounts.
    """
    client_id = (payload.client_id or "").strip()
    client_secret = (payload.client_secret or "").strip()
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=400,
            detail="Google Client ID and Client Secret are required to connect a Gmail receiver via OAuth.",
        )

    # Dedicated redirect URI for Gmail receiver OAuth (add this URL in Google Cloud Console).
    backend_url = (os.getenv("BACKEND_URL") or "http://localhost:8001").rstrip("/")
    redirect_uri = (os.getenv("GMAIL_RECEIVER_REDIRECT_URI") or f"{backend_url}/api/admin/warmup/gmail-receiver/callback").rstrip("/")

    state = str(uuid.uuid4())
    state_doc = {
        "state": state,
        "receiver_account_id": payload.account_id,
        "admin_id": current_admin.get("id"),
        "client_id": client_id,
        "client_secret_encrypted": smtp_service._encrypt_password(client_secret),
        "created_at": datetime.now(timezone.utc),
    }
    await admin_db.gmail_receiver_oauth_states.insert_one(state_doc)

    scopes = ["https://mail.google.com/"]
    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": client_id,
                "client_secret": client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [redirect_uri],
            }
        },
        scopes=scopes,
        redirect_uri=redirect_uri,
    )
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=state,
    )
    return {"auth_url": auth_url}


async def handle_gmail_receiver_oauth_callback(code: str, state: str) -> RedirectResponse:
    """
    Handle Google OAuth callback for admin Gmail receiver accounts.
    Uses GMAIL_RECEIVER_REDIRECT_URI or default backend + /api/admin/warmup/gmail-receiver/callback.
    """
    admin_panel_url = (os.getenv("ADMIN_PANEL_URL") or os.getenv("FRONTEND_URL") or "http://localhost:3000").strip()
    if not admin_panel_url:
        admin_panel_url = "http://localhost:3000"
    base_redirect = f"{admin_panel_url.rstrip('/')}/admin/warmup/receiver-accounts"

    if not code or not state:
        return RedirectResponse(url=f"{base_redirect}?gmail=error&message=missing_code_or_state")

    state_doc = await admin_db.gmail_receiver_oauth_states.find_one({"state": state})
    if not state_doc:
        return RedirectResponse(url=f"{base_redirect}?gmail=error&message=invalid_or_expired_state")

    await admin_db.gmail_receiver_oauth_states.delete_one({"state": state})

    client_id = state_doc.get("client_id") or ""
    secret_encrypted = state_doc.get("client_secret_encrypted")
    if not client_id or not secret_encrypted:
        return RedirectResponse(url=f"{base_redirect}?gmail=error&message=oauth_not_configured")

    try:
        client_secret = smtp_service._decrypt_password(secret_encrypted)
    except Exception:
        return RedirectResponse(url=f"{base_redirect}?gmail=error&message=oauth_not_configured")

    redirect_uri = (os.getenv("GMAIL_RECEIVER_REDIRECT_URI") or "").strip().rstrip("/")
    if not redirect_uri:
        backend_url = (os.getenv("BACKEND_URL") or "http://localhost:8001").rstrip("/")
        redirect_uri = f"{backend_url}/api/admin/warmup/gmail-receiver/callback"

    scopes = ["https://mail.google.com/"]
    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": client_id,
                "client_secret": client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [redirect_uri],
            }
        },
        scopes=scopes,
        redirect_uri=redirect_uri,
    )
    try:
        flow.fetch_token(code=code)
    except Exception:
        return RedirectResponse(url=f"{base_redirect}?gmail=error&message=token_exchange_failed")

    credentials = flow.credentials
    refresh_token = credentials.refresh_token
    if not refresh_token:
        return RedirectResponse(url=f"{base_redirect}?gmail=error&message=no_refresh_token")

    try:
        service = build("gmail", "v1", credentials=credentials)
        profile = service.users().getProfile(userId="me").execute()
        gmail_email = profile.get("emailAddress")
    except Exception:
        gmail_email = None

    if not gmail_email:
        return RedirectResponse(url=f"{base_redirect}?gmail=error&message=could_not_get_email")

    now = datetime.now(timezone.utc)
    encrypted_refresh = smtp_service._encrypt_password(refresh_token)
    receiver_account_id = state_doc.get("receiver_account_id")

    if receiver_account_id:
        existing = await admin_db.warmup_receiver_accounts.find_one({"id": receiver_account_id})
        if not existing or existing.get("provider") != "gmail":
            return RedirectResponse(url=f"{base_redirect}?gmail=error&message=account_not_found")

        await admin_db.warmup_receiver_accounts.update_one(
            {"id": receiver_account_id},
            {
                "$set": {
                    "email": gmail_email,
                    "imap_host": GMAIL_IMAP_HOST,
                    "imap_port": GMAIL_IMAP_PORT,
                    "imap_username": gmail_email,
                    "imap_password": None,
                    "smtp_host": GMAIL_SMTP_HOST,
                    "smtp_port": GMAIL_SMTP_PORT,
                    "smtp_username": gmail_email,
                    "smtp_password": None,
                    "auth_method": "oauth",
                    "gmail_refresh_token": encrypted_refresh,
                    "google_client_id": client_id,
                    "google_client_secret_encrypted": smtp_service._encrypt_password(client_secret),
                    "updated_at": now,
                }
            },
        )
        return RedirectResponse(url=f"{base_redirect}?gmail=success")

    if await admin_db.warmup_receiver_accounts.find_one({"email": gmail_email, "provider": "gmail"}):
        return RedirectResponse(url=f"{base_redirect}?gmail=error&message=email_already_exists")

    doc = {
        "id": str(uuid.uuid4()),
        "provider": "gmail",
        "email": gmail_email,
        "imap_host": GMAIL_IMAP_HOST,
        "imap_port": GMAIL_IMAP_PORT,
        "imap_username": gmail_email,
        "imap_password": None,
        "smtp_host": GMAIL_SMTP_HOST,
        "smtp_port": GMAIL_SMTP_PORT,
        "smtp_username": gmail_email,
        "smtp_password": None,
        "auth_method": "oauth",
        "gmail_refresh_token": encrypted_refresh,
        "google_client_id": client_id,
        "google_client_secret_encrypted": smtp_service._encrypt_password(client_secret),
        "is_active": True,
        "last_used_at": None,
        "daily_reply_cap": None,
        "created_at": now,
        "updated_at": now,
    }
    await admin_db.warmup_receiver_accounts.insert_one(doc)
    return RedirectResponse(url=f"{base_redirect}?gmail=success")


@router.get("/warmup/gmail-receiver/callback")
async def gmail_receiver_callback(request: Request):
    """Google redirects here after Gmail OAuth. Add this URL as authorized redirect URI in Google Cloud Console."""
    code = request.query_params.get("code")
    state = request.query_params.get("state")
    return await handle_gmail_receiver_oauth_callback(code or "", state or "")


@router.get(
    "/warmup/gmail-receiver/redirect-uri",
    dependencies=[Depends(require_admin_permissions(["system.read"]))],
)
async def gmail_receiver_redirect_uri(current_admin: dict = Depends(get_current_admin)):
    """Return the redirect URI to add in Google Cloud Console for Gmail receiver OAuth."""
    backend_url = (os.getenv("BACKEND_URL") or "http://localhost:8001").rstrip("/")
    redirect_uri = (os.getenv("GMAIL_RECEIVER_REDIRECT_URI") or f"{backend_url}/api/admin/warmup/gmail-receiver/callback").rstrip("/")
    return {"redirect_uri": redirect_uri}


@router.get(
    "/warmup/outlook-receiver/auth-url",
    dependencies=[Depends(require_admin_permissions(["system.write"]))],
)
async def outlook_receiver_auth_url(
    account_id: Optional[str] = Query(None),
    current_admin: dict = Depends(get_current_admin),
):
    """Return Microsoft OAuth authorization URL for adding or reconnecting an Outlook receiver account."""
    client_id = os.getenv("MICROSOFT_CLIENT_ID")
    redirect_uri = (os.getenv("MICROSOFT_REDIRECT_URI") or "").strip().rstrip("/")
    if not client_id or not redirect_uri:
        raise HTTPException(
            status_code=503,
            detail="Microsoft OAuth not configured (MICROSOFT_CLIENT_ID, MICROSOFT_REDIRECT_URI).",
        )
    state = str(uuid.uuid4())
    state_doc = {
        "state": state,
        "receiver_account_id": account_id,
        "admin_id": current_admin.get("id"),
        "created_at": datetime.now(timezone.utc),
    }
    await admin_db.outlook_receiver_oauth_states.insert_one(state_doc)
    auth_url = (
        f"{MICROSOFT_AUTHORITY}/oauth2/v2.0/authorize?"
        + urlencode(
            {
                "client_id": client_id,
                "response_type": "code",
                "redirect_uri": redirect_uri,
                "scope": OUTLOOK_SCOPES_STR,
                "state": state,
                "response_mode": "query",
            }
        )
    )
    return {"auth_url": auth_url}


@router.get(
    "/warmup/outlook-receiver/callback",
)
async def outlook_receiver_callback(request: Request):
    """Handle Microsoft OAuth callback: exchange code for tokens, create or update receiver account, redirect to admin panel."""
    code = request.query_params.get("code")
    state = request.query_params.get("state")
    admin_panel_url = (os.getenv("ADMIN_PANEL_URL") or os.getenv("FRONTEND_URL") or "http://localhost:3000").strip()
    if not admin_panel_url:
        admin_panel_url = "http://localhost:3000"
    base_redirect = f"{admin_panel_url.rstrip('/')}/admin/warmup/receiver-accounts"
    if not code or not state:
        return RedirectResponse(
            url=f"{base_redirect}?outlook=error&message=missing_code_or_state"
        )
    state_doc = await admin_db.outlook_receiver_oauth_states.find_one({"state": state})
    if not state_doc:
        return RedirectResponse(
            url=f"{base_redirect}?outlook=error&message=invalid_or_expired_state"
        )
    await admin_db.outlook_receiver_oauth_states.delete_one({"state": state})

    client_id = os.getenv("MICROSOFT_CLIENT_ID")
    client_secret = os.getenv("MICROSOFT_CLIENT_SECRET")
    redirect_uri = os.getenv("MICROSOFT_REDIRECT_URI")
    if not client_id or not client_secret or not redirect_uri:
        return RedirectResponse(
            url=f"{base_redirect}?outlook=error&message=oauth_not_configured"
        )
    if smtp_service is None:
        return RedirectResponse(
            url=f"{base_redirect}?outlook=error&message=service_not_configured"
        )

    # Exchange code for tokens. redirect_uri must match the one used in the authorize request exactly.
    redirect_uri_normalized = redirect_uri.rstrip("/") if redirect_uri else ""
    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri_normalized,
        "scope": OUTLOOK_SCOPES_STR,
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(MICROSOFT_TOKEN_URL, data=data)
            if resp.status_code != 200:
                try:
                    err_body = resp.json()
                    logger.warning(
                        "Outlook token exchange failed: status=%s body=%s",
                        resp.status_code,
                        err_body,
                    )
                except Exception:
                    logger.warning(
                        "Outlook token exchange failed: status=%s body=%s",
                        resp.status_code,
                        resp.text[:500],
                    )
                return RedirectResponse(
                    url=f"{base_redirect}?outlook=error&message=token_exchange_failed"
                )
            body = resp.json()
    except Exception as e:
        logger.exception("Outlook token exchange error: %s", e)
        return RedirectResponse(
            url=f"{base_redirect}?outlook=error&message=token_exchange_failed"
        )

    access_token = body.get("access_token")
    refresh_token = body.get("refresh_token")
    if not refresh_token:
        return RedirectResponse(
            url=f"{base_redirect}?outlook=error&message=no_refresh_token"
        )

    # Get user email from Microsoft Graph. Prefer Outlook mailbox address over sign-in email (e.g. Gmail).
    def _is_outlook_domain(email_addr: Optional[str]) -> bool:
        if not email_addr or "@" not in email_addr:
            return False
        domain = email_addr.split("@", 1)[1].lower()
        return domain in ("outlook.com", "hotmail.com", "live.com", "hotmail.co.uk", "outlook.fr") or domain.endswith(".onmicrosoft.com")

    user_email = None
    if access_token:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.get(
                    "https://graph.microsoft.com/v1.0/me",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"$select": "mail,userPrincipalName,proxyAddresses"},
                )
                if r.status_code == 200:
                    j = r.json()
                    mail = j.get("mail")
                    upn = j.get("userPrincipalName")
                    proxy = j.get("proxyAddresses") or []
                    # Prefer Outlook-type address (actual mailbox) over sign-in email (e.g. Gmail)
                    if mail and _is_outlook_domain(mail):
                        user_email = mail
                    elif proxy:
                        for p in proxy:
                            if isinstance(p, str) and p.lower().startswith("smtp:"):
                                addr = p[5:].strip()
                                if addr and _is_outlook_domain(addr):
                                    user_email = addr
                                    break
                    user_email = user_email or mail or upn
        except Exception:
            pass
    if not user_email and body.get("id_token"):
        import base64
        import json
        try:
            payload_b64 = body["id_token"].split(".")[1]
            payload_b64 += "=" * (4 - len(payload_b64) % 4)
            payload = json.loads(base64.urlsafe_b64decode(payload_b64))
            user_email = payload.get("preferred_username") or payload.get("email")
        except Exception:
            pass
    if not user_email:
        return RedirectResponse(
            url=f"{base_redirect}?outlook=error&message=could_not_get_email"
        )

    now = datetime.now(timezone.utc)
    encrypted_refresh = smtp_service._encrypt_password(refresh_token)
    receiver_account_id = state_doc.get("receiver_account_id")

    if receiver_account_id:
        # Update existing account with new tokens
        existing = await admin_db.warmup_receiver_accounts.find_one({"id": receiver_account_id})
        if not existing or existing.get("provider") != "outlook":
            return RedirectResponse(
                url=f"{base_redirect}?outlook=error&message=account_not_found"
            )
        await admin_db.warmup_receiver_accounts.update_one(
            {"id": receiver_account_id},
            {
                "$set": {
                    "outlook_refresh_token": encrypted_refresh,
                    "auth_method": "oauth",
                    "imap_password": None,
                    "smtp_password": None,
                    "updated_at": now,
                }
            },
        )
        return RedirectResponse(url=f"{base_redirect}?outlook=success")
    else:
        # Create new receiver account (same email can exist for different providers, e.g. Gmail + Outlook)
        if await admin_db.warmup_receiver_accounts.find_one({"email": user_email, "provider": "outlook"}):
            return RedirectResponse(
                url=f"{base_redirect}?outlook=error&message=email_already_exists"
            )
        doc = {
            "id": str(uuid.uuid4()),
            "provider": "outlook",
            "email": user_email,
            "imap_host": OUTLOOK_IMAP_HOST,
            "imap_port": OUTLOOK_IMAP_PORT,
            "imap_username": user_email,
            "imap_password": None,
            "smtp_host": OUTLOOK_SMTP_HOST,
            "smtp_port": OUTLOOK_SMTP_PORT,
            "smtp_username": user_email,
            "smtp_password": None,
            "auth_method": "oauth",
            "outlook_refresh_token": encrypted_refresh,
            "is_active": True,
            "last_used_at": None,
            "daily_reply_cap": None,
            "created_at": now,
            "updated_at": now,
        }
        await admin_db.warmup_receiver_accounts.insert_one(doc)
        return RedirectResponse(url=f"{base_redirect}?outlook=success")


@router.post(
    "/warmup/receiver-accounts/{account_id}/test",
    dependencies=[Depends(require_admin_permissions(["system.write"]))],
)
async def test_warmup_receiver_account(
    account_id: str,
    send_test_email: bool = Query(
        True,
        description="If false, verify mail access and (where applicable) SMTP/Graph login only; do not send the test email.",
    ),
    current_admin: dict = Depends(get_current_admin),
):
    """Test connection for a receiver account: password (IMAP/SMTP), Outlook OAuth (Graph), or Gmail OAuth (Gmail API)."""
    import asyncio
    import imaplib
    import smtplib

    if smtp_service is None:
        raise HTTPException(status_code=503, detail="Service not configured")
    config = await admin_db.warmup_receiver_accounts.find_one({"id": account_id})
    if not config:
        raise HTTPException(status_code=404, detail="Receiver account not found")

    # Use OAuth only for Outlook/Gmail providers with OAuth auth; same email can exist for Gmail (password) and Outlook/Gmail (OAuth)
    provider = config.get("provider") or "custom"
    is_outlook_oauth = (
        provider == "outlook"
        and (config.get("auth_method") == "oauth" or config.get("outlook_refresh_token"))
    )
    is_gmail_oauth = (
        provider == "gmail"
        and (config.get("auth_method") == "oauth" or config.get("gmail_refresh_token"))
    )
    imap_password = None
    smtp_password = None
    access_token = None
    gmail_service = None
    if is_outlook_oauth:
        try:
            refresh_token = smtp_service._decrypt_password(config["outlook_refresh_token"])
            access_token = await get_access_token_async(refresh_token)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Outlook OAuth token failed: {e}")
    elif is_gmail_oauth:
        try:
            refresh_token = smtp_service._decrypt_password(config["gmail_refresh_token"])
            client_id = config.get("google_client_id") or ""
            secret_encrypted = config.get("google_client_secret_encrypted")
            client_secret = smtp_service._decrypt_password(secret_encrypted) if secret_encrypted else ""
            access_token = await get_gmail_access_token_async(
                refresh_token,
                client_id,
                client_secret,
                scope="https://mail.google.com/",
            )
            gmail_service = build_gmail_service(access_token, refresh_token, client_id, client_secret)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Gmail OAuth token failed: {e}")
    else:
        try:
            imap_password = smtp_service._decrypt_password(config["imap_password"]) if config.get("imap_password") else None
            smtp_password = smtp_service._decrypt_password(config["smtp_password"]) if config.get("smtp_password") else None
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Decrypt failed: {e}")
        if not imap_password or not smtp_password:
            raise HTTPException(status_code=400, detail="IMAP and SMTP passwords required for password-based account")

    TEST_EMAIL_TO = os.getenv("WARMUP_TEST_EMAIL_TO", "test@example.com")
    test_token = uuid.uuid4().hex[:8]
    test_subject = f"Pigeon warmup – test email {test_token}"
    test_body = (
        "This is a test email from the Pigeon warmup receiver account test.\n\n"
        f"Test ID: {test_token}"
    )
    imap_ok = False
    imap_msg = ""
    inbox_count: Optional[int] = None
    smtp_ok = False
    smtp_msg = ""
    test_email_sent = False

    if is_outlook_oauth:
        try:
            inbox_count = await graph_get_inbox_count(access_token)
            imap_ok = True
            imap_msg = "Mail (Graph) OK"
        except Exception as e:
            imap_msg = f"Mail (Graph): {e}"
        if send_test_email:
            try:
                await graph_send_mail(
                    access_token,
                    TEST_EMAIL_TO,
                    test_subject,
                    test_body,
                    from_email=config.get("email"),
                )
                test_email_sent = True
                smtp_ok = True
                smtp_msg = "Send (Graph) OK"
            except Exception as e:
                smtp_msg = f"Send (Graph): {e}"
        else:
            smtp_ok = True
            smtp_msg = "Send (Graph): skipped (test email not requested)"
    elif is_gmail_oauth:
        # Use Gmail API (no IMAP/SMTP)
        if not gmail_service:
            imap_msg = "Gmail OAuth: service not available"
            smtp_msg = "Gmail OAuth: service not available"
        else:
            try:
                inbox_msgs = await asyncio.to_thread(gmail_api_list_inbox, gmail_service, 50)
                inbox_count = len(inbox_msgs)
                imap_ok = True
                imap_msg = "Mail (Gmail API) OK"
            except Exception as e:
                imap_msg = f"Mail (Gmail API): {e}"
            if send_test_email:
                try:
                    await asyncio.to_thread(
                        gmail_api_send_mail,
                        gmail_service,
                        TEST_EMAIL_TO,
                        test_subject,
                        test_body,
                        from_email=config.get("email"),
                    )
                    test_email_sent = True
                    smtp_ok = True
                    smtp_msg = "Send (Gmail API) OK"
                except Exception as e:
                    smtp_msg = f"Send (Gmail API): {e}"
            else:
                smtp_ok = True
                smtp_msg = "Send (Gmail API): skipped (test email not requested)"
    else:
        def _test_imap():
            nonlocal imap_ok, imap_msg, inbox_count
            host = config["imap_host"]
            port = config.get("imap_port", 993)
            if port == 993:
                conn = imaplib.IMAP4_SSL(host, port=port)
            else:
                conn = imaplib.IMAP4(host, port=port)
            conn.login(config["imap_username"], imap_password)
            conn.select("INBOX", readonly=True)
            typ, data = conn.search(None, "ALL")
            inbox_count = len(data[0].split()) if data and data[0] else 0
            conn.logout()
            imap_ok = True
            imap_msg = "IMAP OK"

        def _test_smtp():
            nonlocal smtp_ok, smtp_msg, test_email_sent
            host = config["smtp_host"]
            port = config.get("smtp_port", 587)
            if port == 465:
                server = smtplib.SMTP_SSL(host, port, timeout=15)
            else:
                server = smtplib.SMTP(host, port, timeout=15)
                if port == 587:
                    server.starttls()
            server.login(config["smtp_username"], smtp_password)
            from_addr = config.get("email") or config["smtp_username"]
            msg = MIMEText(test_body)
            msg["Subject"] = test_subject
            msg["From"] = from_addr
            msg["To"] = TEST_EMAIL_TO
            server.sendmail(from_addr, [TEST_EMAIL_TO], msg.as_string())
            test_email_sent = True
            server.quit()
            smtp_ok = True
            smtp_msg = "SMTP OK"

        def _test_smtp_login_only():
            nonlocal smtp_ok, smtp_msg
            host = config["smtp_host"]
            port = config.get("smtp_port", 587)
            if port == 465:
                server = smtplib.SMTP_SSL(host, port, timeout=15)
            else:
                server = smtplib.SMTP(host, port, timeout=15)
                if port == 587:
                    server.starttls()
            server.login(config["smtp_username"], smtp_password)
            server.quit()
            smtp_ok = True
            smtp_msg = "SMTP login OK (test email not sent)"

        try:
            await asyncio.to_thread(_test_imap)
        except Exception as e:
            imap_msg = f"IMAP: {e}"
        try:
            if send_test_email:
                await asyncio.to_thread(_test_smtp)
            else:
                await asyncio.to_thread(_test_smtp_login_only)
        except Exception as e:
            smtp_msg = f"SMTP: {e}"

    ok = imap_ok and smtp_ok
    account_label = f"{provider} ({config.get('email', '')})"
    if is_outlook_oauth:
        method_label = "Mail (Graph) and Send (Graph)"
    elif is_gmail_oauth:
        method_label = "OAuth (Gmail API)"
    else:
        method_label = "IMAP and SMTP"
    if imap_ok and smtp_ok:
        message = f"[{account_label}] {method_label} OK."
        if test_email_sent:
            message += f" Test email sent to {TEST_EMAIL_TO}."
        elif not send_test_email:
            message += " Test email send was skipped."
        if inbox_count is not None:
            message += f" INBOX: {inbox_count} message(s)."
        if inbox_count == 0 and not test_email_sent and send_test_email:
            message += " (No mail yet — run warmup sender so warming inboxes send to this receiver.)"
    else:
        parts = [imap_msg, smtp_msg]
        message = f"[{account_label}] " + "; ".join(parts)
    return {
        "ok": ok,
        "message": message,
        "provider": provider,
        "email": config.get("email"),
        "inbox_count": inbox_count,
        "test_email_sent": test_email_sent,
    }


# ---------------------------------------------------------------------------
# Warmup overview & sent history (platform-wide, main db)
# ---------------------------------------------------------------------------


@router.get(
    "/warmup/dashboard",
    dependencies=[Depends(require_admin_permissions(["system.read"]))],
)
async def get_warmup_dashboard(current_admin: dict = Depends(get_current_admin)):
    """
    Warming inboxes (status=warming) with per-inbox warmup_sent stats (7d / 30d) and platform totals.
    Spam vs inbox folder placement is not stored per message; receiver automation moves junk to inbox when seen.
    """
    now = datetime.now(timezone.utc)
    cutoff_7d = now - timedelta(days=7)
    cutoff_30d = now - timedelta(days=30)

    warming = await db.inboxes.find(
        {"status": "warming"},
        {
            "_id": 0,
            "smtp_password": 0,
            "gmail_app_password_encrypted": 0,
        },
    ).to_list(None)

    user_ids = list({i.get("user_id") for i in warming if i.get("user_id")})
    users_by_id: Dict[str, Dict[str, Any]] = {}
    if user_ids:
        async for u in db.users.find(
            {"id": {"$in": user_ids}},
            {"_id": 0, "id": 1, "email": 1, "first_name": 1, "last_name": 1},
        ):
            users_by_id[u["id"]] = u

    inbox_ids = [i.get("id") for i in warming if i.get("id")]

    stats7: Dict[str, Dict[str, Any]] = {}
    stats30: Dict[str, Dict[str, Any]] = {}
    if inbox_ids:
        pipeline_7d = [
            {"$match": {"inbox_id": {"$in": inbox_ids}, "sent_at": {"$gte": cutoff_7d}}},
            {
                "$group": {
                    "_id": "$inbox_id",
                    "sent": {"$sum": 1},
                    "opened": {"$sum": {"$cond": [{"$ne": ["$opened_at", None]}, 1, 0]}},
                    "replied": {"$sum": {"$cond": [{"$ne": ["$replied_at", None]}, 1, 0]}},
                }
            },
        ]
        pipeline_30d = [
            {"$match": {"inbox_id": {"$in": inbox_ids}, "sent_at": {"$gte": cutoff_30d}}},
            {"$group": {"_id": "$inbox_id", "sent": {"$sum": 1}}},
        ]
        rows7 = await db.warmup_sent.aggregate(pipeline_7d).to_list(None)
        rows30 = await db.warmup_sent.aggregate(pipeline_30d).to_list(None)
        for r in rows7:
            if r.get("_id"):
                stats7[r["_id"]] = r
        for r in rows30:
            if r.get("_id"):
                stats30[r["_id"]] = r

    inbox_rows: List[Dict[str, Any]] = []
    for inv in warming:
        iid = inv.get("id")
        if not iid:
            continue
        s7 = stats7.get(iid, {})
        s30 = stats30.get(iid, {})
        uid = inv.get("user_id")
        u = users_by_id.get(uid or "", {})
        sent7 = int(s7.get("sent", 0) or 0)
        op7 = int(s7.get("opened", 0) or 0)
        rep7 = int(s7.get("replied", 0) or 0)
        sent30 = int(s30.get("sent", 0) or 0)
        inbox_rows.append(
            {
                "inbox_id": iid,
                "inbox_email": inv.get("email"),
                "sender_type": inv.get("sender_type"),
                "user_id": uid,
                "user_email": u.get("email"),
                "auto_warmup": bool(inv.get("auto_warmup")),
                "warmup_progress": inv.get("warmup_progress", 0),
                "status": inv.get("status"),
                "sent_today": inv.get("sent_today", 0),
                "daily_limit": inv.get("daily_limit", 50),
                "warmup_target_open_rate": inv.get("warmup_target_open_rate"),
                "warmup_target_reply_rate": inv.get("warmup_target_reply_rate"),
                "warmup_sent_7d": sent7,
                "warmup_opened_7d": op7,
                "warmup_replied_7d": rep7,
                "warmup_open_rate_7d": round(op7 / sent7, 4) if sent7 else None,
                "warmup_reply_rate_7d": round(rep7 / sent7, 4) if sent7 else None,
                "warmup_sent_30d": sent30,
            }
        )

    inbox_rows.sort(key=lambda x: (x.get("inbox_email") or "").lower())

    total_sent_7d = await db.warmup_sent.count_documents({"sent_at": {"$gte": cutoff_7d}})
    total_opened_7d = await db.warmup_sent.count_documents(
        {"sent_at": {"$gte": cutoff_7d}, "opened_at": {"$ne": None}}
    )
    total_replied_7d = await db.warmup_sent.count_documents(
        {"sent_at": {"$gte": cutoff_7d}, "replied_at": {"$ne": None}}
    )

    return {
        "note": (
            "Opened = receiver marked the message read in inbox after delivery (including after spam→inbox moves). "
            "Replied = platform receiver sent a reply. Per-message spam folder placement is not stored."
        ),
        "summary": {
            "warming_inbox_count": len(inbox_rows),
            "auto_warmup_eligible_count": sum(1 for r in inbox_rows if r.get("auto_warmup")),
            "warmup_sent_7d_platform": total_sent_7d,
            "warmup_opened_7d_platform": total_opened_7d,
            "warmup_replied_7d_platform": total_replied_7d,
            "warmup_open_rate_7d_platform": round(total_opened_7d / total_sent_7d, 4) if total_sent_7d else None,
            "warmup_reply_rate_7d_platform": round(total_replied_7d / total_sent_7d, 4) if total_sent_7d else None,
        },
        "inboxes": inbox_rows,
    }


@router.get(
    "/warmup/sent-history",
    dependencies=[Depends(require_admin_permissions(["system.read"]))],
)
async def list_warmup_sent_history(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    inbox_id: Optional[str] = Query(None, description="Filter by sending inbox id"),
    current_admin: dict = Depends(get_current_admin),
):
    """Paginated warmup_sent records (most recent first) with inbox and user email joined."""
    q: Dict[str, Any] = {}
    if inbox_id:
        q["inbox_id"] = inbox_id

    total = await db.warmup_sent.count_documents(q)
    cursor = db.warmup_sent.find(q, {"_id": 0}).sort("sent_at", -1).skip(offset).limit(limit)
    docs = await cursor.to_list(None)

    inbox_ids = list({d.get("inbox_id") for d in docs if d.get("inbox_id")})
    user_ids = list({d.get("user_id") for d in docs if d.get("user_id")})

    inboxes_map: Dict[str, Dict[str, Any]] = {}
    if inbox_ids:
        invs = await db.inboxes.find({"id": {"$in": inbox_ids}}, {"_id": 0, "id": 1, "email": 1}).to_list(None)
        inboxes_map = {i["id"]: i for i in invs}
    users_map: Dict[str, Dict[str, Any]] = {}
    if user_ids:
        us = await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "email": 1}).to_list(None)
        users_map = {u["id"]: u for u in us}

    items: List[Dict[str, Any]] = []
    for d in docs:
        iid = d.get("inbox_id")
        uid = d.get("user_id")
        inv = inboxes_map.get(iid or "", {})
        usr = users_map.get(uid or "", {})
        items.append(
            {
                "id": d.get("id"),
                "inbox_id": iid,
                "inbox_email": inv.get("email"),
                "user_id": uid,
                "user_email": usr.get("email"),
                "receiver_account_id": d.get("receiver_account_id"),
                "receiver_email": d.get("receiver_email"),
                "engagement_mode": d.get("engagement_mode"),
                "thread_id": d.get("thread_id"),
                "subject": d.get("subject"),
                "sent_at": d.get("sent_at"),
                "opened_at": d.get("opened_at"),
                "replied_at": d.get("replied_at"),
                "reply_generation_source": d.get("reply_generation_source"),
                "reply_quality_score": d.get("reply_quality_score"),
                "close_network_mode": d.get("close_network_mode"),
                "close_network_risk_score": d.get("close_network_risk_score"),
                "close_network_reasons": d.get("close_network_reasons"),
                "sender_provider": d.get("sender_provider"),
                "receiver_provider": d.get("receiver_provider"),
                "sender_domain_root": d.get("sender_domain_root"),
                "receiver_domain_root": d.get("receiver_domain_root"),
            }
        )

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": items,
    }


@router.get(
    "/warmup/close-network/metrics",
    dependencies=[Depends(require_admin_permissions(["system.read"]))],
)
async def get_warmup_close_network_metrics(
    days: int = Query(7, ge=1, le=90, description="Rolling window for aggregates"),
    current_admin: dict = Depends(get_current_admin),
):
    """
    Aggregates close-network telemetry from warmup_sent and warmup_close_network_events
    so operators can decide when to change WARMUP_CLOSE_NETWORK_MODE (shadow → high_confidence → full).
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)
    threshold = warmup_close_cfg.WARMUP_CLOSE_NETWORK_RISK_THRESHOLD
    alert_rate = warmup_close_cfg.WARMUP_CLOSE_NETWORK_ALERT_REJECTION_RATE

    mode_env_raw = os.getenv("WARMUP_CLOSE_NETWORK_MODE")
    mode_loaded = warmup_close_cfg.WARMUP_CLOSE_NETWORK_MODE

    config = {
        "WARMUP_CLOSE_NETWORK_MODE_env": mode_env_raw if mode_env_raw is not None else None,
        "WARMUP_CLOSE_NETWORK_MODE_effective": mode_loaded,
        "WARMUP_CLOSE_NETWORK_PAIR_COOLDOWN_DAYS": warmup_close_cfg.WARMUP_CLOSE_NETWORK_PAIR_COOLDOWN_DAYS,
        "WARMUP_CLOSE_NETWORK_RECIPROCITY_WINDOW_DAYS": warmup_close_cfg.WARMUP_CLOSE_NETWORK_RECIPROCITY_WINDOW_DAYS,
        "WARMUP_CLOSE_NETWORK_RECIPROCITY_CAP": warmup_close_cfg.WARMUP_CLOSE_NETWORK_RECIPROCITY_CAP,
        "WARMUP_CLOSE_NETWORK_PROVIDER_DAILY_CAP": warmup_close_cfg.WARMUP_CLOSE_NETWORK_PROVIDER_DAILY_CAP,
        "WARMUP_CLOSE_NETWORK_DOMAIN_DAILY_CAP": warmup_close_cfg.WARMUP_CLOSE_NETWORK_DOMAIN_DAILY_CAP,
        "WARMUP_CLOSE_NETWORK_RISK_THRESHOLD": threshold,
        "WARMUP_CLOSE_NETWORK_ALERT_REJECTION_RATE": alert_rate,
        "WARMUP_CLOSE_NETWORK_MIN_CANDIDATES_PER_CYCLE": warmup_close_cfg.WARMUP_CLOSE_NETWORK_MIN_CANDIDATES_PER_CYCLE,
        "note": (
            "MODE_effective reflects the backend process at import time (same as the warmup sender). "
            "After changing env, restart workers so MODE_effective matches deployment."
        ),
    }

    match_sent = {
        "sent_at": {"$gte": cutoff},
        "engagement_mode": {"$in": ["network", "shared_pool"]},
    }

    sent_facets: Dict[str, Any] = {}
    try:
        sent_facets = await db.warmup_sent.aggregate(
            [
                {"$match": match_sent},
                {
                    "$facet": {
                        "total": [{"$count": "n"}],
                        "with_score": [
                            {
                                "$match": {
                                    "close_network_risk_score": {"$exists": True, "$ne": None},
                                }
                            },
                            {"$count": "n"},
                        ],
                        "would_block_full": [
                            {
                                "$match": {
                                    "close_network_risk_score": {"$gte": threshold},
                                }
                            },
                            {"$count": "n"},
                        ],
                        "by_engagement": [
                            {"$group": {"_id": "$engagement_mode", "c": {"$sum": 1}}},
                        ],
                        "by_logged_mode": [
                            {
                                "$match": {
                                    "close_network_mode": {"$exists": True, "$nin": [None, ""]},
                                }
                            },
                            {"$group": {"_id": "$close_network_mode", "c": {"$sum": 1}}},
                        ],
                        "reasons": [
                            {
                                "$match": {
                                    "close_network_reasons": {"$exists": True, "$type": "array", "$ne": []},
                                }
                            },
                            {"$unwind": "$close_network_reasons"},
                            {"$group": {"_id": "$close_network_reasons", "c": {"$sum": 1}}},
                            {"$sort": {"c": -1}},
                            {"$limit": 30},
                        ],
                    }
                },
            ]
        ).to_list(1)
    except Exception as e:
        logger.warning("close-network metrics: warmup_sent aggregate failed: %s", e)
        sent_facets = [{}]

    facet0 = (sent_facets[0] if sent_facets else {}) or {}

    def _facet_n(row: Dict[str, Any], key: str) -> int:
        arr = row.get(key) or []
        if not arr or not isinstance(arr[0], dict):
            return 0
        doc = arr[0]
        v = doc.get("n")
        if v is None:
            v = doc.get("count")
        try:
            return int(v or 0)
        except (TypeError, ValueError):
            return 0

    total_sent = _facet_n(facet0, "total")
    with_score = _facet_n(facet0, "with_score")
    would_block = _facet_n(facet0, "would_block_full")

    projected_full_rate = (would_block / with_score) if with_score else None
    projected_full_rate_vs_total = (would_block / total_sent) if total_sent else None

    by_engagement = [
        {"engagement_mode": r.get("_id"), "count": int(r.get("c", 0) or 0)}
        for r in facet0.get("by_engagement") or []
        if r.get("_id") is not None
    ]
    by_logged_mode = [
        {"close_network_mode": r.get("_id"), "count": int(r.get("c", 0) or 0)}
        for r in facet0.get("by_logged_mode") or []
        if r.get("_id") is not None
    ]
    reason_counts = [
        {"reason": r.get("_id"), "count": int(r.get("c", 0) or 0)}
        for r in facet0.get("reasons") or []
        if r.get("_id") is not None
    ]

    events_summary: Dict[str, Any] = {
        "total": 0,
        "by_action": [],
        "blocked_reason_counts": [],
        "recent": [],
    }
    try:
        ev_facets = await db.warmup_close_network_events.aggregate(
            [
                {"$match": {"created_at": {"$gte": cutoff}}},
                {
                    "$facet": {
                        "total": [{"$count": "n"}],
                        "by_action": [
                            {"$group": {"_id": "$action", "c": {"$sum": 1}}},
                        ],
                        "blocked_reasons": [
                            {"$match": {"action": "blocked"}},
                            {"$unwind": "$reasons"},
                            {"$group": {"_id": "$reasons", "c": {"$sum": 1}}},
                            {"$sort": {"c": -1}},
                            {"$limit": 30},
                        ],
                    }
                },
            ]
        ).to_list(1)
        ev0 = (ev_facets[0] if ev_facets else {}) or {}
        events_summary["total"] = _facet_n(ev0, "total")
        events_summary["by_action"] = [
            {"action": r.get("_id"), "count": int(r.get("c", 0) or 0)}
            for r in ev0.get("by_action") or []
            if r.get("_id") is not None
        ]
        events_summary["blocked_reason_counts"] = [
            {"reason": r.get("_id"), "count": int(r.get("c", 0) or 0)}
            for r in ev0.get("blocked_reasons") or []
            if r.get("_id") is not None
        ]
        recent = (
            await db.warmup_close_network_events.find(
                {"created_at": {"$gte": cutoff}},
                {
                    "_id": 0,
                    "id": 1,
                    "inbox_id": 1,
                    "user_id": 1,
                    "receiver_email": 1,
                    "mode": 1,
                    "action": 1,
                    "risk_score": 1,
                    "reasons": 1,
                    "created_at": 1,
                },
            )
            .sort("created_at", -1)
            .limit(40)
            .to_list(None)
        )
        events_summary["recent"] = recent
    except Exception as e:
        logger.warning("close-network metrics: events collection query failed: %s", e)

    guidance_lines: List[str] = []
    if mode_loaded == "shadow":
        if with_score == 0:
            guidance_lines.append(
                "No warmup_sent rows with close_network_risk_score in this window yet — "
                "wait for network/shared_pool traffic after deploy, then re-check."
            )
        elif projected_full_rate is not None:
            if projected_full_rate > alert_rate:
                guidance_lines.append(
                    f"Projected full-mode block rate ({projected_full_rate:.1%} of scored sends) is above "
                    f"the alert threshold ({alert_rate:.0%}). Tighten thresholds or stay in shadow longer before full."
                )
            else:
                guidance_lines.append(
                    f"Projected full-mode block rate ({projected_full_rate:.1%} of scored sends) is at or below "
                    f"the alert threshold ({alert_rate:.0%}). Reasonable to try high_confidence next, then full."
                )
        guidance_lines.append(
            "Rollout: shadow → high_confidence (pair cooldown only) → full. Restart backend after env changes."
        )
    elif mode_loaded == "high_confidence":
        guidance_lines.append(
            "Monitor events.by_action blocked counts and warmup volume. If stable, consider full with the same risk threshold."
        )
    elif mode_loaded == "full":
        guidance_lines.append(
            "If send volume drops sharply, set WARMUP_CLOSE_NETWORK_MODE=shadow and restart, then re-tune caps/threshold."
        )
    else:
        guidance_lines.append("Close-network rules are off; telemetry still accumulates on sends when fields are written.")

    return {
        "period_days": days,
        "cutoff_utc": cutoff.isoformat(),
        "generated_at_utc": now.isoformat(),
        "config": config,
        "warmup_sent": {
            "total_network_and_shared_pool": total_sent,
            "with_close_network_score": with_score,
            "would_block_if_full_mode": would_block,
            "projected_full_block_rate_among_scored": projected_full_rate,
            "projected_full_block_rate_among_all_network_pool": projected_full_rate_vs_total,
            "by_engagement_mode": by_engagement,
            "by_logged_close_network_mode": by_logged_mode,
            "close_network_reason_counts": reason_counts,
        },
        "events": events_summary,
        "guidance": guidance_lines,
    }

