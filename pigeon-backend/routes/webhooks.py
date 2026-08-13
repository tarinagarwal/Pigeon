"""Webhook endpoints (no auth). SendGrid Inbound Parse POSTs here."""
import json
import os
import re
import logging
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Request, HTTPException
from starlette.responses import JSONResponse

from database import db
from services.workflow_service import WorkflowService

router = APIRouter()
logger = logging.getLogger(__name__)

_smtp_service = None
_workflow_service: WorkflowService | None = None
lifecycle_automation_service = None


def init_smtp_service(service):
    global _smtp_service
    _smtp_service = service


def init_workflow_service(service: WorkflowService):
    """Initialize workflow service so inbound replies can trigger workflows."""
    global _workflow_service
    _workflow_service = service


def init_lifecycle_automation_service(service):
    """Initialize lifecycle automation service for suppression updates."""
    global lifecycle_automation_service
    lifecycle_automation_service = service


def _parse_attachment_info(form: dict) -> list:
    """Extract attachment metadata from SendGrid attachment-info JSON. Returns list of {filename, type}."""
    result = []
    raw = form.get("attachment-info")
    if not raw:
        return result
    try:
        info = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(info, dict):
            return result
        for key in sorted(info.keys()):
            if key.startswith("attachment") and key[10:].isdigit():
                entry = info[key]
                if isinstance(entry, dict):
                    filename = entry.get("filename") or entry.get("name") or "attachment"
                    result.append({"filename": filename, "type": entry.get("type") or ""})
    except (json.JSONDecodeError, TypeError):
        pass
    return result


def _normalize_msg_id(msg_id: str) -> str:
    """Normalize message id for matching (strip angle brackets)."""
    if not msg_id:
        return ""
    s = (msg_id or "").strip()
    if s.startswith("<") and s.endswith(">"):
        s = s[1:-1]
    return s


def _parse_reply_ids_from_headers(headers_str: str) -> set:
    """Parse In-Reply-To and References from raw headers string into set of normalized message ids."""
    ids = set()
    if not headers_str:
        return ids
    in_reply_to = ""
    references = ""
    for line in headers_str.split("\n"):
        line = line.strip()
        if "\n" in line:
            continue
        if line.lower().startswith("in-reply-to:"):
            in_reply_to = line[12:].strip()
        elif line.lower().startswith("references:"):
            references = line[11:].strip()
    for raw in (in_reply_to, references):
        for part in (raw or "").replace("\r", " ").replace("\n", " ").split():
            part = part.strip().strip("<>")
            if part:
                ids.add(part)
    return ids


def _normalize_subject(subject: str) -> str:
    """Strip Re:, Fwd:, whitespace for matching."""
    if not subject:
        return ""
    s = re.sub(r"^\s*(Re:\s*|Fwd:\s*)+", "", subject, flags=re.IGNORECASE).strip()
    return s


def _extract_email_from_to_field(to_field: str) -> str:
    """
    Extract a single recipient email from the 'to' field for ownership resolution.
    Handles: 'user@domain.com', 'Name <user@domain.com>', and comma-separated lists.
    """
    if not to_field or not to_field.strip():
        return ""
    s = to_field.strip()
    # Take first address if comma-separated (multiple recipients)
    if "," in s:
        s = s.split(",")[0].strip()
    # Extract from "Display Name <email@domain.com>"
    match = re.search(r"<([^>]+)>", s)
    if match:
        return match.group(1).strip().lower()
    return s.lower()


