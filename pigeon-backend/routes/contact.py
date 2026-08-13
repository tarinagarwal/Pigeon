"""Public contact form submission (no auth)."""

from fastapi import APIRouter

from database import db
from models import ContactSubmission
from routes.schemas import ContactFormSubmitRequest
from services.slack_service import notify_contact_submission

router = APIRouter()


@router.post("/contact")
async def submit_contact_form(payload: ContactFormSubmitRequest):
    """Submit the website contact form. No authentication required."""
    submission = ContactSubmission(
        name=payload.name.strip(),
        email=payload.email.strip().lower(),
        subject=payload.subject.strip(),
        message=payload.message.strip(),
        company=payload.company.strip() if payload.company else None,
        phone=payload.phone.strip() if payload.phone else None,
    )
    doc = submission.model_dump()
    await db.contact_submissions.insert_one(doc)
    doc.pop("_id", None)
    # Notify Slack (best-effort; do not fail the request)
    await notify_contact_submission(
        name=submission.name,
        email=submission.email,
        subject=submission.subject,
        message=submission.message,
        company=submission.company,
        phone=submission.phone,
    )
    return {"message": "Thank you for your message. We'll get back to you soon.", "id": submission.id}
