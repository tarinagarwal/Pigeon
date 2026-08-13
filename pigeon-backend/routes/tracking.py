"""Email tracking routes"""
from datetime import datetime, timezone

from fastapi import APIRouter, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
import base64
import os
from typing import Optional

from database import db
from services.tracking_service import TrackingService
from services.workflow_service import WorkflowService

router = APIRouter()

# Initialize services (injected from server.py)
tracking_service: TrackingService = None
workflow_service: Optional[WorkflowService] = None
lifecycle_automation_service = None


def init_tracking_service(service: TrackingService):
    """Initialize tracking service"""
    global tracking_service
    tracking_service = service


def init_workflow_service(service: WorkflowService):
    """Initialize workflow service for workflow triggers on open/click."""
    global workflow_service
    workflow_service = service


def init_lifecycle_automation_service(service):
    """Initialize lifecycle automation service for lifecycle tracking links."""
    global lifecycle_automation_service
    lifecycle_automation_service = service


@router.get("/track/pixel/{pixel_id}")
async def track_pixel(pixel_id: str):
    """Track email open via pixel"""
    await tracking_service.track_open(pixel_id)

    # Trigger workflows listening for onEmailOpened
    if workflow_service:
        pixel = await db.tracking_pixels.find_one({"id": pixel_id})
        if pixel and pixel.get("email_log_id"):
            log = await db.email_logs.find_one({"id": pixel["email_log_id"]})
            if log:
                await workflow_service.trigger_matching_workflows(
                    event_type="onEmailOpened",
                    trigger_context={
                        "email_log_id": log["id"],
                        "campaign_id": log.get("campaign_id"),
                        "contact_id": log.get("contact_id"),
                    },
                )

    # Return 1x1 transparent pixel
    pixel_data = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    )
    return Response(content=pixel_data, media_type="image/png")


@router.get("/track/click/{link_id}")
async def track_click(link_id: str):
    """Track link click and redirect"""
    original_url = await tracking_service.track_click(link_id)
    # (Optional) could add an onEmailClicked trigger in future, similar to onEmailOpened.
    return RedirectResponse(url=original_url)


@router.get("/track/lifecycle/pixel/{pixel_id}")
async def track_lifecycle_pixel(pixel_id: str):
    """Track lifecycle automation email opens."""
    if lifecycle_automation_service:
        try:
            await lifecycle_automation_service.track_open(pixel_id)
        except Exception:
            pass
    pixel_data = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    )
    return Response(content=pixel_data, media_type="image/png")


@router.get("/track/lifecycle/click/{click_token}")
async def track_lifecycle_click(click_token: str):
    """Track lifecycle automation CTA clicks and redirect."""
    target = None
    if lifecycle_automation_service:
        try:
            target = await lifecycle_automation_service.track_click(click_token)
        except Exception:
            target = None
    if not target:
        target = (os.getenv("FRONTEND_URL") or "http://localhost:8080").rstrip("/")
    return RedirectResponse(url=target)


async def _do_unsubscribe(email_log_id: str) -> None:
    """Mark the contact associated with email_log_id as unsubscribed."""
    now = datetime.now(timezone.utc)
    log = await db.email_logs.find_one(
        {"id": email_log_id},
        {"contact_id": 1, "campaign_id": 1, "user_id": 1},
    )
    if not log:
        return
    contact_id = log.get("contact_id")
    campaign_id = log.get("campaign_id")
    if not contact_id:
        return
    await db.contacts.update_one(
        {"id": contact_id},
        {"$set": {"status": "unsubscribed", "manual_unblock": False}},
    )
    if campaign_id:
        await db.campaign_contacts.update_one(
            {"campaign_id": campaign_id, "contact_id": contact_id},
            {
                "$set": {"status": "unsubscribed", "last_activity": now, "updated_at": now},
                "$push": {
                    "events": {
                        "type": "unsubscribed",
                        "timestamp": now,
                        "metadata": {
                            "email_log_id": email_log_id,
                            "source": "list_unsubscribe_header",
                        },
                    }
                },
            },
        )