async def _resolve_user_and_ownership(to_address: str):
    """
    Resolve user_id, inbox_id, domain_id from recipient address.
    Used so ALL inbound mail to your domain(s) is stored and shown under Incoming domain mail,
    not only replies to campaigns (campaign reply linking is done separately).
    Returns (user_id, inbox_id, domain_id) or (None, None, None).
    """
    email = _extract_email_from_to_field(to_address)
    if not email or "@" not in email:
        return None, None, None
    try:
        local, host = email.split("@", 1)
        host = host.strip().rstrip(">").strip()  # in case of trailing '>'
    except ValueError:
        return None, None, None
    if not host:
        return None, None, None
    host = host.lower()
    # Match exact inbox email (e.g. support@company.com in inboxes table)
    inbox = await db.inboxes.find_one({"email": {"$regex": "^" + re.escape(email) + "$", "$options": "i"}})
    if inbox:
        return inbox.get("user_id"), inbox.get("id"), inbox.get("domain_id")
    # Match domain so any address @yourdomain.com is owned by you (catch-all / inbound parse)
    domain = await db.domains.find_one({"domain": {"$regex": "^" + re.escape(host) + "$", "$options": "i"}})
    if domain:
        return domain.get("user_id"), None, domain.get("id")
    return None, None, None


