"""Lifecycle email automation service for trial-to-paid journeys."""

from __future__ import annotations

import logging
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Optional

from services.lifecycle_email_templates import lifecycle_templates


logger = logging.getLogger(__name__)

LIFECYCLE_NOTIFICATION_TYPE = "lifecycle_automation"


class LifecycleAutomationService:
    """Drip automation engine with idempotent send ledger."""

    def __init__(self, db_handle, smtp_service):
        self.db = db_handle
        self.smtp_service = smtp_service
        self.dashboard_url = os.getenv("FRONTEND_URL", "http://localhost:8080").rstrip("/")
        # Tracking pixels, CTA redirects, and unsubscribe must hit the API (FastAPI), not the Next.js site.
        self.tracking_base_url = (
            os.getenv("TRACKING_BASE_URL") or os.getenv("BACKEND_URL") or "http://localhost:8001"
        ).rstrip("/")
        self.book_demo_url = os.getenv("BOOK_DEMO_URL", "http://localhost:8080/book-demo")
        self.templates = lifecycle_templates(self.dashboard_url, self.book_demo_url)
        self.dry_run = os.getenv("LIFECYCLE_DRY_RUN", "").strip().lower() in ("1", "true", "yes")

    async def emit_event(self, user_id: str, event_name: str, payload: Optional[Dict[str, Any]] = None) -> None:
        """Record event and schedule relevant lifecycle emails."""
        now = datetime.now(timezone.utc)
        payload = payload or {}
        await self.db.lifecycle_events.insert_one(
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "event_name": event_name,
                "payload": payload,
                "created_at": now,
            }
        )
        await self.db.lifecycle_journeys.update_one(
            {"user_id": user_id, "journey_name": "trial_to_paid"},
            {
                "$setOnInsert": {
                    "id": str(uuid.uuid4()),
                    "user_id": user_id,
                    "journey_name": "trial_to_paid",
                    "created_at": now,
                },
                "$set": {"updated_at": now},
            },
            upsert=True,
        )

        if event_name == "signup_confirmed":
            await self._schedule_once(user_id, "email_1", now)
            await self._schedule_once(user_id, "email_2", now + timedelta(hours=24))
            await self._schedule_once(user_id, "email_4", now + timedelta(days=3))
            await self._schedule_once(user_id, "email_6", now + timedelta(days=5))
            await self._schedule_once(user_id, "email_7", now + timedelta(days=6))
            await self._schedule_once(user_id, "email_8", now + timedelta(days=7))
            return

        if event_name == "domain_verified":
            await self._schedule_once(user_id, "email_3", now)
            return

        if event_name == "inbox_created":
            await self._schedule_once(user_id, "email_5", now)
            return

        if event_name == "first_campaign_sent":
            await self._schedule_once(user_id, "email_9", now)
            return

        if event_name == "payment_confirmed":
            cycle_end = (payload.get("cycle_end") or "").strip()
            await self._schedule_once(
                user_id,
                "email_10",
                now,
                idempotency_suffix=cycle_end,
            )
            await self._schedule_once(
                user_id,
                "email_11",
                now + timedelta(days=3),
                idempotency_suffix=cycle_end,
            )
            await self._schedule_once(
                user_id,
                "email_12",
                now + timedelta(days=7),
                idempotency_suffix=cycle_end,
            )
            return

        if event_name == "subscription_renewed":
            cycle_end = (payload.get("cycle_end") or "").strip()
            if cycle_end:
                await self._cancel_pending_renewal_reminders(user_id, cycle_end)
            await self._schedule_once(
                user_id,
                "renewal_email_6",
                now,
                idempotency_suffix=cycle_end or now.date().isoformat(),
            )
            return

    async def process_due_sends(self, limit: int = 100) -> int:
        """Process due sends and inactivity checks."""
        await self._enqueue_subscription_renewals(limit=500)
        await self._enqueue_winback_candidates(limit=200)
        now = datetime.now(timezone.utc)
        cursor = self.db.lifecycle_email_sends.find(
            {"status": "pending", "scheduled_for": {"$lte": now}}
        ).sort("scheduled_for", 1).limit(limit)
        processed = 0
        async for send_doc in cursor:
            send_id = send_doc.get("id")
            if not send_id:
                continue
            claimed = await self.db.lifecycle_email_sends.find_one_and_update(
                {"id": send_id, "status": "pending"},
                {"$set": {"status": "running", "started_at": now}},
            )
            if not claimed:
                continue
            ok = await self._process_one(send_id)
            processed += 1 if ok else 0
        return processed

    async def track_open(self, pixel_id: str) -> bool:
        now = datetime.now(timezone.utc)
        result = await self.db.lifecycle_email_sends.update_one(
            {"tracking_pixel_id": pixel_id},
            {
                "$set": {"opened_at": now, "updated_at": now},
                "$inc": {"open_count": 1},
                "$addToSet": {"events": {"type": "opened", "at": now}},
            },
        )
        return result.modified_count > 0

    async def track_click(self, click_token: str) -> Optional[str]:
        now = datetime.now(timezone.utc)
        doc = await self.db.lifecycle_email_sends.find_one({"click_token": click_token}, {"_id": 0})
        if not doc:
            return None
        await self.db.lifecycle_email_sends.update_one(
            {"id": doc["id"]},
            {
                "$set": {"clicked_at": now, "updated_at": now},
                "$inc": {"click_count": 1},
                "$addToSet": {"events": {"type": "clicked", "at": now}},
            },
        )
        return doc.get("cta_url")

    async def unsubscribe(self, unsubscribe_token: str) -> bool:
        now = datetime.now(timezone.utc)
        doc = await self.db.lifecycle_email_sends.find_one({"unsubscribe_token": unsubscribe_token}, {"_id": 0})
        if not doc:
            return False
        user_id = doc.get("user_id")
        if not user_id:
            return False
        await self.db.lifecycle_suppressions.update_one(
            {"user_id": user_id},
            {
                "$setOnInsert": {"id": str(uuid.uuid4()), "user_id": user_id, "created_at": now},
                "$set": {"unsubscribed_lifecycle": True, "updated_at": now},
            },
            upsert=True,
        )
        await self.db.lifecycle_email_sends.update_one(
            {"id": doc["id"]},
            {"$set": {"status": "unsubscribed", "updated_at": now}},
        )
        return True

    async def mark_provider_suppression(self, email: str, reason: str) -> int:
        """Mark users as suppressed on provider bounce/complaint events."""
        if not email:
            return 0
        now = datetime.now(timezone.utc)
        users = await self.db.users.find({"email": {"$regex": f"^{email}$", "$options": "i"}}, {"id": 1}).to_list(None)
        updated = 0
        for user in users:
            user_id = user.get("id")
            if not user_id:
                continue
            set_payload = {"updated_at": now}
            if reason == "complaint":
                set_payload["complaint"] = True
            else:
                set_payload["hard_bounce"] = True
            await self.db.lifecycle_suppressions.update_one(
                {"user_id": user_id},
                {
                    "$setOnInsert": {"id": str(uuid.uuid4()), "user_id": user_id, "created_at": now},
                    "$set": set_payload,
                },
                upsert=True,
            )
            updated += 1
        return updated

    async def _schedule_once(
        self,
        user_id: str,
        template_key: str,
        scheduled_for: datetime,
        idempotency_suffix: str = "",
        extra_fields: Optional[Dict[str, Any]] = None,
    ) -> None:
        now = datetime.now(timezone.utc)
        if scheduled_for.tzinfo is None:
            scheduled_for = scheduled_for.replace(tzinfo=timezone.utc)
        suffix = (idempotency_suffix or "").strip()
        idempotency_key = f"{user_id}:{template_key}:{suffix}" if suffix else f"{user_id}:{template_key}"
        insert_payload: Dict[str, Any] = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "template_key": template_key,
            "status": "pending",
            "scheduled_for": scheduled_for,
            "idempotency_key": idempotency_key,
            "created_at": now,
        }
        if extra_fields:
            insert_payload.update(extra_fields)
        await self.db.lifecycle_email_sends.update_one(
            {"idempotency_key": idempotency_key},
            {
                "$setOnInsert": insert_payload
            },
            upsert=True,
        )

    async def _process_one(self, send_id: str) -> bool:
        now = datetime.now(timezone.utc)
        send_doc = await self.db.lifecycle_email_sends.find_one({"id": send_id}, {"_id": 0})
        if not send_doc:
            return False
        user_id = send_doc.get("user_id")
        template_key = send_doc.get("template_key")
        if not user_id or not template_key or template_key not in self.templates:
            await self.db.lifecycle_email_sends.update_one(
                {"id": send_id},
                {"$set": {"status": "failed", "error_message": "Invalid lifecycle send payload", "updated_at": now}},
            )
            return False
        if not await self._is_eligible(user_id, template_key, send_doc):
            await self.db.lifecycle_email_sends.update_one(
                {"id": send_id},
                {"$set": {"status": "skipped", "updated_at": now}},
            )
            return False

        user = await self.db.users.find_one({"id": user_id}, {"_id": 0})
        if not user or not user.get("email"):
            await self.db.lifecycle_email_sends.update_one(
                {"id": send_id},
                {"$set": {"status": "failed", "error_message": "User email missing", "updated_at": now}},
            )
            return False

        track_pixel_id = str(uuid.uuid4())
        click_token = str(uuid.uuid4())
        unsub_token = str(uuid.uuid4())
        cta_url = self._template_primary_cta(template_key)
        pixel_url = f"{self.tracking_base_url}/api/track/lifecycle/pixel/{track_pixel_id}"
        click_url = f"{self.tracking_base_url}/api/track/lifecycle/click/{click_token}"
        unsubscribe_url = f"{self.tracking_base_url}/api/lifecycle/unsubscribe/{unsub_token}"

        substitutions = await self._template_vars(user_id, user)
        substitutions["unsubscribe_url"] = unsubscribe_url
        template = self.templates[template_key]
        subject = template["subject"].format(**substitutions)
        plain = template["plain"].format(**substitutions)
        html = template["html"].format(**substitutions)
        html = f"{html}<img src=\"{pixel_url}\" width=\"1\" height=\"1\" style=\"display:none\" />"
        html = html.replace(cta_url, click_url)
        plain = plain.replace(cta_url, click_url) + f"\n\nUnsubscribe from lifecycle emails: {unsubscribe_url}"

        await self.db.lifecycle_email_sends.update_one(
            {"id": send_id},
            {
                "$set": {
                    "tracking_pixel_id": track_pixel_id,
                    "click_token": click_token,
                    "unsubscribe_token": unsub_token,
                    "cta_url": cta_url,
                    "updated_at": now,
                }
            },
        )

        if self.dry_run:
            sent = True
        else:
            sent = await self.smtp_service.send_app_notification_email(
                to_email=user["email"],
                subject=subject,
                body_plain=plain,
                body_html=html,
            )
        status = "sent" if sent else "failed"
        await self.db.lifecycle_email_sends.update_one(
            {"id": send_id},
            {
                "$set": {
                    "status": status,
                    "sent_at": now if sent else None,
                    "finished_at": now,
                    "subject": subject,
                    "updated_at": now,
                }
            },
        )
        return sent

    async def _is_eligible(self, user_id: str, template_key: str, send_doc: Optional[Dict[str, Any]] = None) -> bool:
        suppression = await self.db.lifecycle_suppressions.find_one({"user_id": user_id}, {"_id": 0})
        if suppression:
            if suppression.get("unsubscribed_lifecycle"):
                return False
            if suppression.get("hard_bounce") or suppression.get("complaint"):
                return False
        settings = await self.db.user_settings.find_one({"user_id": user_id}, {"notifications": 1, "_id": 0})
        notifications = (settings or {}).get("notifications") or {}
        if notifications.get(LIFECYCLE_NOTIFICATION_TYPE) is False:
            return False
        user = await self.db.users.find_one({"id": user_id}, {"_id": 0})
        if not user:
            return False

        is_paid = (user.get("plan_id") or "free") != "free"
        domain_verified = await self.db.domains.count_documents({"user_id": user_id, "status": "verified"}) > 0
        inbox_count = await self.db.inboxes.count_documents({"user_id": user_id})  # includes Gmail and SMTP
        has_campaign_send = await self.db.email_logs.count_documents({"user_id": user_id, "status": {"$ne": "pending"}}) > 0
        in_trial_like = user.get("subscription_status") in ("trial", "free", "active") and not is_paid
        subscription_end = self._parse_iso_date(user.get("subscription_end"))
        today = datetime.now(timezone.utc).date()
        days_to_end = (subscription_end - today).days if subscription_end else None
        renewal_cycle_end = (send_doc or {}).get("renewal_cycle_end")

        if template_key == "email_2":
            return not domain_verified
        if template_key == "email_3":
            return domain_verified
        if template_key == "email_4":
            return domain_verified and inbox_count == 0
        if template_key == "email_5":
            return inbox_count > 0
        if template_key == "email_6":
            return not has_campaign_send and in_trial_like
        if template_key in ("email_7", "email_8"):
            return not is_paid
        if template_key == "email_9":
            return has_campaign_send and not is_paid
        if template_key == "email_10":
            return is_paid
        if template_key == "email_11":
            return is_paid and inbox_count < 2
        if template_key == "email_12":
            return is_paid
        if template_key == "email_13":
            return True
        if template_key in ("renewal_email_1", "renewal_email_2"):
            if not is_paid or not subscription_end:
                return False
            if renewal_cycle_end and renewal_cycle_end != user.get("subscription_end"):
                return False
            return days_to_end in (3, 1)
        if template_key in ("renewal_email_3", "renewal_email_4", "renewal_email_5"):
            if not subscription_end:
                return False
            if renewal_cycle_end and renewal_cycle_end != user.get("subscription_end"):
                return False
            return (subscription_end < today) and (not is_paid or user.get("subscription_status") in ("cancelled", "past_due", "expired"))
        if template_key == "renewal_email_6":
            return is_paid
        return True

    async def _template_vars(self, user_id: str, user: Dict[str, Any]) -> Dict[str, str]:
        first_name = (user.get("first_name") or "").strip() or "there"
        plan_price = "$29"
        open_rate = 0.0
        sent = await self.db.email_logs.count_documents(
            {"user_id": user_id, "sent_at": {"$gte": datetime.now(timezone.utc) - timedelta(days=7)}, "status": {"$ne": "pending"}}
        )
        opened = await self.db.email_logs.count_documents(
            {"user_id": user_id, "sent_at": {"$gte": datetime.now(timezone.utc) - timedelta(days=7)}, "status": {"$in": ["opened", "clicked", "replied"]}}
        )
        if sent > 0:
            open_rate = round((opened / sent) * 100, 1)
        open_rate_position = "above" if open_rate >= 41 else "below"
        return {
            "first_name": first_name,
            "plan_price": plan_price,
            "open_rate": str(open_rate),
            "open_rate_position": open_rate_position,
        }

    def _template_primary_cta(self, template_key: str) -> str:
        if template_key in ("email_1", "email_2"):
            return f"{self.dashboard_url}/domains"
        if template_key in ("email_3", "email_4", "email_11"):
            return f"{self.dashboard_url}/inboxes"
        if template_key in ("email_5", "email_6"):
            return f"{self.dashboard_url}/campaigns"
        if template_key in ("email_7", "email_8"):
            return f"{self.dashboard_url}/settings?tab=billing"
        if template_key in ("email_9", "email_12"):
            return f"{self.dashboard_url}/analytics"
        if template_key == "email_10":
            return self.dashboard_url
        if template_key in (
            "renewal_email_1",
            "renewal_email_2",
            "renewal_email_3",
            "renewal_email_4",
            "renewal_email_5",
        ):
            return f"{self.dashboard_url}/settings?tab=billing"
        if template_key == "renewal_email_6":
            return self.dashboard_url
        return f"{self.dashboard_url}/login"

    @staticmethod
    def _parse_iso_date(value: Any) -> Optional[date]:
        if not value or not isinstance(value, str):
            return None
        try:
            return datetime.strptime(value[:10], "%Y-%m-%d").date()
        except ValueError:
            return None

    async def _cancel_pending_renewal_reminders(self, user_id: str, cycle_end: str) -> None:
        now = datetime.now(timezone.utc)
        await self.db.lifecycle_email_sends.update_many(
            {
                "user_id": user_id,
                "status": "pending",
                "renewal_cycle_end": cycle_end,
                "template_key": {
                    "$in": [
                        "renewal_email_1",
                        "renewal_email_2",
                        "renewal_email_3",
                        "renewal_email_4",
                        "renewal_email_5",
                    ]
                },
            },
            {"$set": {"status": "skipped", "updated_at": now}},
        )

    async def _enqueue_subscription_renewals(self, limit: int = 500) -> None:
        """
        Queue renewal reminder templates around subscription end date.
        Offsets are relative to subscription_end day in UTC date semantics.
        """
        today = datetime.now(timezone.utc).date()
        users = await self.db.users.find(
            {
                "subscription_end": {"$type": "string"},
            },
            {"id": 1, "subscription_end": 1, "subscription_status": 1, "plan_id": 1},
        ).limit(limit).to_list(None)

        offset_templates = {
            3: "renewal_email_1",
            1: "renewal_email_2",
            -1: "renewal_email_3",
            -5: "renewal_email_4",
            -10: "renewal_email_5",
        }

        for user in users:
            user_id = user.get("id")
            if not user_id:
                continue
            cycle_end = (user.get("subscription_end") or "").strip()
            end_date = self._parse_iso_date(cycle_end)
            if not end_date:
                continue
            days_to_end = (end_date - today).days
            template_key = offset_templates.get(days_to_end)
            if not template_key:
                continue
            await self._schedule_once(
                user_id,
                template_key,
                datetime.now(timezone.utc),
                idempotency_suffix=cycle_end,
                extra_fields={"renewal_cycle_end": cycle_end},
            )

    async def _enqueue_winback_candidates(self, limit: int = 200) -> None:
        """Queue Email 13 for inactive users (14 days with no session activity)."""
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=14)
        # Find users with no active sessions recently.
        users = await self.db.users.find({}, {"id": 1, "created_at": 1}).limit(limit).to_list(None)
        for user in users:
            user_id = user.get("id")
            if not user_id:
                continue
            recent_session = await self.db.sessions.find_one(
                {"user_id": user_id, "last_active": {"$gte": cutoff}},
                {"_id": 0, "id": 1},
            )
            if recent_session:
                continue
            # Fallback: don't trigger winback for very new signups.
            created_at = user.get("created_at")
            if isinstance(created_at, datetime) and created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            if isinstance(created_at, datetime) and created_at > cutoff:
                continue
            await self._schedule_once(user_id, "email_13", now)

