"""Resolve per-user ZeroBounce API key from Settings → Integrations (encrypted in user_settings)."""

from __future__ import annotations

import logging
from typing import Optional

from database import db
from services.encryption_helper import decrypt_value


async def get_zerobounce_api_key_for_user(user_id: str) -> Optional[str]:
    """Decrypt stored key from user_settings. No environment fallback."""
    doc = await db.user_settings.find_one(
        {"user_id": user_id},
        {"_id": 0, "zerobounce_api_key_encrypted": 1},
    )
    enc = doc.get("zerobounce_api_key_encrypted") if doc else None
    if not enc:
        return None
    try:
        return decrypt_value(enc).strip() or None
    except Exception as e:
        logging.warning("Failed to decrypt ZeroBounce key for user %s: %s", user_id, e)
        return None
