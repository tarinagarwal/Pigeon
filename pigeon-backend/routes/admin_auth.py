"""Admin authentication routes.

Admin auth uses HTTP-only cookies (same pattern as user auth). The frontend
sends credentials on every request; no token in localStorage.
"""

from datetime import datetime, timezone, timedelta
import logging
import os

from fastapi import APIRouter, HTTPException, Depends
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from database import admin_db
from admin_models import AdminUser
from routes.auth_utils import (
    get_password_hash,
    verify_password,
    create_admin_access_token,
    normalize_email,
)
from routes.schemas import LoginRequest, CreateAdminRequest, UpdateAdminStatusRequest, UpdateAdminPasswordRequest
from routes.dependencies import get_current_admin, get_current_super_admin, ADMIN_AUTH_COOKIE_NAME


router = APIRouter(prefix="/admin")

COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"


def _set_admin_auth_cookie(response: JSONResponse, token: str) -> None:
    """Set HTTP-only admin auth cookie on response."""
    max_age = 24 * 3600  # 24 hours
    response.set_cookie(
        key=ADMIN_AUTH_COOKIE_NAME,
        value=token,
        max_age=max_age,
        path="/",
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
    )


def _clear_admin_auth_cookie(response: JSONResponse) -> None:
    """Clear admin auth cookie on response."""
    response.delete_cookie(key=ADMIN_AUTH_COOKIE_NAME, path="/")


