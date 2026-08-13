"""Google OAuth2 and Gmail API helpers for Gmail warm-up receiver accounts.

When using OAuth, we use the Gmail API (not IMAP/SMTP) for listing, moving, marking read, and sending.
"""

import base64
import logging
from email.mime.text import MIMEText
from email.utils import formatdate
from typing import Any, List, Literal, Optional

import httpx
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

logger = logging.getLogger(__name__)

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_SCOPE = "https://mail.google.com/"


def _normalize_message_id(msg_id: Optional[str]) -> str:
    if not msg_id:
        return ""
    s = (msg_id or "").strip()
    if s.startswith("<") and s.endswith(">"):
        s = s[1:-1]
    return s


def _get_header(headers: List[dict], name: str) -> Optional[str]:
    if not headers:
        return None
    name_lower = name.lower()
    for h in headers:
        if (h.get("name") or "").lower() == name_lower:
            return (h.get("value") or "").strip()
    return None


def build_gmail_service(
    access_token: str,
    refresh_token: str,
    client_id: str,
    client_secret: str,
) -> Any:
    """Build Gmail API service from OAuth tokens. Uses sync Credentials (refresh happens on next API call if expired)."""
    creds = Credentials(
        token=access_token,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_id,
        client_secret=client_secret,
        scopes=[GMAIL_SCOPE],
    )
    return build("gmail", "v1", credentials=creds)


async def get_access_token_async(
    refresh_token: str,
    client_id: str,
    client_secret: str,
    scope: Optional[str] = None,
) -> str:
    """
    Exchange a Gmail OAuth2 refresh token for a new access token.

    client_id and client_secret come from the Google Cloud OAuth client that
    was used when connecting the receiver account.
    """
    if not refresh_token:
        raise ValueError("Gmail refresh_token is required for OAuth")
    if not client_id or not client_secret:
        raise ValueError("Google client_id and client_secret must be provided for Gmail OAuth")

    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }
    if scope:
        data["scope"] = scope

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data=data)
        try:
            resp.raise_for_status()
        except Exception:
            body_preview = resp.text[:500]
            logger.warning("Gmail OAuth token refresh failed: status=%s body=%s", resp.status_code, body_preview)
            raise

        body = resp.json()

    access_token = body.get("access_token")
    if not access_token:
        raise ValueError("Google token response did not include access_token")

    return access_token


# ---------------------------------------------------------------------------
# Gmail API (sync) – use for OAuth receiver: list, move, mark read, send
# ---------------------------------------------------------------------------


def gmail_api_list_inbox(
    service: Any,
    max_results: int = 50,
) -> List[dict]:
    """List inbox messages; each has id, message_id (Message-ID header), subject, is_read. Sync."""
    result = (
        service.users()
        .messages()
        .list(userId="me", labelIds=["INBOX"], maxResults=max_results)
        .execute()
    )
    msg_list = result.get("messages") or []
    out: List[dict] = []
    for m in msg_list:
        msg_id = m.get("id")
        if not msg_id:
            continue
        try:
            full = (
                service.users()
                .messages()
                .get(
                    userId="me",
                    id=msg_id,
                    format="metadata",
                    metadataHeaders=["Message-ID", "Subject"],
                )
                .execute()
            )
        except Exception:
            continue
        payload = full.get("payload") or {}
        headers = payload.get("headers") or []
        mid = _get_header(headers, "Message-ID")
        subject = _get_header(headers, "Subject") or ""
        label_ids = full.get("labelIds") or []
        is_read = "UNREAD" not in label_ids
        out.append({
            "id": msg_id,
            "message_id": _normalize_message_id(mid) if mid else None,
            "subject": subject,
            "isRead": is_read,
        })
    return out


def gmail_api_list_spam(service: Any, max_results: int = 50) -> List[dict]:
    """List spam messages; each has id, message_id (Message-ID header). Sync."""
    result = (
        service.users()
        .messages()
        .list(userId="me", labelIds=["SPAM"], maxResults=max_results)
        .execute()
    )
    msg_list = result.get("messages") or []
    out: List[dict] = []
    for m in msg_list:
        msg_id = m.get("id")
        if not msg_id:
            continue
        try:
            full = (
                service.users()
                .messages()
                .get(
                    userId="me",
                    id=msg_id,
                    format="metadata",
                    metadataHeaders=["Message-ID", "Subject"],
                )
                .execute()
            )
        except Exception:
            continue
        payload = full.get("payload") or {}
        headers = payload.get("headers") or []
        mid = _get_header(headers, "Message-ID")
        subj = _get_header(headers, "Subject") or ""
        out.append({
            "id": msg_id,
            "message_id": _normalize_message_id(mid) if mid else None,
            "subject": subj,
        })
    return out


