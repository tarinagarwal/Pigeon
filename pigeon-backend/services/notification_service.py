"""Send in-app notifications (campaign, reply, health, weekly, product) to the user's registered email via SendGrid (tarinagarwal@gmail.com) or SMTP, respecting Notification Preferences."""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from database import db
from routes.settings import DEFAULT_NOTIFICATIONS

# Module-level instance; set from server.py via init_notification_service()
notification_service: Optional["NotificationService"] = None


def init_notification_service(service: "NotificationService") -> None:
    global notification_service
    notification_service = service


class NotificationService:
    """Sends notification emails to users' registered email when preferences allow."""

    VALID_TYPES = frozenset({
        "campaign_updates",
        "reply_notifications",
        "health_alerts",
        "weekly_reports",
        "product_updates",
        "ticket_reply",
        "lifecycle_automation",
        "admin_alert",
        "billing_payment_failed",
    })

    # Cooldown for health alerts so they don't spam.
    HEALTH_ALERT_COOLDOWN_HOURS = 24

    def __init__(self, db_handle, smtp_service):
        self.db = db_handle
        self.smtp_service = smtp_service

    async def _is_health_alert_on_cooldown(self, user_id: str) -> bool:
        """Return True if a health alert was sent for this user within the cooldown window."""
        try:
            cutoff = datetime.now(timezone.utc) - timedelta(hours=self.HEALTH_ALERT_COOLDOWN_HOURS)
            existing = await self.db.notification_logs.find_one(
                {
                    "user_id": user_id,
                    "notification_type": "health_alerts",
                    "sent_at": {"$gte": cutoff},
                }
            )
            return existing is not None
        except Exception as e:
            # If cooldown check fails, log but do not block sending (fail open).
            logging.exception("notification_service health alert cooldown check failed: %s", e)
            return False

    async def _log_notification_send(self, user_id: str, notification_type: str, subject: str) -> None:
        """Persist a lightweight log so we can rate-limit specific notification types."""
        try:
            await self.db.notification_logs.insert_one(
                {
                    "user_id": user_id,
                    "notification_type": notification_type,
                    "subject": subject,
                    "sent_at": datetime.now(timezone.utc),
                }
            )
        except Exception as e:
            # Logging failure should never break the main flow.
            logging.exception("notification_service failed to log notification send: %s", e)

    async def send_notification_if_enabled(
        self,
        user_id: str,
        notification_type: str,
        subject: str,
        body_plain: str,
        body_html: Optional[str] = None,
    ) -> bool:
        """If user has this notification type enabled and has an email, send via app SendGrid or SMTP.

        Returns True if sent, False otherwise. Does not raise.
        """
        if notification_type not in self.VALID_TYPES:
            logging.warning("notification_service: invalid type %s", notification_type)
            return False

        # For domain health alerts, enforce a simple per-user 24h cooldown so
        # users receive at most one email per day, even if checks run often.
        if notification_type == "health_alerts":
            on_cooldown = await self._is_health_alert_on_cooldown(user_id)
            if on_cooldown:
                return False

        try:
            doc = await self.db.user_settings.find_one({"user_id": user_id}, {"notifications": 1})
            notifications = {**DEFAULT_NOTIFICATIONS, **(doc.get("notifications") or {})}
            if not notifications.get(notification_type, True):
                return False

            user = await self.db.users.find_one({"id": user_id}, {"email": 1})
            if not user or not user.get("email"):
                return False

            to_email = user["email"]
            sent = await self.smtp_service.send_app_notification_email(
                to_email=to_email,
                subject=subject,
                body_plain=body_plain,
                body_html=body_html,
            )
            if sent:
                await self._log_notification_send(user_id, notification_type, subject)
            return sent
        except Exception as e:
            logging.exception("notification_service send_notification_if_enabled failed: %s", e)
            return False

    async def send_notification_always(
        self,
        user_id: str,
        notification_type: str,
        subject: str,
        body_plain: str,
        body_html: Optional[str] = None,
    ) -> bool:
        """Send a notification email and log it, even if the user has this type turned off.

        Still enforces type validation and health_alerts cooldown, but ignores the
        notification preferences toggle. Returns True if sent, False otherwise.
        """
        if notification_type not in self.VALID_TYPES:
            logging.warning("notification_service: invalid type %s", notification_type)
            return False

        # Keep cooldown behavior for health alerts so they don't spam.
        if notification_type == "health_alerts":
            on_cooldown = await self._is_health_alert_on_cooldown(user_id)
            if on_cooldown:
                return False

        try:
            user = await self.db.users.find_one({"id": user_id}, {"email": 1})
            if not user or not user.get("email"):
                return False

            to_email = user["email"]
            sent = await self.smtp_service.send_app_notification_email(
                to_email=to_email,
                subject=subject,
                body_plain=body_plain,
                body_html=body_html,
            )
            if sent:
                await self._log_notification_send(user_id, notification_type, subject)
            return sent
        except Exception as e:
            logging.exception("notification_service send_notification_always failed: %s", e)
            return False
