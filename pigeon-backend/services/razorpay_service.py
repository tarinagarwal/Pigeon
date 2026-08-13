"""Razorpay subscription API client. Plans are created in Dashboard or via API; mapping from app plan id to Razorpay plan id via env (RAZORPAY_PLAN_STARTER, etc.)."""
import os
import logging
import hmac
import hashlib
import httpx

RAZORPAY_BASE = "https://api.razorpay.com/v1"

logger = logging.getLogger(__name__)


class RazorpayService:
    def __init__(self):
        self.key_id = os.getenv("RAZORPAY_KEY_ID", "").strip()
        self.key_secret = os.getenv("RAZORPAY_KEY_SECRET", "").strip()
        self._auth = (self.key_id, self.key_secret) if self.key_id and self.key_secret else None

    def is_configured(self) -> bool:
        return bool(self._auth)

    def get_razorpay_plan_id(self, app_plan_id: str, annual: bool = False) -> str | None:
        """Map app plan id (starter, growth, pro, scale) to Razorpay plan id. Use annual=True for yearly billing. Returns None for free, enterprise, Custom."""
        if not app_plan_id or app_plan_id in ("free", "enterprise") or app_plan_id.lower() == "custom":
            return None
        name = app_plan_id.upper()
        if annual:
            key = f"RAZORPAY_PLAN_{name}_ANNUAL"
            value = os.getenv(key, "").strip() or None
            if value:
                return value
        key = f"RAZORPAY_PLAN_{name}"
        return os.getenv(key, "").strip() or None

    def get_app_plan_id_from_razorpay_plan(self, razorpay_plan_id: str) -> str | None:
        """Reverse map Razorpay plan id to app plan id (starter, growth, pro, scale). Checks both monthly and annual env vars."""
        for name in ("STARTER", "GROWTH", "PRO", "SCALE"):
            if os.getenv(f"RAZORPAY_PLAN_{name}", "").strip() == razorpay_plan_id:
                return name.lower()
            if os.getenv(f"RAZORPAY_PLAN_{name}_ANNUAL", "").strip() == razorpay_plan_id:
                return name.lower()
        return None

    def is_annual_plan(self, razorpay_plan_id: str) -> bool:
        """Return True if the Razorpay plan id is an annual plan (matches RAZORPAY_PLAN_*_ANNUAL)."""
        rp_id = (razorpay_plan_id or "").strip()
        if not rp_id:
            return False
        for name in ("STARTER", "GROWTH", "PRO", "SCALE"):
            if os.getenv(f"RAZORPAY_PLAN_{name}_ANNUAL", "").strip() == rp_id:
                return True
        return False

    def _headers(self) -> dict:
        return {"Content-Type": "application/json"}

    async def create_order(
        self,
        *,
        amount: int,
        currency: str,
        receipt: str,
        notes: dict | None = None,
    ) -> dict:
        if not self._auth:
            raise ValueError("Razorpay is not configured")
        payload = {
            "amount": int(amount),
            "currency": (currency or "INR").upper(),
            "receipt": receipt,
            "notes": notes or {},
        }
        async with httpx.AsyncClient(auth=self._auth, timeout=30.0) as client:
            r = await client.post(f"{RAZORPAY_BASE}/orders", json=payload, headers=self._headers())
            r.raise_for_status()
            return r.json()

    async def create_subscription(
        self,
        razorpay_plan_id: str,
        user_id: str,
        *,
        total_count: int = 120,
        start_at: int | None = None,
        customer_notify: bool = True,
    ) -> dict:
        """Create a subscription. total_count=120 for monthly (10 years), 10 for annual (10 years). start_at unix ts for trial end (first charge)."""
        if not self._auth:
            raise ValueError("Razorpay is not configured")
        payload = {
            "plan_id": razorpay_plan_id,
            "total_count": total_count,
            "quantity": 1,
            "customer_notify": customer_notify,
            "notes": {"user_id": user_id},
        }
        if start_at is not None:
            payload["start_at"] = start_at
        async with httpx.AsyncClient(auth=self._auth, timeout=30.0) as client:
            r = await client.post(f"{RAZORPAY_BASE}/subscriptions", json=payload, headers=self._headers())
            r.raise_for_status()
            return r.json()

    async def fetch_subscription(self, subscription_id: str) -> dict:
        if not self._auth:
            raise ValueError("Razorpay is not configured")
        async with httpx.AsyncClient(auth=self._auth, timeout=15.0) as client:
            r = await client.get(f"{RAZORPAY_BASE}/subscriptions/{subscription_id}", headers=self._headers())
            r.raise_for_status()
            return r.json()

    async def update_subscription(
        self,
        subscription_id: str,
        razorpay_plan_id: str,
        *,
        schedule_change_at: str = "now",
        customer_notify: bool = True,
    ) -> dict:
        """Update subscription to a new plan. schedule_change_at: 'now' or 'cycle_end'."""
        if not self._auth:
            raise ValueError("Razorpay is not configured")
        payload = {
            "plan_id": razorpay_plan_id,
            "schedule_change_at": schedule_change_at,
            "customer_notify": customer_notify,
        }
        async with httpx.AsyncClient(auth=self._auth, timeout=15.0) as client:
            r = await client.patch(
                f"{RAZORPAY_BASE}/subscriptions/{subscription_id}",
                json=payload,
                headers=self._headers(),
            )
            r.raise_for_status()
            return r.json()

    async def cancel_subscription(self, subscription_id: str, cancel_at_cycle_end: bool = False) -> dict:
        if not self._auth:
            raise ValueError("Razorpay is not configured")
        payload = {"cancel_at_cycle_end": cancel_at_cycle_end}
        async with httpx.AsyncClient(auth=self._auth, timeout=15.0) as client:
            r = await client.post(
                f"{RAZORPAY_BASE}/subscriptions/{subscription_id}/cancel",
                json=payload,
                headers=self._headers(),
            )
            r.raise_for_status()
            return r.json()

    def verify_webhook_signature(self, body: bytes | str, signature: str) -> bool:
        """Verify X-Razorpay-Signature using webhook secret. Body must be raw bytes as received."""
        secret = os.getenv("RAZORPAY_WEBHOOK_SECRET", "").strip()
        if not secret:
            logger.warning("RAZORPAY_WEBHOOK_SECRET not set; webhook verification will fail")
            return False
        if isinstance(body, str):
            body = body.encode("utf-8")
        expected = hmac.new(
            secret.encode("utf-8"),
            body,
            hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(expected, signature)

    def verify_payment_signature(self, *, order_id: str, payment_id: str, signature: str) -> bool:
        if not self.key_secret:
            logger.warning("RAZORPAY_KEY_SECRET not set; payment verification will fail")
            return False
        payload = f"{order_id}|{payment_id}".encode("utf-8")
        expected = hmac.new(
            self.key_secret.encode("utf-8"),
            payload,
            hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(expected, signature)


# Module-level instance; can be set from server if needed
_razorpay_service: RazorpayService | None = None


def get_razorpay_service() -> RazorpayService:
    global _razorpay_service
    if _razorpay_service is None:
        _razorpay_service = RazorpayService()
    return _razorpay_service
