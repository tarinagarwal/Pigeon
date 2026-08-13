"""Email sending, preview, and test routes"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
import re
import uuid

from database import db
from services.gmail_service import GmailService
from services.email_service import EmailService
from services.email_templates import connection_test_email
from routes.schemas import (
    EmailPreviewRequest,
    TestEmailRequest,
    ConnectionTestEmailRequest,
    SMTPConnectionTestEmailRequest,
    SMTPTemplateTestRequest,
    SendReplyRequest,
)
from routes.dependencies import get_current_user
from services.plan_service import (
    MonthlySmtpQuotaExceeded,
    outbound_subscription_block_message,
    user_subscription_blocks_outbound,
)

router = APIRouter()

# Initialize services (will be injected from server.py)
gmail_service: GmailService = None
email_service: EmailService = None
plan_service = None
automation_service = None  # Optional; used to cancel campaign jobs when Gmail fails on send-batch

def init_email_services(gmail: GmailService, email: EmailService):
    """Initialize email services"""
    global gmail_service, email_service
    gmail_service = gmail
    email_service = email


def init_plan_service_for_emails(service):
    global plan_service
    plan_service = service

def init_automation_service_for_emails(service):
    """Optional: set automation service so send-batch can cancel jobs when Gmail fails."""
    global automation_service
    automation_service = service


async def _require_outbound_subscription_for_user(user_id: str) -> None:
    doc = await db.users.find_one(
        {"id": user_id},
        {"subscription_status": 1, "subscription_start": 1, "subscription_end": 1, "plan_id": 1},
    )
    if doc and user_subscription_blocks_outbound(doc):
        raise HTTPException(
            status_code=403,
            detail=outbound_subscription_block_message(doc) or "Sending is blocked for your subscription.",
        )


async def _assert_smtp_quota_for_inbox(user_id: str, inbox: dict) -> None:
    if not plan_service or not email_service:
        return
    if not EmailService.inbox_counts_against_smtp_monthly_quota(inbox):
        return
    try:
        await plan_service.assert_monthly_smtp_quota(user_id)
    except MonthlySmtpQuotaExceeded as e:
        raise HTTPException(status_code=403, detail=e.message) from e


async def _meter_after_send(
    *,
    user_id: str,
    inbox: dict,
    send_source: str,
    to_email: str,
    subject: str,
    message_id: Optional[str],
    template_id: Optional[str] = None,
) -> None:
    if not email_service:
        return
    try:
        await email_service.record_outbound_send_for_usage(
            user_id=user_id,
            sender_id=inbox["id"],
            send_source=send_source,
            to_email=to_email,
            subject=subject,
            inbox=inbox,
            message_id=message_id,
            template_id=template_id,
        )
    except Exception:
        pass


async def _inject_unsubscribe_url_for_template_test(user_id: str, subject: str, body: str) -> tuple:
    """Replace {{unsubscribe_url}} for test sends (same shape as real campaign links)."""
    if not email_service:
        return subject, body
    combined = f"{subject or ''} {body or ''}"
    if not re.search(r"\{\{?\s*unsubscribe_url\s*\}?\}", combined, re.IGNORECASE):
        return subject, body
    tracking_base = await email_service._get_tracking_base(user_id=user_id, domain_id=None)
    test_log_id = str(uuid.uuid4())
    unsub_url = f"{tracking_base}/api/unsubscribe/{test_log_id}"
    subject = EmailService._inject_unsubscribe_url_placeholder(subject or "", unsub_url)
    body = EmailService._inject_unsubscribe_url_placeholder(body or "", unsub_url)
    return subject, body

@router.post("/emails/preview")
async def preview_email(request: EmailPreviewRequest, user_id: str):
    """Preview email with placeholders replaced"""
    # Get template
    template = await db.templates.find_one({"id": request.template_id}, {"_id": 0})
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    
    # Get contact data or use sample data
    contact_data = {}
    if request.contact_id:
        contact = await db.contacts.find_one({"id": request.contact_id}, {"_id": 0})
        if contact:
            fn, ln = contact.get("first_name", "") or "", contact.get("last_name", "") or ""
            contact_data = {
                "first_name": fn,
                "firstName": fn,
                "last_name": ln,
                "lastName": ln,
                "email": contact.get("email", ""),
                "company": contact.get("company", ""),
                "industry": contact.get("industry", ""),
                **(contact.get("custom_fields", {}))
            }
    elif request.sample_data:
        contact_data = request.sample_data
    else:
        # Default sample data (include camelCase so {{firstName}} works in preview)
        contact_data = {
            "first_name": "John",
            "firstName": "John",
            "last_name": "Doe",
            "lastName": "Doe",
            "email": "john.doe@example.com",
            "company": "Acme Inc",
            "industry": "Technology"
        }
    
    # Spintax first (same order as campaign send), then placeholders
    subject = template["subject"]
    body = template["body"]
    if email_service:
        subject = email_service.parse_spintax(subject or "")
        body = email_service.parse_spintax(body or "")

    # Replace {{placeholder}} and {placeholder} formats
    for key, value in contact_data.items():
        subject = re.sub(r'\{\{' + key + r'\}\}', str(value), subject, flags=re.IGNORECASE)
        subject = re.sub(r'\{' + key + r'\}', str(value), subject, flags=re.IGNORECASE)
        body = re.sub(r'\{\{' + key + r'\}\}', str(value), body, flags=re.IGNORECASE)
        body = re.sub(r'\{' + key + r'\}', str(value), body, flags=re.IGNORECASE)

    return {
        "original_subject": template["subject"],
        "original_body": template["body"],
        "preview_subject": subject,
        "preview_body": body,
        "contact_data": contact_data,
        "template_name": template["name"]
    }

@router.post("/emails/send-test")
async def send_test_email(request: TestEmailRequest):
    """Send a test email to a specified address"""
    await _require_outbound_subscription_for_user(request.user_id)
    # Check Gmail connection
    is_connected = await gmail_service.is_connected(request.user_id)
    if not is_connected:
        raise HTTPException(status_code=400, detail="Gmail not connected. Please connect Gmail in Settings first.")
    
    # Get template
    template = await db.templates.find_one({"id": request.template_id}, {"_id": 0})
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    
    # Get contact data or use sample data
    contact_data = {}
    if request.contact_id:
        contact = await db.contacts.find_one({"id": request.contact_id}, {"_id": 0})
        if contact:
            fn, ln = contact.get("first_name", "") or "", contact.get("last_name", "") or ""
            name = (fn + " " + ln).strip() or fn or ln
            contact_data = {
                "first_name": fn,
                "firstName": fn,
                "last_name": ln,
                "lastName": ln,
                "name": name,
                "email": contact.get("email", ""),
                "company": contact.get("company", ""),
                "industry": contact.get("industry", ""),
                **(contact.get("custom_fields", {}))
            }
    elif request.sample_data:
        contact_data = request.sample_data
    else:
        # Default sample data (include camelCase and {{name}} so placeholders work)
        contact_data = {
            "first_name": "John",
            "firstName": "John",
            "last_name": "Doe",
            "lastName": "Doe",
            "name": "John Doe",
            "email": request.test_email,
            "company": "Acme Inc",
            "industry": "Technology",
        }
    
    # Optionally generate AI variation for test
    if getattr(request, "use_ai_variation", False) and getattr(request, "ai_provider", None) and getattr(request, "ai_prompt", None) and email_service:
        try:
            content = await email_service.generate_email_content_for_test(
                request.user_id, request.template_id, request.ai_provider, request.ai_prompt.strip(), contact_data
            )
            subject = content["subject"]
            body = content["body"]
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"AI variation failed: {str(e)}")
    else:
        subject = template["subject"]
        body = template["body"]
    # Determine sender inbox (used both for actual sending and for {{inbox_name}} / {{inbox_email}} placeholders)
    body_type = template.get("body_type", "html")
    sender_id = request.sender_id or request.user_id
    if sender_id == request.user_id:
        first_gmail = await db.inboxes.find_one({"user_id": request.user_id, "sender_type": "gmail"}, {"id": 1})
        if first_gmail:
            sender_id = first_gmail["id"]

    # Enrich contact_data with inbox-based placeholders so tests can use {{inbox_name}} / {{inbox_email}}
    inbox_email_for_placeholders = ""
    inbox_name_for_placeholders = ""
    try:
        if sender_id:
            inbox_doc = await db.inboxes.find_one({"id": sender_id}, {"email": 1, "sender_name": 1, "from_name": 1})
            if inbox_doc and inbox_doc.get("email"):
                inbox_email_for_placeholders = str(inbox_doc["email"]).strip()
                # Derive sender display name from the sending inbox email.
                inbox_name_for_placeholders = EmailService.get_effective_inbox_name(
                    inbox=inbox_doc,
                    inbox_email=inbox_email_for_placeholders,
                )
    except Exception:
        inbox_email_for_placeholders = ""
        inbox_name_for_placeholders = ""

    # Fallback for tests: if we couldn't resolve a sending inbox email,
    # at least use the test recipient email so placeholders don't stay literal.
    if not inbox_email_for_placeholders and getattr(request, "test_email", None):
        inbox_email_for_placeholders = str(request.test_email).strip()
        inbox_name_for_placeholders = EmailService.get_inbox_name_from_email(inbox_email_for_placeholders)
    if inbox_email_for_placeholders:
        contact_data.setdefault("inbox_email", inbox_email_for_placeholders)
        contact_data.setdefault("inboxEmail", inbox_email_for_placeholders)
    if inbox_name_for_placeholders:
        contact_data.setdefault("inbox_name", inbox_name_for_placeholders)
        contact_data.setdefault("inboxName", inbox_name_for_placeholders)

    # Always run spintax then placeholders (so AI output and template both get {{industry}}, {{name}}, {{inbox_name}}, etc. resolved)
    if email_service:
        subject = email_service.parse_spintax(subject or "")
        body = email_service.parse_spintax(body or "")
    for key, value in contact_data.items():
        esc = re.escape(key)
        subject = re.sub(r"\{\{" + esc + r"\}\}", str(value), subject, flags=re.IGNORECASE)
        subject = re.sub(r"\{" + esc + r"\}", str(value), subject, flags=re.IGNORECASE)
        body = re.sub(r"\{\{" + esc + r"\}\}", str(value), body, flags=re.IGNORECASE)
        body = re.sub(r"\{" + esc + r"\}", str(value), body, flags=re.IGNORECASE)

    # Hard fallback: directly replace inbox placeholders with resolved values
    if inbox_email_for_placeholders:
        for token in ("{{inbox_email}}", "{inbox_email}"):
            subject = subject.replace(token, inbox_email_for_placeholders)
            body = body.replace(token, inbox_email_for_placeholders)
    if inbox_name_for_placeholders:
        for token in ("{{inbox_name}}", "{inbox_name}"):
            subject = subject.replace(token, inbox_name_for_placeholders)
            body = body.replace(token, inbox_name_for_placeholders)

    subject, body = await _inject_unsubscribe_url_for_template_test(request.user_id, subject, body)

    # Add [TEST] prefix to subject
    subject = f"[TEST] {subject}"
    inbox_full = await db.inboxes.find_one({"id": sender_id, "user_id": request.user_id}) if sender_id else None
    if inbox_full:
        await _assert_smtp_quota_for_inbox(request.user_id, inbox_full)
    try:
        if inbox_full and inbox_full.get("gmail_auth_method") == "app_password" and email_service and getattr(email_service, "smtp_service", None):
            result = await email_service.smtp_service.send_email_via_smtp_gmail_app_password(
                sender_id, request.test_email, subject, body, None, None, None, body_type=body_type
            )
        else:
            result = await gmail_service.send_email(
                sender_id,
                request.user_id,
                request.test_email,
                subject,
                body,
                body_type=body_type,
            )
        if inbox_full:
            await _meter_after_send(
                user_id=request.user_id,
                inbox=inbox_full,
                send_source="template_test",
                to_email=request.test_email,
                subject=subject,
                message_id=result.get("message_id"),
                template_id=request.template_id,
            )
        return {
            "message": f"Test email sent successfully to {request.test_email}",
            "subject": subject,
            "to": request.test_email,
            "message_id": result.get("message_id")
        }
    except HTTPException:
        raise
    except MonthlySmtpQuotaExceeded as e:
        raise HTTPException(status_code=403, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to send test email: {str(e)}")


@router.post("/emails/send-connection-test")
async def send_connection_test_email(request: ConnectionTestEmailRequest):
    """Send a simple test email to verify connection using Gmail"""
    await _require_outbound_subscription_for_user(request.user_id)
    # Check Gmail connection (OAuth or app-password inbox)
    is_connected = await gmail_service.is_connected(request.user_id)
    gmail_inboxes = await db.inboxes.find({"user_id": request.user_id, "sender_type": "gmail", "gmail_auth_method": "app_password"}, {"id": 1}).to_list(None)
    if not is_connected and not gmail_inboxes:
        raise HTTPException(
            status_code=400,
            detail="Gmail not connected. Please connect Gmail in Settings first.",
        )

    subject, body_plain, _ = connection_test_email()

    sender_id = request.sender_id or request.user_id
    if sender_id == request.user_id:
        first_gmail = await db.inboxes.find_one({"user_id": request.user_id, "sender_type": "gmail"}, {"id": 1})
        if first_gmail:
            sender_id = first_gmail["id"]
    inbox_full = await db.inboxes.find_one({"id": sender_id, "user_id": request.user_id}) if sender_id else None
    if inbox_full:
        await _assert_smtp_quota_for_inbox(request.user_id, inbox_full)
    try:
        if inbox_full and inbox_full.get("gmail_auth_method") == "app_password" and email_service and getattr(email_service, "smtp_service", None):
            result = await email_service.smtp_service.send_email_via_smtp_gmail_app_password(
                sender_id, request.to_email, subject, body_plain, None, None, None, body_type="plain"
            )
        else:
            result = await gmail_service.send_email(
                sender_id,
                request.user_id,
                request.to_email,
                subject,
                body_plain,
                body_type="plain",
            )
        if inbox_full:
            await _meter_after_send(
                user_id=request.user_id,
                inbox=inbox_full,
                send_source="connection_test",
                to_email=request.to_email,
                subject=subject,
                message_id=result.get("message_id"),
            )
        return {
            "message": f"Test email sent successfully to {request.to_email}",
            "subject": subject,
            "to": request.to_email,
            "message_id": result.get("message_id"),
        }
    except HTTPException:
        raise
    except MonthlySmtpQuotaExceeded as e:
        raise HTTPException(status_code=403, detail=e.message) from e
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to send test email: {str(e)}",
        )


@router.post("/emails/send-smtp-connection-test")
async def send_smtp_connection_test_email(request: SMTPConnectionTestEmailRequest):
    """Send a simple test email to verify SMTP inbox connection"""
    await _require_outbound_subscription_for_user(request.user_id)
    # Ensure inbox exists and belongs to user
    inbox = await db.inboxes.find_one({"id": request.inbox_id})
    if not inbox:
        raise HTTPException(status_code=404, detail="Inbox not found")
    if inbox.get("user_id") != request.user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if inbox.get("sender_type") != "smtp":
        raise HTTPException(status_code=400, detail="Inbox is not configured for SMTP")

    if not email_service or not getattr(email_service, "smtp_service", None):
        raise HTTPException(status_code=500, detail="SMTP service not configured")

    subject, body_plain, _ = connection_test_email()

    await _assert_smtp_quota_for_inbox(request.user_id, inbox)
    try:
        result = await email_service.smtp_service.send_email_via_smtp(
            request.inbox_id,
            request.to_email,
            subject,
            body_plain,
            body_type="plain",
        )
        await _meter_after_send(
            user_id=request.user_id,
            inbox=inbox,
            send_source="connection_test",
            to_email=request.to_email,
            subject=subject,
            message_id=result.get("message_id"),
        )
        return {
            "message": f"Test SMTP email sent successfully to {request.to_email}",
            "subject": subject,
            "to": request.to_email,
            "message_id": result.get("message_id"),
        }
    except HTTPException:
        raise
    except MonthlySmtpQuotaExceeded as e:
        raise HTTPException(status_code=403, detail=e.message) from e
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to send SMTP test email: {str(e)}",
        )


@router.post("/emails/send-smtp-test")
async def send_smtp_template_test_email(request: SMTPTemplateTestRequest):
    """Send a template test email via SMTP inbox (same placeholder replacement as Gmail test)."""
    await _require_outbound_subscription_for_user(request.user_id)
    inbox = await db.inboxes.find_one({"id": request.inbox_id})
    if not inbox:
        raise HTTPException(status_code=404, detail="Inbox not found")
    if inbox.get("user_id") != request.user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if inbox.get("sender_type") != "smtp":
        raise HTTPException(status_code=400, detail="Inbox is not configured for SMTP")

    if not email_service or not getattr(email_service, "smtp_service", None):
        raise HTTPException(status_code=500, detail="SMTP service not configured")

    template = await db.templates.find_one({"id": request.template_id}, {"_id": 0})
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    contact_data = {}
    if request.contact_id:
        contact = await db.contacts.find_one({"id": request.contact_id}, {"_id": 0})
        if contact:
            fn, ln = contact.get("first_name", "") or "", contact.get("last_name", "") or ""
            name = (fn + " " + ln).strip() or fn or ln
            contact_data = {
                "first_name": fn,
                "firstName": fn,
                "last_name": ln,
                "lastName": ln,
                "name": name,
                "email": contact.get("email", ""),
                "company": contact.get("company", ""),
                "industry": contact.get("industry", ""),
                **(contact.get("custom_fields", {}))
            }
    elif request.sample_data:
        contact_data = request.sample_data
    else:
        contact_data = {
            "first_name": "John",
            "firstName": "John",
            "last_name": "Doe",
            "lastName": "Doe",
            "name": "John Doe",
            "email": request.test_email,
            "company": "Acme Inc",
            "industry": "Technology",
        }

    # Optionally generate AI variation for test
    if getattr(request, "use_ai_variation", False) and getattr(request, "ai_provider", None) and getattr(request, "ai_prompt", None) and email_service:
        try:
            content = await email_service.generate_email_content_for_test(
                request.user_id, request.template_id, request.ai_provider, request.ai_prompt.strip(), contact_data
            )
            subject = content["subject"]
            body = content["body"]
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"AI variation failed: {str(e)}")
    else:
        subject = template["subject"]
        body = template["body"]
    # Always run spintax then placeholders
    if email_service:
        subject = email_service.parse_spintax(subject or "")
        body = email_service.parse_spintax(body or "")
    for key, value in contact_data.items():
        esc = re.escape(key)
        subject = re.sub(r"\{\{" + esc + r"\}\}", str(value), subject, flags=re.IGNORECASE)
        subject = re.sub(r"\{" + esc + r"\}", str(value), subject, flags=re.IGNORECASE)
        body = re.sub(r"\{\{" + esc + r"\}\}", str(value), body, flags=re.IGNORECASE)
        body = re.sub(r"\{" + esc + r"\}", str(value), body, flags=re.IGNORECASE)

    # Hard fallback: directly replace inbox placeholders using SMTP inbox email
    smtp_inbox_email = str(inbox.get("email") or "").strip()
    smtp_inbox_name = ""
    if smtp_inbox_email:
        smtp_inbox_name = EmailService.get_effective_inbox_name(inbox=inbox, inbox_email=smtp_inbox_email)
        for token in ("{{inbox_email}}", "{inbox_email}"):
            subject = subject.replace(token, smtp_inbox_email)
            body = body.replace(token, smtp_inbox_email)
        if smtp_inbox_name:
            for token in ("{{inbox_name}}", "{inbox_name}"):
                subject = subject.replace(token, smtp_inbox_name)
                body = body.replace(token, smtp_inbox_name)

    subject, body = await _inject_unsubscribe_url_for_template_test(request.user_id, subject, body)

    subject = f"[TEST] {subject}"
    body_type = template.get("body_type", "html")

    await _assert_smtp_quota_for_inbox(request.user_id, inbox)
    try:
        result = await email_service.smtp_service.send_email_via_smtp(
            request.inbox_id,
            request.test_email,
            subject,
            body,
            body_type=body_type,
        )
        await _meter_after_send(
            user_id=request.user_id,
            inbox=inbox,
            send_source="template_test",
            to_email=request.test_email,
            subject=subject,
            message_id=result.get("message_id"),
            template_id=request.template_id,
        )
        return {
            "message": f"Test email sent successfully to {request.test_email}",
            "subject": subject,
            "to": request.test_email,
            "message_id": result.get("message_id")
        }
    except HTTPException:
        raise
    except MonthlySmtpQuotaExceeded as e:
        raise HTTPException(status_code=403, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to send SMTP test email: {str(e)}")


@router.post("/emails/generate")
async def generate_email(
    user_id: str,
    contact_id: str,
    template_id: str,
    provider: str = "openai"
):
    """Generate AI email content"""
    try:
        content = await email_service.generate_email_content(
            user_id, contact_id, template_id, provider
        )
        return content
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/emails/send")
async def send_email(
    user_id: str,
    campaign_id: str,
    contact_id: str,
    template_id: str,
    subject: str,
    body: str
):
    """Send individual email"""
    await _require_outbound_subscription_for_user(user_id)
    template = await db.templates.find_one({"id": template_id}, {"body_type": 1})
    body_type = template.get("body_type", "html") if template else "html"
    try:
        result = await email_service.send_email(
            user_id, campaign_id, contact_id, template_id, subject, body, body_type
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/campaigns/{campaign_id}/send-batch")
async def send_campaign_batch(campaign_id: str):
    """Send batch of emails for campaign (respects daily limit). On Gmail send failure, campaign is paused and pending jobs are cancelled."""
    try:
        result = await email_service.send_campaign_batch(campaign_id)
        if result.get("gmail_send_failed_stop_campaign") and automation_service:
            await automation_service.cancel_campaign_jobs(campaign_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/emails/check-replies")
async def check_replies(user_id: str):
    """Check for replies to sent emails"""
    try:
        result = await email_service.check_replies(user_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/emails/reply")
async def send_reply(request: SendReplyRequest, current_user: dict = Depends(get_current_user)):
    """Send a reply to an inbox email (uses authenticated user)."""
    if request.user_id != current_user.get("id"):
        raise HTTPException(status_code=403, detail="User ID does not match authenticated user")
    try:
        result = await email_service.send_reply(
            current_user["id"],
            request.email_log_id,
            request.subject,
            request.body,
            request.cc,
        )
        return result
    except MonthlySmtpQuotaExceeded as e:
        raise HTTPException(status_code=403, detail=e.message) from e
    except Exception as e:
        msg = str(e)
        if "not found" in msg.lower() or "Email not found" in msg:
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=400, detail=msg)


@router.get("/emails/default-provider")
async def get_default_email_provider():
    """Get the default email provider setting (public)."""
    return {
        "provider": "sendgrid",
        "description": "SendGrid API"
    }

