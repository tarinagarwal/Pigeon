"""Campaign management routes"""
import asyncio
import logging
import re
from fastapi import APIRouter, HTTPException, Depends, Body, Query
from fastapi.responses import JSONResponse
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Set, List
import uuid

# Simple email format check for custom Reply-To
REPLY_TO_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

from database import db
from models import Campaign, Workflow
from routes.dependencies import get_current_user
from services.notification_service import notification_service
from services.email_templates import campaign_started as template_campaign_started, campaign_paused as template_campaign_paused
from services.workflow_service import WorkflowService
from services.plan_service import outbound_subscription_block_message, user_subscription_blocks_outbound

router = APIRouter()
LEAD_TRACKER_STATUSES = {
    "new",
    "contacted",
    "in_progress",
    "follow_up",
    "qualified",
    "disqualified",
}

# Injected from server.py
automation_service = None
email_service = None
plan_service = None
workflow_service: Optional[WorkflowService] = None
campaign_deliverability_service = None


def init_automation_service(service):
    """Initialize automation service for creating campaign batch jobs."""
    global automation_service
    automation_service = service


def init_campaign_email_service(service):
    """Initialize email service for campaign template compliance validation."""
    global email_service
    email_service = service


def init_plan_service(service):
    global plan_service
    plan_service = service


def init_workflow_service(service: WorkflowService):
    """Initialize workflow service so we can trigger workflows on campaign events."""
    global workflow_service
    workflow_service = service


def init_campaign_deliverability_service(service):
    """Initialize deliverability probe service (warmup receiver pool)."""
    global campaign_deliverability_service
    campaign_deliverability_service = service


async def _execute_deliverability_run(run_id: str, campaign_id: str) -> None:
    """Background task: run placement probes and persist result on campaign_deliverability_runs."""
    if campaign_deliverability_service is None:
        now = datetime.now(timezone.utc)
        await db.campaign_deliverability_runs.update_one(
            {"id": run_id},
            {"$set": {"status": "failed", "error": "Deliverability service unavailable", "completed_at": now, "updated_at": now}},
        )
        return
    now = datetime.now(timezone.utc)
    try:
        await db.campaign_deliverability_runs.update_one(
            {"id": run_id},
            {"$set": {"status": "running", "started_at": now, "updated_at": now}},
        )
        result = await campaign_deliverability_service.run_manual_for_campaign(campaign_id)
        done = datetime.now(timezone.utc)
        await db.campaign_deliverability_runs.update_one(
            {"id": run_id},
            {
                "$set": {
                    "status": "completed",
                    "result": result,
                    "error": None,
                    "completed_at": done,
                    "updated_at": done,
                }
            },
        )
    except ValueError as exc:
        done = datetime.now(timezone.utc)
        await db.campaign_deliverability_runs.update_one(
            {"id": run_id},
            {"$set": {"status": "failed", "error": str(exc), "completed_at": done, "updated_at": done}},
        )
    except Exception:
        logging.exception("Background deliverability run failed run_id=%s campaign_id=%s", run_id, campaign_id)
        done = datetime.now(timezone.utc)
        await db.campaign_deliverability_runs.update_one(
            {"id": run_id},
            {
                "$set": {
                    "status": "failed",
                    "error": "Failed to run deliverability test",
                    "completed_at": done,
                    "updated_at": done,
                }
            },
        )


def _get_campaign_template_ids(campaign: dict) -> list:
    """Extract all template IDs used by a campaign (from email_sequence or legacy template_ids).
    Supports snake_case (email_sequence, template_ids, template_id) and camelCase (emailSequence, templateIds, templateId)."""
    ids = set()
    raw_sequence = campaign.get("email_sequence") or campaign.get("emailSequence") or []
    if raw_sequence:
        for step in raw_sequence:
            tid = step.get("template_id") or step.get("templateId")
            if tid:
                ids.add(tid)
            for t in step.get("template_ids") or step.get("templateIds") or []:
                if t:
                    ids.add(t)
    if not ids:
        for tid in campaign.get("template_ids") or campaign.get("templateIds") or []:
            if tid:
                ids.add(tid)
    return list(ids)