def gmail_api_classify_probe(
    service: Any,
    probe_mid: str,
    marker_lower: str,
    *,
    max_results: int = 10,
) -> Optional[Literal["inbox", "spam"]]:
    """
    Locate the probe via Gmail search (not limited to the latest N threads in list APIs).

    Tries RFC Message-ID first, then subject/body search for the marker. Returns placement
    from labelIds when a matching message is found.
    """
    pm = _normalize_message_id(probe_mid)
    queries: List[str] = []
    if pm:
        queries.append(f"rfc822msgid:{pm}")
    if marker_lower:
        queries.append(f"subject:{marker_lower}")
        queries.append(marker_lower)

    seen: set[str] = set()
    for q in queries:
        try:
            result = (
                service.users()
                .messages()
                .list(userId="me", q=q, maxResults=max_results)
                .execute()
            )
        except Exception:
            continue
        for m in result.get("messages") or []:
            gid = m.get("id")
            if not gid or gid in seen:
                continue
            seen.add(gid)
            try:
                full = (
                    service.users()
                    .messages()
                    .get(
                        userId="me",
                        id=gid,
                        format="metadata",
                        metadataHeaders=["Message-ID", "Subject"],
                    )
                    .execute()
                )
            except Exception:
                continue
            payload = full.get("payload") or {}
            headers = payload.get("headers") or []
            mid_h = _normalize_message_id(_get_header(headers, "Message-ID") or "")
            subject_l = (_get_header(headers, "Subject") or "").lower()
            match = (pm and mid_h == pm) or (marker_lower and marker_lower in subject_l)
            if not match:
                continue
            label_ids = full.get("labelIds") or []
            if "SPAM" in label_ids:
                return "spam"
            if "INBOX" in label_ids:
                return "inbox"
            # Exists but not in inbox/spam (e.g. still categorizing); keep searching
    return None


def gmail_api_mark_read(service: Any, message_id: str) -> None:
    """Mark a message as read. Sync."""
    service.users().messages().modify(
        userId="me",
        id=message_id,
        body={"removeLabelIds": ["UNREAD"]},
    ).execute()


def gmail_api_mark_important(
    service: Any,
    message_id: str,
    *,
    add_starred: bool = False,
) -> None:
    """
    Mark a message as Important (Gmail IMPORTANT label). Optionally add STARRED for natural variety.
    Sync; best-effort (caller should catch).
    """
    add_ids = ["IMPORTANT"]
    if add_starred:
        add_ids.append("STARRED")
    service.users().messages().modify(
        userId="me",
        id=message_id,
        body={"addLabelIds": add_ids},
    ).execute()


# Gmail category labels; removing these (when moving to inbox) makes the message show in Primary.
GMAIL_CATEGORY_LABELS_TO_REMOVE = [
    "CATEGORY_PROMOTIONS",
    "CATEGORY_SOCIAL",
    "CATEGORY_UPDATES",
    "CATEGORY_FORUMS",
]


def gmail_api_move_to_inbox(service: Any, message_id: str) -> None:
    """Move a message from spam to inbox and out of Promotions/Social/Updates/Forums into Primary. Sync."""
    remove_ids = ["SPAM"] + GMAIL_CATEGORY_LABELS_TO_REMOVE
    service.users().messages().modify(
        userId="me",
        id=message_id,
        body={
            "removeLabelIds": remove_ids,
            "addLabelIds": ["INBOX", "CATEGORY_PERSONAL"],
        },
    ).execute()


def gmail_api_send_mail(
    service: Any,
    to_email: str,
    subject: str,
    body_plain: str,
    from_email: Optional[str] = None,
    in_reply_to: Optional[str] = None,
    references: Optional[str] = None,
) -> None:
    """Send an email via Gmail API. Sync. Optionally set In-Reply-To/References for replies."""
    msg = MIMEText(body_plain, "plain")
    msg["To"] = to_email
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    if from_email:
        msg["From"] = from_email
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to if in_reply_to.startswith("<") else f"<{in_reply_to}>"
    if references:
        msg["References"] = references
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")
    body = {"raw": raw}
    service.users().messages().send(userId="me", body=body).execute()