@router.post("/sendgrid/inbound")
async def sendgrid_inbound(request: Request):
    """
    Receive parsed email from SendGrid Inbound Parse. No auth; verify via SENDGRID_INBOUND_VERIFY_TOKEN if set.
    Stores EVERY incoming email in inbound_messages (so Incoming domain mail shows all mail to your domain(s),
    not only campaign replies). If the message is a reply to a campaign, we also link it to the matching email_log.
    """
    try:
        body = await request.body()
        content_type = request.headers.get("content-type", "")
        form = {}
        attachment_contents = []
        if "application/x-www-form-urlencoded" in content_type:
            from urllib.parse import parse_qs
            parsed = parse_qs(body.decode("utf-8", errors="replace"))
            form = {k: (v[0] if v else "") for k, v in parsed.items()}
        elif "multipart/form-data" in content_type:
            form_data = await request.form()
            form = {}
            attachment_contents = []  # bytes per attachment, in order (attachment1, attachment2, ...)
            for k in sorted(form_data.keys()):
                v = form_data.get(k)
                if isinstance(v, str):
                    form[k] = v
                elif v is not None and getattr(v, "file", None):
                    if k.startswith("attachment") and k != "attachments" and k != "attachment-info" and k[10:].isdigit():
                        try:
                            v.file.seek(0)
                            attachment_contents.append(v.file.read())
                        except Exception:
                            attachment_contents.append(b"")
                    else:
                        try:
                            v.file.seek(0)
                            form[k] = v.file.read().decode("utf-8", errors="replace")
                        except Exception:
                            form[k] = ""
                else:
                    form[k] = str(v) if v is not None else ""
        else:
            logger.warning("SendGrid inbound: unexpected content-type %s", content_type)
            return JSONResponse(content={"ok": False}, status_code=200)

        verify_token = os.getenv("SENDGRID_INBOUND_VERIFY_TOKEN")
        if verify_token:
            supplied = form.get("token") or request.headers.get("X-SendGrid-Verify-Token", "")
            if supplied != verify_token:
                raise HTTPException(status_code=401, detail="Invalid or missing verification token")

        to_addr = form.get("to", "").strip()
        from_addr = form.get("from", "").strip()
        subject = form.get("subject", "").strip()
        text = form.get("text", "").strip()
        html = form.get("html", "").strip()
        headers_str = form.get("headers", "")

        user_id, inbox_id, domain_id = await _resolve_user_and_ownership(to_addr)
        if not user_id:
            logger.info("SendGrid inbound: no owner for to=%s, storing with null user_id", to_addr)
        now = datetime.now(timezone.utc)
        msg_id = str(uuid.uuid4())
        attachment_list = _parse_attachment_info(form)
        # spam_score / spam_report are sent by SendGrid when "Check incoming emails for spam" is enabled on the Inbound Parse host
        spam_score_raw = form.get("spam_score", "").strip()
        spam_report_str = form.get("spam_report", "").strip() or None
        spam_score = float(spam_score_raw) if spam_score_raw else None
        # Thread: same conversation (Gmail-style). Use In-Reply-To/References to find parent thread.
        reply_ids = _parse_reply_ids_from_headers(headers_str)
        thread_id = msg_id
        if reply_ids and user_id:
            reply_ids_expanded = set(reply_ids)
            for mid in reply_ids:
                reply_ids_expanded.add(f"<{mid}>")
                n = _normalize_msg_id(mid)
                if n:
                    reply_ids_expanded.add(n)
                    reply_ids_expanded.add(f"<{n}>")
            existing = await db.inbound_messages.find_one(
                {"user_id": user_id, "$or": [{"message_id": {"$in": list(reply_ids_expanded)}}, {"id": {"$in": list(reply_ids)}}]},
                {"thread_id": 1},
            )
            if existing and existing.get("thread_id"):
                thread_id = existing["thread_id"]
        doc = {
            "id": msg_id,
            "to": to_addr,
            "from": from_addr,
            "subject": subject,
            "body_text": text,
            "body_html": html or None,
            "received_at": now,
            "user_id": user_id or "",
            "inbox_id": inbox_id,
            "domain_id": domain_id,
            "message_id": form.get("Message-ID", "").strip() or None,
            "headers": headers_str[:2000] if headers_str else None,
            "attachments": attachment_list,
            "has_attachment": len(attachment_list) > 0,
            "spam_score": spam_score,
            "spam_report": spam_report_str,
            "thread_id": thread_id,
        }
        await db.inbound_messages.insert_one(doc)

        # Forward email with attachments to user's registered email via SMTP (we don't store attachment content)
        if user_id and attachment_contents and _smtp_service:
            user = await db.users.find_one({"id": user_id}, {"email": 1})
            if user and user.get("email"):
                attachments_for_forward = []
                from_lower = (from_addr or "").strip().lower()
                skip_all_attachments_for_sender = "dmarc" in from_lower

                for i in range(min(len(attachment_contents), len(attachment_list))):
                    if skip_all_attachments_for_sender:
                        # Do not forward any attachments for DMARC-related senders
                        continue
                    meta = attachment_list[i]
                    fn = (meta.get("filename") or f"attachment_{i + 1}").strip()
                    ct = meta.get("type") or "application/octet-stream"
                    # Skip attachments whose filenames clearly look like DMARC reports
                    if "dmarc" in fn.lower():
                        continue
                    attachments_for_forward.append((fn, attachment_contents[i], ct))
                try:
                    await _smtp_service.send_app_notification_email_with_attachments(
                        to_email=user["email"],
                        subject=f"Fwd: {subject}" if subject else "Forwarded email",
                        body_plain=text or "(no plain text)",
                        body_html=html,
                        attachments=attachments_for_forward,
                    )
                    logger.info("Forwarded inbound email with %s attachment(s) to user %s", len(attachments_for_forward), user_id)
                except Exception as e:
                    logger.warning("Failed to forward inbound email with attachments to user %s: %s", user_id, e)

        reply_body = text or html or ""
        reply_ids = _parse_reply_ids_from_headers(headers_str)
        matched_log = None

        # 1) Match by original sent message id (first reply from contact)
        if reply_ids and user_id:
            for mid in reply_ids:
                log = await db.email_logs.find_one(
                    {
                        "user_id": user_id,
                        "status": {"$ne": "replied"},
                        "$or": [
                            {"smtp_message_id": mid},
                            {"smtp_message_id": f"<{mid}>"},
                            {"gmail_message_id": mid},
                        ],
                    }
                )
                if log:
                    matched_log = log
                    break
                normalized = _normalize_msg_id(mid)
                if normalized:
                    log = await db.email_logs.find_one(
                        {
                            "user_id": user_id,
                            "status": {"$ne": "replied"},
                            "$or": [
                                {"smtp_message_id": normalized},
                                {"smtp_message_id": f"<{normalized}>"},
                                {"gmail_message_id": normalized},
                            ],
                        }
                    )
                    if log:
                        matched_log = log
                        break

        # 2) Match by our reply message id (contact replying again to our reply - threading)
        if not matched_log and reply_ids and user_id:
            reply_ids_expanded = set()
            for mid in reply_ids:
                reply_ids_expanded.add(mid)
                reply_ids_expanded.add(f"<{mid}>")
                n = _normalize_msg_id(mid)
                if n:
                    reply_ids_expanded.add(n)
                    reply_ids_expanded.add(f"<{n}>")
            log = await db.email_logs.find_one(
                {"user_id": user_id, "thread_messages.message_id": {"$in": list(reply_ids_expanded)}},
                sort=[("replied_at", -1)],
            )
            if log:
                matched_log = log

        # 3) Fallback: match by contact + subject (first reply)
        if not matched_log and user_id and from_addr and to_addr:
            norm_subj = _normalize_subject(subject)
            if norm_subj:
                contact = await db.contacts.find_one({"user_id": user_id, "email": {"$regex": re.escape(from_addr), "$options": "i"}})
                if contact:
                    log = await db.email_logs.find_one(
                        {
                            "user_id": user_id,
                            "contact_id": contact["id"],
                            "status": {"$ne": "replied"},
                            "subject": {"$regex": re.escape(norm_subj), "$options": "i"},
                        },
                        sort=[("sent_at", -1)],
                    )
                    if log:
                        matched_log = log

        # Warmup send history: link inbound replies to warmup_sent (same mailbox idea as email_logs).
        if not matched_log and user_id:
            try:
                from services.warmup_inbound_sync import try_update_warmup_sent_from_inbound

                await try_update_warmup_sent_from_inbound(
                    db,
                    user_id=user_id,
                    inbox_id=inbox_id,
                    to_addr=to_addr,
                    from_addr=from_addr,
                    subject=subject,
                    reply_ids=reply_ids,
                    received_at=now,
                    inbound_message_id=msg_id,
                )
            except Exception as e:
                logger.warning("SendGrid inbound: warmup reply match failed: %s", e)

        if matched_log:
            # Append their reply to thread (Gmail-style threading); keep reply_body as latest for compat
            thread_entry = {
                "type": "their_reply",
                "body": reply_body[:50000],
                "at": now.isoformat(),
                "inbound_message_id": msg_id,
            }
            await db.email_logs.update_one(
                {"id": matched_log["id"], "user_id": matched_log["user_id"]},
                {
                    "$set": {
                        "status": "replied",
                        "replied_at": now,
                        "reply_body": reply_body[:50000],
                        "inbound_message_id": msg_id,
                    },
                    "$push": {"thread_messages": thread_entry},
                },
            )
            contact_id = matched_log.get("contact_id")
            campaign_id = matched_log.get("campaign_id")
            if contact_id:
                await db.contacts.update_one({"id": contact_id}, {"$set": {"status": "replied"}})
            if campaign_id and contact_id:
                await db.campaign_contacts.update_one(
                    {"campaign_id": campaign_id, "contact_id": contact_id},
                    {
                        "$set": {"status": "replied", "last_activity": now, "updated_at": now},
                        "$push": {
                            "events": {
                                "type": "replied",
                                "timestamp": now,
                                "metadata": {"source": "inbound_parse", "reply_body": reply_body[:500]},
                            }
                        },
                    },
                )
            logger.info("SendGrid inbound: linked to email_log id=%s", matched_log["id"])

            # Trigger workflows listening for onEmailReplied and outbound webhooks email.replied.
            try:
                if _workflow_service:
                    await _workflow_service.trigger_matching_workflows(
                        event_type="onEmailReplied",
                        trigger_context={
                            "email_log_id": matched_log["id"],
                            "campaign_id": campaign_id,
                            "contact_id": contact_id,
                        },
                    )

                # Best-effort webhook dispatch; never raise here.
                try:
                    from services.webhook_event_service import WebhookEventService  # local import
                    from server import webhook_event_service as _wh_service  # type: ignore

                    if isinstance(_wh_service, WebhookEventService):
                        # Reload latest email_log so webhook payload reflects updated status.
                        log = await db.email_logs.find_one(
                            {"id": matched_log["id"]},
                            {"_id": 0},
                        )
                        if log:
                            await _wh_service.send_email_event("email.replied", log)
                except Exception:
                    pass
            except Exception:
                logger.warning("SendGrid inbound: side-effect error for email_log id=%s", matched_log["id"])

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("SendGrid inbound webhook error: %s", e)
        return JSONResponse(content={"ok": False, "error": str(e)}, status_code=200)
    return JSONResponse(content={"ok": True}, status_code=200)