@router.post("/campaigns")
async def create_campaign(campaign: Campaign, current_user: dict = Depends(get_current_user)):
    """Create campaign. Validates template compliance (e.g. unsubscribe link) before saving."""
    if campaign.user_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Cannot create campaign for another user")
    if email_service and campaign.template_ids:
        err = await email_service.validate_campaign_templates_compliance(campaign.user_id, campaign.template_ids)
        if err:
            raise HTTPException(status_code=400, detail=err)
    # Validate reply_to_id when set
    rtype = campaign.reply_to_type
    rid = campaign.reply_to_id
    if rtype == "gmail" and rid:
        inbox = await db.inboxes.find_one({"id": rid, "user_id": campaign.user_id, "sender_type": "gmail"})
        cred = await db.gmail_credentials.find_one({"$or": [{"id": rid}, {"user_id": rid}], "user_id": campaign.user_id}) if not inbox else None
        if not inbox and not cred:
            raise HTTPException(status_code=400, detail="Reply-To Gmail account not found or not connected. Connect Gmail in Settings or choose another option.")
    if rtype == "imap" and rid:
        config = await db.reply_to_imap_configs.find_one({"id": rid, "user_id": campaign.user_id})
        if not config:
            raise HTTPException(status_code=400, detail="Reply-To IMAP config not found. Add it in Settings or choose another option.")
    if rtype == "custom":
        custom_email = (campaign.reply_to_email or "").strip()
        if not custom_email:
            raise HTTPException(status_code=400, detail="Reply-To custom email is required when using Custom email.")
        if not REPLY_TO_EMAIL_RE.match(custom_email):
            raise HTTPException(status_code=400, detail="Reply-To must be a valid email address.")
    campaign.updated_at = datetime.now(timezone.utc)
    campaign_dict = campaign.model_dump()
    await db.campaigns.insert_one(campaign_dict)
    campaign_dict.pop("_id", None)  # Remove MongoDB _id before returning
    return campaign_dict

@router.get("/campaigns")
async def get_campaigns(
    user_id: str,
    archived: Optional[bool] = Query(
        None,
        description="Filter by archived: true=only archived, false=only non-archived, omit=all",
    ),
    skip: int = Query(
        0,
        ge=0,
        description="Number of campaigns to skip (for pagination).",
    ),
    limit: int = Query(
        200,
        ge=1,
        le=500,
        description="Maximum number of campaigns to return (for pagination).",
    ),
):
    """Get campaigns for user.

    Supports optional archived filter and simple pagination via skip/limit.
    """
    query: dict = {"user_id": user_id}
    if archived is not None:
        if archived:
            query["archived"] = True
        else:
            query["$or"] = [{"archived": False}, {"archived": {"$exists": False}}]

    # Order: draft/pending → active (running) → paused → everything else; then newest first within each group.
    pipeline: List[Dict[str, Any]] = [
        {"$match": query},
        {
            "$addFields": {
                "_status_rank": {
                    "$switch": {
                        "branches": [
                            {"case": {"$in": ["$status", ["draft", "pending"]]}, "then": 0},
                            {"case": {"$eq": ["$status", "active"]}, "then": 1},
                            {"case": {"$eq": ["$status", "paused"]}, "then": 2},
                        ],
                        "default": 3,
                    }
                }
            }
        },
        {"$sort": {"_status_rank": 1, "created_at": -1}},
        {"$skip": skip},
        {"$limit": limit},
        {"$project": {"_id": 0, "_status_rank": 0}},
    ]
    campaigns = await db.campaigns.aggregate(pipeline).to_list(length=None)
    return campaigns


@router.get("/campaigns/compliance-status")
async def get_campaigns_compliance_status(
    ids: str = Query(..., description="Comma-separated campaign IDs"),
    current_user: dict = Depends(get_current_user),
):
    """Return compliance status (links, unsubscribe, spam words) for each campaign. Owner only."""
    campaign_ids = [x.strip() for x in ids.split(",") if x.strip()]
    if not campaign_ids:
        return {}
    # Fetch full campaign docs (no projection) so _get_campaign_template_ids sees email_sequence and template_ids
    # regardless of which creation flow (new/edit, AI studio, outreach) was used
    cursor = db.campaigns.find(
        {"id": {"$in": campaign_ids}, "user_id": current_user["id"]},
        {"_id": 0},
    )
    campaigns = await cursor.to_list(None)
    result = {}
    if not email_service:
        for c in campaigns:
            result[c["id"]] = {"ok": True, "errors": []}
        return result
    for campaign in campaigns:
        template_ids = _get_campaign_template_ids(campaign)
        errors = await email_service.validate_campaign_full_compliance(
            campaign["user_id"], template_ids
        )
        result[campaign["id"]] = {"ok": len(errors) == 0, "errors": errors}
    return result


