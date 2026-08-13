"""Admin API: list and inspect stored Razorpay / Lemon Squeezy billing webhooks."""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from database import admin_db, db
from routes.dependencies import get_current_admin, require_admin_permissions

router = APIRouter(prefix="/admin/billing-webhooks")


def _collections_for_read():
    """Read from admin collection first, then main-db fallback when different."""
    cols = [admin_db.billing_webhook_logs]
    if db.name != admin_db.name:
        cols.append(db.billing_webhook_logs)
    return cols


@router.get(
    "/logs",
    dependencies=[Depends(require_admin_permissions(["system.read"]))],
)
async def list_billing_webhook_logs(
    provider: Optional[str] = Query(None, description="razorpay | lemonsqueezy"),
    event_contains: Optional[str] = Query(None, description="Case-insensitive substring match on event_name"),
    outcome_contains: Optional[str] = Query(None, description="Case-insensitive substring match on outcome"),
    user_id: Optional[str] = Query(None),
    signature_valid: Optional[bool] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    current_admin: dict = Depends(get_current_admin),
):
    """Paginated webhook log entries (newest first)."""
    q: dict[str, Any] = {}
    if provider:
        q["provider"] = provider.strip().lower()
    if event_contains and event_contains.strip():
        q["event_name"] = {"$regex": event_contains.strip(), "$options": "i"}
    if outcome_contains and outcome_contains.strip():
        q["outcome"] = {"$regex": outcome_contains.strip(), "$options": "i"}
    if user_id and user_id.strip():
        q["user_id"] = user_id.strip()
    if signature_valid is not None:
        q["signature_valid"] = signature_valid

    collections = _collections_for_read()
    if len(collections) == 1:
        total = await collections[0].count_documents(q)
        cursor = (
            collections[0].find(q, {"_id": 0, "payload": 0})
            .sort("received_at", -1)
            .skip(skip)
            .limit(limit)
        )
        logs = await cursor.to_list(length=limit)
        return {"logs": logs, "total": total}

    total = 0
    merged: list[dict[str, Any]] = []
    for col in collections:
        total += await col.count_documents(q)
        part = await (
            col.find(q, {"_id": 0, "payload": 0})
            .sort("received_at", -1)
            .limit(skip + limit)
            .to_list(length=skip + limit)
        )
        merged.extend(part)
    merged.sort(key=lambda x: x.get("received_at") or "", reverse=True)
    logs = merged[skip:skip + limit]
    return {"logs": logs, "total": total}


@router.get(
    "/logs/{log_id}",
    dependencies=[Depends(require_admin_permissions(["system.read"]))],
)
async def get_billing_webhook_log(
    log_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    """Single log entry including full stored payload."""
    doc = await admin_db.billing_webhook_logs.find_one({"id": log_id}, {"_id": 0})
    if not doc and db.name != admin_db.name:
        doc = await db.billing_webhook_logs.find_one({"id": log_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Webhook log not found")
    return doc
