import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from config import (
    BLOCKED_CONTACT_CLEANUP_INTERVAL_HOURS,
    EMAIL_LOG_CLEANUP_INTERVAL_HOURS,
)
from services.blocked_contacts_cleanup_service import cleanup_expired_blocked_contacts
from services.email_logs_cleanup_service import (
    cleanup_stale_inbound_messages,
    cleanup_stale_email_logs,
    cleanup_stale_tracking_pixels,
)

class BackgroundTasks:
    def __init__(
        self,
        db,
        domain_service,
        admin_db=None,
        automation_service=None,
        warmup_sender_service=None,
        warmup_receiver_service=None,
        lifecycle_automation_service=None,
    ):
        self.db = db
        self.domain_service = domain_service
        self.admin_db = admin_db
        self.automation_service = automation_service
        self.warmup_sender_service = warmup_sender_service
        self.warmup_receiver_service = warmup_receiver_service
        self.lifecycle_automation_service = lifecycle_automation_service
        self.running = False
    
    async def start(self):
        """Start background tasks."""
        self.running = True
        asyncio.create_task(self._daily_reset_loop())
        asyncio.create_task(self._warmup_tracking_loop())
        asyncio.create_task(self._weekly_report_loop())
        asyncio.create_task(self._blocked_contacts_cleanup_loop())
        asyncio.create_task(self._email_logs_cleanup_loop())
        if self.warmup_sender_service is not None:
            asyncio.create_task(self._warmup_sender_loop())
            asyncio.create_task(self._shared_pool_credit_settlement_loop())
        if self.warmup_receiver_service is not None:
            asyncio.create_task(self._warmup_receiver_loop())
        if self.automation_service is not None:
            asyncio.create_task(self._automation_loop())
            print("[CAMPAIGN_BATCH] background tasks started (automation loop will run every 60s)", flush=True)
        else:
            print("[CAMPAIGN_BATCH] WARNING: automation_service is None - campaign batch jobs will NOT run", flush=True)
        logging.info("Background tasks started")
    
    async def stop(self):
        """Stop background tasks."""
        self.running = False
        logging.info("Background tasks stopped")

    async def _blocked_contacts_cleanup_loop(self):
        """Every 24h (configurable), unlink and delete long-blocked contacts in bulk."""
        interval_hours = max(1, int(BLOCKED_CONTACT_CLEANUP_INTERVAL_HOURS))
        interval_seconds = interval_hours * 3600
        while self.running:
            try:
                result = await cleanup_expired_blocked_contacts(self.db)
                blocked_deleted = int((result.get("blocked") or {}).get("deleted_contacts", 0))
                unused_deleted = int((result.get("unused") or {}).get("deleted_contacts", 0))
                total_deleted = int(result.get("deleted_contacts_total", 0))
                if total_deleted > 0:
                    logging.info(
                        "Contact cleanup: total_deleted=%s blocked_deleted=%s unused_deleted=%s",
                        total_deleted,
                        blocked_deleted,
                        unused_deleted,
                    )
                await asyncio.sleep(interval_seconds)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logging.error("Error in blocked contacts cleanup loop: %s", e)
                await asyncio.sleep(min(300, interval_seconds))

    async def _email_logs_cleanup_loop(self):
        """Every 24h (configurable), delete stale email_logs/tracking_pixels/inbound_messages in bulk."""
        interval_hours = max(1, int(EMAIL_LOG_CLEANUP_INTERVAL_HOURS))
        interval_seconds = interval_hours * 3600
        while self.running:
            try:
                email_logs_result = await cleanup_stale_email_logs(self.db)
                tracking_pixels_result = await cleanup_stale_tracking_pixels(self.db)
                inbound_messages_result = await cleanup_stale_inbound_messages(self.db)
                deleted_email_logs = int(email_logs_result.get("deleted_email_logs", 0))
                deleted_tracking_pixels = int(
                    tracking_pixels_result.get("deleted_tracking_pixels", 0)
                )
                deleted_inbound_messages = int(
                    inbound_messages_result.get("deleted_inbound_messages", 0)
                )
                if (
                    deleted_email_logs > 0
                    or deleted_tracking_pixels > 0
                    or deleted_inbound_messages > 0
                ):
                    logging.info(
                        "Email/tracking/inbound cleanup: deleted_email_logs=%s deleted_tracking_pixels=%s deleted_inbound_messages=%s retention_days=%s",
                        deleted_email_logs,
                        deleted_tracking_pixels,
                        deleted_inbound_messages,
                        int(email_logs_result.get("retention_days", 0)),
                    )
                await asyncio.sleep(interval_seconds)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logging.error("Error in email/tracking/inbound cleanup loop: %s", e)
                await asyncio.sleep(min(300, interval_seconds))
    
    async def _daily_reset_loop(self):
        """Global daily reset: at 00:00–00:05 UTC, reset sent_today for all inboxes; set warmup targets and run spam-to-inbox pass."""
        while self.running:
            try:
                now = datetime.now(timezone.utc)
                today_midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
                # If we're in the 00:00–00:05 UTC window, run reset and warmup midnight tasks now
                if now < today_midnight + timedelta(minutes=5):
                    await self._reset_daily_counters()
                    await self._warmup_midnight_tasks()
                    next_midnight = today_midnight + timedelta(days=1)
                else:
                    next_midnight = today_midnight + timedelta(days=1)
                sleep_seconds = (next_midnight - now).total_seconds()
                if sleep_seconds < 0:
                    sleep_seconds += 86400
                await asyncio.sleep(sleep_seconds)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logging.error(f"Error in daily reset loop: {e}")
                await asyncio.sleep(300)

    async def _warmup_sender_loop(self):
        """Send warm-up emails from all warming inboxes to the platform receiver pool. Runs every 10 min."""
        while self.running and self.warmup_sender_service is not None:
            try:
                result = await self.warmup_sender_service.run(max_sends_per_inbox_per_run=3)
                if result.get("sent_count", 0) > 0:
                    logging.info(
                        "Warmup sender: sent %s, errors %s",
                        result.get("sent_count", 0),
                        result.get("error_count", 0),
                    )
                await asyncio.sleep(600)  # 10 minutes
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logging.error("Error in warmup sender loop: %s", e)
                await asyncio.sleep(300)

    async def _warmup_receiver_loop(self):
        """Open warm-up emails, move from spam, send replies from template pool. Runs every 5 min."""
        while self.running and self.warmup_receiver_service is not None:
            try:
                result = await self.warmup_receiver_service.run(max_replies_per_account_per_run=2)
                if any((result.get("moved_from_spam", 0), result.get("opened", 0), result.get("replied", 0))):
                    logging.info(
                        "Warmup receiver: moved_from_spam=%s opened=%s replied=%s",
                        result.get("moved_from_spam", 0),
                        result.get("opened", 0),
                        result.get("replied", 0),
                    )
                await asyncio.sleep(300)  # 5 minutes
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logging.error("Error in warmup receiver loop: %s", e)
                await asyncio.sleep(300)

    async def _shared_pool_credit_settlement_loop(self):
        """Settle held shared-pool credits every 30 minutes.

        Rewards the contact owner when a reply is detected on the warmup email.
        Refunds the sender after 48 hours if no qualifying reply occurred.
        """
        while self.running and self.warmup_sender_service is not None:
            try:
                result = await self.warmup_sender_service.settle_held_shared_pool_credits()
                if result.get("rewarded", 0) or result.get("refunded", 0):
                    logging.info(
                        "Shared-pool credit settlement: rewarded=%s refunded=%s",
                        result.get("rewarded", 0),
                        result.get("refunded", 0),
                    )
                await asyncio.sleep(1800)  # 30 minutes
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logging.error("Error in shared pool credit settlement loop: %s", e)
                await asyncio.sleep(300)

    async def _warmup_tracking_loop(self):
        """Update inbox warmup progress for warming inboxes. Robust: per-inbox isolation, small delay between updates."""
        while self.running:
            try:
                warming_inboxes = await self.db.inboxes.find({"status": "warming"}).to_list(None)
                for i, inbox in enumerate(warming_inboxes):
                    if not self.running:
                        break
                    inbox_id = inbox.get("id") if isinstance(inbox, dict) else None
                    if not inbox_id:
                        continue
                    try:
                        await self._update_warmup_progress(inbox_id)
                    except Exception as e:
                        logging.error("Error updating warmup for inbox %s: %s", inbox_id, e)
                    # Small delay between inboxes to avoid DB thundering herd with many warming inboxes
                    if i < len(warming_inboxes) - 1:
                        await asyncio.sleep(0.5)
                await asyncio.sleep(3600)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logging.error("Error in warmup tracking loop: %s", e)
                await asyncio.sleep(300)
    
    async def _weekly_report_loop(self):
        """Once per week (Monday 00:05 UTC), send weekly report emails to users who have the preference enabled."""
        while self.running:
            try:
                now = datetime.now(timezone.utc)
                days_until_monday = (7 - now.weekday()) % 7
                next_run = (now + timedelta(days=days_until_monday)).replace(hour=0, minute=5, second=0, microsecond=0)
                if now >= next_run:
                    next_run += timedelta(days=7)
                sleep_seconds = max(60.0, (next_run - now).total_seconds())
                await asyncio.sleep(sleep_seconds)
                if not self.running:
                    break
                from services.notification_service import notification_service
                if not notification_service:
                    continue
                week_ago = now - timedelta(days=7)
                user_ids = await self.db.email_logs.distinct("user_id", {"sent_at": {"$gte": week_ago}})
                for uid in user_ids:
                    if not self.running:
                        break
                    try:
                        sent = await self.db.email_logs.count_documents(
                            {"user_id": uid, "sent_at": {"$gte": week_ago}, "status": {"$ne": "pending"}}
                        )
                        opened = await self.db.email_logs.count_documents(
                            {"user_id": uid, "sent_at": {"$gte": week_ago}, "status": {"$in": ["opened", "clicked", "replied"]}}
                        )
                        replied = await self.db.email_logs.count_documents(
                            {"user_id": uid, "sent_at": {"$gte": week_ago}, "status": "replied"}
                        )
                        from services.email_templates import weekly_report
                        subject, body_plain, body_html = weekly_report(sent, opened, replied)
                        await notification_service.send_notification_if_enabled(
                            uid, "weekly_reports", subject, body_plain, body_html
                        )
                    except Exception as e:
                        logging.warning("Weekly report for user %s failed: %s", uid, e)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logging.error("Error in weekly report loop: %s", e)
                await asyncio.sleep(3600)

    async def _reset_daily_counters(self):
        """Reset sent_today counter for all inboxes."""
        result = await self.db.inboxes.update_many(
            {},
            {"$set": {"sent_today": 0}}
        )
        logging.info(f"Reset daily counters for {result.modified_count} inboxes")

    def _compute_warmup_day_index(self, inbox: Dict[str, Any], now_utc: datetime) -> int:
        """
        1..30 warmup day index based on warmup_started_at (preferred) or created_at.
        Clamped to keep phase logic stable and bounded.
        """
        start_at = inbox.get("warmup_started_at") or inbox.get("created_at")
        if isinstance(start_at, str):
            try:
                from dateutil import parser
                start_at = parser.parse(start_at)
            except Exception:
                start_at = now_utc
        elif not isinstance(start_at, datetime):
            start_at = now_utc

        if getattr(start_at, "tzinfo", None) is None and hasattr(start_at, "replace"):
            start_at = start_at.replace(tzinfo=timezone.utc)

        try:
            days_since_start = max(0, (now_utc - start_at).days)
        except Exception:
            days_since_start = 0
        return min(30, max(1, days_since_start + 1))

    def _compute_warmup_targets_for_day(
        self,
        day: int,
        daily_limit_goal: int,
        prev_open_rate: Optional[float] = None,
        prev_reply_rate: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        30-day warmup plan aligned with phase targets requested by product:
        high engagement at start, then gradual realism.
        The plan's send counts are authored on a 50/day baseline and
        scaled to each inbox daily_limit_goal.
        """
        # Keep signature compatibility; current strategy uses explicit day table.
        _ = prev_open_rate
        _ = prev_reply_rate

        d = min(30, max(1, int(day)))
        goal = max(1, min(50, int(daily_limit_goal or 50)))

        # (baseline_daily_cap_for_goal_50, open_rate, reply_rate, phase)
        # Mirrors the provided plan:
        # Phase 1 day 1-7, Phase 2 day 8-15, Phase 3 day 16-23, Phase 4 day 24-30.
        plan_by_day = {
            1:  (5, 1.00, 0.60, "phase_1_gentle_start"),
            2:  (8, 1.00, 0.60, "phase_1_gentle_start"),
            3:  (10, 1.00, 0.55, "phase_1_gentle_start"),
            4:  (12, 1.00, 0.55, "phase_1_gentle_start"),
            5:  (15, 0.95, 0.50, "phase_1_gentle_start"),
            6:  (18, 0.95, 0.50, "phase_1_gentle_start"),
            7:  (20, 0.92, 0.45, "phase_1_gentle_start"),
            8:  (22, 0.95, 0.45, "phase_2_build_consistency"),
            9:  (25, 0.95, 0.45, "phase_2_build_consistency"),
            10: (28, 0.92, 0.40, "phase_2_build_consistency"),
            11: (30, 0.92, 0.40, "phase_2_build_consistency"),
            12: (32, 0.90, 0.40, "phase_2_build_consistency"),
            13: (35, 0.90, 0.38, "phase_2_build_consistency"),
            14: (38, 0.88, 0.38, "phase_2_build_consistency"),
            15: (40, 0.88, 0.35, "phase_2_build_consistency"),
            16: (42, 0.90, 0.35, "phase_3_natural_behavior"),
            17: (45, 0.88, 0.35, "phase_3_natural_behavior"),
            18: (45, 0.88, 0.32, "phase_3_natural_behavior"),
            19: (48, 0.85, 0.32, "phase_3_natural_behavior"),
            20: (50, 0.85, 0.30, "phase_3_natural_behavior"),
            21: (50, 0.85, 0.30, "phase_3_natural_behavior"),
            22: (50, 0.83, 0.28, "phase_3_natural_behavior"),
            23: (50, 0.83, 0.28, "phase_3_natural_behavior"),
            24: (50, 0.85, 0.28, "phase_4_steady_state"),
            25: (50, 0.82, 0.25, "phase_4_steady_state"),
            26: (50, 0.82, 0.25, "phase_4_steady_state"),
            27: (50, 0.80, 0.25, "phase_4_steady_state"),
            28: (50, 0.80, 0.22, "phase_4_steady_state"),
            29: (50, 0.78, 0.22, "phase_4_steady_state"),
            30: (50, 0.78, 0.20, "phase_4_steady_state"),
        }
        baseline_cap_50, open_rate, reply_rate, phase = plan_by_day[d]

        # Scale authored baseline cap (for goal=50) to current inbox goal.
        # Example: goal=25 halves the authored counts for each day.
        scale = goal / 50.0
        daily_cap = int(round(baseline_cap_50 * scale))
        daily_cap = max(1, min(goal, daily_cap))

        return {
            "phase": phase,
            "day": d,
            "daily_limit": daily_cap,
            "warmup_target_open_rate": open_rate,
            "warmup_target_reply_rate": reply_rate,
        }

    async def _warmup_midnight_tasks(self):
        """At midnight: reset warmup daily behavior targets/caps for warming inboxes; run spam-to-inbox pass for receivers."""
        try:
            now_utc = datetime.now(timezone.utc)
            warming = await self.db.inboxes.find(
                {"status": "warming", "auto_warmup": True},
                {
                    "id": 1,
                    "created_at": 1,
                    "warmup_started_at": 1,
                    "daily_limit": 1,
                    "warmup_daily_limit_goal": 1,
                    "warmup_target_open_rate": 1,
                    "warmup_target_reply_rate": 1,
                },
            ).to_list(None)
            for inbox in warming:
                inbox_id = inbox.get("id")
                if not inbox_id:
                    continue
                day_index = self._compute_warmup_day_index(inbox, now_utc)
                goal = inbox.get("warmup_daily_limit_goal")
                if goal is None:
                    goal = inbox.get("daily_limit", 50)
                goal = max(1, min(50, int(goal or 50)))
                plan = self._compute_warmup_targets_for_day(
                    day_index,
                    daily_limit_goal=goal,
                    prev_open_rate=inbox.get("warmup_target_open_rate"),
                    prev_reply_rate=inbox.get("warmup_target_reply_rate"),
                )
                await self.db.inboxes.update_one(
                    {"id": inbox_id},
                    {
                        "$set": {
                            "warmup_daily_limit_goal": goal,
                            "daily_limit": int(plan["daily_limit"]),
                            "warmup_target_open_rate": float(plan["warmup_target_open_rate"]),
                            "warmup_target_reply_rate": float(plan["warmup_target_reply_rate"]),
                            "warmup_phase": plan["phase"],
                            "warmup_plan_day": int(plan["day"]),
                            "updated_at": now_utc,
                        }
                    },
                )
            if warming:
                logging.info(
                    "Warmup midnight: set phased daily caps + open/reply targets for %s warming inboxes",
                    len(warming),
                )
            if self.warmup_receiver_service is not None:
                moved = await self.warmup_receiver_service.run_spam_to_inbox_only()
                if moved > 0:
                    logging.info("Warmup midnight: moved %s messages from spam to inbox (report not spam)", moved)
        except Exception as e:
            logging.error("Error in warmup midnight tasks: %s", e)
    
    async def _update_warmup_progress(self, inbox_id: str):
        """Update warmup progress for an inbox. Uses warmup_started_at when set (e.g. after 'warm again'),
        otherwise days since creation. Robust: safe date parsing, no div-by-zero, only transition warming->ready."""
        inbox = await self.db.inboxes.find_one({"id": inbox_id})
        if not inbox:
            return
        current_status = inbox.get("status") or "warming"
        # Only update progress for inboxes that are actually warming; leave paused/ready unchanged
        if current_status != "warming":
            return

        sent_today = int(inbox.get("sent_today") or 0)
        daily_limit = max(1, int(inbox.get("daily_limit") or 50))
        now_utc = datetime.now(timezone.utc)

        start_at = inbox.get("warmup_started_at") or inbox.get("created_at")
        if isinstance(start_at, str):
            try:
                from dateutil import parser
                start_at = parser.parse(start_at)
            except Exception:
                start_at = now_utc
        elif not isinstance(start_at, datetime):
            start_at = now_utc
        if getattr(start_at, "tzinfo", None) is None and hasattr(start_at, "replace"):
            start_at = start_at.replace(tzinfo=timezone.utc)

        try:
            days_since_start = max(0, (now_utc - start_at).days)
        except Exception:
            days_since_start = 0

        # Warmup over 7 days; progress 0-100
        new_progress = min(100, (days_since_start / 7.0) * 100.0)
        if sent_today > 0 and daily_limit > 0:
            activity_bonus = min(10.0, (sent_today / daily_limit) * 10.0)
            new_progress = min(100.0, new_progress + activity_bonus)
        new_progress = int(round(new_progress))

        new_status = "ready" if new_progress >= 100 else "warming"

        await self.db.inboxes.update_one(
            {"id": inbox_id},
            {
                "$set": {
                    "warmup_progress": new_progress,
                    "status": new_status,
                    "updated_at": now_utc,
                }
            },
        )

    async def _automation_loop(self):
        """Periodically process pending automation jobs.

        This delegates to AutomationService so that rules and jobs created via
        the admin APIs can be executed over time.
        """
        print("[CAMPAIGN_BATCH] automation loop started (runs every 60s)", flush=True)
        while self.running and self.automation_service is not None:
            try:
                if self.lifecycle_automation_service is not None:
                    await self.lifecycle_automation_service.process_due_sends()
                await self.automation_service.process_pending_jobs()
                # Process automation jobs roughly once per minute
                await asyncio.sleep(60)
            except asyncio.CancelledError:
                print("[CAMPAIGN_BATCH] automation loop cancelled", flush=True)
                raise
            except Exception as e:  # pragma: no cover - defensive logging
                logging.error(f"Error in automation loop: {e}")
                print(f"[CAMPAIGN_BATCH] automation loop error: {e}", flush=True)
                await asyncio.sleep(60)