@router.get("/campaigns/{campaign_id}")
async def get_campaign(campaign_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single campaign by id (owner only)."""
    campaign = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.get("user_id") != current_user.get("id"):
        raise HTTPException(status_code=403, detail="Access denied: campaign does not belong to you")
    return campaign


@router.post("/campaigns/{campaign_id}/deliverability-test")
async def trigger_campaign_deliverability_test(
    campaign_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Queue inbox/spam placement probes (runs in background). Owner only."""
    if campaign_deliverability_service is None:
        raise HTTPException(status_code=503, detail="Deliverability service unavailable")
    campaign = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0, "user_id": 1})
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    user_id = current_user.get("id")
    if campaign.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Access denied: campaign does not belong to you")

    now = datetime.now(timezone.utc)
    stale_before = now - timedelta(minutes=12)
    await db.campaign_deliverability_runs.update_many(
        {
            "campaign_id": campaign_id,
            "user_id": user_id,
            "status": "running",
            "started_at": {"$lt": stale_before},
        },
        {
            "$set": {
                "status": "failed",
                "error": "Run timed out or was superseded.",
                "completed_at": now,
                "updated_at": now,
            }
        },
    )
    blocking = await db.campaign_deliverability_runs.find_one(
        {
            "campaign_id": campaign_id,
            "user_id": user_id,
            "$or": [
                {"status": "queued"},
                {
                    "status": "running",
                    "$or": [
                        {"started_at": None},
                        {"started_at": {"$gte": stale_before}},
                    ],
                },
            ],
        },
        {"_id": 0, "id": 1},
    )
    if blocking:
        raise HTTPException(
            status_code=409,
            detail="A placement test is already running or queued for this campaign.",
        )

    run_id = str(uuid.uuid4())
    doc: Dict[str, Any] = {
        "id": run_id,
        "campaign_id": campaign_id,
        "user_id": user_id,
        "status": "queued",
        "error": None,
        "result": None,
        "created_at": now,
        "updated_at": now,
        "started_at": None,
        "completed_at": None,
    }
    await db.campaign_deliverability_runs.insert_one(doc)
    asyncio.create_task(_execute_deliverability_run(run_id, campaign_id))
    return JSONResponse(
        status_code=202,
        content={"ok": True, "campaign_id": campaign_id, "run_id": run_id, "status": "queued"},
    )


