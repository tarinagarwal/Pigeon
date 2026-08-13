"""Workspace management: sub-user invitations and page-level permissions."""

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr

from database import db
from routes.dependencies import get_current_user
from models import SubUserPermissions
from services.email_templates import workspace_team_invitation
from services.smtp_service import SMTPService

router = APIRouter(prefix="/workspace", tags=["workspace"])

smtp_service: Optional[SMTPService] = None


def init_smtp_service(service: SMTPService) -> None:
    global smtp_service
    smtp_service = service


def _app_frontend_base_url() -> str:
    u = (os.getenv("FRONTEND_URL") or os.getenv("FRONTEND_URL_MAILBOX") or "").rstrip("/")
    if not u:
        u = (os.getenv("BACKEND_URL") or "").rstrip("/")
    return u


class InviteSubUserRequest(BaseModel):
    email: EmailStr
    name: Optional[str] = None
    permissions: Optional[SubUserPermissions] = None


class UpdateSubUserRequest(BaseModel):
    permissions: SubUserPermissions
    name: Optional[str] = None


@router.get("/sub-users")
async def list_sub_users(current_user: dict = Depends(get_current_user)):
    """List all sub-users for the current workspace owner."""
    owner_id = current_user["id"]
    invitations = await db.sub_user_invitations.find(
        {"owner_id": owner_id},
        {"_id": 0},
    ).to_list(None)
    return {"sub_users": invitations}


@router.post("/sub-users")
async def add_sub_user(
    payload: InviteSubUserRequest,
    current_user: dict = Depends(get_current_user),
):
    """Add a user as a sub-user of the current workspace."""
    owner_id = current_user["id"]
    email_lower = payload.email.lower()

    if email_lower == current_user["email"].lower():
        raise HTTPException(status_code=400, detail="You cannot add yourself as a sub-user")

    existing = await db.sub_user_invitations.find_one(
        {"owner_id": owner_id, "sub_user_email": email_lower, "status": "active"}
    )
    if existing:
        raise HTTPException(status_code=400, detail="This user is already a member of your workspace")

    # Resolve sub_user_id if the email belongs to an existing account
    invited_user = await db.users.find_one(
        {"email": email_lower}, {"id": 1, "first_name": 1, "last_name": 1}
    )

    now = datetime.now(timezone.utc)
    permissions = payload.permissions or SubUserPermissions()

    display_name = payload.name
    if not display_name and invited_user:
        display_name = (
            f"{invited_user.get('first_name', '')} {invited_user.get('last_name', '')}".strip()
            or None
        )

    doc = {
        "id": str(uuid.uuid4()),
        "owner_id": owner_id,
        "sub_user_email": email_lower,
        "sub_user_id": invited_user["id"] if invited_user else None,
        "name": display_name,
        "status": "active",
        "permissions": permissions.model_dump(),
        "invited_at": now,
        "updated_at": now,
    }

    await db.sub_user_invitations.insert_one(doc)
    doc.pop("_id", None)

    inviter_first = (current_user.get("first_name") or "").strip()
    inviter_last = (current_user.get("last_name") or "").strip()
    inviter_name = f"{inviter_first} {inviter_last}".strip() or (
        current_user.get("email") or "A workspace owner"
    )

    base = _app_frontend_base_url()
    email_q = quote(email_lower, safe="")
    login_url = f"{base}/login?email={email_q}" if base else f"/login?email={email_q}"
    signup_url = f"{base}/signup?email={email_q}" if base else f"/signup?email={email_q}"

    subject, body_plain, body_html = workspace_team_invitation(
        inviter_name,
        invitee_has_account=invited_user is not None,
        signup_url=signup_url,
        login_url=login_url,
    )
    if smtp_service:
        try:
            sent = await smtp_service.send_app_notification_email(
                to_email=email_lower,
                subject=subject,
                body_plain=body_plain,
                body_html=body_html,
            )
            if not sent:
                logging.warning(
                    "Workspace invite email not sent to %s (notification mail returned False)",
                    email_lower,
                )
        except Exception:
            logging.exception("Failed to send workspace invite email to %s", email_lower)
    else:
        logging.warning(
            "SMTPService not injected; workspace invite email not sent to %s",
            email_lower,
        )

    return {"sub_user": doc, "message": "Sub-user added successfully"}


@router.put("/sub-users/{invitation_id}")
async def update_sub_user(
    invitation_id: str,
    payload: UpdateSubUserRequest,
    current_user: dict = Depends(get_current_user),
):
    """Update name and permissions for a sub-user."""
    owner_id = current_user["id"]

    invitation = await db.sub_user_invitations.find_one(
        {"id": invitation_id, "owner_id": owner_id}
    )
    if not invitation:
        raise HTTPException(status_code=404, detail="Sub-user not found")

    updates: dict = {
        "permissions": payload.permissions.model_dump(),
        "updated_at": datetime.now(timezone.utc),
    }
    if payload.name is not None:
        updates["name"] = payload.name

    await db.sub_user_invitations.update_one({"id": invitation_id}, {"$set": updates})
    updated = await db.sub_user_invitations.find_one({"id": invitation_id}, {"_id": 0})
    return {"sub_user": updated}


@router.delete("/sub-users/{invitation_id}")
async def remove_sub_user(
    invitation_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Remove a sub-user from the workspace."""
    owner_id = current_user["id"]

    invitation = await db.sub_user_invitations.find_one(
        {"id": invitation_id, "owner_id": owner_id}
    )
    if not invitation:
        raise HTTPException(status_code=404, detail="Sub-user not found")

    await db.sub_user_invitations.delete_one({"id": invitation_id})
    return {"deleted": True}


@router.get("/my-access")
async def get_my_access(current_user: dict = Depends(get_current_user)):
    """Return the calling user's sub-user permissions (if they are a sub-user)."""
    return {
        "is_sub_user": current_user.get("_is_sub_user", False),
        "permissions": current_user.get("_sub_user_permissions"),
        "workspace_owner_id": current_user.get("_workspace_owner_id"),
    }


@router.get("/available")
async def get_available_workspaces(current_user: dict = Depends(get_current_user)):
    """Return all workspaces this user has been added to as a sub-user.

    Matches by sub_user_id (preferred) or by sub_user_email as a fallback so
    invitations added before the user's account existed are still surfaced.
    """
    # Use the original user ID if operating inside another workspace already
    user_id = current_user.get("_original_user_id") or current_user["id"]
    user_email = (current_user.get("email") or "").lower()

    invitations = await db.sub_user_invitations.find(
        {
            "$or": [
                {"sub_user_id": user_id, "status": "active"},
                {"sub_user_email": user_email, "status": "active"},
            ]
        },
        {"_id": 0},
    ).to_list(None)

    # Back-fill sub_user_id for email-matched invitations that lack it
    for inv in invitations:
        if not inv.get("sub_user_id") and inv.get("sub_user_email") == user_email:
            await db.sub_user_invitations.update_one(
                {"id": inv["id"]},
                {"$set": {"sub_user_id": user_id}},
            )

    workspaces = []
    for inv in invitations:
        owner = await db.users.find_one(
            {"id": inv["owner_id"]},
            {"id": 1, "first_name": 1, "last_name": 1, "email": 1, "company": 1},
        )
        if owner:
            name = f"{owner.get('first_name', '')} {owner.get('last_name', '')}".strip()
            workspaces.append({
                "owner_id": inv["owner_id"],
                "owner_name": name or owner.get("email", ""),
                "owner_email": owner.get("email", ""),
                "owner_company": owner.get("company") or None,
                "permissions": inv.get("permissions", {}),
            })

    return {"workspaces": workspaces}