@router.get("/unsubscribe/{email_log_id}", response_class=HTMLResponse)
async def unsubscribe_page(email_log_id: str):
    """Show a one-click unsubscribe confirmation page."""
    return HTMLResponse(content=f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribe</title>
  <style>
    body {{ font-family: Arial, sans-serif; display: flex; justify-content: center;
           align-items: center; min-height: 100vh; margin: 0; background: #f9fafb; }}
    .card {{ background: white; padding: 40px; border-radius: 8px;
             box-shadow: 0 1px 4px rgba(0,0,0,0.1); text-align: center;
             max-width: 400px; width: 90%; }}
    h2 {{ color: #111; margin-bottom: 12px; }}
    p {{ color: #555; margin-bottom: 24px; }}
    button {{ background: #e53e3e; color: white; border: none; padding: 12px 28px;
              border-radius: 6px; font-size: 16px; cursor: pointer; }}
    button:hover {{ background: #c53030; }}
  </style>
</head>
<body>
  <div class="card">
    <h2>Unsubscribe</h2>
    <p>Click the button below to unsubscribe from future emails.</p>
    <form method="POST" action="/api/unsubscribe/{email_log_id}">
      <button type="submit">Unsubscribe me</button>
    </form>
  </div>
</body>
</html>""")


@router.post("/unsubscribe/{email_log_id}")
async def unsubscribe_one_click(email_log_id: str, request: Request):
    """
    Handle unsubscribe requests:
    - RFC 8058 one-click POST from email clients (triggered by List-Unsubscribe-Post header)
    - Form POST from our unsubscribe confirmation page
    """
    await _do_unsubscribe(email_log_id)
    content_type = request.headers.get("content-type", "")
    if "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
        return HTMLResponse(content="""<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Unsubscribed</title>
  <style>
    body { font-family: Arial, sans-serif; display: flex; justify-content: center;
           align-items: center; min-height: 100vh; margin: 0; background: #f9fafb; }
    .card { background: white; padding: 40px; border-radius: 8px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.1); text-align: center;
            max-width: 400px; width: 90%; }
    h2 { color: #38a169; }
    p { color: #555; }
  </style>
</head>
<body>
  <div class="card">
    <h2>You've been unsubscribed</h2>
    <p>You will no longer receive emails from this sender.</p>
  </div>
</body>
</html>""")
    # JSON response for email client one-click (RFC 8058)
    return JSONResponse(content={"ok": True})


@router.get("/lifecycle/unsubscribe/{unsubscribe_token}", response_class=HTMLResponse)
async def lifecycle_unsubscribe_page(unsubscribe_token: str):
    """Show unsubscribe confirmation for lifecycle automation emails."""
    return HTMLResponse(content=f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribe</title>
  <style>
    body {{ font-family: Arial, sans-serif; display: flex; justify-content: center;
           align-items: center; min-height: 100vh; margin: 0; background: #f9fafb; }}
    .card {{ background: white; padding: 40px; border-radius: 8px;
             box-shadow: 0 1px 4px rgba(0,0,0,0.1); text-align: center;
             max-width: 420px; width: 90%; }}
    h2 {{ color: #111; margin-bottom: 12px; }}
    p {{ color: #555; margin-bottom: 24px; }}
    button {{ background: #e53e3e; color: white; border: none; padding: 12px 28px;
              border-radius: 6px; font-size: 16px; cursor: pointer; }}
  </style>
</head>
<body>
  <div class="card">
    <h2>Unsubscribe from lifecycle emails</h2>
    <p>Confirm to stop trial and onboarding lifecycle emails from Pigeon.</p>
    <form method="POST" action="/api/lifecycle/unsubscribe/{unsubscribe_token}">
      <button type="submit">Unsubscribe me</button>
    </form>
  </div>
</body>
</html>""")


@router.post("/lifecycle/unsubscribe/{unsubscribe_token}")
async def lifecycle_unsubscribe(unsubscribe_token: str, request: Request):
    """Handle lifecycle automation unsubscribe."""
    ok = False
    if lifecycle_automation_service:
        try:
            ok = await lifecycle_automation_service.unsubscribe(unsubscribe_token)
        except Exception:
            ok = False
    content_type = request.headers.get("content-type", "")
    if "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
        return HTMLResponse(content="""<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Unsubscribed</title>
  <style>
    body { font-family: Arial, sans-serif; display: flex; justify-content: center;
           align-items: center; min-height: 100vh; margin: 0; background: #f9fafb; }
    .card { background: white; padding: 40px; border-radius: 8px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.1); text-align: center;
            max-width: 420px; width: 90%; }
    h2 { color: #38a169; }
    p { color: #555; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Preference updated</h2>
    <p>You will no longer receive lifecycle automation emails.</p>
  </div>
</body>
</html>""")
    return JSONResponse(content={"ok": ok})