@router.get("/campaigns/{campaign_id}/deliverability-runs")
async def list_campaign_deliverability_runs(
    campaign_id: str,
    current_user: dict = Depends(get_current_user),
    limit: int = Query(50, ge=1, le=100),
):
    """History of placement test runs for this campaign (owner only)."""
    campaign = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0, "user_id": 1})
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.get("user_id") != current_user.get("id"):
        raise HTTPException(status_code=403, detail="Access denied: campaign does not belong to you")
    uid = current_user.get("id")
    cursor = (
        db.campaign_deliverability_runs.find(
            {"campaign_id": campaign_id, "user_id": uid},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(limit)
    )
    runs = await cursor.to_list(length=None)
    return {"runs": runs}


@router.get("/campaigns/{campaign_id}/deliverability-runs/{run_id}")
async def get_campaign_deliverability_run(
    campaign_id: str,
    run_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Single placement test run (owner only)."""
    campaign = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0, "user_id": 1})
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.get("user_id") != current_user.get("id"):
        raise HTTPException(status_code=403, detail="Access denied: campaign does not belong to you")
    run = await db.campaign_deliverability_runs.find_one(
        {"id": run_id, "campaign_id": campaign_id, "user_id": current_user.get("id")},
        {"_id": 0},
    )
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@router.put("/campaigns/{campaign_id}")
async def update_campaign(campaign_id: str, campaign: Campaign, current_user: dict = Depends(get_current_user)):
    """Update campaign (owner only).

    Contact list cannot be changed once the campaign has actually started sending
    (i.e. once there are email_logs for this campaign). If the campaign has never
    run, the contact list can still be changed.

    Also validates template compliance and Reply-To configuration.
    """
    existing = await db.campaigns.find_one(
        {"id": campaign_id},
        {"_id": 0, "user_id": 1, "contact_list_ids": 1, "contact_ids": 1},
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if existing.get("user_id") != current_user.get("id"):
        raise HTTPException(status_code=403, detail="Access denied: campaign does not belong to you")

    # Determine whether this campaign has ever actually "run" any sends.
    # If there are no email_logs at all, we allow changing the contact list.
    has_any_email_logs = await db.email_logs.count_documents(
        {"campaign_id": campaign_id}
    )

    if has_any_email_logs:
        # Once any sends exist, lock contact list/contact_ids to their original values.
        new_list_ids = sorted(campaign.contact_list_ids or [])
        new_contact_ids = sorted(campaign.contact_ids or [])
        existing_list_ids = sorted(existing.get("contact_list_ids") or [])
        existing_contact_ids = sorted(existing.get("contact_ids") or [])
        if new_list_ids != existing_list_ids or new_contact_ids != existing_contact_ids:
            raise HTTPException(
                status_code=400,
                detail="Contact list cannot be changed after the campaign has started sending. Create a new campaign to use a different list.",
            )
    if email_service and campaign.template_ids:
        err = await email_service.validate_campaign_templates_compliance(campaign.user_id, campaign.template_ids)
        if err:
            raise HTTPException(status_code=400, detail=err)
    rtype = campaign.reply_to_type
    rid = campaign.reply_to_id
    if rtype == "gmail" and rid:
        inbox = await db.inboxes.find_one({"id": rid, "user_id": existing["user_id"], "sender_type": "gmail"})
        cred = await db.gmail_credentials.find_one({"$or": [{"id": rid}, {"user_id": rid}], "user_id": existing["user_id"]}) if not inbox else None
        if not inbox and not cred:
            raise HTTPException(status_code=400, detail="Reply-To Gmail account not found or not connected. Connect Gmail in Settings or choose another option.")
    if rtype == "imap" and rid:
        config = await db.reply_to_imap_configs.find_one({"id": rid, "user_id": existing["user_id"]})
        if not config:
            raise HTTPException(status_code=400, detail="Reply-To IMAP config not found. Add it in Settings or choose another option.")
    if rtype == "custom":
        custom_email = (campaign.reply_to_email or "").strip()
        if not custom_email:
            raise HTTPException(status_code=400, detail="Reply-To custom email is required when using Custom email.")
        if not REPLY_TO_EMAIL_RE.match(custom_email):
            raise HTTPException(status_code=400, detail="Reply-To must be a valid email address.")
    campaign.updated_at = datetime.now(timezone.utc)
    campaign_dict = campaign.model_dump()
    # Enforce: if the campaign has already run, keep existing contact_list_ids/contact_ids.
    # If it has not run, we allow whatever the client sends.
    if has_any_email_logs:
        campaign_dict["contact_list_ids"] = existing.get("contact_list_ids", [])
        campaign_dict["contact_ids"] = existing.get("contact_ids", [])
    await db.campaigns.update_one(
        {"id": campaign_id},
        {"$set": campaign_dict}
    )
    campaign_dict.pop("_id", None)
    return campaign_dict


@router.patch("/campaigns/{campaign_id}")
async def patch_campaign(
    campaign_id: str,
    body: dict = Body(...),
    current_user: dict = Depends(get_current_user),
):
    """Partial update (e.g. archived only). Only 'archived' is supported."""
    if "archived" not in body:
        raise HTTPException(status_code=400, detail="PATCH body must include 'archived' (true/false)")
    existing = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0, "user_id": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if existing.get("user_id") != current_user.get("id"):
        raise HTTPException(status_code=403, detail="Access denied")
    update: dict = {"updated_at": datetime.now(timezone.utc)}
    if "archived" in body:
        update["archived"] = bool(body["archived"])
    await db.campaigns.update_one({"id": campaign_id}, {"$set": update})
    updated = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
    return updated


@router.post("/campaigns/{campaign_id}/start")
async def start_campaign(
    campaign_id: str,
    body: Optional[dict] = Body(None),
):
    """Start campaign and create first send-batch job so emails are sent automatically.

    Optional body: {"scheduled_at": "ISO8601 datetime"} to run the first batch at a future time.

    NOTE:
    The detailed logic for whether there are remaining sendable contacts or follow‑ups
    is handled inside EmailService.send_campaign_batch. This endpoint now only validates
    that the campaign has at least one contact attached; it no longer tries to infer
    completion based solely on the presence or absence of "pending" contacts, which
    could incorrectly mark campaigns as completed when follow‑up sequence steps are
    still due.
    """
    campaign = await db.campaigns.find_one({"id": campaign_id})
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    owner_id = campaign.get("user_id")
    if owner_id:
        owner = await db.users.find_one(
            {"id": owner_id},
            {"subscription_status": 1, "subscription_start": 1, "subscription_end": 1, "plan_id": 1},
        )
        if owner and user_subscription_blocks_outbound(owner):
            raise HTTPException(
                status_code=403,
                detail=outbound_subscription_block_message(owner)
                or "Fix your subscription in Settings → Billing before starting a campaign.",
            )

    # Resolve all contact_ids for this campaign (direct + from lists)
    contact_list_ids = campaign.get("contact_list_ids", [])
    all_contact_ids: Set[str] = set(campaign.get("contact_ids", []))

    if contact_list_ids:
        contact_lists = await db.contact_lists.find(
            {"id": {"$in": contact_list_ids}}
        ).to_list(None)
        for cl in contact_lists:
            all_contact_ids.update(cl.get("contact_ids", []))

    # If there are no contacts at all, starting the campaign is invalid
    if not all_contact_ids:
        raise HTTPException(
            status_code=400,
            detail="Cannot start campaign: no contacts are attached to this campaign.",
        )

    # Full compliance check (links, unsubscribe, spam words) before starting
    template_ids = _get_campaign_template_ids(campaign)
    if email_service:
        compliance_errors = await email_service.validate_campaign_full_compliance(
            campaign["user_id"], template_ids
        )
        if compliance_errors:
            raise HTTPException(
                status_code=400,
                detail="Compliance issues must be fixed before starting:\n\n• " + "\n• ".join(compliance_errors),
            )

    # Enforce plan limit on concurrently active campaigns (per user).
    if plan_service:
        user_id = campaign.get("user_id")
        if user_id:
            # Fetch user document to resolve plan/limits.
            user = await db.users.find_one({"id": user_id}, {"_id": 0})
            if user:
                limits = await plan_service.get_user_limits(user)
                max_active = limits.get("max_campaigns", 1)
                if max_active != -1:
                    active_count = await plan_service.active_campaigns_count(user_id)
                    if active_count >= max_active:
                        raise HTTPException(
                            status_code=403,
                            detail=f"You have reached your plan limit of {max_active} active campaigns. Pause or complete another campaign, or upgrade your plan.",
                        )

    await db.campaigns.update_one(
        {"id": campaign_id},
        {"$set": {"status": "active", "updated_at": datetime.now(timezone.utc)}}
    )

    # Trigger any active workflows that should start when this campaign starts.
    if workflow_service:
        await workflow_service.trigger_matching_workflows(
            event_type="onCampaignStarted",
            trigger_context={"campaign_id": campaign_id},
        )

    scheduled_at = None
    if body and body.get("scheduled_at"):
        try:
            from dateutil import parser as dateutil_parser
            scheduled_at = dateutil_parser.parse(body["scheduled_at"])
            if scheduled_at.tzinfo is None:
                scheduled_at = scheduled_at.replace(tzinfo=timezone.utc)
            else:
                scheduled_at = scheduled_at.astimezone(timezone.utc)
        except (ValueError, TypeError) as e:
            raise HTTPException(status_code=400, detail=f"Invalid scheduled_at: {e}")

    if automation_service:
        await automation_service.create_campaign_batch_job(campaign_id, scheduled_at=scheduled_at)
    if notification_service:
        name = campaign.get("name") or campaign_id
        subject, body_plain, body_html = template_campaign_started(name)
        await notification_service.send_notification_if_enabled(
            campaign["user_id"],
            "campaign_updates",
            subject,
            body_plain,
            body_html,
        )

    # Initialize CampaignContact records for all contacts in the background so the
    # API response is fast even for very large campaigns.
    if all_contact_ids:
        async def _init_campaign_contacts_background(campaign_id: str, user_id: str, contact_ids: Set[str]) -> None:
            now = datetime.now(timezone.utc)
            for c_id in contact_ids:
                try:
                    await db.campaign_contacts.update_one(
                        {"campaign_id": campaign_id, "contact_id": c_id},
                        {
                            "$setOnInsert": {
                                "id": str(uuid.uuid4()),
                                "user_id": user_id,
                                "status": "pending",
                                "events": [],
                                "created_at": now,
                            },
                            "$set": {
                                "updated_at": now,
                            },
                        },
                        upsert=True,
                    )
                except Exception as e:
                    # Best-effort background initialization; log but never block or crash start.
                    print(f"[CAMPAIGN_CONTACTS] init failed for {campaign_id}/{c_id}: {e}", flush=True)

        try:
            asyncio.create_task(_init_campaign_contacts_background(campaign_id, campaign["user_id"], set(all_contact_ids)))
        except RuntimeError:
            # If no running loop is available for create_task (very unusual in FastAPI),
            # fall back to synchronous initialization.
            await _init_campaign_contacts_background(campaign_id, campaign["user_id"], set(all_contact_ids))

    return {"message": "Campaign started"}

@router.delete("/campaigns/{campaign_id}")
async def delete_campaign(campaign_id: str):
    """Delete campaign, its jobs, and campaign contacts. Cannot delete a running (active) campaign."""
    campaign = await db.campaigns.find_one({"id": campaign_id}, {"status": 1})
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.get("status") == "active":
        raise HTTPException(
            status_code=400,
            detail="Cannot delete a running campaign. Pause it first, then delete.",
        )
    try:
        if automation_service:
            await automation_service.delete_campaign_jobs(campaign_id)
        await db.campaign_contacts.delete_many({"campaign_id": campaign_id})
        await db.campaigns.delete_one({"id": campaign_id})
        return {"message": "Campaign deleted"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/campaigns/{campaign_id}/jobs")
async def get_campaign_jobs(campaign_id: str, current_user: dict = Depends(get_current_user)):
    """Get batch jobs (send_campaign_batch) for a campaign. Campaign must belong to current user."""
    campaign = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0, "user_id": 1})
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.get("user_id") != current_user.get("id"):
        raise HTTPException(status_code=404, detail="Campaign not found")
    if not automation_service:
        return {"jobs": []}
    jobs = await automation_service.list_jobs_for_campaign(campaign_id)
    return {"jobs": jobs}


@router.post("/campaigns/{campaign_id}/jobs/{job_id}/stop")
async def stop_campaign_job(campaign_id: str, job_id: str, current_user: dict = Depends(get_current_user)):
    """Stop a pending or running batch job. Campaign must belong to current user; job must belong to this campaign."""
    campaign = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0, "user_id": 1})
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.get("user_id") != current_user.get("id"):
        raise HTTPException(status_code=404, detail="Campaign not found")
    if not automation_service:
        raise HTTPException(status_code=503, detail="Automation service unavailable")
    job = await automation_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.get("action_config", {}).get("campaign_id") != campaign_id:
        raise HTTPException(status_code=404, detail="Job not found")
    updated = await automation_service.force_stop_job(job_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="Job not found")
    # If campaign is still active, schedule a new batch job in 5 minutes
    campaign_now = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0, "status": 1})
    if campaign_now and campaign_now.get("status") == "active":
        next_at = datetime.now(timezone.utc) + timedelta(minutes=5)
        await automation_service.create_campaign_batch_job(campaign_id, scheduled_at=next_at)
    return updated


@router.post("/campaigns/{campaign_id}/pause")
async def pause_campaign(campaign_id: str):
    """Pause campaign, stop any running batch job, and cancel its pending send jobs."""
    campaign = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    await db.campaigns.update_one(
        {"id": campaign_id},
        {"$set": {"status": "paused", "updated_at": datetime.now(timezone.utc)}}
    )
    if automation_service:
        # Cancel all pending (scheduled) jobs for this campaign
        await automation_service.cancel_campaign_jobs(campaign_id)
        # Stop any currently running batch job for this campaign
        jobs = await automation_service.list_jobs_for_campaign(campaign_id)
        for job in jobs:
            if job.get("status") == "running":
                await automation_service.force_stop_job(job["id"])
    if notification_service:
        name = campaign.get("name") or campaign_id
        subject, body_plain, body_html = template_campaign_paused(name)
        await notification_service.send_notification_if_enabled(
            campaign["user_id"],
            "campaign_updates",
            subject,
            body_plain,
            body_html,
        )
    return {"message": "Campaign paused"}

@router.get("/campaigns/{campaign_id}/contacts")
async def get_campaign_contacts(campaign_id: str, current_user: dict = Depends(get_current_user)):
    """Get all contacts for a campaign with their specific status and engagement timeline"""
    campaign = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0, "user_id": 1})
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.get("user_id") != current_user.get("id"):
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Get campaign contacts
    campaign_contacts = await db.campaign_contacts.find(
        {"campaign_id": campaign_id},
        {"_id": 0}
    ).to_list(None)

    # Get contact details
    contact_ids = [cc["contact_id"] for cc in campaign_contacts]
    contacts = await db.contacts.find(
        {"id": {"$in": contact_ids}},
        {"_id": 0}
    ).to_list(None)
    contact_map = {c["id"]: c for c in contacts}

    # Per-contact link click counts: sum link_clicks.click_count for this campaign
    email_logs = await db.email_logs.find(
        {"campaign_id": campaign_id},
        {"id": 1, "contact_id": 1}
    ).to_list(None)
    log_to_contact = {el["id"]: el["contact_id"] for el in email_logs}
    log_ids = list(log_to_contact.keys())
    contact_clicks = {}
    if log_ids:
        link_clicks = await db.link_clicks.find(
            {"email_log_id": {"$in": log_ids}},
            {"email_log_id": 1, "click_count": 1}
        ).to_list(None)
        for lc in link_clicks:
            cid = log_to_contact.get(lc["email_log_id"])
            if cid:
                contact_clicks[cid] = contact_clicks.get(cid, 0) + lc.get("click_count", 0)

    # Enrich campaign contacts
    enriched_contacts = []
    for cc in campaign_contacts:
        contact = contact_map.get(cc["contact_id"], {})
        enriched_contacts.append({
            **cc,
            "contact_details": contact,
            "click_count": contact_clicks.get(cc["contact_id"], 0),
        })

    return enriched_contacts


@router.get("/campaigns/{campaign_id}/leads")
async def get_campaign_enrichment_leads(
    campaign_id: str,
    current_user: dict = Depends(get_current_user),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: Optional[str] = Query(None, description="Search by email/company/name"),
):
    """List enrichment lead artifacts for this campaign (enriched contacts only)."""
    campaign = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0, "user_id": 1})
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.get("user_id") != current_user.get("id"):
        raise HTTPException(status_code=404, detail="Campaign not found")

    query: Dict[str, Any] = {"campaign_id": campaign_id}
    s = (search or "").strip()
    if s:
        esc = re.escape(s)
        query["$or"] = [
            {"query_context.company": {"$regex": esc, "$options": "i"}},
            {"query_context.first_name": {"$regex": esc, "$options": "i"}},
            {"query_context.last_name": {"$regex": esc, "$options": "i"}},
            {"query_context.email_domain": {"$regex": esc, "$options": "i"}},
            {"lead_object.company_name": {"$regex": esc, "$options": "i"}},
            {"lead_object.person_name": {"$regex": esc, "$options": "i"}},
        ]

    total = await db.campaign_enrichment_leads.count_documents(query)
    leads = await (
        db.campaign_enrichment_leads.find(query, {"_id": 0})
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
        .to_list(length=limit)
    )
    return {"leads": leads, "total": total, "skip": skip, "limit": limit}


@router.patch("/campaigns/{campaign_id}/leads/{lead_id}/tracker")
async def update_campaign_enrichment_lead_tracker(
    campaign_id: str,
    lead_id: str,
    current_user: dict = Depends(get_current_user),
    payload: Dict[str, Any] = Body(...),
):
    """Update tracker status/note for a campaign enrichment lead."""
    campaign = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0, "user_id": 1})
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.get("user_id") != current_user.get("id"):
        raise HTTPException(status_code=404, detail="Campaign not found")

    lead = await db.campaign_enrichment_leads.find_one(
        {"id": lead_id, "campaign_id": campaign_id},
        {"_id": 0, "id": 1},
    )
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    status_raw = payload.get("tracker_status")
    note_raw = payload.get("tracker_note")

    updates: Dict[str, Any] = {}
    if status_raw is not None:
        status_value = str(status_raw).strip()
        if status_value not in LEAD_TRACKER_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid tracker status")
        updates["tracker_status"] = status_value
    if note_raw is not None:
        note_value = str(note_raw)
        if len(note_value) > 2000:
            raise HTTPException(status_code=400, detail="Tracker note is too long")
        updates["tracker_note"] = note_value

    if not updates:
        raise HTTPException(status_code=400, detail="No tracker fields provided")

    now = datetime.now(timezone.utc)
    updates["tracker_updated_at"] = now
    updates["updated_at"] = now

    await db.campaign_enrichment_leads.update_one(
        {"id": lead_id, "campaign_id": campaign_id},
        {"$set": updates},
    )

    updated = await db.campaign_enrichment_leads.find_one(
        {"id": lead_id, "campaign_id": campaign_id},
        {"_id": 0},
    )
    return updated or {"id": lead_id, **updates}

@router.get("/campaigns/{campaign_id}/stats")
async def get_campaign_stats(campaign_id: str):
    """Get campaign-specific statistics"""
    campaign = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    # Get email logs for this campaign
    # total_attempted: all non-pending (includes failed)
    total_attempted = await db.email_logs.count_documents({"campaign_id": campaign_id, "status": {"$ne": "pending"}})
    # total_failed: hard/soft bounces etc.
    total_failed = await db.email_logs.count_documents({"campaign_id": campaign_id, "status": "failed"})
    # total_delivered: successfully accepted by provider (used as denominator for rates)
    total_delivered = max(total_attempted - total_failed, 0)
    total_opened = await db.email_logs.count_documents({"campaign_id": campaign_id, "status": {"$in": ["opened", "clicked", "replied"]}})
    total_clicked = await db.email_logs.count_documents({"campaign_id": campaign_id, "status": {"$in": ["clicked", "replied"]}})
    total_replied = await db.email_logs.count_documents({"campaign_id": campaign_id, "status": "replied"})
    total_complained = await db.email_logs.count_documents({"campaign_id": campaign_id, "status": "complained"})
    
    # Use only delivered emails for rate calculations (exclude failed)
    denom = total_delivered
    open_rate = (total_opened / denom * 100) if denom > 0 else 0
    click_rate = (total_clicked / denom * 100) if denom > 0 else 0
    reply_rate = (total_replied / denom * 100) if denom > 0 else 0
    spam_rate = (total_complained / denom * 100) if denom > 0 else 0
    
    # Get health score from associated inbox/domain
    health = 95  # Default
    if campaign.get("sender_ids"):
        inbox_id = campaign.get("sender_ids")[0]
        inbox = await db.inboxes.find_one({"id": inbox_id}, {"_id": 0})
        if inbox and inbox.get("domain_id"):
            domain = await db.domains.find_one({"id": inbox.get("domain_id")}, {"_id": 0})
            if domain:
                health = domain.get("health_score", 95)
    
    return {
        "sent": total_delivered,
        "opened": total_opened,
        "clicked": total_clicked,
        "replied": total_replied,
        "complained": total_complained,
        "openRate": round(open_rate, 1),
        "clickRate": round(click_rate, 1),
        "replyRate": round(reply_rate, 1),
        "spamRate": round(spam_rate, 2),
        "health": health
    }


@router.get("/campaigns/{campaign_id}/stats-by-template")
async def get_campaign_stats_by_template(campaign_id: str, current_user: dict = Depends(get_current_user)):
    """Get per-template stats for A/B performance (sent, opened, clicked, replied, rates).

    NOTE: "sent" here is aligned with the main campaign stats endpoint:
    it counts only successfully delivered emails (excludes failed and pending),
    so the sum of per-template sent values matches the overall "sent" metric.
    """
    campaign = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0, "user_id": 1})
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.get("user_id") != current_user.get("id"):
        raise HTTPException(status_code=403, detail="Access denied")

    pipeline = [
        # Exclude pending so we only look at attempts, same as get_campaign_stats
        {"$match": {"campaign_id": campaign_id, "status": {"$ne": "pending"}}},
        {
            "$group": {
                "_id": "$template_id",
                # Delivered = all non-failed attempts
                "sent": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$status", "failed"]},
                            0,
                            1,
                        ]
                    }
                },
                "opened": {
                    "$sum": {
                        "$cond": [
                            {"$in": ["$status", ["opened", "clicked", "replied"]]},
                            1,
                            0,
                        ]
                    }
                },
                "clicked": {
                    "$sum": {
                        "$cond": [
                            {"$in": ["$status", ["clicked", "replied"]]},
                            1,
                            0,
                        ]
                    }
                },
                "replied": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$status", "replied"]},
                            1,
                            0,
                        ]
                    }
                },
                "failed": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$status", "failed"]},
                            1,
                            0,
                        ]
                    }
                },
            }
        },
    ]

    rows = await db.email_logs.aggregate(pipeline).to_list(None)
    template_ids = [r["_id"] for r in rows if r["_id"]]
    templates = await db.templates.find(
        {"id": {"$in": template_ids}},
        {"_id": 0, "id": 1, "name": 1, "subject": 1},
    ).to_list(None) if template_ids else []
    name_by_id = {t["id"]: t.get("name", t["id"]) for t in templates}

    by_template = []
    for r in rows:
        tid = r["_id"]
        sent = r.get("sent", 0) or 0
        opened = r.get("opened", 0) or 0
        clicked = r.get("clicked", 0) or 0
        replied = r.get("replied", 0) or 0

        # Use delivered "sent" as denominator; if zero, rates are 0
        open_rate = round((opened / sent) * 100, 1) if sent else 0
        click_rate = round((clicked / sent) * 100, 1) if sent else 0
        reply_rate = round((replied / sent) * 100, 1) if sent else 0

        by_template.append(
            {
                "templateId": tid,
                "templateName": name_by_id.get(tid, tid),
                "sent": sent,
                "opened": opened,
                "clicked": clicked,
                "replied": replied,
                "openRate": open_rate,
                "clickRate": click_rate,
                "replyRate": reply_rate,
            }
        )

    return {"byTemplate": by_template}


@router.get("/campaigns/{campaign_id}/email-details")
async def get_campaign_email_details(campaign_id: str, skip: int = 0, limit: int = 100):
    """Get detailed email logs for a campaign with contact info"""
    # Get campaign
    campaign = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    # Get email logs
    logs = await db.email_logs.find(
        {"campaign_id": campaign_id},
        {"_id": 0}
    ).sort("sent_at", -1).skip(skip).limit(limit).to_list(None)
    
    total_logs = await db.email_logs.count_documents({"campaign_id": campaign_id})
    
    # Get all contact IDs from logs
    contact_ids = list(set([log.get("contact_id") for log in logs if log.get("contact_id")]))
    
    # Get contacts
    contacts = await db.contacts.find(
        {"id": {"$in": contact_ids}},
        {"_id": 0}
    ).to_list(None)
    contact_map = {c["id"]: c for c in contacts}
    
    # Get pending contacts (not yet sent)
    contact_list_ids = campaign.get("contact_list_ids", [])
    all_contact_ids = set(campaign.get("contact_ids", []))
    
    if contact_list_ids:
        contact_lists = await db.contact_lists.find(
            {"id": {"$in": contact_list_ids}}
        ).to_list(None)
        for cl in contact_lists:
            all_contact_ids.update(cl.get("contact_ids", []))
    
    sent_contact_ids = set([log.get("contact_id") for log in logs if log.get("contact_id")])
    pending_contact_ids = list(all_contact_ids - sent_contact_ids)
    
    pending_contacts = await db.contacts.find(
        {"id": {"$in": pending_contact_ids}},
        {"_id": 0}
    ).to_list(None)
    
    # Build enriched logs with contact details
    enriched_logs = []
    for log in logs:
        contact = contact_map.get(log.get("contact_id"), {})
        enriched_logs.append({
            **log,
            "contact_email": contact.get("email", "Unknown"),
            "contact_first_name": contact.get("first_name", ""),
            "contact_last_name": contact.get("last_name", ""),
            "contact_company": contact.get("company", ""),
            "contact_data": contact
        })
    
    # Calculate stats
    stats = {
        "total_contacts": len(all_contact_ids),
        "emails_sent": total_logs,
        "pending": len(pending_contact_ids),
        "opened": await db.email_logs.count_documents({"campaign_id": campaign_id, "status": {"$in": ["opened", "clicked", "replied"]}}),
        "clicked": await db.email_logs.count_documents({"campaign_id": campaign_id, "status": {"$in": ["clicked", "replied"]}}),
        "replied": await db.email_logs.count_documents({"campaign_id": campaign_id, "status": "replied"}),
        "failed": await db.email_logs.count_documents({"campaign_id": campaign_id, "status": "failed"})
    }
    
    return {
        "campaign": campaign,
        "stats": stats,
        "email_logs": enriched_logs,
        "pending_contacts": pending_contacts,
        "total_logs": total_logs
    }
