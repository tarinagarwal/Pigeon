"""Email Infra API integration service (domain lifecycle)."""

import os
import logging
from typing import Any, Dict, Optional

import aiohttp
import asyncio


class EmailInfraServiceError(Exception):
    """Raised when Email Infra API returns an error."""

    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


class EmailInfraService:
    def __init__(self):
        self.base_url = (os.getenv("EMAIL_INFRA_API_BASE_URL") or "").rstrip("/")
        self.api_key = (os.getenv("EMAIL_INFRA_API_KEY") or "").strip()
        timeout_ms = os.getenv("EMAIL_INFRA_TIMEOUT_MS", "15000")
        try:
            self.timeout_seconds = max(1, int(timeout_ms) / 1000)
        except ValueError:
            self.timeout_seconds = 15

    @property
    def enabled(self) -> bool:
        return bool(self.base_url and self.api_key)

    async def _request(
        self,
        method: str,
        path: str,
        payload: Optional[Dict[str, Any]] = None,
        timeout_override: Optional[float] = None,
    ) -> Dict[str, Any]:
        if not self.enabled:
            raise EmailInfraServiceError(
                "Email Infra API is not configured. Set EMAIL_INFRA_API_BASE_URL and EMAIL_INFRA_API_KEY."
            )

        url = f"{self.base_url}{path}"
        headers = {
            "Content-Type": "application/json",
            "X-API-Key": self.api_key,
        }
        total_timeout = timeout_override or self.timeout_seconds
        timeout = aiohttp.ClientTimeout(total=total_timeout)

        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.request(method, url, headers=headers, json=payload) as response:
                    if response.status >= 400:
                        raw = await response.text()
                        message = raw or f"Email Infra API error ({response.status})"
                        raise EmailInfraServiceError(message, status_code=response.status)
                    if response.status == 204:
                        return {}
                    return await response.json()
        except asyncio.TimeoutError as exc:
            logging.error("Email Infra request timed out: %s %s (%s)", method, url, exc)
            raise EmailInfraServiceError("Email Infra request timed out") from exc
        except aiohttp.ClientError as exc:
            logging.error("Email Infra request failed: %s %s (%s)", method, url, exc)
            raise EmailInfraServiceError(f"Email Infra connection failed: {exc}") from exc

    async def create_domain(self, domain: str, vps_id: str = "auto-select") -> Dict[str, Any]:
        return await self._request(
            "POST",
            "/api/v1/domains",
            {"domain": domain, "vps_id": vps_id},
        )

    async def get_domain(self, domain_id: str) -> Dict[str, Any]:
        return await self._request("GET", f"/api/v1/domains/{domain_id}")

    async def update_domain_webhook(self, domain_id: str, inbound_webhook_url: Optional[str]) -> Dict[str, Any]:
        return await self._request(
            "PATCH",
            f"/api/v1/domains/{domain_id}",
            {"inbound_webhook_url": inbound_webhook_url},
        )

    async def verify_domain_dns(self, domain_id: str) -> Dict[str, Any]:
        return await self._request("GET", f"/api/v1/domains/{domain_id}/verify-dns")

    async def delete_domain(self, domain_id: str) -> Dict[str, Any]:
        await self._request("DELETE", f"/api/v1/domains/{domain_id}")
        return {"success": True}

    async def create_mailbox(
        self,
        *,
        email: str,
        password: str,
        domain_id: str,
        vps_id: str,
        ip_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "email": email,
            "password": password,
            "domain_id": domain_id,
            "vps_id": vps_id,
            "ip_id": ip_id,
        }
        # Mailbox provisioning can take longer; allow a higher timeout here.
        return await self._request("POST", "/api/v1/mailboxes", payload, timeout_override=60.0)

    async def verify_mailbox(self, mailbox_id: str) -> Dict[str, Any]:
        """
        Verify that a mailbox is fully provisioned on the VPS.
        Mirrors GET /api/v1/mailboxes/{mailbox_id}/verify.
        """
        # Verification can also be slow; use a higher timeout.
        return await self._request("GET", f"/api/v1/mailboxes/{mailbox_id}/verify", timeout_override=60.0)

    async def send_mailbox_email(
        self,
        *,
        mailbox_id: str,
        to: str,
        subject: str,
        body: str,
        from_email: Optional[str] = None,
        cc: Optional[str] = None,
        ip_address: Optional[str] = None,
        outbound_message_id: Optional[str] = None,
        in_reply_to: Optional[str] = None,
        references: Optional[str] = None,
        extra_headers: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """
        Send an email through Email Infra mailbox API.
        Mirrors POST /api/v1/mailboxes/{mailbox_id}/send.
        """
        payload: Dict[str, Any] = {
            "to": to,
            "subject": subject,
            "body": body,
        }
        if from_email:
            payload["from_email"] = from_email
        if cc:
            payload["cc"] = cc
        if ip_address:
            payload["ip_address"] = ip_address
        if outbound_message_id:
            payload["outbound_message_id"] = outbound_message_id
        if in_reply_to:
            payload["in_reply_to"] = in_reply_to
        if references:
            payload["references"] = references
        if extra_headers:
            payload["extra_headers"] = extra_headers

        # Sending can take longer than default when mailbox/VPS is under load.
        return await self._request(
            "POST",
            f"/api/v1/mailboxes/{mailbox_id}/send",
            payload,
            timeout_override=30.0,
        )

