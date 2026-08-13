"""IMAP reply detection for campaigns that use Reply-To IMAP. Uses stdlib imaplib in a thread."""
import asyncio
import imaplib
import email
import logging
from datetime import datetime, timezone
from typing import List, Dict, Any

logger = logging.getLogger(__name__)


def _extract_body_from_message(msg: email.message.Message) -> str:
    """Extract plain text or HTML body from an email message (supports multipart)."""
    body_parts = []
    if msg.is_multipart():
        for part in msg.walk():
            content_type = (part.get_content_type() or "").lower()
            if content_type == "text/plain":
                try:
                    payload = part.get_payload(decode=True)
                    if payload:
                        charset = part.get_content_charset() or "utf-8"
                        body_parts.append((0, payload.decode(charset, errors="replace")))
                except Exception:
                    pass
            elif content_type == "text/html" and not body_parts:
                try:
                    payload = part.get_payload(decode=True)
                    if payload:
                        charset = part.get_content_charset() or "utf-8"
                        body_parts.append((1, payload.decode(charset, errors="replace")))
                except Exception:
                    pass
        # Prefer plain text; if we only got HTML, use it
        if body_parts:
            body_parts.sort(key=lambda x: x[0])
            return (body_parts[0][1] or "").strip()
    else:
        try:
            payload = msg.get_payload(decode=True)
            if payload:
                charset = msg.get_content_charset() or "utf-8"
                return payload.decode(charset, errors="replace").strip()
        except Exception:
            pass
    return ""


def _normalize_msg_id(msg_id: str) -> str:
    """Normalize message id for matching (strip angle brackets)."""
    if not msg_id:
        return ""
    s = (msg_id or "").strip()
    if s.startswith("<") and s.endswith(">"):
        s = s[1:-1]
    return s


def _parse_reply_ids(in_reply_to: str, references: str) -> set:
    """Parse In-Reply-To and References headers into a set of normalized message ids."""
    ids = set()
    for raw in (in_reply_to or "", references or ""):
        for part in raw.replace("\r", " ").replace("\n", " ").split():
            part = part.strip()
            if part:
                n = _normalize_msg_id(part)
                if n:
                    ids.add(n)
    return ids


def _is_auto_reply(body: str) -> bool:
    """Heuristic check for auto‑replies (OOO, delivery notifications, etc.)."""
    if not body:
        return False
    text = body.lower()
    auto_markers = [
        "out of office",
        "out-of-office",
        "automatic reply",
        "auto-reply",
        "autoreply",
        "this is an automated message",
        "this is an automatic message",
        "i am currently out of the office",
        "i am out of the office",
        "i am away from the office",
        "delivery status notification",
        "delivery failure",
        "undeliverable",
        "mail delivery subsystem",
        "vacation reply",
        "on vacation",
    ]
    return any(marker in text for marker in auto_markers)


def _fetch_recent_headers_sync(host: str, port: int, username: str, password: str, max_messages: int = 100) -> List[Dict[str, Any]]:
    """Connect to IMAP, select INBOX, fetch full message for recent emails. Returns list of {reply_to_ids, body}."""
    results = []
    try:
        use_ssl = port == 993
        if use_ssl:
            conn = imaplib.IMAP4_SSL(host, port=port)
        else:
            conn = imaplib.IMAP4(host, port=port)
        conn.login(username, password)
        conn.select("INBOX", readonly=True)
        typ, data = conn.search(None, "ALL")
        if typ != "OK" or not data or not data[0]:
            conn.logout()
            return results
        uids = data[0].split()
        uids = uids[-max_messages:] if len(uids) > max_messages else uids
        for uid in uids:
            try:
                typ, msg_data = conn.fetch(uid, "(RFC822)")
                if typ != "OK" or not msg_data:
                    continue
                part = msg_data[0]
                if not isinstance(part, tuple) or len(part) < 2:
                    continue
                raw = part[1]
                if isinstance(raw, bytes):
                    raw = raw.decode("utf-8", errors="replace")
                else:
                    raw = str(raw)
                msg = email.message_from_string(raw)
                in_reply_to = msg.get("In-Reply-To", "") or ""
                references = msg.get("References", "") or ""
                reply_to_ids = _parse_reply_ids(in_reply_to, references)
                body = _extract_body_from_message(msg)
                results.append({"reply_to_ids": reply_to_ids, "body": body})
            except Exception as e:
                logger.warning("imap_reply: fetch uid %s failed: %s", uid, e)
                continue
        conn.logout()
    except Exception as e:
        logger.warning("imap_reply: connect/login failed for %s: %s", host, e)
    return results


