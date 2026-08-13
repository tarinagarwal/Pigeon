"""Microsoft OAuth2 for Outlook receiver accounts: token refresh and XOAUTH2 strings for IMAP/SMTP."""
import base64
import logging
import os
from typing import List, Optional

import httpx

logger = logging.getLogger(__name__)

MICROSOFT_AUTHORITY = "https://login.microsoftonline.com/common"
MICROSOFT_TOKEN_URL = f"{MICROSOFT_AUTHORITY}/oauth2/v2.0/token"
# Microsoft Graph scopes (valid for v2.0 authorize endpoint). offline_access for refresh token.
# Mail.ReadWrite required to move messages (e.g. from Junk to Inbox); Mail.Read is read-only.
OUTLOOK_SCOPES = [
    "offline_access",
    "https://graph.microsoft.com/Mail.Read",
    "https://graph.microsoft.com/Mail.ReadWrite",
    "https://graph.microsoft.com/Mail.Send",
    "https://graph.microsoft.com/User.Read",
]
OUTLOOK_SCOPES_STR = " ".join(OUTLOOK_SCOPES)
# Fallback when refresh token was issued before Mail.ReadWrite was added (avoids 400 on refresh).
OUTLOOK_SCOPES_LEGACY = [
    "offline_access",
    "https://graph.microsoft.com/Mail.Read",
    "https://graph.microsoft.com/Mail.Send",
    "https://graph.microsoft.com/User.Read",
]
OUTLOOK_SCOPES_LEGACY_STR = " ".join(OUTLOOK_SCOPES_LEGACY)


def get_access_token(refresh_token: str) -> str:
    """
    Exchange refresh_token for a new access_token via Microsoft token endpoint.
    Tries full scopes first; on 400 retries with legacy scopes (no Mail.ReadWrite).
    """
    client_id = os.getenv("MICROSOFT_CLIENT_ID")
    client_secret = os.getenv("MICROSOFT_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise ValueError(
            "MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be set for Outlook OAuth"
        )
    with httpx.Client(timeout=30.0) as client:
        for scope_str, label in [(OUTLOOK_SCOPES_STR, "full"), (OUTLOOK_SCOPES_LEGACY_STR, "legacy")]:
            data = {
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "scope": scope_str,
            }
            resp = client.post(MICROSOFT_TOKEN_URL, data=data)
            if resp.status_code == 200:
                body = resp.json()
                access_token = body.get("access_token")
                if not access_token:
                    raise ValueError("Microsoft token response did not include access_token")
                if label == "legacy":
                    logger.warning(
                        "Outlook token refreshed with legacy scopes (no Mail.ReadWrite). "
                        "Reconnect the Outlook account in Admin → Warmup to enable moving messages from Junk."
                    )
                return access_token
            if resp.status_code != 400 or label == "legacy":
                resp.raise_for_status()
        resp.raise_for_status()
    raise ValueError("Microsoft token response did not include access_token")


async def get_access_token_async(refresh_token: str) -> str:
    """Async version of get_access_token. Tries full scopes first; on 400 retries with legacy scopes (no Mail.ReadWrite)."""
    client_id = os.getenv("MICROSOFT_CLIENT_ID")
    client_secret = os.getenv("MICROSOFT_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise ValueError(
            "MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be set for Outlook OAuth"
        )
    async with httpx.AsyncClient(timeout=30.0) as client:
        for scope_str, label in [(OUTLOOK_SCOPES_STR, "full"), (OUTLOOK_SCOPES_LEGACY_STR, "legacy")]:
            data = {
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "scope": scope_str,
            }
            resp = await client.post(MICROSOFT_TOKEN_URL, data=data)
            if resp.status_code == 200:
                body = resp.json()
                access_token = body.get("access_token")
                if not access_token:
                    raise ValueError("Microsoft token response did not include access_token")
                if label == "legacy":
                    logger.warning(
                        "Outlook token refreshed with legacy scopes (no Mail.ReadWrite). "
                        "Reconnect the Outlook account in Admin → Warmup to enable moving messages from Junk."
                    )
                return access_token
            if resp.status_code != 400 or label == "legacy":
                resp.raise_for_status()
        resp.raise_for_status()
    raise ValueError("Microsoft token response did not include access_token")


def build_imap_xoauth2_string(user: str, access_token: str) -> str:
    """
    Build SASL XOAUTH2 string for IMAP (Office 365).
    Format: base64("user=<email>\\x01auth=Bearer <token>\\x01\\x01")
    """
    raw = f"user={user}\x01auth=Bearer {access_token}\x01\x01"
    return base64.b64encode(raw.encode("utf-8")).decode("ascii")


def build_smtp_xoauth2_string(user: str, access_token: str) -> str:
    """
    Build SASL XOAUTH2 string for SMTP (Office 365). Same format as IMAP.
    """
    return build_imap_xoauth2_string(user, access_token)


