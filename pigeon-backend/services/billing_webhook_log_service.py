"""Persist Razorpay and Lemon Squeezy webhook payloads to admin_db for operational visibility."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from database import admin_db, db

logger = logging.getLogger(__name__)

_MAX_JSON_CHARS = 500_000


def _payload_for_storage(payload: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if payload is None:
        return None
    try:
        s = json.dumps(payload, default=str)
        if len(s) > _MAX_JSON_CHARS:
            return {
                "_truncated": True,
                "original_approx_chars": len(s),
                "top_level_keys": list(payload.keys())[:80],
            }
    except Exception:
        return {"_error": "payload_not_json_serializable"}
    return payload


async def flush_billing_webhook_log(
    *,
    provider: str,
    body_length: int,
    signature_valid: bool,
    event_name: Optional[str],
    payload: Optional[dict[str, Any]],
    user_id: Optional[str],
    external_id: Optional[str],
    outcome: str,
) -> None:
    """Insert one webhook audit row. Never raises (logging failures must not break webhooks)."""
    doc: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "provider": provider,
        "received_at": datetime.now(timezone.utc),
        "signature_valid": signature_valid,
        "event_name": event_name,
        "user_id": user_id,
        "external_id": external_id,
        "outcome": outcome,
        "body_length": body_length,
        "payload": _payload_for_storage(payload),
    }
    try:
        await admin_db.billing_webhook_logs.insert_one(doc)
        return
    except Exception:
        logger.exception(
            "billing_webhook_logs insert failed on admin_db provider=%s outcome=%s; trying main db fallback",
            provider,
            outcome,
        )
    try:
        # Fallback path for environments where ADMIN_DB_NAME points to a DB
        # that the app user cannot write to.
        await db.billing_webhook_logs.insert_one(doc)
    except Exception:
        logger.exception(
            "billing_webhook_logs insert failed on both admin_db and main db provider=%s outcome=%s",
            provider,
            outcome,
        )