@router.post("/auth/login")
async def admin_login(request: LoginRequest):
    """Login admin user; returns access_token for Authorization: Bearer (email is case-insensitive)."""
    email_norm = normalize_email(request.email)
    admin = await admin_db.admin_users.find_one({
        "$or": [{"email": email_norm}, {"email": request.email.strip()}]
    })
    if not admin:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if admin.get("status") != "active":
        raise HTTPException(status_code=403, detail="Admin account is disabled")

    if not verify_password(request.password, admin["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    access_token = create_admin_access_token(
        data={"sub": admin["id"], "type": "admin"}
    )

    admin_dict = {
        k: v
        for k, v in admin.items()
        if k not in {"_id", "password_hash"}
    }

    response = JSONResponse(content=jsonable_encoder({
        "admin": admin_dict,
        "token_type": "bearer",
        "access_token": access_token,
    }))
    _set_admin_auth_cookie(response, access_token)
    return response


@router.get("/auth/me")
async def admin_me(current_admin: dict = Depends(get_current_admin)):
    """Return the currently authenticated admin user."""
    return current_admin


@router.post("/auth/logout")
async def admin_logout(current_admin: dict = Depends(get_current_admin)):
    """Logout admin: clear auth cookie and return success."""
    logging.info(
        "Admin %s logged out at %s",
        current_admin.get("id"),
        datetime.now(timezone.utc).isoformat(),
    )
    response = JSONResponse(content={"message": "Logged out successfully"})
    _clear_admin_auth_cookie(response)
    return response


def _allow_dev_create_admin() -> bool:
    """Only allow the dev create-admin endpoint when explicitly enabled (e.g. local/dev)."""
    return os.getenv("ALLOW_DEV_CREATE_ADMIN", "").lower() in ("1", "true", "yes")


@router.post("/auth/create-admin")
async def create_admin_user_dev():
    """TEMPORARY endpoint to create an admin user for testing.
    Only available when ALLOW_DEV_CREATE_ADMIN=true. Disabled by default in production.
    """
    if not _allow_dev_create_admin():
        raise HTTPException(status_code=403, detail="Create-admin is disabled. Set ALLOW_DEV_CREATE_ADMIN=true only in dev.")
    # Check if admin user already exists
    existing_admin = await admin_db.admin_users.find_one({"email": "admin@example.com"})
    if existing_admin:
        return {"message": "Admin user already exists"}
    
    # Create admin user
    admin_user = AdminUser(
        email="admin@example.com",
        password_hash=get_password_hash("admin123"),
        is_super_admin=True,
        status="active"
    )
    
    # Insert into database
    result = await admin_db.admin_users.insert_one(admin_user.model_dump())
    
    if result.inserted_id:
        return {
            "message": "Admin user created successfully!",
            "email": "admin@example.com",
            "password": "admin123",
            "warning": "Remember to change the password in production!"
        }
    else:
        raise HTTPException(status_code=500, detail="Failed to create admin user")


# ---------------------------------------------------------------------------
# Admin management (super admin only)
# ---------------------------------------------------------------------------

def _serialize_admin(doc: dict) -> dict:
    """Strip sensitive fields and serialize datetimes for JSON."""
    out = {k: v for k, v in doc.items() if k not in {"_id", "password_hash"}}
    for key in ("created_at", "updated_at"):
        if key in out and hasattr(out[key], "isoformat"):
            out[key] = out[key].isoformat()
    return out


@router.get("/admins")
async def list_admins(current_admin: dict = Depends(get_current_super_admin)):
    """List all admin users (super admin only)."""
    cursor = admin_db.admin_users.find({}, {"_id": 0, "password_hash": 0})
    admins = await cursor.to_list(None)
    return {"admins": [_serialize_admin(a) for a in admins]}


@router.post("/admins")
async def create_admin_user(
    body: CreateAdminRequest,
    current_admin: dict = Depends(get_current_super_admin),
):
    """Create a new admin user (super admin only). Email is stored lowercase."""
    email = normalize_email(body.email)
    existing = await admin_db.admin_users.find_one({
        "$or": [{"email": email}, {"email": body.email.strip()}]
    })
    if existing:
        raise HTTPException(status_code=400, detail="An admin with this email already exists")
    admin_user = AdminUser(
        email=email,
        password_hash=get_password_hash(body.password),
        is_super_admin=body.is_super_admin,
        status="active",
    )
    await admin_db.admin_users.insert_one(admin_user.model_dump())
    created = await admin_db.admin_users.find_one(
        {"id": admin_user.id},
        {"_id": 0, "password_hash": 0},
    )
    return _serialize_admin(created)


@router.patch("/admins/{admin_id}/status")
async def update_admin_status(
    admin_id: str,
    body: UpdateAdminStatusRequest,
    current_admin: dict = Depends(get_current_super_admin),
):
    """Enable or disable an admin (super admin only). Cannot disable yourself."""
    if body.status not in ("active", "disabled"):
        raise HTTPException(status_code=400, detail="status must be 'active' or 'disabled'")
    if admin_id == current_admin.get("id"):
        raise HTTPException(status_code=400, detail="You cannot change your own status")
    admin = await admin_db.admin_users.find_one({"id": admin_id})
    if not admin:
        raise HTTPException(status_code=404, detail="Admin not found")
    await admin_db.admin_users.update_one(
        {"id": admin_id},
        {"$set": {"status": body.status, "updated_at": datetime.now(timezone.utc)}},
    )
    updated = await admin_db.admin_users.find_one(
        {"id": admin_id},
        {"_id": 0, "password_hash": 0},
    )
    return _serialize_admin(updated)


@router.patch("/admins/{admin_id}/password")
async def update_admin_password(
    admin_id: str,
    body: UpdateAdminPasswordRequest,
    current_admin: dict = Depends(get_current_super_admin),
):
    """Set a new password for an admin (super admin only)."""
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    admin = await admin_db.admin_users.find_one({"id": admin_id})
    if not admin:
        raise HTTPException(status_code=404, detail="Admin not found")
    await admin_db.admin_users.update_one(
        {"id": admin_id},
        {
            "$set": {
                "password_hash": get_password_hash(body.new_password),
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )
    return {"message": "Password updated"}


@router.delete("/admins/{admin_id}")
async def delete_admin(
    admin_id: str,
    current_admin: dict = Depends(get_current_super_admin),
):
    """Delete an admin user (super admin only). Cannot delete yourself."""
    if admin_id == current_admin.get("id"):
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    result = await admin_db.admin_users.delete_one({"id": admin_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Admin not found")
    return {"message": "Admin deleted"}