GMAIL_IMAP_HOST = "imap.gmail.com"
GMAIL_IMAP_PORT = 993


class ImapReplyService:
    """Check an IMAP inbox for replies that match SMTP-sent email message IDs."""

    def __init__(self, db, smtp_service):
        self.db = db
        self.smtp_service = smtp_service

    async def check_replies_for_config(self, config_id: str, logs: List[Dict[str, Any]]) -> int:
        """
        For logs that belong to campaigns with reply_to_type=imap and reply_to_id=config_id,
        check the IMAP inbox for messages whose In-Reply-To/References match each log's smtp_message_id.
        Update matching logs and related contact/campaign_contact. Returns count of replies found.
        """
        if not logs:
            return 0
        config = await self.db.reply_to_imap_configs.find_one({"id": config_id})
        if not config:
            logger.warning("imap_reply: config_id=%s not found", config_id)
            return 0
        try:
            password = self.smtp_service._decrypt_password(config["imap_password"])
        except Exception as e:
            logger.warning("imap_reply: decrypt failed for config_id=%s: %s", config_id, e)
            return 0
        host = config["imap_host"]
        port = config.get("imap_port", 993)
        username = config["imap_username"]
        messages = await asyncio.to_thread(
            _fetch_recent_headers_sync, host, port, username, password, max_messages=100
        )
        now = datetime.now(timezone.utc)
        replies_found = 0
        updated_log_ids = set()
        for msg_info in messages:
            reply_to_ids = msg_info.get("reply_to_ids") or set()
            body = msg_info.get("body", "")
            if not reply_to_ids:
                continue
            for log in logs:
                if log["id"] in updated_log_ids:
                    continue
                smtp_id = log.get("smtp_message_id") or ""
                normalized = _normalize_msg_id(smtp_id)
                if not normalized or normalized not in reply_to_ids:
                    continue
                is_auto = _is_auto_reply(body)
                await self.db.email_logs.update_one(
                    {"id": log["id"], "user_id": log["user_id"]},
                    {
                        "$set": {
                            "status": "replied",
                            "replied_at": now,
                            "reply_body": body,
                            "reply_type": "auto" if is_auto else "human",
                        }
                    },
                )
                contact_id = log.get("contact_id")
                campaign_id = log.get("campaign_id")
                if contact_id:
                    await self.db.contacts.update_one(
                        {"id": contact_id},
                        {"$set": {"status": "replied"}},
                    )
                if campaign_id and contact_id:
                    await self.db.campaign_contacts.update_one(
                        {"campaign_id": campaign_id, "contact_id": contact_id},
                        {
                            "$set": {"status": "replied", "last_activity": now, "updated_at": now},
                            "$push": {
                                "events": {
                                    "type": "replied",
                                    "timestamp": now,
                                    "metadata": {
                                        "source": "inbox_imap",
                                        "reply_body": body[:500],
                                        "reply_type": "auto" if is_auto else "human",
                                    },
                                }
                            },
                        },
                    )
                updated_log_ids.add(log["id"])
                replies_found += 1
                # Trigger workflows listening for onEmailReplied and outbound webhooks email.replied.
                from services.workflow_service import WorkflowService  # local import to avoid circular
                from services.webhook_event_service import WebhookEventService  # local import
                from server import workflow_service as _wf_service, webhook_event_service as _wh_service  # type: ignore

                if isinstance(_wf_service, WorkflowService):
                    await _wf_service.trigger_matching_workflows(
                        event_type="onEmailReplied",
                        trigger_context={
                            "email_log_id": log["id"],
                            "campaign_id": campaign_id,
                            "contact_id": contact_id,
                        },
                    )

                try:
                    if isinstance(_wh_service, WebhookEventService):
                        # Reload latest email_log so webhook payload reflects updated status.
                        latest = await self.db.email_logs.find_one(
                            {"id": log["id"]},
                            {"_id": 0},
                        )
                        if latest:
                            await _wh_service.send_email_event("email.replied", latest)
                except Exception:
                    pass
                break
        return replies_found

    async def check_replies_for_gmail_app_password_inbox(
        self, inbox_id: str, logs: List[Dict[str, Any]]
    ) -> int:
        """
        Check a Gmail inbox connected via app password for replies that match the given logs'
        smtp_message_id (In-Reply-To/References). Uses IMAP (imap.gmail.com). Returns count of replies found.
        """
        if not logs:
            return 0
        inbox = await self.db.inboxes.find_one(
            {"id": inbox_id, "sender_type": "gmail", "gmail_auth_method": "app_password"},
            {"email": 1, "gmail_app_password_encrypted": 1},
        )
        if not inbox or not inbox.get("gmail_app_password_encrypted"):
            logger.warning("imap_reply: gmail app-password inbox_id=%s not found or no password", inbox_id)
            return 0
        try:
            password = self.smtp_service._decrypt_password(inbox["gmail_app_password_encrypted"])
        except Exception as e:
            logger.warning("imap_reply: decrypt failed for gmail inbox_id=%s: %s", inbox_id, e)
            return 0
        username = inbox["email"]
        messages = await asyncio.to_thread(
            _fetch_recent_headers_sync,
            GMAIL_IMAP_HOST,
            GMAIL_IMAP_PORT,
            username,
            password,
            max_messages=100,
        )
        now = datetime.now(timezone.utc)
        replies_found = 0
        updated_log_ids = set()
        for msg_info in messages:
            reply_to_ids = msg_info.get("reply_to_ids") or set()
            body = msg_info.get("body", "")
            if not reply_to_ids:
                continue
            for log in logs:
                if log["id"] in updated_log_ids:
                    continue
                smtp_id = log.get("smtp_message_id") or ""
                normalized = _normalize_msg_id(smtp_id)
                if not normalized or normalized not in reply_to_ids:
                    continue
                is_auto = _is_auto_reply(body)
                await self.db.email_logs.update_one(
                    {"id": log["id"], "user_id": log["user_id"]},
                    {
                        "$set": {
                            "status": "replied",
                            "replied_at": now,
                            "reply_body": body,
                            "reply_type": "auto" if is_auto else "human",
                        }
                    },
                )
                contact_id = log.get("contact_id")
                campaign_id = log.get("campaign_id")
                if contact_id:
                    await self.db.contacts.update_one(
                        {"id": contact_id},
                        {"$set": {"status": "replied"}},
                    )
                if campaign_id and contact_id:
                    await self.db.campaign_contacts.update_one(
                        {"campaign_id": campaign_id, "contact_id": contact_id},
                        {
                            "$set": {"status": "replied", "last_activity": now, "updated_at": now},
                            "$push": {
                                "events": {
                                    "type": "replied",
                                    "timestamp": now,
                                    "metadata": {
                                        "source": "inbox_smtp",
                                        "reply_body": body[:500],
                                        "reply_type": "auto" if is_auto else "human",
                                    },
                                }
                            },
                        },
                    )
                updated_log_ids.add(log["id"])
                replies_found += 1
                # Trigger workflows listening for onEmailReplied and outbound webhooks email.replied.
                from services.workflow_service import WorkflowService  # local import to avoid circular
                from services.webhook_event_service import WebhookEventService  # local import
                from server import workflow_service as _wf_service, webhook_event_service as _wh_service  # type: ignore

                if isinstance(_wf_service, WorkflowService):
                    await _wf_service.trigger_matching_workflows(
                        event_type="onEmailReplied",
                        trigger_context={
                            "email_log_id": log["id"],
                            "campaign_id": campaign_id,
                            "contact_id": contact_id,
                        },
                    )

                try:
                    if isinstance(_wh_service, WebhookEventService):
                        latest = await self.db.email_logs.find_one(
                            {"id": log["id"]},
                            {"_id": 0},
                        )
                        if latest:
                            await _wh_service.send_email_event("email.replied", latest)
                except Exception:
                    pass
                break
        return replies_found
