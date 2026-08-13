"""Admin CRUD routes for Rent Your Network (RYN).

Covers:
  - RYN Users      — list, get, update (status / credits), delete
  - RYN Listings   — list, get, update, delete/remove
  - RYN Transactions — list (read-only), manual credit grant
  - Stats dashboard  — platform-level overview
"""
from datetime import datetime, timezone
from typing import Any, Dict, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, field_validator

from database import db, admin_db
from services.email_validation import RYN_KNOWN_EMAIL_PROVIDERS, normalize_ryn_email_provider
from admin_models import AuditLog
from routes.dependencies import get_current_admin, require_admin_permissions

router = APIRouter(prefix="/admin/ryn")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _enc(data: Any) -> Any:
    return jsonable_encoder(data)


async def _log(admin: Dict, action: str, resource_type: str, resource_id: Optional[str], metadata: Optional[Dict] = None) -> None:
    log = AuditLog(
        admin_user_id=admin["id"],
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        metadata=metadata or {},
    )
    await admin_db.audit_logs.insert_one(log.model_dump())


async def _get_ryn_user_or_404(user_id: str) -> dict:
    user = await db.ryn_users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="RYN user not found")
    return user


def _normalize_ryn_listing_mx(listing: Optional[dict]) -> None:
    """Older documents may omit mx_ok; infer from cached MX hosts. Normalize provider to known tokens."""
    if not listing:
        return
    if listing.get("mx_ok") is None:
        listing["mx_ok"] = bool(listing.get("mx_records"))
    listing["provider"] = normalize_ryn_email_provider(listing.get("provider"))


async def _get_listing_or_404(listing_id: str) -> dict:
    listing = await db.ryn_listings.find_one({"id": listing_id}, {"_id": 0})
    if not listing:
        raise HTTPException(status_code=404, detail="RYN listing not found")
    _normalize_ryn_listing_mx(listing)
    return listing


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class AdminRYNUserUpdate(BaseModel):
    full_name: Optional[str] = None
    status: Optional[str] = None          # active | suspended
    credits_balance: Optional[int] = None
    credits_held: Optional[int] = None
    credits_total_earned: Optional[int] = None
    credits_total_spent: Optional[int] = None

    @field_validator("status")
    @classmethod
    def valid_status(cls, v):
        if v is not None and v not in ("active", "suspended"):
            raise ValueError("status must be 'active' or 'suspended'")
        return v

    @field_validator("credits_balance", "credits_held", "credits_total_earned", "credits_total_spent")
    @classmethod
    def non_negative(cls, v):
        if v is not None and v < 0:
            raise ValueError("Credit values cannot be negative")
        return v


class AdminRYNListingUpdate(BaseModel):
    note: Optional[str] = None
    status: Optional[str] = None          # active | paused | removed
    daily_receive_limit: Optional[int] = None
    provider: Optional[str] = None

    @field_validator("status")
    @classmethod
    def valid_status(cls, v):
        if v is not None and v not in ("active", "paused", "removed"):
            raise ValueError("status must be 'active', 'paused', or 'removed'")
        return v

    @field_validator("daily_receive_limit")
    @classmethod
    def limit_range(cls, v):
        if v is not None and not (1 <= v <= 20):
            raise ValueError("daily_receive_limit must be 1–20")
        return v

    @field_validator("provider")
    @classmethod
    def provider_known_only(cls, v):
        if v is None:
            return v
        allowed = frozenset(RYN_KNOWN_EMAIL_PROVIDERS)
        if v not in allowed:
            raise ValueError(f"provider must be one of: {', '.join(sorted(allowed))}")
        return v


class AdminRYNGrantCredits(BaseModel):
    user_id: str
    amount: int
    reason: str = "admin_grant"

    @field_validator("amount")
    @classmethod
    def positive(cls, v):
        if v == 0:
            raise ValueError("Amount cannot be zero")
        return v


# ---------------------------------------------------------------------------
# Stats / overview
# ---------------------------------------------------------------------------