@router.post("/sendgrid/events")
async def sendgrid_events(request: Request):
    """
    Receive SendGrid Event Webhook (delivered, open, click, bounce, spamreport, etc.).
    No auth; configure this URL in SendGrid Mail Settings → Event Webhook.
    For spamreport (and bounce) we update email_log and campaign_contact so campaign stats can show spam/complaint rate.
    SendGrid includes custom_args (e.g. email_log_id) in each event when set on send.
    """
    try:
        body = await request.json()
    except Exception as e:
        logger.warning("SendGrid events: invalid JSON %s", e)
        return JSONResponse(content={"ok": False}, status_code=200)
    if not isinstance(body, list):
        body = [body] if body else []
    now = datetime.now(timezone.utc)
    for ev in body:
        if not isinstance(ev, dict):
            continue
        event_type = (ev.get("event") or "").strip().lower()
        if event_type not in ("spamreport", "bounce", "dropped"):
            continue
        if lifecycle_automation_service:
            try:
                provider_email = (ev.get("email") or "").strip().lower()
                if provider_email:
                    await lifecycle_automation_service.mark_provider_suppression(
                        provider_email,
                        reason="complaint" if event_type == "spamreport" else "hard_bounce",
                    )
            except Exception:
                logger.exception("Failed lifecycle suppression update from SendGrid event")
        email_log_id = (ev.get("email_log_id") or "").strip() or None
        if not email_log_id:
            continue
        log = await db.email_logs.find_one({"id": email_log_id}, {"_id": 0, "campaign_id": 1, "contact_id": 1, "user_id": 1, "status": 1})
        if not log:
            continue
        if event_type == "spamreport":
            await db.email_logs.update_one(
                {"id": email_log_id},
                {"$set": {"status": "complained", "complained_at": now, "updated_at": now}},
            )
            await db.campaign_contacts.update_one(
                {"campaign_id": log["campaign_id"], "contact_id": log["contact_id"]},
                {
                    "$set": {"status": "complained", "last_activity": now, "updated_at": now},
                    "$push": {
                        "events": {
                            "type": "complained",
                            "timestamp": now,
                            "metadata": {"email_log_id": email_log_id, "source": "sendgrid_webhook"},
                        }
                    },
                },
            )
            logger.info("SendGrid events: marked email_log %s as complained", email_log_id)
        elif event_type in ("bounce", "dropped"):
            await db.email_logs.update_one(
                {"id": email_log_id},
                {"$set": {"status": "failed", "error_message": ev.get("reason") or event_type, "updated_at": now}},
            )
            await db.campaign_contacts.update_one(
                {"campaign_id": log["campaign_id"], "contact_id": log["contact_id"]},
                {
                    "$set": {"status": "failed", "last_activity": now, "updated_at": now},
                    "$push": {
                        "events": {
                            "type": "failed",
                            "timestamp": now,
                            "metadata": {"email_log_id": email_log_id, "source": "sendgrid_webhook", "reason": ev.get("reason")},
                        }
                    },
                },
            )
            # Mark contact as blocked in global contacts after 3 failed attempts
            try:
                from services.contact_blocking import maybe_mark_contact_blocked_for_failures
                await maybe_mark_contact_blocked_for_failures(db, log["user_id"], log["contact_id"])
            except Exception:
                pass
    return JSONResponse(content={"ok": True}, status_code=200)
