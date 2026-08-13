"""Reply-To IMAP config CRUD (for campaign Reply-To option)."""
from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid

from database import db
from routes.dependencies import get_current_user
from routes.schemas import ReplyToImapConfigCreate, ReplyToImapConfigUpdate

router = APIRouter()

# Injected from server.py (SMTPService for encrypt/decrypt password)
smtp_service = None


def init_smtp_service(service):
    """Initialize SMTP service for password encryption."""
    global smtp_service
    smtp_service = service


@router.get("/reply-to-imap-configs")
async def list_reply_to_imap_configs(current_user: dict = Depends(get_current_user)):
    """List Reply-To IMAP configs for the current user (no password)."""
    user_id = current_user["id"]
    cursor = db.reply_to_imap_configs.find(
        {"user_id": user_id},
        {"_id": 0, "imap_password": 0},
    ).sort("created_at", -1)
    configs = await cursor.to_list(None)
    return configs


@router.post("/reply-to-imap-configs")
async def create_reply_to_imap_config(
    payload: ReplyToImapConfigCreate,
    current_user: dict = Depends(get_current_user),
):
    """Create a Reply-To IMAP config. Password is encrypted at rest."""
    if smtp_service is None:
        raise HTTPException(status_code=503, detail="Service not configured")
    user_id = current_user["id"]
    config_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    encrypted_password = smtp_service._encrypt_password(payload.imap_password)
    doc = {
        "id": config_id,
        "user_id": user_id,
        "email": payload.email,
        "imap_host": payload.imap_host,
        "imap_port": payload.imap_port,
        "imap_username": payload.imap_username,
        "imap_password": encrypted_password,
        "created_at": now,
        "updated_at": now,
    }
    await db.reply_to_imap_configs.insert_one(doc)
    doc.pop("_id", None)
    doc.pop("imap_password", None)
    return doc


@router.put("/reply-to-imap-configs/{config_id}")
async def update_reply_to_imap_config(
    config_id: str,
    payload: ReplyToImapConfigUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Update a Reply-To IMAP config. Only provided fields are updated."""
    user_id = current_user["id"]
    existing = await db.reply_to_imap_configs.find_one({"id": config_id, "user_id": user_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Reply-To IMAP config not found")
    update_data = payload.model_dump(exclude_unset=True)
    if "imap_password" in update_data and update_data["imap_password"]:
        if smtp_service is None:
            raise HTTPException(status_code=503, detail="Service not configured")
        update_data["imap_password"] = smtp_service._encrypt_password(update_data["imap_password"])
    update_data["updated_at"] = datetime.now(timezone.utc)
    await db.reply_to_imap_configs.update_one(
        {"id": config_id, "user_id": user_id},
        {"$set": update_data},
    )
    doc = await db.reply_to_imap_configs.find_one(
        {"id": config_id, "user_id": user_id},
        {"_id": 0, "imap_password": 0},
    )
    return doc


@router.delete("/reply-to-imap-configs/{config_id}")
async def delete_reply_to_imap_config(
    config_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Delete a Reply-To IMAP config."""
    user_id = current_user["id"]
    result = await db.reply_to_imap_configs.delete_one({"id": config_id, "user_id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Reply-To IMAP config not found")
    return {"message": "Reply-To IMAP config deleted"}


@router.post("/reply-to-imap-configs/{config_id}/test")
async def test_reply_to_imap_config(
    config_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Test IMAP connection for a Reply-To config."""
    user_id = current_user["id"]
    config = await db.reply_to_imap_configs.find_one({"id": config_id, "user_id": user_id})
    if not config:
        raise HTTPException(status_code=404, detail="Reply-To IMAP config not found")
    if smtp_service is None:
        raise HTTPException(status_code=503, detail="Service not configured")
    import asyncio
    import imaplib
    try:
        password = smtp_service._decrypt_password(config["imap_password"])
    except Exception as e:
        raise HTTPException(status_code=400, detail="Could not decrypt password")
    try:
        def _connect():
            port = config.get("imap_port", 993)
            use_ssl = port == 993
            if use_ssl:
                conn = imaplib.IMAP4_SSL(config["imap_host"], port=port)
            else:
                conn = imaplib.IMAP4(config["imap_host"], port=port)
            conn.login(config["imap_username"], password)
            conn.select("INBOX")
            conn.logout()
        await asyncio.to_thread(_connect)
        return {"message": "Connection successful"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection failed: {str(e)}")
