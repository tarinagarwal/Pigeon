"""User-configured outbound webhooks for email events.

Supported events:
- email.sent
- email.opened
- email.replied
- email.bounced
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from database import db

logger = logging.getLogger(__name__)


class WebhookEventService:
    """Dispatch outbound webhooks for user-configured endpoints."""

    def __init__(self) -> None:
        # Currently stateless; db is imported directly from database module.
        # This class exists mainly so other modules can isinstance-check.
        self._timeout = 10.0

    async def _get_matching_webhooks(self, user_id: str, event: str) -> List[Dict[str, Any]]:
        """Return webhooks for user that subscribe to the given event."""
        cursor = db.webhooks.find(
            {
                "user_id": user_id,
                "events": {"$in": [event]},
            },
            {"_id": 0},
        )
        return await cursor.to_list(None)

    async def _post_single(
        self,
        url: str,
        body: Dict[str, Any],
    ) -> None:
        """POST a single webhook event. Errors are logged but not raised."""
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(url, json=body)
                if not resp.is_success:
                    logger.warning(
                        "webhook_event_service: non-2xx response url=%s status=%s body=%s",
                        url,
                        resp.status_code,
                        resp.text[:500],
                    )
        except Exception as e:  # pragma: no cover - best-effort logging
            logger.warning("webhook_event_service: error delivering webhook url=%s err=%s", url, e)

    async def _deliver(
        self,
        user_id: str,
        event: str,
        data: Dict[str, Any],
        *,
        email_log_id: Optional[str] = None,
        campaign_id: Optional[str] = None,
        contact_id: Optional[str] = None,
    ) -> None:
        """Deliver an event to all matching webhooks for the user."""
        webhooks = await self._get_matching_webhooks(user_id, event)
        if not webhooks:
            return

        occurred_at = datetime.now(timezone.utc).isoformat()
        tasks: List[asyncio.Future[Any]] = []
        for wh in webhooks:
            url = (wh.get("url") or "").strip()
            if not url:
                continue
            body: Dict[str, Any] = {
                "event": event,
                "occurred_at": occurred_at,
                "user_id": user_id,
                "webhook_id": wh.get("id"),
                "data": data,
            }
            if email_log_id:
                body["email_log_id"] = email_log_id
            if campaign_id:
                body["campaign_id"] = campaign_id
            if contact_id:
                body["contact_id"] = contact_id
            tasks.append(asyncio.create_task(self._post_single(url, body)))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def send_email_event(self, event: str, email_log: Dict[str, Any]) -> None:
        """Send an email.* webhook event for the given email_log."""
        user_id = (email_log.get("user_id") or "").strip()
        if not user_id:
            return

        # Minimal payload for consumers; avoid huge bodies.
        payload: Dict[str, Any] = {
            "id": email_log.get("id"),
            "status": email_log.get("status"),
            "subject": email_log.get("subject"),
            "campaign_id": email_log.get("campaign_id"),
            "contact_id": email_log.get("contact_id"),
            "sent_at": _iso(email_log.get("sent_at")),
            "opened_at": _iso(email_log.get("opened_at")),
            "replied_at": _iso(email_log.get("replied_at")),
        }

        # Include contact basics when available so receivers don't need to re-query your API.
        contact: Optional[Dict[str, Any]] = None
        contact_id = email_log.get("contact_id")
        if contact_id:
            try:
                contact = await db.contacts.find_one(
                    {"id": contact_id},
                    {
                        "_id": 0,
                        "id": 1,
                        "email": 1,
                        "first_name": 1,
                        "last_name": 1,
                        "company": 1,
                    },
                )
            except Exception:
                contact = None

        if contact:
            payload["contact"] = contact

        await self._deliver(
            user_id=user_id,
            event=event,
            data=payload,
            email_log_id=email_log.get("id"),
            campaign_id=email_log.get("campaign_id"),
            contact_id=email_log.get("contact_id"),
        )


def _iso(value: Any) -> Optional[str]:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        else:
            value = value.astimezone(timezone.utc)
        return value.isoformat()
    return None

