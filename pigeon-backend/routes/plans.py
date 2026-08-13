"""Public plans API (no auth) for pricing and landing pages."""
from fastapi import APIRouter

from database import admin_db

router = APIRouter()


@router.get("/plans")
async def list_plans():
    """Return active plans sorted by order. No authentication required."""
    cursor = admin_db.plans.find(
        {"active": True},
        {"_id": 0},
    ).sort("order", 1)
    plans = await cursor.to_list(None)
    return {"plans": plans}
