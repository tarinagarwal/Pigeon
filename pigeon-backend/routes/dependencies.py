"""Shared dependencies for routes.

This module provides helpers for:
- Authenticating regular users via JWT.
- Authenticating admin users via JWT (same JWT_SECRET as users; admin tokens have type=admin).
- Enforcing admin permissions (RBAC) for admin-only endpoints.
"""

import logging
from datetime import datetime, timezone, date
from typing import List, Callable

from fastapi import HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt

# Import database connections
from database import db, admin_db

# JWT configuration: single source of truth from auth_utils (loads .env)
from routes.auth_utils import JWT_ALGORITHM, JWT_SECRET

# Security scheme (Authorization: Bearer <token>). auto_error=False so we can fall back to cookie for user auth.
security = HTTPBearer(auto_error=False)
# Cookie name must match auth.py AUTH_COOKIE_NAME
AUTH_COOKIE_NAME = "auth_token"
# Mailbox auth cookie (must match auth.MAILBOX_AUTH_COOKIE_NAME)
MAILBOX_AUTH_COOKIE_NAME = "mailbox_auth_token"
# Admin cookie name (must match admin_auth.ADMIN_AUTH_COOKIE_NAME)
ADMIN_AUTH_COOKIE_NAME = "admin_auth_token"


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    """Get current user from JWT: from auth cookie first, then Authorization header.

    In demo mode (demo=1 query or X-Demo-Mode header) when no auth token is present,
    return a synthetic read-only demo user instead of raising 401.
    """
    is_demo = (
        request.query_params.get("demo") == "1"
        or request.headers.get("x-demo-mode") == "1"
    )

    if is_demo:
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
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
            "_is_demo": True,
        }

    token = request.cookies.get(AUTH_COOKIE_NAME) if request.cookies else None
    if not token and credentials:
        token = credentials.credentials
    if not token:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id: str = payload.get("sub")
        token_iat = payload.get("iat")  # Token issue time
        jti = payload.get("jti")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")

    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")

    # If token has jti (session-backed), verify session still exists
    if jti:
        session = await db.sessions.find_one({"user_id": user_id, "jti": jti})
        if session is None:
            raise HTTPException(status_code=401, detail="Session expired or revoked")
        # Update last_active for this session
        await db.sessions.update_one(
            {"user_id": user_id, "jti": jti},
            {"$set": {"last_active": datetime.now(timezone.utc)}},
        )
        user["_jti"] = jti
    
    # Handle subscription trial expiry and regular subscription expiry.
    plan_id = user.get("plan_id")
    subscription_end = user.get("subscription_end")
    trial_ends_at = user.get("trial_ends_at")
    subscription_status = user.get("subscription_status")

    # 1) Trial expiry: if trial has ended, downgrade to free.
    if subscription_status == "trial" and trial_ends_at:
        try:
            if isinstance(trial_ends_at, datetime):
                trial_end_dt = trial_ends_at
            else:
                # Stored as string/naive date; parse conservatively
                trial_end_dt = datetime.fromisoformat(str(trial_ends_at))
            if datetime.now(timezone.utc) > trial_end_dt.replace(tzinfo=timezone.utc):
                await db.users.update_one(
                    {"id": user_id},
                    {
                        "$set": {
                            "plan_id": "free",
                            "subscription_status": "active",
                            "trial_ends_at": None,
                            "subscription_start": None,
                            "subscription_end": None,
                            "updated_at": datetime.now(timezone.utc),
                        }
                    },
                )
                user["plan_id"] = "free"
                user["subscription_status"] = "active"
                user["trial_ends_at"] = None
                user["subscription_start"] = None
                user["subscription_end"] = None
                logging.info(
                    "Trial expired for user %s (previous plan %s); downgraded to free",
                    user_id,
                    plan_id,
                )
        except Exception as e:
            logging.debug("Could not handle trial expiry for user %s: %s", user_id, e)

    # 2) Regular subscription expiry: only for non-free plans. If subscription_end is in the past, downgrade to free.
    plan_id = user.get("plan_id")
    subscription_end = user.get("subscription_end")
    if plan_id and plan_id != "free" and subscription_end:
        try:
            if isinstance(subscription_end, datetime):
                end_date = subscription_end.date() if hasattr(subscription_end, "date") else date.fromisoformat(subscription_end.strftime("%Y-%m-%d"))
            else:
                end_date = date.fromisoformat(str(subscription_end)[:10])
            if date.today() > end_date:
                await db.users.update_one(
                    {"id": user_id},
                    {
                        "$set": {
                            "plan_id": "free",
                            "subscription_start": None,
                            "subscription_end": None,
                            "updated_at": datetime.now(timezone.utc),
                        }
                    },
                )
                user["plan_id"] = "free"
                user["subscription_start"] = None
                user["subscription_end"] = None
                logging.info("Subscription expired for user %s (plan was %s, ended %s); downgraded to free", user_id, plan_id, subscription_end)
        except (ValueError, TypeError) as e:
            logging.debug("Could not parse subscription_end for user %s: %s", user_id, e)

    # 3) Paid plan_id in DB but no billing entitlement (e.g. cancelled without successful charge) — persist free tier.
    try:
        from services.plan_service import sync_stored_plan_with_entitlements_if_needed

        user = await sync_stored_plan_with_entitlements_if_needed(db, user)
    except Exception as e:
        logging.debug("Billing plan sync for user %s: %s", user_id, e)

    # Workspace context: sub-user operating in another user's workspace.
    # The frontend sends X-Workspace-Context: {owner_user_id} when the sub-user
    # has switched into a workspace they were invited to. We verify the invitation
    # and swap the effective user to the owner so all data endpoints serve the
    # owner's resources automatically.
    workspace_context = request.headers.get("X-Workspace-Context")
    if workspace_context and workspace_context != user_id:
        user_email = (user.get("email") or "").lower()
        sub_invitation = await db.sub_user_invitations.find_one(
            {
                "owner_id": workspace_context,
                "status": "active",
                "$or": [
                    {"sub_user_id": user_id},
                    {"sub_user_email": user_email},
                ],
            },
            {"_id": 0},
        )
        if sub_invitation:
            owner = await db.users.find_one(
                {"id": workspace_context},
                {"_id": 0, "password_hash": 0},
            )
            if owner:
                from services.plan_service import sync_stored_plan_with_entitlements_if_needed

                owner = await sync_stored_plan_with_entitlements_if_needed(db, owner)
                owner["_is_sub_user"] = True
                owner["_sub_user_permissions"] = sub_invitation.get("permissions", {})
                owner["_workspace_owner_id"] = workspace_context
                owner["_original_user_id"] = user_id
                return owner

    # Check if user is banned
    if user.get("status") == "banned":
        raise HTTPException(status_code=403, detail="Account is banned and cannot be accessed")

    # Check if user was banned after token was issued
    if user.get("banned_at") and token_iat:
        banned_at = user["banned_at"]
        if isinstance(banned_at, datetime) and banned_at.tzinfo is None:
            banned_at = banned_at.replace(tzinfo=timezone.utc)
        
        token_issue_time = datetime.fromtimestamp(token_iat, tz=timezone.utc)
        if banned_at > token_issue_time:
            raise HTTPException(status_code=403, detail="Account has been banned and access is revoked")
    
    return user


