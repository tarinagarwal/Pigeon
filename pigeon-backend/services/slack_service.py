"""Slack notifications via Bot token – post to channels using chat.postMessage."""

import logging
import os
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

SLACK_API_POST_MESSAGE = "https://slack.com/api/chat.postMessage"

# Channel names (override via env: SLACK_CHANNEL_*)
DEFAULT_CHANNELS = {
    "contact": "pigeon-contact",
    "ticket": "pigeon-ticket",
    "new-user": "pigeon-new-user",
}


def _get_bot_token() -> Optional[str]:
    return os.environ.get("SLACK_BOT_TOKEN")


def _get_channel(channel_key: str) -> Optional[str]:
    # e.g. new-user -> SLACK_CHANNEL_NEW_USER
    env_key = f"SLACK_CHANNEL_{channel_key.upper().replace('-', '_')}"
    return os.environ.get(env_key) or DEFAULT_CHANNELS.get(channel_key.lower())


async def send_slack(
    channel_key: str,
    text: str,
    blocks: Optional[list[Dict[str, Any]]] = None,
) -> bool:
    """
    Send a message to a Slack channel via Bot API (chat.postMessage).

    Args:
        channel_key: One of "contact", "ticket", "new-user" (maps to channel name).
        text: Plain text message.
        blocks: Optional Slack Block Kit blocks.

    Returns:
        True if sent successfully, False otherwise.
    """
    token = _get_bot_token()
    if not token or not token.strip():
        logger.debug("SLACK_BOT_TOKEN not set, skipping Slack send")
        return False

    channel = _get_channel(channel_key)
    if not channel:
        logger.warning("No Slack channel configured for key=%s", channel_key)
        return False

    body: Dict[str, Any] = {"channel": channel, "text": text}
    if blocks:
        body["blocks"] = blocks

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                SLACK_API_POST_MESSAGE,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=body,
            )
            data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            if r.is_success and data.get("ok"):
                return True
            logger.warning(
                "Slack API error channel_key=%s status=%s ok=%s error=%s",
                channel_key,
                r.status_code,
                data.get("ok"),
                data.get("error", r.text[:200]),
            )
            return False
    except Exception as e:
        logger.exception("Slack send error channel_key=%s: %s", channel_key, e)
        return False


async def notify_contact_submission(
    name: str,
    email: str,
    subject: str,
    message: str,
    company: Optional[str] = None,
    phone: Optional[str] = None,
) -> bool:
    """Send new contact form submission to pigeon-contact."""
    lines = [
        "*New contact form submission*",
        f"*Name:* {name}",
        f"*Email:* {email}",
        f"*Subject:* {subject}",
        f"*Message:* {message}",
    ]
    if company:
        lines.append(f"*Company:* {company}")
    if phone:
        lines.append(f"*Phone:* {phone}")
    return await send_slack("contact", text="\n".join(lines))


async def notify_ticket_created(
    ticket_id: str,
    subject: str,
    description: str,
    priority: str,
    user_id: str,
    user_email: Optional[str] = None,
) -> bool:
    """Send new ticket created notification to pigeon-ticket."""
    lines = [
        "*New support ticket created*",
        f"*Ticket ID:* {ticket_id}",
        f"*Subject:* {subject}",
        f"*Priority:* {priority}",
        f"*User ID:* {user_id}",
    ]
    if user_email:
        lines.append(f"*User email:* {user_email}")
    lines.append(f"*Description:* {description}")
    return await send_slack("ticket", text="\n".join(lines))


async def notify_new_user_signup(email: str, user_id: str) -> bool:
    """Send new user registration to pigeon-new-user."""
    text = "\n".join([
        "*New user sign up*",
        f"*Email:* {email}",
        f"*User ID:* {user_id}",
    ])
    return await send_slack("new-user", text=text)