@router.get(
    "/stats",
    dependencies=[Depends(require_admin_permissions(["ryn.read"]))],
)
async def ryn_stats(current_admin: dict = Depends(get_current_admin)):
    """High-level platform stats for the RYN section."""
    total_users = await db.ryn_users.count_documents({})
    active_users = await db.ryn_users.count_documents({"status": "active"})
    suspended_users = await db.ryn_users.count_documents({"status": "suspended"})

    total_listings = await db.ryn_listings.count_documents({})
    active_listings = await db.ryn_listings.count_documents({"status": "active"})
    paused_listings = await db.ryn_listings.count_documents({"status": "paused"})

    total_transactions = await db.ryn_transactions.count_documents({})

    # Aggregate total credits in circulation
    pipeline = [
        {"$group": {
            "_id": None,
            "total_balance": {"$sum": "$credits_balance"},
            "total_held": {"$sum": "$credits_held"},
            "total_earned": {"$sum": "$credits_total_earned"},
            "total_spent": {"$sum": "$credits_total_spent"},
        }}
    ]
    credit_agg = await db.ryn_users.aggregate(pipeline).to_list(1)
    credits = credit_agg[0] if credit_agg else {}

    return _enc({
        "users": {
            "total": total_users,
            "active": active_users,
            "suspended": suspended_users,
        },
        "listings": {
            "total": total_listings,
            "active": active_listings,
            "paused": paused_listings,
        },
        "transactions": {
            "total": total_transactions,
        },
        "credits": {
            "total_balance": credits.get("total_balance", 0),
            "total_held": credits.get("total_held", 0),
            "total_earned": credits.get("total_earned", 0),
            "total_spent": credits.get("total_spent", 0),
        },
    })


# ---------------------------------------------------------------------------
# RYN Users
# ---------------------------------------------------------------------------

@router.get(
    "/users",
    dependencies=[Depends(require_admin_permissions(["ryn.read"]))],
)
async def admin_list_ryn_users(
    status: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    skip: int = 0,
    limit: int = 50,
    current_admin: dict = Depends(get_current_admin),
):
    """List all RYN users with optional filters."""
    query: Dict[str, Any] = {}
    if status:
        query["status"] = status
    if search:
        query["$or"] = [
            {"email": {"$regex": search, "$options": "i"}},
            {"full_name": {"$regex": search, "$options": "i"}},
        ]
    users = await db.ryn_users.find(
        query, {"_id": 0, "password_hash": 0}
    ).sort("created_at", -1).skip(skip).limit(limit).to_list(None)
    total = await db.ryn_users.count_documents(query)
    return _enc({"users": users, "total": total, "skip": skip, "limit": limit})


