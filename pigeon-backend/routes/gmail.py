"""Gmail OAuth routes"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse
import os
import logging
from datetime import datetime, timezone

from database import db
from services.gmail_service import GmailService

router = APIRouter()

# Initialize service (will be injected from server.py)
gmail_service: GmailService = None

def init_gmail_service(service: GmailService):
    """Initialize Gmail service"""
    global gmail_service
    gmail_service = service

@router.get("/gmail/auth")
async def gmail_auth(user_id: str, credential_id: str = None):
    """Initiate Gmail OAuth flow. credential_id omitted = add new account; provided = re-auth that account."""
    try:
        auth_url = await gmail_service.get_auth_url(user_id, credential_id)
        return {"auth_url": auth_url}
    except Exception as e:
        logging.warning(f"Gmail auth initiation failed for user_id={user_id}: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/gmail/callback")
async def gmail_callback(code: str, state: str):
    """Handle Gmail OAuth callback"""
    try:
        user_id = await gmail_service.handle_callback(code, state)
        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
        return RedirectResponse(url=f"{frontend_url}?auth=success")
    except Exception as e:
        logging.error(f"Gmail auth error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/gmail/status")
async def gmail_status(user_id: str):
    """List connected Gmail accounts with sent_today per account (OAuth and app-password)."""
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    accounts = []
    creds = await db.gmail_credentials.find({"user_id": user_id}).to_list(None)
    for c in creds:
        cid = c.get("id") or c.get("user_id")
        email = c.get("gmail_email", "")
        gmail_sender_ids = [user_id] if cid == user_id else [cid]
        inboxes = await db.inboxes.find(
            {"user_id": user_id, "sender_type": "gmail", "gmail_credentials_id": cid},
            {"id": 1}
        ).to_list(None)
        gmail_sender_ids.extend(inbox["id"] for inbox in inboxes)
        sent_today = await db.email_logs.count_documents({
            "sender_id": {"$in": gmail_sender_ids},
            "sender_type": "gmail",
            "status": "sent",
            "sent_at": {"$gte": today_start},
        })
        accounts.append({"id": cid, "email": email, "sent_today": sent_today})
    app_password_inboxes = await db.inboxes.find(
        {"user_id": user_id, "sender_type": "gmail", "gmail_auth_method": "app_password"},
        {"id": 1, "email": 1}
    ).to_list(None)
    for inbox in app_password_inboxes:
        sent_today = await db.email_logs.count_documents({
            "sender_id": inbox["id"],
            "sender_type": "gmail",
            "status": "sent",
            "sent_at": {"$gte": today_start},
        })
        accounts.append({"id": inbox["id"], "email": inbox["email"], "sent_today": sent_today, "auth_method": "app_password"})
    connected = len(accounts) > 0
    email = accounts[0]["email"] if accounts else None
    sent_today = accounts[0]["sent_today"] if accounts else 0
    return {"connected": connected, "email": email, "sent_today": sent_today, "accounts": accounts}

@router.delete("/gmail/disconnect")
async def disconnect_gmail(user_id: str, credential_id: str = None, inbox_id: str = None):
    """Disconnect one Gmail account. Provide credential_id or inbox_id (and user_id)."""
    if not credential_id and not inbox_id:
        raise HTTPException(status_code=400, detail="Provide credential_id or inbox_id to disconnect one account.")
    if inbox_id:
        inbox = await db.inboxes.find_one({"id": inbox_id, "user_id": user_id})
        if not inbox or inbox.get("sender_type") != "gmail":
            raise HTTPException(status_code=404, detail="Gmail inbox not found.")
        if not inbox.get("gmail_credentials_id"):
            await db.inboxes.delete_one({"id": inbox_id, "user_id": user_id})
            return {"message": "Gmail disconnected"}
        credential_id = inbox.get("gmail_credentials_id")
    cid = credential_id
    cred = await db.gmail_credentials.find_one({"id": cid, "user_id": user_id})
    if not cred:
        cred = await db.gmail_credentials.find_one({"user_id": user_id})
        if cred and cred.get("id") != cid:
            raise HTTPException(status_code=404, detail="Credential not found for this user.")
    if not cred:
        raise HTTPException(status_code=404, detail="Gmail credential not found.")
    await db.gmail_credentials.delete_one({"id": cid, "user_id": user_id})
    await db.inboxes.delete_many({"user_id": user_id, "gmail_credentials_id": cid})
    return {"message": "Gmail disconnected"}
