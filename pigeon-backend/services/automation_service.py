import asyncio
import logging
import os
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Dict, Any, List, Optional, TYPE_CHECKING

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from admin_models import AutomationRule, SystemJob, JobRun
from services.workflow_service import WorkflowService
from services.sendgrid_service import SendGridRateLimitError
from services.email_service import (
    next_campaign_window_start_utc,
    normalize_schedule_weekdays_from_campaign,
)

if TYPE_CHECKING:
    from services.email_service import EmailService
    from services.domain_service import DomainService

# Max concurrent campaign batches per process (scale across campaigns)
MAX_CONCURRENT_CAMPAIGN_BATCHES = int(os.environ.get("MAX_CONCURRENT_CAMPAIGN_BATCHES", "20"))

# Per-instance running job count: we record runner_instance_id when claiming (from EC2 metadata, no env).
_ec2_instance_id_cache: Optional[str] = None
_ec2_instance_id_tried = False


def _fetch_ec2_instance_id_sync() -> Optional[str]:
    """Fetch this EC2 instance ID from metadata (blocking). Returns None if not on EC2 or on error."""
    def get_with_token(token: Optional[str]) -> Optional[str]:
        req = urllib.request.Request(
            "http://169.254.169.254/latest/meta-data/instance-id",
            headers={"User-Agent": "PigeonBackend/1.0", **({"X-aws-ec2-metadata-token": token} if token else {})},
        )
        with urllib.request.urlopen(req, timeout=2) as r:
            body = r.read().decode().strip()
            return body or None

    try:
        # IMDSv2: get session token first (required in some VPCs)
        token_req = urllib.request.Request(
            "http://169.254.169.254/latest/api/token",
            headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"},
            method="PUT",
        )
        with urllib.request.urlopen(token_req, timeout=1) as tr:
            token = tr.read().decode().strip() or None
        if token:
            return get_with_token(token)
    except Exception:
        pass
    try:
        return get_with_token(None)  # IMDSv1 fallback
    except Exception:
        return None


AWS_REGION = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))


def _is_instance_terminating_sync(instance_id: str) -> bool:
    """Check if this EC2 instance is in Terminating:Wait (blocking boto3 call).
    Returns True if draining, False otherwise (not on ASG, InService, or API error).
    """
    try:
        import boto3
        region = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
        client = boto3.client("autoscaling", region_name=region)
        resp = client.describe_auto_scaling_instances(InstanceIds=[instance_id], MaxRecords=1)
        instances = resp.get("AutoScalingInstances") or []
        if not instances:
            return False
        return instances[0].get("LifecycleState") == "Terminating:Wait"
    except Exception:
        return False


# Jobs "running" longer than this are marked failed (stuck recovery, hours)
STALE_RUNNING_JOB_HOURS = int(os.environ.get("STALE_RUNNING_JOB_HOURS", "24"))
# send_campaign_batch jobs running longer than this: stop and reschedule in 5 min (like Stop button)
STALE_CAMPAIGN_AUTO_RESTART_HOURS = int(os.environ.get("STALE_CAMPAIGN_AUTO_RESTART_HOURS", "2"))
# No heartbeat for this many minutes = process likely dead; reclaim (cancel + reschedule)
HEARTBEAT_STALE_MINUTES = int(os.environ.get("HEARTBEAT_STALE_MINUTES", "5"))
# When this file exists (set by ASG termination handler on host), instance is draining: do not claim new jobs
INSTANCE_TERMINATING_FILE = os.environ.get("INSTANCE_TERMINATING_FILE", "/signals/instance-terminating")
# Set EMAIL_DEBUG=1 in .env to see detailed warnings in server logs only (not exposed to users)
_EMAIL_DEBUG = os.environ.get("EMAIL_DEBUG", "").strip().lower() in ("1", "true", "yes")


