"""Lemon Squeezy checkout and webhook handling for international billing."""
import hmac
import hashlib
import json
import logging
import os
from typing import Any, Dict, Optional

import httpx

LEMONSQUEEZY_BASE = "https://api.lemonsqueezy.com/v1"

logger = logging.getLogger(__name__)


class LemonSqueezyService:
    def __init__(self, plan_service=None):
        self.api_key = (os.getenv("LEMONSQUEEZY_API_KEY") or "").strip()
        self.store_id = (os.getenv("LEMONSQUEEZY_STORE_ID") or "").strip()
        self.webhook_secret = (os.getenv("LEMONSQUEEZY_WEBHOOK_SECRET") or "").strip()
        self._plan_service = plan_service

    def is_configured(self) -> bool:
        return bool(self.api_key and self.store_id)

    def _headers(self) -> dict:
        return {
            "Accept": "application/vnd.api+json",
            "Content-Type": "application/vnd.api+json",
            "Authorization": f"Bearer {self.api_key}",
        }

    async def get_variant_id(self, plan_id: str, annual: bool) -> Optional[str]:
        """Resolve Lemon Squeezy variant ID for plan_id + billing cycle. Uses plan_service if set, else env."""
        if self._plan_service:
            return await self._plan_service.get_lemon_squeezy_variant_id_from_plan(plan_id, annual)
        name = (plan_id or "").strip().upper().replace("-", "_")
        if not name or name in ("FREE", "ENTERPRISE", "CUSTOM"):
            return None
        key = f"LEMONSQUEEZY_VARIANT_{name}_ANNUAL" if annual else f"LEMONSQUEEZY_VARIANT_{name}_MONTHLY"
        return (os.getenv(key) or "").strip() or None

    async def create_checkout(
        self,
        variant_id: str,
        user_id: str,
        *,
        redirect_url: Optional[str] = None,
        skip_trial: bool = False,
        custom_data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Create a Lemon Squeezy checkout. Returns dict with checkout_url (and optionally id).
        custom_data.user_id is set so webhooks can attribute the subscription to the user.
        If skip_trial is True, the checkout will not offer the product's trial (for users who already used a trial).
        """
        if not self.is_configured():
            raise ValueError("Lemon Squeezy is not configured")
        payload = {
            "data": {
                "type": "checkouts",
                "attributes": {
                    "checkout_data": {
                        "custom": {
                            "user_id": user_id,
                            **(custom_data or {}),
                        }
                    }
                },
                "relationships": {
                    "store": {"data": {"type": "stores", "id": self.store_id}},
                    "variant": {"data": {"type": "variants", "id": str(variant_id)}},
                },
            }
        }
        if redirect_url:
            payload["data"]["attributes"].setdefault("product_options", {})["redirect_url"] = redirect_url
        if skip_trial:
            payload["data"]["attributes"]["checkout_options"] = {"skip_trial": True}
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"{LEMONSQUEEZY_BASE}/checkouts",
                json=payload,
                headers=self._headers(),
            )
            if r.status_code == 401:
                logger.error(
                    "Lemon Squeezy 401 Unauthorized: invalid or expired API key. "
                    "Set LEMONSQUEEZY_API_KEY in .env with a key from Lemon Squeezy Dashboard → Settings → API (keys expire after 1 year; use test vs live as needed)."
                )
            r.raise_for_status()
            data = r.json()
        attrs = (data.get("data") or {}).get("attributes") or {}
        url = attrs.get("url") or ""
        checkout_id = (data.get("data") or {}).get("id")
        return {"checkout_url": url, "checkout_id": checkout_id}

    async def get_subscription(self, subscription_id: str) -> Optional[Dict[str, Any]]:
        """
        Fetch a subscription by ID from Lemon Squeezy. Returns attributes dict including
        status, variant_id, renews_at, created_at, urls.customer_portal (signed, 24h valid).
        Returns None if not configured or subscription not found.
        """
        if not self.is_configured() or not (subscription_id or "").strip():
            return None
        sid = str(subscription_id).strip()
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.get(
                    f"{LEMONSQUEEZY_BASE}/subscriptions/{sid}",
                    headers=self._headers(),
                )
                if r.status_code == 404:
                    return None
                r.raise_for_status()
                data = r.json()
        except Exception as e:
            logger.warning("Lemon Squeezy get_subscription failed: %s", e)
            return None
        attrs = (data.get("data") or {}).get("attributes") or {}
        return attrs

    async def update_subscription_variant(
        self,
        subscription_id: str,
        new_variant_id: str,
        *,
        invoice_immediately: bool = True,
        clear_trial: bool = False,
    ) -> Dict[str, Any]:
        """
        Change the subscription's variant (plan) in Lemon Squeezy.

        By default this invoices the prorated difference immediately (invoice_immediately=True),
        matching an "upgrade now" behaviour.
        """
        if not self.is_configured() or not (subscription_id or "").strip():
            raise ValueError("Lemon Squeezy is not configured or subscription_id is missing")
        sid = str(subscription_id).strip()
        payload: Dict[str, Any] = {
            "data": {
                "type": "subscriptions",
                "id": sid,
                "attributes": {
                    "variant_id": str(new_variant_id),
                },
            }
        }
        if invoice_immediately:
            payload["data"]["attributes"]["invoice_immediately"] = True
        if clear_trial:
            # End any existing trial immediately so the upgrade + invoice can succeed.
            payload["data"]["attributes"]["trial_ends_at"] = None
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.patch(
                f"{LEMONSQUEEZY_BASE}/subscriptions/{sid}",
                json=payload,
                headers=self._headers(),
            )
            r.raise_for_status()
            data = r.json()
        attrs = (data.get("data") or {}).get("attributes") or {}
        return attrs

    def verify_webhook_signature(self, payload_body: bytes, signature: str) -> bool:
        """Verify X-Signature from Lemon Squeezy webhook using LEMONSQUEEZY_WEBHOOK_SECRET."""
        # Debug: webhook secret status (masked)
        secret_set = bool(self.webhook_secret)
        secret_len = len(self.webhook_secret) if self.webhook_secret else 0
        print(
            f"[Lemon Squeezy webhook] LEMONSQUEEZY_WEBHOOK_SECRET set={secret_set}, len={secret_len}"
        )
        print(f"[Lemon Squeezy webhook] X-Signature (incoming): {signature!r}")
        if not self.webhook_secret or not signature:
            print("[Lemon Squeezy webhook] Reject: missing secret or X-Signature")
            return False
        computed = hmac.new(
            self.webhook_secret.encode("utf-8"),
            payload_body,
            hashlib.sha256,
        ).hexdigest()
        print(f"[Lemon Squeezy webhook] Computed signature (HMAC-SHA256 of body): {computed!r}")
        ok = hmac.compare_digest(computed, signature)
        if not ok:
            print(
                "[Lemon Squeezy webhook] Signature mismatch: incoming != computed. "
                "Check that LEMONSQUEEZY_WEBHOOK_SECRET matches the 'Signing secret' in Lemon Squeezy Dashboard > Settings > Webhooks."
            )
        return ok

    @staticmethod
    def _get_custom_data(meta: Dict[str, Any]) -> Dict[str, Any]:
        """Extract custom_data from webhook meta (meta.custom_data or meta.custom_data from nested)."""
        if not meta:
            return {}
        return meta.get("custom_data") or {}

    @staticmethod
    def _get_user_id_from_payload(payload: Dict[str, Any]) -> Optional[str]:
        """Get user_id from meta.custom_data. Lemon Squeezy may return numbers as int."""
        meta = (payload.get("meta") or {})
        custom = LemonSqueezyService._get_custom_data(meta)
        uid = custom.get("user_id")
        if uid is None:
            return None
        return str(uid).strip() or None
