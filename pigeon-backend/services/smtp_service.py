import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from email.utils import formatdate
from cryptography.fernet import Fernet
import os
import logging
import httpx
import asyncio
import json
from typing import Dict, Optional, Any, List, Tuple
from datetime import datetime, timezone
import io
import random
import re

from services.email_html_plain import html_email_fragment_to_plain
from services.email_infra_service import EmailInfraService, EmailInfraServiceError


class SendGridForbiddenError(Exception):
    """Raised when SendGrid API returns 403 Forbidden (e.g. invalid API key, domain not verified)."""


class DomainRateLimitError(Exception):
    """Raised when the per-inbox per-recipient-domain daily send limit is reached."""

    def __init__(self, domain: str, limit: int):
        self.domain = domain
        self.limit = limit
        super().__init__(f"Domain rate limit reached: {limit} emails/inbox/day to @{domain}")


class EmailInfraWarmupDelayError(Exception):
    """
    Raised when Email Infra indicates this mailbox must wait (warmup/pacing).
    Campaign batch code should treat this as a deferral, not a delivery failure.
    """

    def __init__(self, next_send_at: Optional[str] = None):
        self.next_send_at = next_send_at
        msg = "Email Infra warmup delay active"
        if next_send_at:
            msg = f"{msg} until {next_send_at}"
        super().__init__(msg)