class AutomationService:
    """Service responsible for managing automation rules and system jobs.

    This initial implementation focuses on:
    - CRUD operations for AutomationRule.
    - Creating and tracking SystemJob and JobRun documents.
    - Processing pending jobs (including send_campaign_batch for active campaigns).
    - Scalable: atomic job claiming (multi-worker safe), parallel batches (semaphore-limited).
    """

    def __init__(
        self,
        admin_db,
        app_db,
        email_service: Optional["EmailService"] = None,
        workflow_service: Optional[WorkflowService] = None,
        domain_service: Optional["DomainService"] = None,
    ):
        self.admin_db = admin_db
        self.app_db = app_db
        self.email_service = email_service
        self.workflow_service = workflow_service
        self.domain_service = domain_service
        self.logger = logging.getLogger(__name__)
        self._batch_semaphore = asyncio.Semaphore(MAX_CONCURRENT_CAMPAIGN_BATCHES)

    def _dev_warn(self, msg: str, *args, **kwargs) -> None:
        """Print warning when EMAIL_DEBUG=1 (re-read env each time)."""
        if os.environ.get("EMAIL_DEBUG", "").strip().lower() in ("1", "true", "yes"):
            text = "[EMAIL_DEBUG] " + (msg % args if args else msg)
            print(text, flush=True)

    def _batch_log(self, msg: str, *args) -> None:
        """Always print so you see campaign batch activity in terminal."""
        text = "[CAMPAIGN_BATCH] " + (msg % args if args else msg)
        print(text, flush=True)

    async def _get_ec2_instance_id(self) -> Optional[str]:
        """EC2 instance ID from metadata (cached). None if not on EC2. Used for per-instance running job count in admin."""
        global _ec2_instance_id_cache, _ec2_instance_id_tried
        if _ec2_instance_id_tried:
            return _ec2_instance_id_cache
        try:
            loop = asyncio.get_event_loop()
            _ec2_instance_id_cache = await loop.run_in_executor(None, _fetch_ec2_instance_id_sync)
        except Exception:
            _ec2_instance_id_cache = None
        _ec2_instance_id_tried = True
        return _ec2_instance_id_cache

    async def _is_instance_terminating(self) -> bool:
        """True if this instance is in Terminating:Wait. Prevents claiming during race before signal file exists."""
        instance_id = await self._get_ec2_instance_id()
        if not instance_id:
            return False
        try:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(
                None, lambda: _is_instance_terminating_sync(instance_id)
            )
        except Exception:
            return False

    # ------------------------------------------------------------------
    # Rules
    # ------------------------------------------------------------------

    async def list_rules(self) -> List[Dict[str, Any]]:
        rules = await self.admin_db.automation_rules.find({}, {"_id": 0}).to_list(None)
        return rules

    async def get_rule(self, rule_id: str) -> Optional[Dict[str, Any]]:
        rule = await self.admin_db.automation_rules.find_one({"id": rule_id}, {"_id": 0})
        return rule

    async def create_rule(self, data: Dict[str, Any], admin_id: Optional[str]) -> Dict[str, Any]:
        now = datetime.now(timezone.utc)
        rule = AutomationRule(
            **data,
            created_by_admin_id=admin_id,
            updated_by_admin_id=admin_id,
            created_at=now,
            updated_at=now,
        )
        rule_dict = rule.model_dump()
        await self.admin_db.automation_rules.insert_one(rule_dict)
        rule_dict.pop("_id", None)
        return rule_dict

    async def update_rule(self, rule_id: str, data: Dict[str, Any], admin_id: Optional[str]) -> Optional[Dict[str, Any]]:
        existing = await self.admin_db.automation_rules.find_one({"id": rule_id})
        if not existing:
            return None

        data["updated_at"] = datetime.now(timezone.utc)
        if admin_id:
            data["updated_by_admin_id"] = admin_id

        await self.admin_db.automation_rules.update_one(
            {"id": rule_id},
            {"$set": data},
        )
        updated = await self.admin_db.automation_rules.find_one({"id": rule_id}, {"_id": 0})
        return updated

    async def delete_rule(self, rule_id: str) -> bool:
        result = await self.admin_db.automation_rules.delete_one({"id": rule_id})
        return result.deleted_count > 0

    # ------------------------------------------------------------------
    # Jobs
    # ------------------------------------------------------------------

    async def list_jobs(self) -> List[Dict[str, Any]]:
        pipeline = [
            {"$sort": {"created_at": -1}},
            {
                "$lookup": {
                    "from": "job_runs",
                    "let": {"jobId": "$id"},
                    "pipeline": [
                        {"$match": {"$expr": {"$eq": ["$job_id", "$$jobId"]}}},
                        {"$sort": {"started_at": -1}},
                        {"$limit": 1},
                        {"$project": {"logs": 1, "_id": 0}},
                    ],
                    "as": "latest_run",
                },
            },
            {
                "$addFields": {
                    "note": {"$ifNull": [{"$arrayElemAt": ["$latest_run.logs", 0]}, None]},
                },
            },
            {"$unset": ["latest_run", "_id"]},
        ]
        jobs = await self.admin_db.system_jobs.aggregate(pipeline).to_list(None)
        return jobs

    async def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        job = await self.admin_db.system_jobs.find_one({"id": job_id}, {"_id": 0})
        return job

    async def list_job_runs(self, job_id: str) -> List[Dict[str, Any]]:
        """Return admin log entries (job_runs) for a job, e.g. to show errors in admin UI."""
        runs = await self.admin_db.job_runs.find({"job_id": job_id}, {"_id": 0}).sort("started_at", -1).limit(100).to_list(None)
        return runs

    async def list_jobs_for_campaign(self, campaign_id: str) -> List[Dict[str, Any]]:
        """Return send_campaign_batch jobs for a campaign, newest first."""
        jobs = await self.admin_db.system_jobs.find(
            {
                "job_type": "send_campaign_batch",
                "action_config.campaign_id": campaign_id,
            },
            {"_id": 0},
        ).sort("created_at", -1).to_list(None)
        return jobs

    async def create_job_for_rule(
        self,
        rule_id: str,
        scheduled_at: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        job = SystemJob(
            rule_id=rule_id,
            job_type="automation_rule",
            status="pending",
            scheduled_at=scheduled_at or datetime.now(timezone.utc),
        )
        job_dict = job.model_dump()
        await self.admin_db.system_jobs.insert_one(job_dict)
        job_dict.pop("_id", None)
        return job_dict

    def _ensure_utc(self, dt: Optional[datetime]) -> Optional[datetime]:
        """Ensure datetime is timezone-aware UTC for consistent DB queries."""
        if dt is None:
            return None
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)

    async def create_campaign_batch_job(
        self,
        campaign_id: str,
        scheduled_at: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        """Create a job to send a campaign batch. Used when a campaign is started."""
        now = datetime.now(timezone.utc)
        run_at = self._ensure_utc(scheduled_at) if scheduled_at else now
        job = SystemJob(
            rule_id=None,
            job_type="send_campaign_batch",
            action_config={"campaign_id": campaign_id},
            status="pending",
            scheduled_at=run_at,
        )
        job_dict = job.model_dump()
        await self.admin_db.system_jobs.insert_one(job_dict)
        job_dict.pop("_id", None)
        return job_dict

    async def create_dns_verify_job(self, domain_id: str) -> bool:
        """Create a dns_verify_domain job for a domain. Returns True if created, False if duplicate (another instance/scheduler already created it).
        Uses partial unique index to ensure only one pending job per domain - safe for multi-instance ASG."""
        now = datetime.now(timezone.utc)
        job = SystemJob(
            rule_id=None,
            job_type="dns_verify_domain",
            action_config={"domain_id": domain_id},
            status="pending",
            scheduled_at=now,
        )
        job_dict = job.model_dump()
        try:
            await self.admin_db.system_jobs.insert_one(job_dict)
            return True
        except DuplicateKeyError:
            return False

    async def cancel_campaign_jobs(self, campaign_id: str) -> int:
        """Cancel all pending send_campaign_batch jobs for a campaign (e.g. when campaign is paused)."""
        result = await self.admin_db.system_jobs.update_many(
            {
                "job_type": "send_campaign_batch",
                "action_config.campaign_id": campaign_id,
                "status": "pending",
            },
            {"$set": {"status": "cancelled", "finished_at": datetime.now(timezone.utc)}},
        )
        if result.modified_count:
            self.logger.info("Cancelled %d pending jobs for campaign %s", result.modified_count, campaign_id)
        return result.modified_count

    async def pause_all_active_campaigns_for_user(self, user_id: str) -> int:
        """Pause every active campaign for the user and cancel or stop associated batch jobs."""
        n = 0
        cursor = self.app_db.campaigns.find({"user_id": user_id, "status": "active"}, {"id": 1})
        async for doc in cursor:
            cid = doc.get("id")
            if not cid:
                continue
            now = datetime.now(timezone.utc)
            await self.app_db.campaigns.update_one(
                {"id": cid},
                {"$set": {"status": "paused", "updated_at": now}},
            )
            await self.cancel_campaign_jobs(cid)
            jobs = await self.list_jobs_for_campaign(cid)
            for job in jobs:
                if job.get("status") == "running":
                    await self.force_stop_job(job["id"])
            n += 1
        if n:
            self.logger.info("Paused %d active campaign(s) for user_id=%s (subscription pending)", n, user_id)
        return n

    async def delete_campaign_jobs(self, campaign_id: str) -> int:
        """Delete all send_campaign_batch jobs for a campaign (e.g. when campaign is deleted)."""
        result = await self.admin_db.system_jobs.delete_many(
            {
                "job_type": "send_campaign_batch",
                "action_config.campaign_id": campaign_id,
            },
        )
        if result.deleted_count:
            self.logger.info("Deleted %d jobs for campaign %s", result.deleted_count, campaign_id)
        return result.deleted_count

    async def force_stop_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Force stop a pending or running job by marking it as cancelled."""
        job = await self.admin_db.system_jobs.find_one({"id": job_id}, {"_id": 0})
        if not job:
            return None
        status = job.get("status")
        if status not in ("pending", "running"):
            return job  # already finished or cancelled
        now = datetime.now(timezone.utc)
        await self.admin_db.system_jobs.update_one(
            {"id": job_id},
            {"$set": {"status": "cancelled", "finished_at": now}},
        )
        self.logger.info("Force stopped job %s (was %s)", job_id, status)
        updated = await self.admin_db.system_jobs.find_one({"id": job_id}, {"_id": 0})
        return updated

    async def append_job_run(
        self,
        job_id: str,
        status: str,
        logs: Optional[str] = None,
    ) -> Dict[str, Any]:
        run = JobRun(
            job_id=job_id,
            status=status,
            logs=logs,
        )
        run_dict = run.model_dump()
        await self.admin_db.job_runs.insert_one(run_dict)
        run_dict.pop("_id", None)
        return run_dict

    # ------------------------------------------------------------------
    # Processing
    # ------------------------------------------------------------------

    def _log_task_done(self, task: asyncio.Task, job_id: str, campaign_id: str) -> None:
        """Log any exception from the batch task and ensure job is marked failed with error in admin logs."""
        try:
            exc = task.exception()
            if exc is not None:
                self.logger.error("Campaign batch task failed job_id=%s campaign_id=%s: %s", job_id, campaign_id, exc)
                self._batch_log("TASK FAILED job_id=%s campaign_id=%s: %s", job_id, campaign_id, exc)
                # Safety net: ensure job is stopped and error is in admin job_runs even if the in-coroutine except failed
                try:
                    loop = asyncio.get_running_loop()
                    loop.create_task(self._ensure_job_failed_and_log(job_id, campaign_id, str(exc)))
                except Exception as e:
                    self.logger.warning("Could not schedule ensure_job_failed_and_log: %s", e)
        except asyncio.CancelledError:
            pass

    async def _ensure_job_failed_and_log(self, job_id: str, campaign_id: str, error_message: str) -> None:
        """If job is still 'running', mark it failed and append error to admin job_runs. Idempotent."""
        err_truncated = (error_message or "Unknown error")[:500]
        try:
            job = await self.admin_db.system_jobs.find_one({"id": job_id}, {"status": 1})
            if job and job.get("status") == "running":
                try:
                    await self.admin_db.system_jobs.update_one(
                        {"id": job_id, "status": "running"},
                        {
                            "$set": {
                                "status": "failed",
                                "finished_at": datetime.now(timezone.utc),
                                "error_message": err_truncated,
                            }
                        },
                    )
                except Exception as e:
                    self.logger.error("_ensure_job_failed_and_log: failed to update system_jobs for %s: %s", job_id, e)
                try:
                    await self.append_job_run(job_id=job_id, status="failed", logs=error_message)
                except Exception as e:
                    self.logger.error("_ensure_job_failed_and_log: failed to append_job_run for %s: %s", job_id, e)
        except Exception as e:
            self.logger.error("_ensure_job_failed_and_log: %s", e)

    async def _run_dns_verify_domain(self, job_id: str, domain_id: str) -> None:
        """Run DNS verification for a domain. Reschedules on SendGrid rate limit."""
        try:
            await self.domain_service.verify_dns_records(domain_id)
            await self.domain_service.calculate_health_score(domain_id)
            await self.admin_db.system_jobs.update_one(
                {"id": job_id, "status": "running"},
                {"$set": {"status": "success", "finished_at": datetime.now(timezone.utc)}},
            )
            self.logger.info("DNS verification completed for domain_id=%s", domain_id)
        except SendGridRateLimitError as e:
            now = datetime.now(timezone.utc)
            reset_utc = e.rate_limit_reset_utc
            try:
                from dateutil import parser
                reset_dt = parser.parse(reset_utc) if isinstance(reset_utc, str) else now + timedelta(seconds=60)
            except Exception:
                reset_dt = now + timedelta(seconds=60)
            if getattr(reset_dt, "tzinfo", None) is None and hasattr(reset_dt, "replace"):
                reset_dt = reset_dt.replace(tzinfo=timezone.utc)
            run_at = reset_dt if isinstance(reset_dt, datetime) else now + timedelta(seconds=60)
            if hasattr(run_at, "replace") and getattr(run_at, "tzinfo", None) is None:
                run_at = run_at.replace(tzinfo=timezone.utc)
            await self.admin_db.system_jobs.update_one(
                {"id": job_id, "status": "running"},
                {"$set": {"status": "pending", "scheduled_at": run_at}},
            )
            self.logger.info(
                "DNS verify job_id=%s rescheduled for SendGrid rate limit reset at %s",
                job_id, run_at,
            )
        except Exception as exc:
            self.logger.error("dns_verify_domain job failed job_id=%s domain_id=%s: %s", job_id, domain_id, exc)
            await self.admin_db.system_jobs.update_one(
                {"id": job_id, "status": "running"},
                {"$set": {"status": "failed", "finished_at": datetime.now(timezone.utc), "error_message": str(exc)}},
            )

    def _log_dns_verify_done(self, task: asyncio.Task, job_id: str, domain_id: str) -> None:
        """Log any exception from dns_verify task (defensive; _run_dns_verify_domain handles its own errors)."""
        try:
            exc = task.exception()
            if exc is not None:
                self.logger.error("dns_verify_domain task exception job_id=%s domain_id=%s: %s", job_id, domain_id, exc)
        except asyncio.CancelledError:
            pass

    async def _run_campaign_batch_with_semaphore(self, job_id: str, campaign_id: str) -> None:
        """Run campaign batch under semaphore so we limit concurrent batches; then update job status."""
        self._batch_log("job_id=%s campaign_id=%s task started (acquiring semaphore)", job_id, campaign_id)
        async with self._batch_semaphore:
            await self._run_campaign_batch_and_schedule_next(job_id, campaign_id)

    async def _run_campaign_batch_and_schedule_next(self, job_id: str, campaign_id: str) -> None:
        """Run send_campaign_batch for a campaign, then schedule next job if campaign still active."""
        result = None
        try:
            self._batch_log("job_id=%s campaign_id=%s starting batch", job_id, campaign_id)
            if self.email_service:
                job_id_for_check = job_id

                async def _is_job_cancelled() -> bool:
                    doc = await self.admin_db.system_jobs.find_one(
                        {"id": job_id_for_check}, {"status": 1}
                    )
                    return (doc or {}).get("status") == "cancelled"

                async def _update_heartbeat() -> None:
                    await self.admin_db.system_jobs.update_one(
                        {"id": job_id_for_check, "status": "running"},
                        {"$set": {"last_heartbeat_at": datetime.now(timezone.utc)}},
                    )

                result = await self.email_service.send_campaign_batch(
                    campaign_id,
                    check_job_cancelled=_is_job_cancelled,
                    update_job_heartbeat=_update_heartbeat,
                )
                sent = result.get("sent", 0)
                msg = result.get("message", "")
                self.logger.info("Campaign batch job %s sent %s emails for campaign %s", job_id, sent, campaign_id)
                self._batch_log("job_id=%s campaign_id=%s result sent=%s message=%s", job_id, campaign_id, sent, msg)
            else:
                self.logger.warning("Email service not configured; skipping campaign batch for %s", campaign_id)
            # If job was force-stopped, do not schedule next or overwrite status
            job_doc = await self.admin_db.system_jobs.find_one({"id": job_id}, {"status": 1})
            if job_doc and job_doc.get("status") == "cancelled":
                return
            # If email_service reports that the full sequence is done for all sendable
            # contacts, mark the campaign as completed and cancel future jobs.
            if result and result.get("all_done"):
                campaign = await self.app_db.campaigns.find_one({"id": campaign_id})
                if campaign:
                    await self.app_db.campaigns.update_one(
                        {"id": campaign_id},
                        {
                            "$set": {
                                "status": "completed",
                                "updated_at": datetime.now(timezone.utc),
                            }
                        },
                    )
                    # Cancel any other pending jobs for this campaign
                    await self.cancel_campaign_jobs(campaign_id)
                    self.logger.info(
                        "Campaign %s completed: full sequence sent to all sendable contacts",
                        campaign_id,
                    )
                    from services.notification_service import notification_service
                    from services.email_templates import (
                        campaign_completed as template_campaign_completed,
                    )
                    if notification_service:
                        name = campaign.get("name") or campaign_id
                        subject, body_plain, body_html = template_campaign_completed(
                            name
                        )
                        await notification_service.send_notification_if_enabled(
                            campaign["user_id"],
                            "campaign_updates",
                            subject,
                            body_plain,
                            body_html,
                        )
            # If Gmail send failed, campaign was paused by email_service; cancel jobs and do not schedule next
            if result and result.get("gmail_send_failed_stop_campaign"):
                await self.cancel_campaign_jobs(campaign_id)
                err_detail = result.get("message", "Gmail send failed. Campaign stopped.")
                await self.append_job_run(job_id=job_id, status="failed", logs=err_detail)
                await self.admin_db.system_jobs.update_one(
                    {"id": job_id, "status": "running"},
                    {
                        "$set": {
                            "status": "failed",
                            "finished_at": datetime.now(timezone.utc),
                            "error_message": err_detail[:500],
                        }
                    },
                )
                return
            # Schedule next batch only if campaign is still active
            campaign_after = await self.app_db.campaigns.find_one(
                {"id": campaign_id}, {"status": 1}
            )
            if (
                campaign_after
                and campaign_after.get("status") == "active"
                and self.email_service
            ):
                now = datetime.now(timezone.utc)
                # Determine base gap between batches. This is separate from per-email pacing
                # (handled inside email_service.send_campaign_batch) and exists so the
                # automation loop does not hammer the DB when there is nothing to send.
                batch_interval_minutes = int(
                    os.environ.get("CAMPAIGN_BATCH_INTERVAL_MINUTES", "10")
                )
                next_at: Optional[datetime] = None

                if result:
                    # Pacing deferred: next send would require long wait; schedule next batch at that time
                    if result.get("pacing_deferred") and result.get("next_send_at"):
                        next_send_at_val = result["next_send_at"]
                        if getattr(next_send_at_val, "tzinfo", None) is None:
                            next_send_at_val = next_send_at_val.replace(tzinfo=timezone.utc)
                        next_at = next_send_at_val
                        self.logger.info(
                            "Pacing deferred; next batch for campaign %s at %s (per-inbox gap)",
                            campaign_id,
                            next_at,
                        )
                    # Single sender + daily limit reached -> schedule next at start of next UTC day (after reset)
                    elif result.get("daily_limit_reached"):
                        camp = await self.app_db.campaigns.find_one(
                            {"id": campaign_id}, {"sender_ids": 1}
                        )
                        sender_ids = (camp or {}).get("sender_ids") or []
                        is_single_sender = len(sender_ids) <= 1
                        if is_single_sender:
                            next_at = (now + timedelta(days=1)).replace(
                                hour=0, minute=5, second=0, microsecond=0
                            )
                            self.logger.info(
                                "Daily limit reached (single sender); next batch for campaign %s at %s (next UTC day)",
                                campaign_id,
                                next_at,
                            )
                        else:
                            next_at = now + timedelta(minutes=batch_interval_minutes)
                    # Not a scheduled weekday: next batch at start_time on the next allowed day
                    elif (
                        result.get("sent", 0) == 0
                        and isinstance(result.get("message"), str)
                        and "Waiting for scheduled send day" in result["message"]
                    ):
                        camp = await self.app_db.campaigns.find_one(
                            {"id": campaign_id},
                            {"start_time": 1, "timezone": 1, "schedule_weekdays": 1},
                        )
                        c = camp or {}
                        start_time_str = c.get("start_time") or "09:00"
                        tz_name = c.get("timezone") or "America/New_York"
                        allowed = normalize_schedule_weekdays_from_campaign(c)
                        next_at = next_campaign_window_start_utc(
                            now,
                            tz_name=tz_name,
                            start_time_str=start_time_str,
                            allowed_weekdays=allowed,
                        )
                        self.logger.info(
                            "Not a scheduled send day; next batch for campaign %s at %s (tz=%s weekdays=%s)",
                            campaign_id,
                            next_at,
                            tz_name,
                            sorted(allowed),
                        )
                    # Outside send window: schedule next batch at the start of the next window
                    elif (
                        result.get("sent", 0) == 0
                        and isinstance(result.get("message"), str)
                        and "Waiting for specified time" in result["message"]
                    ):
                        camp = await self.app_db.campaigns.find_one(
                            {"id": campaign_id},
                            {"start_time": 1, "timezone": 1, "schedule_weekdays": 1},
                        )
                        c = camp or {}
                        start_time_str = c.get("start_time") or "09:00"
                        tz_name = c.get("timezone") or "America/New_York"
                        allowed = normalize_schedule_weekdays_from_campaign(c)
                        try:
                            tz = ZoneInfo(tz_name.strip())
                        except Exception:
                            tz = timezone.utc
                        try:
                            start_hour, start_minute = map(
                                int, start_time_str.strip().split(":", 1)
                            )
                        except Exception:
                            start_hour, start_minute = 9, 0
                        now_local = now.astimezone(tz)
                        today_local = now_local.date()
                        window_start_local = datetime(
                            today_local.year,
                            today_local.month,
                            today_local.day,
                            start_hour,
                            start_minute,
                            tzinfo=tz,
                        )
                        if window_start_local <= now_local:
                            # At/after today's window start time; next run at start_time on the next allowed day
                            window_start_local_utc = next_campaign_window_start_utc(
                                now,
                                tz_name=tz_name,
                                start_time_str=start_time_str,
                                allowed_weekdays=allowed,
                            )
                            window_start_local = window_start_local_utc.astimezone(tz)
                        next_at = window_start_local.astimezone(timezone.utc)
                        self.logger.info(
                            "Outside send window; next batch for campaign %s scheduled at start of window %s (campaign tz=%s)",
                            campaign_id,
                            next_at,
                            tz_name,
                        )

                if not next_at:
                    next_at = now + timedelta(minutes=batch_interval_minutes)

                await self.create_campaign_batch_job(campaign_id, scheduled_at=next_at)
                self.logger.info(
                    "Scheduled next batch job for campaign %s at %s (interval=%d min)",
                    campaign_id,
                    next_at,
                    batch_interval_minutes,
                )
            # Log and surface why sent=0 so UI Error/notes column shows it
            if result and result.get("sent", 0) == 0:
                errors = result.get("errors", [])
                err_detail = result.get("message", "") or ("No emails sent" if not errors else (str(len(errors)) + " error(s); first: " + (errors[0].get("error", "") or str(errors[0]))))
                await self.append_job_run(job_id=job_id, status="success", logs=err_detail)
                await self.admin_db.system_jobs.update_one(
                    {"id": job_id, "status": "running"},
                    {"$set": {"status": "success", "finished_at": datetime.now(timezone.utc), "error_message": err_detail[:500]}},
                )
            else:
                await self.append_job_run(job_id=job_id, status="success", logs=f"Sent batch for campaign {campaign_id}")
                await self.admin_db.system_jobs.update_one(
                    {"id": job_id, "status": "running"},
                    {"$set": {"status": "success", "finished_at": datetime.now(timezone.utc)}},
                )
        except Exception as exc:
            self.logger.error("Campaign batch job %s failed: %s", job_id, exc)
            err_msg = str(exc)
            err_truncated = err_msg[:500]
            # Always stop the job and write error to admin logs; do each step so a failure in one doesn't skip the other
            try:
                await self.admin_db.system_jobs.update_one(
                    {"id": job_id, "status": "running"},
                    {
                        "$set": {
                            "status": "failed",
                            "finished_at": datetime.now(timezone.utc),
                            "error_message": err_truncated,
                        }
                    },
                )
            except Exception as update_exc:
                self.logger.error("Failed to mark job %s as failed in system_jobs: %s", job_id, update_exc)
            try:
                await self.append_job_run(job_id=job_id, status="failed", logs=err_msg)
            except Exception as append_exc:
                self.logger.error("Failed to append_job_run (admin log) for job %s: %s", job_id, append_exc)
            # On unexpected failures, pause the campaign and cancel any future pending jobs
            try:
                now = datetime.now(timezone.utc)
                await self.app_db.campaigns.update_one(
                    {"id": campaign_id},
                    {
                        "$set": {
                            "status": "paused",
                            "last_error_note": f"Campaign batch job failed: {err_msg[:400]}",
                            "last_error_at": now,
                            "updated_at": now,
                        }
                    },
                )
                await self.cancel_campaign_jobs(campaign_id)
            except Exception as pause_exc:
                self.logger.error(
                    "Failed to pause campaign %s after batch error: %s",
                    campaign_id,
                    pause_exc,
                )

    async def mark_stale_running_jobs(self) -> int:
        """Handle stuck running jobs (runs every ~60s in automation tick):
        - send_campaign_batch: no heartbeat for HEARTBEAT_STALE_MINUTES (5 min) = process dead → reclaim
        - send_campaign_batch running > STALE_CAMPAIGN_AUTO_RESTART_HOURS (2h): cancel and reschedule
        - Other jobs running > STALE_RUNNING_JOB_HOURS (24h): mark failed.
        Returns total count of jobs updated."""
        now = datetime.now(timezone.utc)
        total_updated = 0

        # 1. send_campaign_batch with stale heartbeat: process likely exited, reclaim (cancel + reschedule)
        heartbeat_cutoff = now - timedelta(minutes=HEARTBEAT_STALE_MINUTES)
        stale_heartbeat_jobs = await self.admin_db.system_jobs.find(
            {
                "job_type": "send_campaign_batch",
                "status": "running",
                "$or": [
                    {"last_heartbeat_at": {"$lt": heartbeat_cutoff}},
                    {"last_heartbeat_at": {"$exists": False}, "started_at": {"$lt": heartbeat_cutoff}},
                ],
            },
            {"id": 1, "action_config": 1},
        ).to_list(None)
        for job in stale_heartbeat_jobs:
            job_id = job["id"]
            campaign_id = (job.get("action_config") or {}).get("campaign_id")
            res = await self.admin_db.system_jobs.update_one(
                {"id": job_id, "status": "running"},
                {
                    "$set": {
                        "status": "cancelled",
                        "finished_at": now,
                        "error_message": f"Process exited (no heartbeat for {HEARTBEAT_STALE_MINUTES} min); reclaimed and rescheduled.",
                    }
                },
            )
            if res.modified_count:
                total_updated += 1
                self.logger.warning(
                    "Reclaimed campaign batch job %s (no heartbeat for %d min); rescheduling in 5 min",
                    job_id,
                    HEARTBEAT_STALE_MINUTES,
                )
                self._batch_log(
                    "reclaimed job_id=%s campaign_id=%s (process exited, no heartbeat); scheduling new batch in 5 min",
                    job_id,
                    campaign_id or "?",
                )
                if campaign_id:
                    campaign = await self.app_db.campaigns.find_one({"id": campaign_id}, {"_id": 0, "status": 1})
                    if campaign and campaign.get("status") == "active":
                        next_at = now + timedelta(minutes=5)
                        await self.create_campaign_batch_job(campaign_id, scheduled_at=next_at)
                        self.logger.info("Scheduled new batch for campaign %s at %s (reclaimed)", campaign_id, next_at)

        # 2. send_campaign_batch jobs running > 2h (fallback for jobs without heartbeat): cancel and reschedule
        campaign_cutoff = now - timedelta(hours=STALE_CAMPAIGN_AUTO_RESTART_HOURS)
        stale_campaign_jobs = await self.admin_db.system_jobs.find(
            {
                "job_type": "send_campaign_batch",
                "status": "running",
                "started_at": {"$lt": campaign_cutoff},
            },
            {"id": 1, "action_config": 1},
        ).to_list(None)

        for job in stale_campaign_jobs:
            job_id = job["id"]
            campaign_id = (job.get("action_config") or {}).get("campaign_id")
            res = await self.admin_db.system_jobs.update_one(
                {"id": job_id, "status": "running"},
                {"$set": {"status": "cancelled", "finished_at": now, "error_message": "Job ran > 6h; auto-stopped and rescheduled in 5 min."}},
            )
            if res.modified_count:
                total_updated += 1
                self.logger.warning(
                    "Auto-stopped campaign batch job %s (running > %dh); rescheduling in 5 min",
                    job_id,
                    STALE_CAMPAIGN_AUTO_RESTART_HOURS,
                )
                self._batch_log(
                    "auto-stopped job_id=%s campaign_id=%s (running > %dh); scheduling new batch in 5 min",
                    job_id,
                    campaign_id or "?",
                    STALE_CAMPAIGN_AUTO_RESTART_HOURS,
                )
                if campaign_id:
                    campaign = await self.app_db.campaigns.find_one({"id": campaign_id}, {"_id": 0, "status": 1})
                    if campaign and campaign.get("status") == "active":
                        next_at = now + timedelta(minutes=5)
                        await self.create_campaign_batch_job(campaign_id, scheduled_at=next_at)
                        self.logger.info("Scheduled new batch for campaign %s at %s", campaign_id, next_at)

        # 2. Any other jobs (or campaign jobs not caught above) running > 24h: mark failed
        long_cutoff = now - timedelta(hours=STALE_RUNNING_JOB_HOURS)
        result = await self.admin_db.system_jobs.update_many(
            {"status": "running", "started_at": {"$lt": long_cutoff}},
            {
                "$set": {
                    "status": "failed",
                    "finished_at": now,
                    "error_message": "Job timed out (worker may have crashed or restarted).",
                }
            },
        )
        total_updated += result.modified_count
        if result.modified_count:
            self.logger.warning("Marked %d stale running jobs as failed", result.modified_count)

        return total_updated

    async def process_pending_jobs(self, limit: int = 20) -> int:
        """Process a batch of pending jobs whose schedule time has passed.

        - send_campaign_batch: atomically claim job (multi-worker safe), run batch in background
          (semaphore-limited so multiple campaigns run in parallel without unbounded concurrency).
        - automation_rule: placeholder (marks success).
        - workflow_step: executes one step in a workflow via WorkflowService (if configured).
        When instance is draining (ASG Terminating:Wait), do not claim new jobs so in-flight work can finish.
        """
        now = datetime.now(timezone.utc)
        await self.mark_stale_running_jobs()

        if os.path.exists(INSTANCE_TERMINATING_FILE):
            self.logger.info("Instance is terminating (draining): skipping new job claims")
            return 0

        # Check ASG lifecycle state directly: closes race where Terminating:Wait happens
        # before termination handler creates the signal file (handler polls every 10s).
        if await self._is_instance_terminating():
            self.logger.info("Instance in Terminating:Wait (ASG): skipping new job claims")
            return 0

        pending_count = await self.admin_db.system_jobs.count_documents(
            {"status": "pending", "scheduled_at": {"$lte": now}}
        )
        running_count = await self.admin_db.system_jobs.count_documents(
            {"job_type": "send_campaign_batch", "status": "running"}
        )
        running_detail = ""
        if running_count > 0:
            running_jobs = await self.admin_db.system_jobs.find(
                {"job_type": "send_campaign_batch", "status": "running"},
                {"id": 1, "action_config.campaign_id": 1, "started_at": 1},
            ).limit(5).to_list(None)
            parts = []
            for j in running_jobs:
                cid = (j.get("action_config") or {}).get("campaign_id") or "?"
                started = j.get("started_at")
                started_str = started.isoformat() if started else "?"
                parts.append(f"job_id={j.get('id')} campaign_id={cid} started={started_str}")
            running_detail = " [" + "; ".join(parts) + "]"
        print(
            f"[CAMPAIGN_BATCH] automation tick: {pending_count} pending job(s) due, {running_count} running{running_detail}",
            flush=True,
        )

        pending_jobs_cursor = self.admin_db.system_jobs.find(
            {
                "status": "pending",
                "scheduled_at": {"$lte": now},
            }
        ).sort("scheduled_at", 1).limit(limit)

        processed = 0
        async for job in pending_jobs_cursor:
            if os.path.exists(INSTANCE_TERMINATING_FILE):
                self.logger.info("Instance terminating detected mid-batch: stopping further job claims")
                break
            job_id = job["id"]
            job_type = job.get("job_type", "automation_rule")

            # DNS verify jobs are intentionally disabled.
            # Domain verification must be user-triggered via manual verify endpoints only.
            if job_type == "dns_verify_domain":
                await self.admin_db.system_jobs.update_one(
                    {"id": job_id, "status": "pending"},
                    {
                        "$set": {
                            "status": "cancelled",
                            "finished_at": datetime.now(timezone.utc),
                            "error_message": "Cancelled: DNS auto-verification jobs are disabled; use manual verify.",
                        }
                    },
                )
                processed += 1
                continue

            if job_type == "send_campaign_batch":
                action_config = job.get("action_config") or {}
                campaign_id = action_config.get("campaign_id")
                if not campaign_id or not self.email_service:
                    self._dev_warn(
                        "process_pending_jobs: job_id=%s missing campaign_id or email_service",
                        job_id,
                    )
                    await self.admin_db.system_jobs.update_one(
                        {"id": job_id},
                        {
                            "$set": {
                                "status": "failed",
                                "error_message": "Missing campaign_id or email_service",
                            }
                        },
                    )
                    processed += 1
                    continue
                # Atomic claim: only one worker runs this job; record instance for per-instance running count in admin
                runner_id = await self._get_ec2_instance_id()
                claim_set = {"status": "running", "started_at": datetime.now(timezone.utc)}
                if runner_id:
                    claim_set["runner_instance_id"] = runner_id
                claimed = await self.admin_db.system_jobs.find_one_and_update(
                    {"id": job_id, "status": "pending"},
                    {"$set": claim_set},
                    return_document=ReturnDocument.AFTER,
                )
                if not claimed:
                    continue  # Another worker claimed it or it was cancelled
                self._batch_log(
                    "claimed job_id=%s campaign_id=%s (batch will run in background)",
                    job_id,
                    campaign_id,
                )
                task = asyncio.create_task(
                    self._run_campaign_batch_with_semaphore(job_id, campaign_id)
                )
                task.add_done_callback(
                    lambda t, jid=job_id, cid=campaign_id: self._log_task_done(t, jid, cid)
                )
                processed += 1
                continue

            if job_type == "dns_verify_domain":
                action_config = job.get("action_config") or {}
                domain_id = action_config.get("domain_id")
                if not domain_id or not self.domain_service:
                    self._dev_warn(
                        "process_pending_jobs: job_id=%s missing domain_id or domain_service",
                        job_id,
                    )
                    await self.admin_db.system_jobs.update_one(
                        {"id": job_id},
                        {
                            "$set": {
                                "status": "failed",
                                "error_message": "Missing domain_id or domain_service",
                            }
                        },
                    )
                    processed += 1
                    continue
                runner_id = await self._get_ec2_instance_id()
                claim_set = {"status": "running", "started_at": datetime.now(timezone.utc)}
                if runner_id:
                    claim_set["runner_instance_id"] = runner_id
                claimed = await self.admin_db.system_jobs.find_one_and_update(
                    {"id": job_id, "status": "pending"},
                    {"$set": claim_set},
                    return_document=ReturnDocument.AFTER,
                )
                if not claimed:
                    continue
                async def _run_dns_verify_wrapper(domain_id_inner: str, job_id_inner: str) -> None:
                    try:
                        result = await self.domain_service.verify_dns_records(domain_id_inner)
                        await self.domain_service.calculate_health_score(domain_id_inner)
                        await self.admin_db.system_jobs.update_one(
                            {"id": job_id_inner, "status": "running"},
                            {"$set": {"status": "success", "finished_at": datetime.now(timezone.utc)}},
                        )
                        self.logger.info("DNS verification completed for domain_id=%s", domain_id_inner)
                    except SendGridRateLimitError as e:
                        now = datetime.now(timezone.utc)
                        reset_utc = e.rate_limit_reset_utc
                        try:
                            from dateutil import parser
                            reset_dt = parser.parse(reset_utc) if isinstance(reset_utc, str) else now + timedelta(seconds=60)
                        except Exception:
                            reset_dt = now + timedelta(seconds=60)
                        if getattr(reset_dt, "tzinfo", None) is None:
                            reset_dt = getattr(reset_dt, "replace", lambda tz=None: reset_dt)(tzinfo=timezone.utc) if hasattr(reset_dt, "replace") else now + timedelta(seconds=60)
                        run_at = reset_dt if isinstance(reset_dt, datetime) else now + timedelta(seconds=60)
                        if hasattr(run_at, "astimezone") and getattr(run_at, "tzinfo", None) is None:
                            run_at = run_at.replace(tzinfo=timezone.utc)
                        await self.admin_db.system_jobs.update_one(
                            {"id": job_id_inner, "status": "running"},
                            {"$set": {"status": "pending", "scheduled_at": run_at}},
                        )
                        self.logger.info(
                            "DNS verify job_id=%s rescheduled for SendGrid rate limit reset at %s",
                            job_id_inner, run_at,
                        )
                    except Exception as exc:
                        self.logger.error("dns_verify_domain job failed job_id=%s domain_id=%s: %s", job_id_inner, domain_id_inner, exc)
                        await self.admin_db.system_jobs.update_one(
                            {"id": job_id_inner, "status": "running"},
                            {"$set": {"status": "failed", "finished_at": datetime.now(timezone.utc), "error_message": str(exc)}},
                        )
                task = asyncio.create_task(_run_dns_verify_wrapper(domain_id, job_id))
                processed += 1
                continue

            if job_type == "dns_verify_domain":
                action_config = job.get("action_config") or {}
                domain_id = action_config.get("domain_id")
                if not domain_id or not self.domain_service:
                    self._dev_warn(
                        "process_pending_jobs: job_id=%s missing domain_id or domain_service",
                        job_id,
                    )
                    await self.admin_db.system_jobs.update_one(
                        {"id": job_id},
                        {
                            "$set": {
                                "status": "failed",
                                "error_message": "Missing domain_id or domain_service",
                            }
                        },
                    )
                    processed += 1
                    continue
                # Atomic claim: only one worker verifies this domain (multi-instance safe)
                runner_id = await self._get_ec2_instance_id()
                claim_set = {"status": "running", "started_at": datetime.now(timezone.utc)}
                if runner_id:
                    claim_set["runner_instance_id"] = runner_id
                claimed = await self.admin_db.system_jobs.find_one_and_update(
                    {"id": job_id, "status": "pending"},
                    {"$set": claim_set},
                    return_document=ReturnDocument.AFTER,
                )
                if not claimed:
                    continue
                # Run verification synchronously (fast, per-domain; no need for background task)
                try:
                    await self.domain_service.verify_dns_records(domain_id)
                    await self.domain_service.calculate_health_score(domain_id)
                    await self.admin_db.system_jobs.update_one(
                        {"id": job_id, "status": "running"},
                        {"$set": {"status": "success", "finished_at": datetime.now(timezone.utc)}},
                    )
                except SendGridRateLimitError as e:
                    # Reschedule for rate limit reset so we retry sooner than next 24h cycle
                    reset_utc = e.rate_limit_reset_utc
                    try:
                        from dateutil import parser
                        reset_dt = parser.parse(reset_utc) if isinstance(reset_utc, str) else datetime.now(timezone.utc) + timedelta(seconds=60)
                    except Exception:
                        reset_dt = datetime.now(timezone.utc) + timedelta(seconds=60)
                    if getattr(reset_dt, "tzinfo", None) is None:
                        reset_dt = reset_dt.replace(tzinfo=timezone.utc)
                    await self.admin_db.system_jobs.update_one(
                        {"id": job_id, "status": "running"},
                        {"$set": {"status": "pending", "scheduled_at": reset_dt}},
                    )
                    self.logger.info(
                        "dns_verify_domain job_id=%s domain_id=%s rate limited; rescheduled for %s",
                        job_id, domain_id, reset_dt,
                    )
                except Exception as exc:
                    self.logger.error("dns_verify_domain job_id=%s domain_id=%s failed: %s", job_id, domain_id, exc)
                    await self.append_job_run(job_id=job_id, status="failed", logs=str(exc))
                    await self.admin_db.system_jobs.update_one(
                        {"id": job_id, "status": "running"},
                        {
                            "$set": {
                                "status": "failed",
                                "finished_at": datetime.now(timezone.utc),
                                "error_message": str(exc)[:500],
                            }
                        },
                    )
                processed += 1
                continue

            if job_type == "dns_verify_domain":
                action_config = job.get("action_config") or {}
                domain_id = action_config.get("domain_id")
                if not domain_id or not self.domain_service:
                    self._dev_warn(
                        "process_pending_jobs: job_id=%s missing domain_id or domain_service",
                        job_id,
                    )
                    await self.admin_db.system_jobs.update_one(
                        {"id": job_id},
                        {
                            "$set": {
                                "status": "failed",
                                "error_message": "Missing domain_id or domain_service",
                            }
                        },
                    )
                    processed += 1
                    continue
                # Atomic claim: only one instance runs this job
                runner_id = await self._get_ec2_instance_id()
                claim_set = {"status": "running", "started_at": datetime.now(timezone.utc)}
                if runner_id:
                    claim_set["runner_instance_id"] = runner_id
                claimed = await self.admin_db.system_jobs.find_one_and_update(
                    {"id": job_id, "status": "pending"},
                    {"$set": claim_set},
                    return_document=ReturnDocument.AFTER,
                )
                if not claimed:
                    continue
                # Run verification synchronously (quick; no need for background task)
                try:
                    await self.domain_service.verify_dns_records(domain_id)
                    await self.domain_service.calculate_health_score(domain_id)
                    await self.admin_db.system_jobs.update_one(
                        {"id": job_id, "status": "running"},
                        {
                            "$set": {
                                "status": "success",
                                "finished_at": datetime.now(timezone.utc),
                            }
                        },
                    )
                except SendGridRateLimitError as e:
                    # Reschedule for rate limit reset
                    reset_utc = e.rate_limit_reset_utc
                    reset_dt = datetime.now(timezone.utc) + timedelta(seconds=60)
                    if reset_utc:
                        try:
                            from dateutil import parser
                            reset_dt = parser.parse(reset_utc) if isinstance(reset_utc, str) else reset_dt
                            if getattr(reset_dt, "tzinfo", None) is None:
                                reset_dt = reset_dt.replace(tzinfo=timezone.utc)
                        except Exception:
                            pass
                    await self.admin_db.system_jobs.update_one(
                        {"id": job_id, "status": "running"},
                        {
                            "$set": {
                                "status": "pending",
                                "scheduled_at": reset_dt,
                                "started_at": None,
                                "runner_instance_id": None,
                            }
                        },
                    )
                    self.logger.info(
                        "dns_verify_domain job_id=%s domain_id=%s hit SendGrid rate limit; rescheduled for %s",
                        job_id, domain_id, reset_dt,
                    )
                except Exception as exc:
                    self.logger.error(
                        "dns_verify_domain job failed job_id=%s domain_id=%s: %s",
                        job_id, domain_id, exc,
                    )
                    await self.admin_db.system_jobs.update_one(
                        {"id": job_id, "status": "running"},
                        {
                            "$set": {
                                "status": "failed",
                                "finished_at": datetime.now(timezone.utc),
                                "error_message": str(exc)[:500],
                            }
                        },
                    )
                processed += 1
                continue

            if job_type == "dns_verify_domain":
                action_config = job.get("action_config") or {}
                domain_id = action_config.get("domain_id")
                if not domain_id or not self.domain_service:
                    self._dev_warn(
                        "process_pending_jobs: job_id=%s missing domain_id or domain_service",
                        job_id,
                    )
                    await self.admin_db.system_jobs.update_one(
                        {"id": job_id},
                        {
                            "$set": {
                                "status": "failed",
                                "error_message": "Missing domain_id or domain_service",
                            }
                        },
                    )
                    processed += 1
                    continue
                runner_id = await self._get_ec2_instance_id()
                claim_set = {"status": "running", "started_at": datetime.now(timezone.utc)}
                if runner_id:
                    claim_set["runner_instance_id"] = runner_id
                claimed = await self.admin_db.system_jobs.find_one_and_update(
                    {"id": job_id, "status": "pending"},
                    {"$set": claim_set},
                    return_document=ReturnDocument.AFTER,
                )
                if not claimed:
                    continue

                async def _run_dns_verify(job_id_inner: str, domain_id_inner: str) -> None:
                    try:
                        result = await self.domain_service.verify_dns_records(domain_id_inner)
                        await self.domain_service.calculate_health_score(domain_id_inner)
                        await self.admin_db.system_jobs.update_one(
                            {"id": job_id_inner, "status": "running"},
                            {
                                "$set": {
                                    "status": "success",
                                    "finished_at": datetime.now(timezone.utc),
                                }
                            },
                        )
                        logging.info("DNS verified for domain_id=%s", domain_id_inner)
                        rl = result.get("rate_limit_sendgrid") if isinstance(result, dict) else None
                        if rl and str(rl.get("remaining", "")) == "0":
                            self.logger.info(
                                "SendGrid rate limit at 0 for domain %s; next cycle will retry remaining domains",
                                domain_id_inner,
                            )
                    except SendGridRateLimitError as e:
                        reset_utc = e.rate_limit_reset_utc
                        try:
                            from dateutil import parser
                            reset_dt = parser.parse(reset_utc) if isinstance(reset_utc, str) else reset_utc
                        except Exception:
                            reset_dt = datetime.now(timezone.utc) + timedelta(seconds=60)
                        if getattr(reset_dt, "tzinfo", None) is None:
                            reset_dt = reset_dt.replace(tzinfo=timezone.utc)
                        await self.admin_db.system_jobs.update_one(
                            {"id": job_id_inner, "status": "running"},
                            {
                                "$set": {
                                    "status": "pending",
                                    "scheduled_at": reset_dt,
                                    "started_at": None,
                                    "runner_instance_id": None,
                                }
                            },
                        )
                        self.logger.info(
                            "dns_verify_domain job_id=%s rate limited; rescheduled for %s",
                            job_id_inner,
                            reset_dt,
                        )
                    except Exception as exc:
                        self.logger.error(
                            "dns_verify_domain job failed job_id=%s domain_id=%s: %s",
                            job_id_inner,
                            domain_id_inner,
                            exc,
                        )
                        await self.admin_db.system_jobs.update_one(
                            {"id": job_id_inner, "status": "running"},
                            {
                                "$set": {
                                    "status": "failed",
                                    "finished_at": datetime.now(timezone.utc),
                                    "error_message": str(exc),
                                }
                            },
                        )

                asyncio.create_task(_run_dns_verify(job_id, domain_id))
                processed += 1
                continue

            if job_type == "dns_verify_domain":
                action_config = job.get("action_config") or {}
                domain_id = action_config.get("domain_id")
                if not domain_id or not self.domain_service:
                    self._dev_warn(
                        "process_pending_jobs: job_id=%s missing domain_id or domain_service",
                        job_id,
                    )
                    await self.admin_db.system_jobs.update_one(
                        {"id": job_id},
                        {
                            "$set": {
                                "status": "failed",
                                "error_message": "Missing domain_id or domain_service",
                            }
                        },
                    )
                    processed += 1
                    continue
                # Atomic claim: only one worker runs this job
                runner_id = await self._get_ec2_instance_id()
                claim_set = {"status": "running", "started_at": datetime.now(timezone.utc)}
                if runner_id:
                    claim_set["runner_instance_id"] = runner_id
                claimed = await self.admin_db.system_jobs.find_one_and_update(
                    {"id": job_id, "status": "pending"},
                    {"$set": claim_set},
                    return_document=ReturnDocument.AFTER,
                )
                if not claimed:
                    continue
                # Run verification synchronously (fast: DNS + API calls per domain)
                asyncio.create_task(
                    self._run_dns_verify_job(job_id, domain_id)
                )
                processed += 1
                continue

            if job_type == "dns_verify_domain":
                action_config = job.get("action_config") or {}
                domain_id = action_config.get("domain_id")
                if not domain_id or not self.domain_service:
                    self._dev_warn(
                        "process_pending_jobs: job_id=%s missing domain_id or domain_service",
                        job_id,
                    )
                    await self.admin_db.system_jobs.update_one(
                        {"id": job_id},
                        {
                            "$set": {
                                "status": "failed",
                                "error_message": "Missing domain_id or domain_service",
                            }
                        },
                    )
                    processed += 1
                    continue
                runner_id = await self._get_ec2_instance_id()
                claim_set = {"status": "running", "started_at": datetime.now(timezone.utc)}
                if runner_id:
                    claim_set["runner_instance_id"] = runner_id
                claimed = await self.admin_db.system_jobs.find_one_and_update(
                    {"id": job_id, "status": "pending"},
                    {"$set": claim_set},
                    return_document=ReturnDocument.AFTER,
                )
                if not claimed:
                    continue
                asyncio.create_task(
                    self._run_dns_verify_domain_and_finish(job_id, domain_id)
                )
                processed += 1
                continue

            if job_type == "workflow_step":
                action_config = job.get("action_config") or {}
                workflow_run_id = action_config.get("workflow_run_id")
                node_id = action_config.get("node_id")
                if not self.workflow_service or not workflow_run_id or not node_id:
                    self._dev_warn(
                        "process_pending_jobs: job_id=%s missing workflow_run_id/node_id or workflow_service",
                        job_id,
                    )
                    await self.admin_db.system_jobs.update_one(
                        {"id": job_id},
                        {
                            "$set": {
                                "status": "failed",
                                "error_message": "Missing workflow_run_id/node_id or workflow_service",
                            }
                        },
                    )
                    processed += 1
                    continue

                runner_id = await self._get_ec2_instance_id()
                claim_set = {"status": "running", "started_at": datetime.now(timezone.utc)}
                if runner_id:
                    claim_set["runner_instance_id"] = runner_id
                claimed = await self.admin_db.system_jobs.find_one_and_update(
                    {"id": job_id, "status": "pending"},
                    {"$set": claim_set},
                    return_document=ReturnDocument.AFTER,
                )
                if not claimed:
                    continue

                async def _run_workflow_wrapper(
                    workflow_run_id_inner: str, node_id_inner: str, job_id_inner: str
                ) -> None:
                    try:
                        await self.workflow_service.run_step(
                            workflow_run_id=workflow_run_id_inner,
                            node_id=node_id_inner,
                        )
                        await self.admin_db.system_jobs.update_one(
                            {"id": job_id_inner, "status": "running"},
                            {
                                "$set": {
                                    "status": "success",
                                    "finished_at": datetime.now(timezone.utc),
                                }
                            },
                        )
                    except Exception as exc:  # pragma: no cover - defensive
                        self.logger.error(
                            "workflow_step job failed job_id=%s run_id=%s node_id=%s: %s",
                            job_id_inner,
                            workflow_run_id_inner,
                            node_id_inner,
                            exc,
                        )
                        await self.admin_db.system_jobs.update_one(
                            {"id": job_id_inner, "status": "running"},
                            {
                                "$set": {
                                    "status": "failed",
                                    "finished_at": datetime.now(timezone.utc),
                                    "error_message": str(exc),
                                }
                            },
                        )

                task = asyncio.create_task(
                    _run_workflow_wrapper(workflow_run_id, node_id, job_id)
                )
                processed += 1
                continue

            # Default: automation_rule placeholder (record instance for per-instance running count in admin)
            runner_id = await self._get_ec2_instance_id()
            run_set = {"status": "running", "started_at": datetime.now(timezone.utc)}
            if runner_id:
                run_set["runner_instance_id"] = runner_id
            try:
                await self.admin_db.system_jobs.update_one(
                    {"id": job_id},
                    {"$set": run_set},
                )
                log_message = f"Processed job {job_id} for rule {job.get('rule_id')}"
                await self.append_job_run(job_id=job_id, status="success", logs=log_message)
                # Only set success if job was not force-stopped (still running)
                await self.admin_db.system_jobs.update_one(
                    {"id": job_id, "status": "running"},
                    {"$set": {"status": "success", "finished_at": datetime.now(timezone.utc)}},
                )
                processed += 1
            except Exception as exc:
                self.logger.error("Error processing job %s: %s", job_id, exc)
                await self.append_job_run(job_id=job_id, status="failed", logs=str(exc))
                # Only set failed if job was not force-stopped (still running)
                await self.admin_db.system_jobs.update_one(
                    {"id": job_id, "status": "running"},
                    {
                        "$set": {
                            "status": "failed",
                            "finished_at": datetime.now(timezone.utc),
                            "error_message": str(exc),
                        }
                    },
                )

        if processed:
            self.logger.info("Processed %d automation jobs", processed)
        return processed

