"""Credit ledger helpers for shared warmup pool usage and top-ups."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from pymongo import ReturnDocument


class CreditService:
    """Encapsulate user credit balance updates plus immutable ledger entries."""

    def __init__(self, db: Any):
        self.db = db

    async def get_balance(self, user_id: str) -> int:
        user = await self.db.users.find_one({"id": user_id}, {"_id": 0, "credits_balance": 1})
        return int((user or {}).get("credits_balance", 0) or 0)

    async def add_credits(
        self,
        user_id: str,
        amount: int,
        *,
        reason: str,
        metadata: Optional[dict[str, Any]] = None,
        idempotency_key: Optional[str] = None,
        purchased: bool = False,
        earned: bool = False,
    ) -> dict[str, Any]:
        if amount <= 0:
            raise ValueError("amount must be positive")

        existing = None
        if idempotency_key:
            existing = await self.db.credit_transactions.find_one(
                {"user_id": user_id, "idempotency_key": idempotency_key},
                {"_id": 0},
            )
            if existing:
                return existing

        now = datetime.now(timezone.utc)
        inc_payload: dict[str, int] = {"credits_balance": amount}
        if purchased:
            inc_payload["credits_total_purchased"] = amount
        if earned:
            inc_payload["credits_total_earned"] = amount

        await self.db.users.update_one(
            {"id": user_id},
            {"$inc": inc_payload, "$set": {"updated_at": now}},
        )

        transaction = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "delta": amount,
            "reason": reason,
            "metadata": metadata or {},
            "idempotency_key": idempotency_key,
            "created_at": now,
        }
        await self.db.credit_transactions.insert_one(transaction)
        transaction.pop("_id", None)
        return transaction

    async def spend_credits(
        self,
        user_id: str,
        amount: int,
        *,
        reason: str,
        metadata: Optional[dict[str, Any]] = None,
        idempotency_key: Optional[str] = None,
    ) -> tuple[bool, Optional[dict[str, Any]]]:
        if amount <= 0:
            raise ValueError("amount must be positive")

        existing = None
        if idempotency_key:
            existing = await self.db.credit_transactions.find_one(
                {"user_id": user_id, "idempotency_key": idempotency_key},
                {"_id": 0},
            )
            if existing:
                return True, existing

        now = datetime.now(timezone.utc)
        updated_user = await self.db.users.find_one_and_update(
            {
                "id": user_id,
                "$expr": {"$gte": [{"$ifNull": ["$credits_balance", 0]}, amount]},
            },
            {
                "$inc": {
                    "credits_balance": -amount,
                    "credits_total_spent": amount,
                },
                "$set": {"updated_at": now},
            },
            projection={"_id": 0, "credits_balance": 1},
            return_document=ReturnDocument.AFTER,
        )
        if not updated_user:
            return False, None

        transaction = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "delta": -amount,
            "reason": reason,
            "metadata": metadata or {},
            "idempotency_key": idempotency_key,
            "created_at": now,
        }
        await self.db.credit_transactions.insert_one(transaction)
        transaction.pop("_id", None)
        return True, transaction

    async def list_transactions(self, user_id: str, *, limit: int = 20) -> list[dict[str, Any]]:
        docs = await self.db.credit_transactions.find(
            {"user_id": user_id},
            {"_id": 0},
        ).sort("created_at", -1).limit(max(1, min(limit, 100))).to_list(None)
        return docs