@router.get(
    "/users/{user_id}",
    dependencies=[Depends(require_admin_permissions(["ryn.read"]))],
)
async def admin_get_ryn_user(
    user_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    """Get full details of a single RYN user including their listings and recent transactions."""
    user = await _get_ryn_user_or_404(user_id)

    listings = await db.ryn_listings.find(
        {"owner_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(None)
    for row in listings:
        _normalize_ryn_listing_mx(row)

    transactions = await db.ryn_transactions.find(
        {"user_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).limit(20).to_list(None)

    return _enc({
        "user": {k: v for k, v in user.items() if k != "password_hash"},
        "listings": listings,
        "recent_transactions": transactions,
    })


@router.put(
    "/users/{user_id}",
    dependencies=[Depends(require_admin_permissions(["ryn.write"]))],
)
async def admin_update_ryn_user(
    user_id: str,
    body: AdminRYNUserUpdate,
    current_admin: dict = Depends(get_current_admin),
):
    """Update a RYN user's fields (status, name, credit balances)."""
    await _get_ryn_user_or_404(user_id)

    updates: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc)}
    if body.full_name is not None:
        updates["full_name"] = body.full_name.strip()
    if body.status is not None:
        updates["status"] = body.status
    if body.credits_balance is not None:
        updates["credits_balance"] = body.credits_balance
    if body.credits_held is not None:
        updates["credits_held"] = body.credits_held
    if body.credits_total_earned is not None:
        updates["credits_total_earned"] = body.credits_total_earned
    if body.credits_total_spent is not None:
        updates["credits_total_spent"] = body.credits_total_spent

    await db.ryn_users.update_one({"id": user_id}, {"$set": updates})
    updated = await db.ryn_users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})

    await _log(current_admin, "update_ryn_user", "ryn_user", user_id, {"changes": {k: v for k, v in updates.items() if k != "updated_at"}})
    return _enc({"user": updated})


@router.delete(
    "/users/{user_id}",
    dependencies=[Depends(require_admin_permissions(["ryn.write"]))],
)
async def admin_delete_ryn_user(
    user_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    """Permanently delete a RYN user and all their listings."""
    await _get_ryn_user_or_404(user_id)

    await db.ryn_listings.update_many(
        {"owner_id": user_id},
        {"$set": {"status": "removed", "updated_at": datetime.now(timezone.utc)}},
    )
    await db.ryn_users.delete_one({"id": user_id})

    await _log(current_admin, "delete_ryn_user", "ryn_user", user_id)
    return {"message": "RYN user deleted"}


@router.post(
    "/users/{user_id}/suspend",
    dependencies=[Depends(require_admin_permissions(["ryn.write"]))],
)
async def admin_suspend_ryn_user(
    user_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    await _get_ryn_user_or_404(user_id)
    await db.ryn_users.update_one({"id": user_id}, {"$set": {"status": "suspended", "updated_at": datetime.now(timezone.utc)}})
    await _log(current_admin, "suspend_ryn_user", "ryn_user", user_id)
    return {"message": "User suspended"}


@router.post(
    "/users/{user_id}/unsuspend",
    dependencies=[Depends(require_admin_permissions(["ryn.write"]))],
)
async def admin_unsuspend_ryn_user(
    user_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    await _get_ryn_user_or_404(user_id)
    await db.ryn_users.update_one({"id": user_id}, {"$set": {"status": "active", "updated_at": datetime.now(timezone.utc)}})
    await _log(current_admin, "unsuspend_ryn_user", "ryn_user", user_id)
    return {"message": "User unsuspended"}


# ---------------------------------------------------------------------------
# RYN Listings
# ---------------------------------------------------------------------------

@router.get(
    "/listings",
    dependencies=[Depends(require_admin_permissions(["ryn.read"]))],
)
async def admin_list_ryn_listings(
    owner_id: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    provider: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    skip: int = 0,
    limit: int = 50,
    current_admin: dict = Depends(get_current_admin),
):
    """List all RYN email listings with optional filters."""
    query: Dict[str, Any] = {}
    if owner_id:
        query["owner_id"] = owner_id
    if status:
        query["status"] = status
    if provider:
        query["provider"] = provider
    if search:
        query["email"] = {"$regex": search, "$options": "i"}

    listings = await db.ryn_listings.find(
        query, {"_id": 0}
    ).sort("created_at", -1).skip(skip).limit(limit).to_list(None)
    total = await db.ryn_listings.count_documents(query)

    # Enrich with owner email for display
    owner_ids = list({l["owner_id"] for l in listings})
    owners = await db.ryn_users.find(
        {"id": {"$in": owner_ids}}, {"_id": 0, "id": 1, "email": 1, "full_name": 1}
    ).to_list(None)
    owner_map = {o["id"]: o for o in owners}
    for listing in listings:
        listing["owner"] = owner_map.get(listing["owner_id"], {})
        _normalize_ryn_listing_mx(listing)

    return _enc({"listings": listings, "total": total, "skip": skip, "limit": limit})


@router.get(
    "/listings/{listing_id}",
    dependencies=[Depends(require_admin_permissions(["ryn.read"]))],
)
async def admin_get_ryn_listing(
    listing_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    """Get full listing details including owner info and related transactions."""
    listing = await _get_listing_or_404(listing_id)

    owner = await db.ryn_users.find_one(
        {"id": listing["owner_id"]}, {"_id": 0, "id": 1, "email": 1, "full_name": 1, "status": 1}
    )
    transactions = await db.ryn_transactions.find(
        {"listing_id": listing_id}, {"_id": 0}
    ).sort("created_at", -1).limit(20).to_list(None)

    # Recent warmup activity for this listing email
    warmup_activity = await db.warmup_sent.find(
        {"ryn_listing_id": listing_id},
        {"_id": 0, "id": 1, "receiver_email": 1, "sent_at": 1, "opened_at": 1, "replied_at": 1, "credit_status": 1}
    ).sort("sent_at", -1).limit(20).to_list(None)

    return _enc({
        "listing": listing,
        "owner": owner,
        "recent_transactions": transactions,
        "warmup_activity": warmup_activity,
    })


@router.put(
    "/listings/{listing_id}",
    dependencies=[Depends(require_admin_permissions(["ryn.write"]))],
)
async def admin_update_ryn_listing(
    listing_id: str,
    body: AdminRYNListingUpdate,
    current_admin: dict = Depends(get_current_admin),
):
    """Update a listing's status, note, daily limit, or provider."""
    await _get_listing_or_404(listing_id)

    updates: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc)}
    if body.note is not None:
        updates["note"] = body.note.strip() or None
    if body.status is not None:
        updates["status"] = body.status
    if body.daily_receive_limit is not None:
        updates["daily_receive_limit"] = body.daily_receive_limit
    if body.provider is not None:
        updates["provider"] = body.provider

    await db.ryn_listings.update_one({"id": listing_id}, {"$set": updates})
    updated = await db.ryn_listings.find_one({"id": listing_id}, {"_id": 0})
    _normalize_ryn_listing_mx(updated)

    await _log(current_admin, "update_ryn_listing", "ryn_listing", listing_id, {"changes": {k: v for k, v in updates.items() if k != "updated_at"}})
    return _enc({"listing": updated})


@router.delete(
    "/listings/{listing_id}",
    dependencies=[Depends(require_admin_permissions(["ryn.write"]))],
)
async def admin_delete_ryn_listing(
    listing_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    """Permanently remove a listing (sets status to removed)."""
    await _get_listing_or_404(listing_id)
    await db.ryn_listings.update_one(
        {"id": listing_id},
        {"$set": {"status": "removed", "updated_at": datetime.now(timezone.utc)}},
    )
    await _log(current_admin, "remove_ryn_listing", "ryn_listing", listing_id)
    return {"message": "Listing removed"}


# ---------------------------------------------------------------------------
# RYN Transactions
# ---------------------------------------------------------------------------

@router.get(
    "/transactions",
    dependencies=[Depends(require_admin_permissions(["ryn.read"]))],
)
async def admin_list_ryn_transactions(
    user_id: Optional[str] = Query(default=None),
    listing_id: Optional[str] = Query(default=None),
    tx_type: Optional[str] = Query(default=None, alias="type"),
    skip: int = 0,
    limit: int = 50,
    current_admin: dict = Depends(get_current_admin),
):
    """List RYN credit transactions with optional filters."""
    query: Dict[str, Any] = {}
    if user_id:
        query["user_id"] = user_id
    if listing_id:
        query["listing_id"] = listing_id
    if tx_type:
        query["type"] = tx_type

    txs = await db.ryn_transactions.find(
        query, {"_id": 0}
    ).sort("created_at", -1).skip(skip).limit(limit).to_list(None)
    total = await db.ryn_transactions.count_documents(query)
    return _enc({"transactions": txs, "total": total, "skip": skip, "limit": limit})


@router.post(
    "/transactions/grant",
    dependencies=[Depends(require_admin_permissions(["ryn.write"]))],
)
async def admin_grant_ryn_credits(
    body: AdminRYNGrantCredits,
    current_admin: dict = Depends(get_current_admin),
):
    """Manually grant (positive) or deduct (negative) credits for a RYN user."""
    user = await _get_ryn_user_or_404(body.user_id)
    now = datetime.now(timezone.utc)
    amount = body.amount

    if amount > 0:
        await db.ryn_users.update_one(
            {"id": body.user_id},
            {"$inc": {"credits_balance": amount, "credits_total_earned": amount}, "$set": {"updated_at": now}},
        )
        tx_type = "bonus"
    else:
        # Deduction — ensure balance doesn't go below 0
        current_balance = int(user.get("credits_balance", 0))
        if abs(amount) > current_balance:
            raise HTTPException(status_code=400, detail=f"Cannot deduct {abs(amount)} credits; user only has {current_balance}.")
        await db.ryn_users.update_one(
            {"id": body.user_id},
            {"$inc": {"credits_balance": amount}, "$set": {"updated_at": now}},
        )
        tx_type = "spend"

    tx_id = str(uuid.uuid4())
    tx = {
        "id": tx_id,
        "user_id": body.user_id,
        "amount": amount,
        "type": tx_type,
        "description": f"Admin grant by {current_admin.get('email', 'admin')}: {body.reason}",
        "listing_id": None,
        "listing_email": None,
        "renter_user_id": None,
        "hold_until": None,
        "released_at": None,
        "settled_reason": None,
        "warmup_sent_id": None,
        "created_at": now,
        "updated_at": now,
    }
    await db.ryn_transactions.insert_one({**tx, "_id": tx_id})

    await _log(current_admin, "grant_ryn_credits", "ryn_user", body.user_id, {"amount": amount, "reason": body.reason})
    return _enc({"message": f"{'Granted' if amount > 0 else 'Deducted'} {abs(amount)} credits", "transaction": tx})


# ---------------------------------------------------------------------------
# RYN Email OTPs (pending verifications)
# ---------------------------------------------------------------------------

@router.get(
    "/otps",
    dependencies=[Depends(require_admin_permissions(["ryn.read"]))],
)
async def admin_list_ryn_otps(
    skip: int = 0,
    limit: int = 50,
    current_admin: dict = Depends(get_current_admin),
):
    """List pending email verification OTPs."""
    otps = await db.ryn_email_otps.find(
        {}, {"_id": 0, "code": 0}
    ).sort("expires_at", -1).skip(skip).limit(limit).to_list(None)
    total = await db.ryn_email_otps.count_documents({})
    return _enc({"otps": otps, "total": total})


@router.delete(
    "/otps/{email}",
    dependencies=[Depends(require_admin_permissions(["ryn.write"]))],
)
async def admin_revoke_ryn_otp(
    email: str,
    current_admin: dict = Depends(get_current_admin),
):
    """Revoke a pending OTP for an email address."""
    result = await db.ryn_email_otps.delete_one({"email": email.lower().strip()})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="No pending OTP found for this email")
    await _log(current_admin, "revoke_ryn_otp", "ryn_otp", email)
    return {"message": f"OTP revoked for {email}"}


# ---------------------------------------------------------------------------
# Withdrawal requests
# ---------------------------------------------------------------------------

VALID_WITHDRAW_STATUSES = ("pending", "processing", "completed", "rejected")


class AdminWithdrawStatusUpdate(BaseModel):
    status: str
    admin_notes: Optional[str] = None

    @field_validator("status")
    @classmethod
    def valid_status(cls, v: str) -> str:
        if v not in VALID_WITHDRAW_STATUSES:
            raise ValueError(f"status must be one of: {', '.join(VALID_WITHDRAW_STATUSES)}")
        return v


@router.get(
    "/withdrawals",
    dependencies=[Depends(require_admin_permissions(["ryn.read"]))],
)
async def admin_list_withdrawals(
    skip: int = 0,
    limit: int = 50,
    status: Optional[str] = None,
    current_admin: dict = Depends(get_current_admin),
):
    """List all RYN withdrawal requests with optional status filter."""
    query: Dict = {}
    if status:
        if status not in VALID_WITHDRAW_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status filter: {status}")
        query["status"] = status

    total = await db.ryn_withdrawals.count_documents(query)
    withdrawals = await db.ryn_withdrawals.find(
        query, {"_id": 0}
    ).sort("created_at", -1).skip(skip).limit(limit).to_list(None)
    return _enc({"withdrawals": withdrawals, "total": total})


@router.get(
    "/withdrawals/{withdraw_id}",
    dependencies=[Depends(require_admin_permissions(["ryn.read"]))],
)
async def admin_get_withdrawal(
    withdraw_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    """Get a single withdrawal request by ID."""
    doc = await db.ryn_withdrawals.find_one({"id": withdraw_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Withdrawal request not found")
    return _enc({"withdrawal": doc})


@router.patch(
    "/withdrawals/{withdraw_id}",
    dependencies=[Depends(require_admin_permissions(["ryn.write"]))],
)
async def admin_update_withdrawal_status(
    withdraw_id: str,
    body: AdminWithdrawStatusUpdate,
    current_admin: dict = Depends(get_current_admin),
):
    """Update the status of a withdrawal request.

    If status changes to 'rejected', the credits_requested amount is refunded
    back to the user's available balance.
    """
    doc = await db.ryn_withdrawals.find_one({"id": withdraw_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Withdrawal request not found")

    old_status = doc.get("status")
    now = datetime.now(timezone.utc)

    updates: Dict = {
        "status": body.status,
        "updated_at": now,
    }
    if body.admin_notes is not None:
        updates["admin_notes"] = body.admin_notes.strip()

    await db.ryn_withdrawals.update_one({"id": withdraw_id}, {"$set": updates})

    # If transitioning to rejected, refund the credits
    if body.status == "rejected" and old_status != "rejected":
        credits_requested = doc.get("credits_requested", 0)
        user_id = doc.get("user_id")
        if user_id and credits_requested > 0:
            await db.ryn_users.update_one(
                {"id": user_id},
                {
                    "$inc": {
                        "credits_balance": credits_requested,
                        "credits_total_spent": -credits_requested,
                    },
                    "$set": {"updated_at": now},
                },
            )
            refund_tx_id = str(uuid.uuid4())
            await db.ryn_transactions.insert_one({
                "id": refund_tx_id,
                "user_id": user_id,
                "amount": credits_requested,
                "type": "refund",
                "description": f"Withdrawal request rejected — {credits_requested} credits refunded",
                "withdraw_id": withdraw_id,
                "created_at": now,
            })

    updated = await db.ryn_withdrawals.find_one({"id": withdraw_id}, {"_id": 0})
    await _log(
        current_admin,
        "update_withdrawal_status",
        "ryn_withdrawal",
        withdraw_id,
        {"old_status": old_status, "new_status": body.status},
    )
    return _enc({"withdrawal": updated, "message": f"Withdrawal status updated to '{body.status}'"})
