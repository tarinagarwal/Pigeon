"""Serper.dev API helpers and per-user API key resolution."""

from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, Optional

import httpx

from database import db
from services.encryption_helper import decrypt_value

SERPER_URL = "https://google.serper.dev/search"
_MAX_QUERY_LEN = 256


async def get_serper_api_key_for_user(user_id: str) -> Optional[str]:
    """
    Prefer encrypted key from user_settings; fall back to server SERPER_API_KEY env.
    """
    doc = await db.user_settings.find_one(
        {"user_id": user_id},
        {"_id": 0, "serper_api_key_encrypted": 1},
    )
    enc = doc.get("serper_api_key_encrypted") if doc else None
    if enc:
        try:
            return decrypt_value(enc).strip() or None
        except Exception as e:
            logging.warning("Failed to decrypt Serper key for user %s: %s", user_id, e)
    env_key = (os.environ.get("SERPER_API_KEY") or "").strip()
    return env_key or None


async def serper_search(api_key: str, q: str, page: int = 1, num: int = 10) -> Dict[str, Any]:
    """
    Google search via Serper. Uses page (1-based) for pagination per Serper API.
    """
    normalized_q = re.sub(r"\s+", " ", str(q or "")).strip()
    if not normalized_q:
        raise ValueError("Serper query is empty")
    # Keep search prompts concise to avoid Serper rejecting oversized/malformed inputs.
    normalized_q = normalized_q[:_MAX_QUERY_LEN]
    payload: Dict[str, Any] = {
        "q": normalized_q,
        "page": max(1, page),
        "num": max(1, min(num, 20)),
    }
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                SERPER_URL,
                headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
                json=payload,
                timeout=45.0,
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            detail = (e.response.text or "").strip() if e.response is not None else ""
            status = e.response.status_code if e.response is not None else "unknown"
            logging.warning(
                "Serper request failed status=%s page=%s num=%s q=%r detail=%s",
                status,
                payload["page"],
                payload["num"],
                payload["q"][:120],
                detail[:400],
            )
            raise RuntimeError(
                f"Serper request failed ({status}): {(detail[:300] or 'No error details returned')}"
            ) from e