async def get_current_mailbox(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    """Get current mailbox from JWT: mailbox auth cookie or Authorization header. Returns inbox doc + user_id."""
    token = request.cookies.get(MAILBOX_AUTH_COOKIE_NAME) if request.cookies else None
    if not token and credentials:
        token = credentials.credentials
    if not token:
        raise HTTPException(status_code=401, detail="Mailbox login required")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        inbox_id: str = payload.get("sub")
        token_type: str = payload.get("type", "user")
        user_id: str = payload.get("user_id")
        if inbox_id is None or token_type != "mailbox" or user_id is None:
            raise HTTPException(status_code=401, detail="Invalid mailbox token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid mailbox token")

    inbox = await db.inboxes.find_one(
        {"id": inbox_id, "user_id": user_id},
        {"_id": 0, "smtp_password": 0, "gmail_app_password_encrypted": 0, "mailbox_password_hash": 0},
    )
    if inbox is None:
        raise HTTPException(status_code=401, detail="Mailbox not found")
    inbox["_user_id"] = user_id
    return inbox


async def get_admin_db():
    """Return the admin/system database handle."""
    return admin_db


async def get_current_admin(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    """Get current admin from JWT: from auth cookie first, then Authorization header (same as user)."""
    token = request.cookies.get(ADMIN_AUTH_COOKIE_NAME) if request.cookies else None
    if not token and credentials:
        token = credentials.credentials
    if not token:
        raise HTTPException(status_code=401, detail="Invalid admin authentication credentials")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        admin_id: str = payload.get("sub")
        token_type: str = payload.get("type", "user")
        if admin_id is None or token_type != "admin":
            raise HTTPException(status_code=401, detail="Invalid admin authentication credentials")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid admin authentication credentials")

    admin = await admin_db.admin_users.find_one(
        {"id": admin_id},
        {"_id": 0, "password_hash": 0},
    )
    if admin is None:
        raise HTTPException(status_code=401, detail="Admin user not found")
    if admin.get("status") != "active":
        raise HTTPException(status_code=403, detail="Admin account is disabled")
    return admin


async def get_current_super_admin(current_admin: dict = Depends(get_current_admin)) -> dict:
    """Get current admin and require super_admin. Used for admin management."""
    admin = current_admin
    if not admin.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Super admin access required")
    return admin


def require_admin_permissions(required_permissions: List[str]) -> Callable:
    """Dependency factory to enforce that an admin has the given permissions.

    Super admins (is_super_admin=True) are always allowed.
    Permissions are resolved via:
    - admin_user_roles (admin_user_id -> role_id)
    - role_permissions (role_id -> permission_id)
    - admin_permissions (permission_id -> code)
    """

    async def dependency(current_admin: dict = Depends(get_current_admin)) -> dict:
        if current_admin.get("is_super_admin"):
            return current_admin

        # If no specific permissions are required, only authentication is needed.
        if not required_permissions:
            return current_admin

        admin_id = current_admin["id"]

        # Find roles assigned to this admin user
        user_roles = await admin_db.admin_user_roles.find(
            {"admin_user_id": admin_id},
            {"_id": 0},
        ).to_list(None)
        role_ids = [ur.get("role_id") for ur in user_roles if ur.get("role_id")]
        if not role_ids:
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Find permissions attached to these roles
        role_perms = await admin_db.role_permissions.find(
            {"role_id": {"$in": role_ids}},
            {"_id": 0},
        ).to_list(None)
        permission_ids = [rp.get("permission_id") for rp in role_perms if rp.get("permission_id")]
        if not permission_ids:
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Load permission codes
        permissions = await admin_db.admin_permissions.find(
            {"id": {"$in": permission_ids}},
            {"_id": 0},
        ).to_list(None)
        codes = {p.get("code") for p in permissions if p.get("code")}

        if not set(required_permissions).issubset(codes):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return current_admin

    return dependency


async def verify_domain_ownership(domain_id: str, user_id: str) -> dict:
    """Verify that a domain belongs to the user and return the domain."""
    domain = await db.domains.find_one({"id": domain_id}, {"_id": 0})
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    if domain.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Access denied: Domain does not belong to user")
    return domain
