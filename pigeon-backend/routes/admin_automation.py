"""Admin automation routes.

These endpoints expose CRUD operations for automation rules and system jobs
backed by AutomationService. They are protected by admin authentication and
permission checks.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from database import db
from services.automation_service import AutomationService
from routes.dependencies import get_current_admin, require_admin_permissions


router = APIRouter(prefix="/admin")

# This will be initialized from server.py
automation_service: Optional[AutomationService] = None


def init_automation_service(service: AutomationService):
    """Initialize the automation service from the application startup."""
    global automation_service
    automation_service = service


def _ensure_service() -> AutomationService:
    if automation_service is None:
        raise HTTPException(status_code=500, detail="Automation service not configured")
    return automation_service


@router.get(
    "/automation/rules",
    dependencies=[Depends(require_admin_permissions(["automation.read"]))],
)
async def list_automation_rules(current_admin: dict = Depends(get_current_admin)):
    service = _ensure_service()
    rules = await service.list_rules()
    return {"rules": rules}


@router.get(
    "/automation/rules/{rule_id}",
    dependencies=[Depends(require_admin_permissions(["automation.read"]))],
)
async def get_automation_rule(rule_id: str, current_admin: dict = Depends(get_current_admin)):
    service = _ensure_service()
    rule = await service.get_rule(rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Automation rule not found")
    return rule


@router.post(
    "/automation/rules",
    dependencies=[Depends(require_admin_permissions(["automation.write"]))],
)
async def create_automation_rule(
    payload: dict,
    current_admin: dict = Depends(get_current_admin),
):
    service = _ensure_service()
    rule = await service.create_rule(payload, admin_id=current_admin["id"])
    return rule


@router.put(
    "/automation/rules/{rule_id}",
    dependencies=[Depends(require_admin_permissions(["automation.write"]))],
)
async def update_automation_rule(
    rule_id: str,
    payload: dict,
    current_admin: dict = Depends(get_current_admin),
):
    service = _ensure_service()
    updated = await service.update_rule(rule_id, payload, admin_id=current_admin["id"])
    if not updated:
        raise HTTPException(status_code=404, detail="Automation rule not found")
    return updated


@router.delete(
    "/automation/rules/{rule_id}",
    dependencies=[Depends(require_admin_permissions(["automation.write"]))],
)
async def delete_automation_rule(
    rule_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    service = _ensure_service()
    deleted = await service.delete_rule(rule_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Automation rule not found")
    return {"deleted": True}


@router.post(
    "/automation/rules/{rule_id}/jobs",
    dependencies=[Depends(require_admin_permissions(["automation.write"]))],
)
async def create_job_for_rule(
    rule_id: str,
    scheduled_at: Optional[datetime] = Query(
        default=None,
        description="Optional schedule time; defaults to now if omitted.",
    ),
    current_admin: dict = Depends(get_current_admin),
):
    service = _ensure_service()
    job = await service.create_job_for_rule(rule_id=rule_id, scheduled_at=scheduled_at)
    return job


@router.get(
    "/automation/jobs",
    dependencies=[Depends(require_admin_permissions(["automation.read"]))],
)
async def list_automation_jobs(current_admin: dict = Depends(get_current_admin)):
    service = _ensure_service()
    jobs = await service.list_jobs()
    return {"jobs": jobs}


@router.get(
    "/automation/jobs/{job_id}",
    dependencies=[Depends(require_admin_permissions(["automation.read"]))],
)
async def get_automation_job(job_id: str, current_admin: dict = Depends(get_current_admin)):
    service = _ensure_service()
    job = await service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Automation job not found")
    return job


@router.get(
    "/automation/jobs/{job_id}/runs",
    dependencies=[Depends(require_admin_permissions(["automation.read"]))],
)
async def list_automation_job_runs(job_id: str, current_admin: dict = Depends(get_current_admin)):
    """List admin log entries (job runs) for this job, including error logs when a batch failed."""
    service = _ensure_service()
    job = await service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Automation job not found")
    runs = await service.list_job_runs(job_id)
    return {"job_id": job_id, "runs": runs}


@router.post(
    "/automation/jobs/{job_id}/stop",
    dependencies=[Depends(require_admin_permissions(["automation.write"]))],
)
async def force_stop_automation_job(
    job_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    """Force stop a pending or running automation job (marks it as cancelled).
    For send_campaign_batch jobs, schedules a new batch in 5 minutes if the campaign is still active."""
    service = _ensure_service()
    job = await service.force_stop_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Automation job not found")
    # If send_campaign_batch and campaign still active, schedule new job in 5 minutes (same as user Stop)
    if job.get("job_type") == "send_campaign_batch":
        campaign_id = (job.get("action_config") or {}).get("campaign_id")
        if campaign_id:
            campaign = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0, "status": 1})
            if campaign and campaign.get("status") == "active":
                next_at = datetime.now(timezone.utc) + timedelta(minutes=5)
                await service.create_campaign_batch_job(campaign_id, scheduled_at=next_at)
    return job