class SMTPService:
    def __init__(self, db):
        self.db = db
        self.email_infra_service = EmailInfraService()
        encryption_key = os.getenv("ENCRYPTION_KEY")
        if not encryption_key:
            raise ValueError("ENCRYPTION_KEY environment variable is required. Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"")
        self.encryption_key = encryption_key
        self.fernet = Fernet(self.encryption_key.encode() if isinstance(self.encryption_key, str) else self.encryption_key)
    
    def _encrypt_password(self, password: str) -> str:
        """Encrypt SMTP password"""
        encrypted = self.fernet.encrypt(password.encode())
        return encrypted.decode()
    
    def _decrypt_password(self, encrypted_password: str) -> str:
        """Decrypt SMTP password"""
        decrypted = self.fernet.decrypt(encrypted_password.encode())
        return decrypted.decode()
    
    async def _get_inbox_config(self, inbox_id: str) -> Dict:
        """Get and decrypt inbox SMTP configuration"""
        inbox = await self.db.inboxes.find_one({"id": inbox_id})
        if not inbox:
            raise Exception("Inbox not found")
        
        if inbox.get("sender_type") != "smtp":
            raise Exception("Inbox is not configured for SMTP")
        
        config = {
            "user_id": inbox.get("user_id"),
            "mailbox_id": inbox.get("mailbox_id"),
            "email_infra_ip": inbox.get("email_infra_ip"),
            "email_infra_next_send_at": inbox.get("email_infra_next_send_at"),
            "email": inbox["email"],
            "sender_name": (inbox.get("sender_name") or "").strip(),
            "smtp_host": inbox.get("smtp_host") or os.getenv("SMTP_HOST"),
            "smtp_port": inbox.get("smtp_port", int(os.getenv("SMTP_PORT", "587"))),
            "smtp_username": inbox.get("smtp_username") or os.getenv("SMTP_USERNAME"),
            "smtp_provider": inbox.get("smtp_provider", "custom"),
            "domain_id": inbox.get("domain_id")
        }
        
        # Decrypt password or fall back to global / provider-specific credentials
        inbox_encrypted_password = inbox.get("smtp_password")
        provider = config["smtp_provider"]

        # pigeon = Pigeon-managed SendGrid: use global env API key instead of per-inbox credentials
        if provider == "pigeon":
            config["actual_provider"] = "sendgrid"
            api_key = os.getenv("SENDGRID_API_KEY")
            if not api_key:
                raise Exception("SendGrid API key not configured in environment (SENDGRID_API_KEY)")
            config["smtp_password"] = api_key

        elif inbox_encrypted_password:
            # Per-inbox password / API key
            config["smtp_password"] = self._decrypt_password(inbox_encrypted_password)
        else:
            # For SendGrid provider we require per-inbox credentials
            if provider == "sendgrid":
                raise Exception("SMTP password (API key) not configured for inbox")
            
            # For custom SMTP, allow using global env credentials
            global_password = os.getenv("SMTP_PASSWORD")
            if not global_password:
                raise Exception("SMTP password not configured (no inbox or global SMTP_PASSWORD set)")
            
            config["smtp_password"] = global_password
        
        return config

    def _parse_iso_dt(self, value: Optional[str]) -> Optional[datetime]:
        if not value or not isinstance(value, str):
            return None
        try:
            dt = datetime.fromisoformat(value)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except Exception:
            return None

    def _extract_email_infra_warmup_next_send_at(self, err: Exception) -> Optional[str]:
        """
        Email Infra may return a JSON body like:
        { "detail": { "ok": false, "message": "...", "next_send_at": "...", ... } }
        We store next_send_at on inbox for Email Infra throttling, but still fall back to SendGrid.
        """
        raw = str(err) if err else ""
        if not raw:
            return None
        try:
            parsed = json.loads(raw)
        except Exception:
            return None
        if not isinstance(parsed, dict):
            return None
        detail = parsed.get("detail")
        if not isinstance(detail, dict):
            return None
        next_send_at = detail.get("next_send_at")
        if isinstance(next_send_at, str) and next_send_at:
            return next_send_at
        return None

    async def _is_email_infra_enabled_for_user(self, user_id: Optional[str]) -> bool:
        if not user_id:
            return False
        settings = await self.db.user_settings.find_one(
            {"user_id": user_id},
            {"_id": 0, "email_infra": 1},
        )
        return bool(settings and settings.get("email_infra", {}).get("enabled") is True)
    
    async def _send_via_sendgrid_api(self, config: Dict, to_email: str, subject: str, body: str, tracking_pixel_url: str = None, reply_to_email: str = None, outbound_message_id: str = None, body_type: str = "html", email_log_id: str = None, cc: str = None, in_reply_to: str = None, references: str = None, unsubscribe_url: str = None) -> Dict:
        """Send email via SendGrid API. email_log_id is passed as custom_arg so Event Webhook (e.g. spamreport) can update the log. in_reply_to/references enable threading."""
        # SendGrid API key should be in smtp_password
        api_key = config["smtp_password"]
        
        if body_type == "plain":
            content = [{"type": "text/plain", "value": body}]
        else:
            html_body = body
            if tracking_pixel_url:
                _px_w = random.randint(3, 12)
                _px_h = random.randint(3, 12)
                html_body += f'<img src="{tracking_pixel_url}" width="{_px_w}" height="{_px_h}" />'
            plain_fallback = html_email_fragment_to_plain(body)
            content = [
                {"type": "text/plain", "value": plain_fallback or " "},
                {"type": "text/html", "value": html_body},
            ]
        
        personalizations = [{"to": [{"email": to_email}]}]
        if email_log_id:
            personalizations[0]["custom_args"] = {"email_log_id": email_log_id}
        if cc:
            cc_emails = [e.strip() for e in cc.split(",") if e.strip() and "@" in e.strip()]
            if cc_emails:
                personalizations[0]["cc"] = [{"email": e} for e in cc_emails]
        # Lazy import: email_service imports smtp_service at module load.
        from services.email_service import EmailService

        from_email = config["email"]
        from_block: Dict[str, str] = {"email": from_email}
        inbox_display_name = EmailService.get_effective_inbox_name(
            inbox={"sender_name": config.get("sender_name"), "email": from_email},
            inbox_email=from_email,
        )
        if inbox_display_name and inbox_display_name.strip():
            from_block["name"] = inbox_display_name.strip()
        payload = {
            "personalizations": personalizations,
            "from": from_block,
            "subject": subject,
            "content": content
        }
        if reply_to_email:
            payload["reply_to"] = {"email": reply_to_email}
        headers = {}
        if outbound_message_id:
            headers["Message-ID"] = self._ensure_angle_brackets(outbound_message_id)
        if in_reply_to:
            headers["In-Reply-To"] = self._ensure_angle_brackets(in_reply_to)
        if references:
            headers["References"] = references.strip()
        if unsubscribe_url:
            headers["List-Unsubscribe"] = f"<{unsubscribe_url}>"
            headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
        if headers:
            payload["headers"] = headers

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.sendgrid.com/v3/mail/send",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                },
                json=payload,
                timeout=30.0
            )
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 403:
                    raise SendGridForbiddenError(
                        f"403 Forbidden. Check domain authentication. {e}"
                    ) from e
                raise

            return {
                "message_id": outbound_message_id or response.headers.get("X-Message-Id", "unknown"),
                "status": "sent",
                "provider": "sendgrid"
            }
    
    def _ensure_angle_brackets(self, msg_id: str) -> str:
        """Ensure message id is in angle brackets for In-Reply-To/References."""
        if not msg_id or not msg_id.strip():
            return msg_id or ""
        s = msg_id.strip()
        return s if s.startswith("<") and s.endswith(">") else f"<{s}>"

    async def _send_via_smtp(self, config: Dict, to_email: str, subject: str, body: str, tracking_pixel_url: str = None, reply_to_email: str = None, outbound_message_id: str = None, body_type: str = "html", cc: str = None, in_reply_to: str = None, references: str = None, unsubscribe_url: str = None) -> Dict:
        """Send email via standard SMTP. outbound_message_id is Message-ID; in_reply_to/references enable threading so To and CC see the same conversation."""
        message = MIMEMultipart('alternative')
        sender_name = str(config.get("sender_name") or "").strip()
        message['From'] = f'{sender_name} <{config["email"]}>' if sender_name else config["email"]
        message['To'] = to_email
        message['Subject'] = subject
        message['Date'] = formatdate(localtime=True)
        if outbound_message_id:
            message['Message-ID'] = self._ensure_angle_brackets(outbound_message_id)
        if reply_to_email:
            message['Reply-To'] = reply_to_email
        if cc:
            message['Cc'] = cc.strip()
        if in_reply_to:
            message['In-Reply-To'] = self._ensure_angle_brackets(in_reply_to)
        if references:
            message['References'] = references.strip()
        if unsubscribe_url:
            message['List-Unsubscribe'] = f'<{unsubscribe_url}>'
            message['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'

        if body_type == "plain":
            message.attach(MIMEText(body, 'plain'))
        else:
            # Only convert bare newlines to <br> when the body is not already structured HTML
            # (i.e. does not contain block-level tags like <p>, <div>, <ul>, <table>).
            # Applying the replacement to structured HTML inserts spurious <br> tags mid-element.
            _is_structured_html = bool(
                re.search(r"<(?:p|div|ul|ol|li|table|tr|td|th|h[1-6]|blockquote)\b", body, re.IGNORECASE)
            )
            html_body = body if _is_structured_html else body.replace('\n', '<br>\n')
            # Only inject tracking image when there is no existing <img> tag in the body.
            # Use a small random size (not 1x1) to reduce fingerprinting as a tracking pixel.
            if tracking_pixel_url and "<img" not in body.lower():
                width = random.randint(3, 12)
                height = random.randint(3, 12)
                html_body += f'<img src="{tracking_pixel_url}" width="{width}" height="{height}" />'
            html_content = f'''<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
    body {{ font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333; }}
    </style>
</head>
<body>
{html_body}
</body>
</html>'''
            # Attach plain text alternative first so it is the fallback for spam filters
            # and clients that prefer plain text (multipart/alternative: last part wins).
            plain_fallback = html_email_fragment_to_plain(body)
            message.attach(MIMEText(plain_fallback, 'plain'))
            message.attach(MIMEText(html_content, 'html'))
        
        message_bytes = message.as_bytes()
        
        # Connect to SMTP server
        smtp_port = config.get("smtp_port", 587)
        smtp_host = config["smtp_host"]
        
        try:
            # Use asyncio to run in thread pool
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(
                None,
                self._send_smtp_sync,
                smtp_host,
                smtp_port,
                config["smtp_username"],
                config["smtp_password"],
                message_bytes
            )
            if outbound_message_id:
                result = {**result, "message_id": outbound_message_id}
            return result
        except Exception as e:
            logging.error(f"SMTP send error: {e}")
            raise Exception(f"Failed to send email via SMTP: {str(e)}")
    
    def _send_smtp_sync(self, host: str, port: int, username: str, password: str, message_bytes: bytes) -> Dict:
        """Synchronous SMTP send (runs in thread pool)"""
        try:
            if port == 465:
                # SSL connection
                server = smtplib.SMTP_SSL(host, port, timeout=60)
            else:
                # TLS connection
                server = smtplib.SMTP(host, port, timeout=60)
                server.starttls()
            
            server.login(username, password)

            # Send message bytes directly (already includes DKIM signature if applicable).
            # Use sendmail() with raw bytes to preserve DKIM signature — send_message() would
            # re-serialize the parsed message, producing different bytes that break the signature.
            if isinstance(message_bytes, bytes):
                from email import message_from_bytes
                msg = message_from_bytes(message_bytes)
                from_addr = msg.get("From", username)
                to_addrs = []
                for header in ("To", "Cc"):
                    vals = msg.get_all(header) or []
                    for v in vals:
                        to_addrs.extend(a.strip() for a in v.split(",") if a.strip())
                server.sendmail(from_addr, to_addrs, message_bytes)
            else:
                # Fallback for MIMEMultipart object (no DKIM signing)
                server.send_message(message_bytes)
            
            server.quit()
            
            return {
                "message_id": f"smtp-{datetime.now(timezone.utc).timestamp()}",
                "status": "sent",
                "provider": "smtp"
            }
        except Exception as e:
            logging.error(f"SMTP sync error: {e}")
            raise
    
    async def send_email_via_smtp(
        self,
        inbox_id: str,
        to_email: str,
        subject: str,
        body: str,
        tracking_pixel_url: str = None,
        reply_to_email: str = None,
        outbound_message_id: str = None,
        body_type: str = "html",
        email_log_id: str = None,
        cc: str = None,
        in_reply_to: str = None,
        references: str = None,
        unsubscribe_url: str = None,
    ) -> Dict:
        """Send email via SMTP. reply_to_email ensures replies are delivered (e.g. to Gmail) when From address cannot receive mail. outbound_message_id is Message-ID; in_reply_to/references enable threading so To and CC see the same conversation."""
        config = await self._get_inbox_config(inbox_id)
        inbox_provider = config.get("smtp_provider", "custom")

        # Resolve domain-level sending provider (default to sendgrid for legacy docs).
        domain_sending_provider = "sendgrid"
        domain_id = (config.get("domain_id") or "").strip()
        if domain_id:
            domain_doc = await self.db.domains.find_one(
                {"id": domain_id, "user_id": config.get("user_id")},
                {"sending_provider": 1, "email_infra": 1},
            )
            if domain_doc and domain_doc.get("sending_provider"):
                domain_sending_provider = domain_doc.get("sending_provider")

        # Domain-level routing (no EmailInfra -> SendGrid fallback).
        if domain_sending_provider == "email_infra":
            email_infra_enabled = await self._is_email_infra_enabled_for_user(config.get("user_id"))
            mailbox_id = (config.get("mailbox_id") or "").strip()
            if not mailbox_id:
                # If mailbox_id wasn't on the inbox doc yet, try to fall back to domain email_infra (if present).
                if domain_id:
                    domain_doc = await self.db.domains.find_one(
                        {"id": domain_id, "user_id": config.get("user_id")},
                        {"email_infra": 1},
                    )
                    mailbox_id = ((domain_doc or {}).get("email_infra") or {}).get("mailbox_id") or mailbox_id

            if not email_infra_enabled or not mailbox_id or not self.email_infra_service.enabled:
                raise Exception("Email Infra is not enabled/configured for this inbox domain.")

            # If Email Infra told us to wait (warmup pacing), defer without sending.
            next_send_at_str = config.get("email_infra_next_send_at")
            next_send_at_dt = self._parse_iso_dt(next_send_at_str) if next_send_at_str else None
            if next_send_at_dt and datetime.now(timezone.utc) < next_send_at_dt:
                logging.warning(
                    "Email Infra warmup delay active for inbox_id=%s until %s; deferring send.",
                    inbox_id,
                    next_send_at_str,
                )
                raise EmailInfraWarmupDelayError(next_send_at_str)

            infra_body = body
            if body_type != "plain" and tracking_pixel_url:
                # Match SendGrid/SMTP behavior: avoid obvious 1x1 hidden tracker pattern.
                _px_w = random.randint(3, 12)
                _px_h = random.randint(3, 12)
                infra_body = f'{infra_body}<img src="{tracking_pixel_url}" width="{_px_w}" height="{_px_h}" />'

            try:
                infra_extra_headers = None
                if unsubscribe_url:
                    infra_extra_headers = {
                        "List-Unsubscribe": f"<{unsubscribe_url}>",
                        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                    }
                infra_result = await self.email_infra_service.send_mailbox_email(
                    mailbox_id=mailbox_id,
                    to=to_email,
                    subject=subject,
                    body=infra_body,
                    from_email=config.get("email"),
                    cc=cc,
                    ip_address=(config.get("email_infra_ip") or None),
                    outbound_message_id=outbound_message_id,
                    in_reply_to=in_reply_to,
                    references=references,
                    extra_headers=infra_extra_headers,
                )

                if isinstance(infra_result, dict) and infra_result.get("ok") is False:
                    raise Exception(infra_result.get("detail") or infra_result.get("message") or "Email Infra send failed")

                # Persist sending IP to inbox for sticky routing next send
                ip = (infra_result or {}).get("ip")
                if ip and ip != (config.get("email_infra_ip") or None):
                    await self.db.inboxes.update_one(
                        {"id": inbox_id},
                        {"$set": {"email_infra_ip": ip}},
                    )

                return {
                    "message_id": (
                        (infra_result or {}).get("message_id")
                        or (infra_result or {}).get("outbound_message_id")
                        or outbound_message_id
                        or f"email-infra-{datetime.now(timezone.utc).timestamp()}"
                    ),
                    "status": "sent",
                    "provider": "email_infra",
                    "ip": (infra_result or {}).get("ip"),
                }
            except EmailInfraWarmupDelayError:
                raise
            except (EmailInfraServiceError, Exception) as e:
                warmup_next_send_at = self._extract_email_infra_warmup_next_send_at(e)
                if warmup_next_send_at:
                    await self.db.inboxes.update_one(
                        {"id": inbox_id},
                        {"$set": {"email_infra_next_send_at": warmup_next_send_at}},
                    )
                    raise EmailInfraWarmupDelayError(warmup_next_send_at)
                raise

        # Send via SendGrid when requested at domain level.
        if domain_sending_provider == "sendgrid":
            if inbox_provider in ("sendgrid", "pigeon"):
                return await self._send_via_sendgrid_api(
                    config,
                    to_email,
                    subject,
                    body,
                    tracking_pixel_url,
                    reply_to_email,
                    outbound_message_id,
                    body_type,
                    email_log_id,
                    cc,
                    in_reply_to,
                    references,
                    unsubscribe_url,
                )

            # Backwards compatible: if inbox isn't SendGrid-capable, keep old SMTP behavior.
            return await self._send_via_smtp(
                config,
                to_email,
                subject,
                body,
                tracking_pixel_url,
                reply_to_email,
                outbound_message_id,
                body_type,
                cc,
                in_reply_to,
                references,
                unsubscribe_url,
            )

        # Fallback (should not normally happen): route by inbox config.
        if inbox_provider == "sendgrid":
            return await self._send_via_sendgrid_api(config, to_email, subject, body, tracking_pixel_url, reply_to_email, outbound_message_id, body_type, email_log_id, cc, in_reply_to, references, unsubscribe_url)

        return await self._send_via_smtp(config, to_email, subject, body, tracking_pixel_url, reply_to_email, outbound_message_id, body_type, cc, in_reply_to, references, unsubscribe_url)

    async def send_email_via_smtp_gmail_app_password(
        self,
        inbox_id: str,
        to_email: str,
        subject: str,
        body: str,
        tracking_pixel_url: str = None,
        reply_to_email: str = None,
        outbound_message_id: str = None,
        body_type: str = "html",
        cc: str = None,
        in_reply_to: str = None,
        references: str = None,
        unsubscribe_url: str = None,
    ) -> Dict:
        """Send email via Gmail SMTP using an inbox connected with app password (no OAuth). in_reply_to/references enable threading."""
        inbox = await self.db.inboxes.find_one({"id": inbox_id})
        if not inbox or inbox.get("sender_type") != "gmail" or inbox.get("gmail_auth_method") != "app_password":
            raise Exception("Inbox not found or not a Gmail app-password inbox")
        enc = inbox.get("gmail_app_password_encrypted")
        if not enc:
            raise Exception("Gmail app password not configured for this inbox")
        password = self._decrypt_password(enc)
        email = inbox["email"]
        config = {
            "email": email,
            "smtp_host": "smtp.gmail.com",
            "smtp_port": 587,
            "smtp_username": email,
            "smtp_password": password,
        }
        return await self._send_via_smtp(config, to_email, subject, body, tracking_pixel_url, reply_to_email, outbound_message_id, body_type, cc, in_reply_to, references, unsubscribe_url)

    async def test_smtp_connection(self, inbox_id: str) -> bool:
        """Test SMTP connection"""
        try:
            config = await self._get_inbox_config(inbox_id)
            provider = config.get("smtp_provider", "custom")
            
            # pigeon = Pigeon-managed SendGrid; resolve to underlying provider for connection test
            if provider == "pigeon":
                provider = config.get("actual_provider", "sendgrid")

            # For API providers, just check if credentials exist
            if provider == "sendgrid":
                return bool(config.get("smtp_password"))
            
            # For custom SMTP, test connection
            smtp_host = config["smtp_host"]
            smtp_port = config.get("smtp_port", 587)
            username = config["smtp_username"]
            password = config["smtp_password"]
            
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(
                None,
                self._test_smtp_sync,
                smtp_host,
                smtp_port,
                username,
                password
            )
            return result
        except Exception as e:
            logging.error(f"SMTP test error: {e}")
            return False
    
    def _test_smtp_sync(self, host: str, port: int, username: str, password: str) -> bool:
        """Synchronous SMTP connection test"""
        try:
            if port == 465:
                server = smtplib.SMTP_SSL(host, port, timeout=10)
            else:
                server = smtplib.SMTP(host, port, timeout=10)
                server.starttls()
            
            server.login(username, password)
            server.quit()
            return True
        except Exception:
            return False
    
    async def get_smtp_config(self, inbox_id: str) -> Dict:
        """Get SMTP configuration (without password)"""
        inbox = await self.db.inboxes.find_one({"id": inbox_id})
        if not inbox:
            raise Exception("Inbox not found")
        
        return {
            "email": inbox["email"],
            "smtp_host": inbox.get("smtp_host"),
            "smtp_port": inbox.get("smtp_port"),
            "smtp_username": inbox.get("smtp_username"),
            "smtp_provider": inbox.get("smtp_provider", "custom")
            # Password is not returned for security
        }

    def _get_app_notification_config(self) -> Optional[Dict[str, Any]]:
        """Build config for app notifications.
        Prefer SendGrid using SENDGRID_API_KEY + NOTIFICATION_FROM_EMAIL (+ optional NOTIFICATION_FROM_NAME),
        otherwise fall back to SMTP via NOTIFICATION_SMTP_* or SMTP_* env vars.
        Returns None if neither is configured."""
        from_email = os.getenv("NOTIFICATION_FROM_EMAIL")
        from_name = os.getenv("NOTIFICATION_FROM_NAME", "Pigeon AI")
        api_key = os.getenv("SENDGRID_API_KEY")
        if api_key and from_email:
            return {
                "use_sendgrid": True,
                "from_email": from_email,
                "from_name": from_name,
                "api_key": api_key,
            }
        host = os.getenv("NOTIFICATION_SMTP_HOST") or os.getenv("SMTP_HOST")
        port_str = os.getenv("NOTIFICATION_SMTP_PORT") or os.getenv("SMTP_PORT", "587")
        username = os.getenv("NOTIFICATION_SMTP_USERNAME") or os.getenv("SMTP_USERNAME")
        password = os.getenv("NOTIFICATION_SMTP_PASSWORD") or os.getenv("SMTP_PASSWORD")
        from_email = from_email or username
        if not host or not username or not password:
            return None
        try:
            port = int(port_str)
        except (TypeError, ValueError):
            port = 587
        return {
            "use_sendgrid": False,
            "smtp_host": host,
            "smtp_port": port,
            "smtp_username": username,
            "smtp_password": password,
            "from_email": from_email,
            "from_name": from_name,
        }

    async def _send_app_notification_via_sendgrid(
        self,
        config: Dict[str, Any],
        to_email: str,
        subject: str,
        body_plain: str,
        body_html: Optional[str] = None,
        attachments: Optional[List[Tuple[str, bytes, str]]] = None,
    ) -> bool:
        """Send app notification email via SendGrid API. Returns True if sent."""
        import base64
        content = [{"type": "text/plain", "value": body_plain}]
        if body_html:
            content.append({"type": "text/html", "value": body_html})
        else:
            content.append({"type": "text/html", "value": body_plain.replace("\n", "<br>\n")})
        payload = {
            "personalizations": [{"to": [{"email": to_email}]}],
            "from": {"email": config["from_email"], "name": config.get("from_name") or "Pigeon"},
            "subject": subject,
            "content": content,
        }
        if attachments:
            payload["attachments"] = [
                {"content": base64.b64encode(content_bytes).decode(), "filename": fn, "type": ct}
                for fn, content_bytes, ct in attachments
            ]
        try:
            async with httpx.AsyncClient() as client:
                r = await client.post(
                    "https://api.sendgrid.com/v3/mail/send",
                    headers={"Authorization": f"Bearer {config['api_key']}", "Content-Type": "application/json"},
                    json=payload,
                    timeout=30.0,
                )
                r.raise_for_status()
                return True
        except Exception as e:
            logging.error("SendGrid app notification failed to %s: %s", to_email, e)
            return False

    async def send_app_notification_email(
        self,
        to_email: str,
        subject: str,
        body_plain: str,
        body_html: Optional[str] = None,
    ) -> bool:
        """Send a single email using app-level SendGrid or SMTP from .env (no inbox). Used for user notifications. Returns True if sent, False if skipped or failed (logs, does not raise)."""
        config = self._get_app_notification_config()
        if not config:
            logging.warning("App notification email skipped: SENDGRID_API_KEY+NOTIFICATION_FROM_EMAIL or NOTIFICATION_SMTP_* not configured in .env")
            return False
        if config.get("use_sendgrid"):
            return await self._send_app_notification_via_sendgrid(config, to_email, subject, body_plain, body_html)
        message = MIMEMultipart("alternative")
        from_addr = config["from_email"]
        from_name = config.get("from_name")
        if from_name:
            message["From"] = f'{from_name} <{from_addr}>'
        else:
            message["From"] = from_addr
        message["To"] = to_email
        message["Subject"] = subject
        message["Date"] = formatdate(localtime=True)
        message.attach(MIMEText(body_plain, "plain"))
        if body_html:
            message.attach(MIMEText(body_html, "html"))
        else:
            message.attach(MIMEText(body_plain.replace("\n", "<br>\n"), "html"))
        message_bytes = message.as_bytes()
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                self._send_smtp_sync,
                config["smtp_host"],
                config["smtp_port"],
                config["smtp_username"],
                config["smtp_password"],
                message_bytes,
            )
            return True
        except Exception as e:
            logging.error("App notification email failed to %s: %s", to_email, e)
            return False

    async def send_app_notification_email_with_attachments(
        self,
        to_email: str,
        subject: str,
        body_plain: str,
        body_html: Optional[str] = None,
        attachments: Optional[List[Tuple[str, bytes, str]]] = None,
    ) -> bool:
        """Send email using app-level SendGrid or SMTP with optional attachments. Used e.g. to forward inbound mail to the user. attachments = [(filename, content_bytes, content_type), ...]. Returns True if sent."""
        config = self._get_app_notification_config()
        if not config:
            logging.warning("App notification email skipped: SENDGRID_API_KEY+NOTIFICATION_FROM_EMAIL or NOTIFICATION_SMTP_* not configured in .env")
            return False
        if config.get("use_sendgrid"):
            return await self._send_app_notification_via_sendgrid(config, to_email, subject, body_plain, body_html, attachments)
        message = MIMEMultipart("mixed")
        from_addr = config["from_email"]
        from_name = config.get("from_name")
        if from_name:
            message["From"] = f'{from_name} <{from_addr}>'
        else:
            message["From"] = from_addr
        message["To"] = to_email
        message["Subject"] = subject
        message["Date"] = formatdate(localtime=True)
        # Body as alternative part
        body_part = MIMEMultipart("alternative")
        body_part.attach(MIMEText(body_plain, "plain"))
        if body_html:
            body_part.attach(MIMEText(body_html, "html"))
        else:
            body_part.attach(MIMEText(body_plain.replace("\n", "<br>\n"), "html"))
        message.attach(body_part)
        # Attachments
        if attachments:
            for filename, content_bytes, content_type in attachments:
                main, sub = (content_type.split("/", 1) + ["octet-stream"])[:2]
                part = MIMEBase(main, sub)
                part.set_payload(content_bytes)
                encoders.encode_base64(part)
                part.add_header("Content-Disposition", "attachment", filename=filename)
                message.attach(part)
        message_bytes = message.as_bytes()
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                self._send_smtp_sync,
                config["smtp_host"],
                config["smtp_port"],
                config["smtp_username"],
                config["smtp_password"],
                message_bytes,
            )
            return True
        except Exception as e:
            logging.error("App notification email with attachments failed to %s: %s", to_email, e)
            return False