# ---------------------------------------------------------------------------
# Microsoft Graph API (mail) – used when token has Graph scopes (Mail.Read, Mail.Send)
# ---------------------------------------------------------------------------

GRAPH_BASE = "https://graph.microsoft.com/v1.0"


async def graph_get_inbox_count(access_token: str) -> int:
    """Get inbox message count via Graph API."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(
            f"{GRAPH_BASE}/me/mailFolders/inbox",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"$select": "totalItemCount"},
        )
        r.raise_for_status()
        data = r.json()
        return data.get("totalItemCount", 0)


async def graph_send_mail(
    access_token: str,
    to_email: str,
    subject: str,
    body_plain: str,
    from_email: Optional[str] = None,
) -> None:
    """Send an email via Graph API POST /me/sendMail. from_email sets the From address (must be user's mailbox/alias)."""
    message: dict = {
        "subject": subject,
        "body": {"contentType": "Text", "content": body_plain},
        "toRecipients": [{"emailAddress": {"address": to_email}}],
    }
    if from_email:
        message["from"] = {"emailAddress": {"address": from_email}}
    payload = {
        "message": message,
        "saveToSentItems": True,
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(
            f"{GRAPH_BASE}/me/sendMail",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        r.raise_for_status()


def _normalize_msg_id(mid: Optional[str]) -> str:
    if not mid:
        return ""
    s = (mid or "").strip()
    if s.startswith("<") and s.endswith(">"):
        s = s[1:-1]
    return s


async def graph_list_inbox_messages(
    access_token: str, max_items: int = 50
) -> List[dict]:
    """List inbox messages; each has id, internetMessageId, subject, isRead."""
    out: List[dict] = []
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(
            f"{GRAPH_BASE}/me/mailFolders/inbox/messages",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"$top": max_items, "$select": "id,internetMessageId,subject,isRead"},
        )
        r.raise_for_status()
        data = r.json()
        for m in data.get("value", []):
            out.append({
                "id": m.get("id"),
                "internetMessageId": _normalize_msg_id(m.get("internetMessageId")),
                "subject": (m.get("subject") or "").strip() or None,
                "isRead": m.get("isRead", False),
            })
    return out


async def graph_list_junk_messages(access_token: str, max_items: int = 50) -> List[dict]:
    """List junk folder messages; each has id, internetMessageId."""
    out: List[dict] = []
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(
            f"{GRAPH_BASE}/me/mailFolders/junkemail/messages",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"$top": max_items, "$select": "id,internetMessageId"},
        )
        r.raise_for_status()
        data = r.json()
        for m in data.get("value", []):
            out.append({
                "id": m.get("id"),
                "internetMessageId": _normalize_msg_id(m.get("internetMessageId")),
            })
    return out


async def graph_move_to_inbox(access_token: str, message_id: str) -> None:
    """Move a message to inbox (from junk)."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(
            f"{GRAPH_BASE}/me/messages/{message_id}/move",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json={"destinationId": "inbox"},
        )
        r.raise_for_status()


async def graph_mark_read(access_token: str, message_id: str) -> None:
    """Mark a message as read."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.patch(
            f"{GRAPH_BASE}/me/messages/{message_id}",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json={"isRead": True},
        )
        r.raise_for_status()


async def graph_mark_important(
    access_token: str,
    message_id: str,
    *,
    add_flag: bool = False,
) -> None:
    """
    Mark message as high importance (Outlook). Optionally set follow-up flag for 'starred' variety.
    """
    payload: dict = {"importance": "high"}
    if add_flag:
        payload["flag"] = {"flagStatus": "flagged"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.patch(
            f"{GRAPH_BASE}/me/messages/{message_id}",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        r.raise_for_status()


async def graph_send_reply(
    access_token: str,
    original_message_id: str,
    body_plain: str,
    from_email: Optional[str] = None,
) -> None:
    """Create a reply to a message, set body (and optional from), and send (Graph)."""
    async with httpx.AsyncClient(timeout=20.0) as client:
        create = await client.post(
            f"{GRAPH_BASE}/me/messages/{original_message_id}/createReply",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        create.raise_for_status()
        draft = create.json()
        draft_id = draft.get("id")
        if not draft_id:
            raise ValueError("No draft id from createReply")
        patch_payload: dict = {"body": {"contentType": "Text", "content": body_plain}}
        if from_email:
            patch_payload["from"] = {"emailAddress": {"address": from_email}}
        await client.patch(
            f"{GRAPH_BASE}/me/messages/{draft_id}",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json=patch_payload,
        )
        send_r = await client.post(
            f"{GRAPH_BASE}/me/messages/{draft_id}/send",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        send_r.raise_for_status()
