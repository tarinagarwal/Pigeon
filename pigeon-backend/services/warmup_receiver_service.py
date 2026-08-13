"""Warm-up receiver: for each platform receiver account, open warm-up emails, move from spam, and reply from the 200-300 template pool."""
import asyncio
import difflib
import email
import imaplib
import logging
import math
import os
import random
import smtplib
import uuid
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from services.outlook_oauth_service import (
    build_imap_xoauth2_string,
    build_smtp_xoauth2_string,
    get_access_token_async,
    graph_list_inbox_messages,
    graph_list_junk_messages,
    graph_mark_important,
    graph_mark_read,
    graph_move_to_inbox,
    graph_send_reply,
)
from services.warmup_sender_service import WarmupSenderService

from services.gmail_oauth_receiver import (
    build_gmail_service,
    get_access_token_async as get_gmail_access_token_async,
    gmail_api_list_inbox,
    gmail_api_list_spam,
    gmail_api_mark_important,
    gmail_api_mark_read,
    gmail_api_move_to_inbox,
    gmail_api_send_mail,
)

logger = logging.getLogger(__name__)

# Default per-inbox open/reply rates when not set at midnight (realistic engagement)
DEFAULT_WARMUP_TARGET_OPEN_RATE = 0.40
DEFAULT_WARMUP_TARGET_REPLY_RATE = 0.35

# Only open/reply after message has been "delivered" for a human-like delay (minutes)
MIN_DELAY_OPEN_REPLY_MINUTES = 30
MAX_DELAY_OPEN_REPLY_MINUTES = 90
MIN_DELAY_NEXT_THREAD_ACTION_MINUTES = 120
MAX_DELAY_NEXT_THREAD_ACTION_MINUTES = 720
HUMAN_TIMEZONES = [
    "America/New_York",
    "America/Chicago",
    "America/Los_Angeles",
    "Europe/London",
    "Europe/Berlin",
    "Asia/Kolkata",
    "Asia/Singapore",
]
SYNTHETIC_RECEIVER_PERSONAS = [
    {"name": "early_bird_receiver", "start": (6, 8), "end": (16, 19), "drop": (0.18, 0.30), "gap": (90, 420)},
    {"name": "office_receiver", "start": (8, 10), "end": (18, 21), "drop": (0.15, 0.28), "gap": (120, 720)},
    {"name": "night_receiver", "start": (10, 12), "end": (21, 23), "drop": (0.22, 0.40), "gap": (150, 900)},
]
SYNTHETIC_REPLY_ARCHETYPES = [
    {"name": "quick_responder", "reply_min": 20, "reply_max": 75, "next_min": 90, "next_max": 360},
    {"name": "balanced_responder", "reply_min": 35, "reply_max": 120, "next_min": 120, "next_max": 720},
    {"name": "slow_responder", "reply_min": 60, "reply_max": 240, "next_min": 240, "next_max": 1440},
]

# Common spam folder names by provider
SPAM_FOLDER_NAMES = [
    "[Gmail]/Spam",
    "Junk E-mail",
    "Junk",
    "Spam",
    "Bulk Mail",
]


def _compute_warmup_day_index_from_inbox(inbox: Dict[str, Any], now_utc: datetime) -> int:
    """1..30 warmup day index (aligned with background_tasks midnight plan)."""
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
    return min(7, max(1, days_since_start + 1))


def _warmup_phase_important_band(day: int) -> Tuple[float, float]:
    """Target fraction of warmup emails to mark important/star (min, max) by phase."""
    d = min(7, max(1, int(day)))
    if d <= 7:
        return (0.05, 0.10)
    if d <= 15:
        return (0.08, 0.12)
    if d <= 23:
        return (0.10, 0.15)
    return (0.08, 0.12)


def _normalize_message_id(msg_id: str) -> str:
    if not msg_id:
        return ""
    s = (msg_id or "").strip()
    if s.startswith("<") and s.endswith(">"):
        s = s[1:-1]
    return s


def _imap_find_spam_folder_sync(conn: imaplib.IMAP4) -> Optional[str]:
    """Return Spam folder name from IMAP LIST (Gmail-style parsing with quoted name). Use for select()."""
    typ, folders = conn.list()
    if typ != "OK" or not folders:
        return None
    for f in folders:
        fstr = f.decode("utf-8", errors="replace") if isinstance(f, bytes) else str(f)
        for spam_name in SPAM_FOLDER_NAMES:
            if spam_name in fstr:
                parts = fstr.split('"')
                if len(parts) >= 3:
                    return parts[-2]
                return spam_name
    return None


def _imap_fetch_message_id_sync(conn: imaplib.IMAP4, uid: bytes) -> Optional[str]:
    """Fetch Message-ID header for a single message."""
    try:
        typ, data = conn.fetch(uid, "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])")
        if typ != "OK" or not data:
            return None
        part = data[0]
        if not isinstance(part, tuple):
            return None
        raw = part[1].decode("utf-8", errors="replace") if isinstance(part[1], bytes) else str(part[1])
        msg = email.message_from_string(raw)
        mid = msg.get("Message-ID", "") or ""
        return _normalize_message_id(mid) or None
    except Exception:
        return None


def _imap_process_spam_and_inbox_sync(
    host: str,
    port: int,
    username: str,
    password: str,
    message_ids_to_move_from_spam: List[str],
    message_ids_to_mark_read_inbox: List[str],
    max_messages: int = 50,
    message_ids_allow_open: Optional[set] = None,
    mark_important_message_ids: Optional[set] = None,
) -> Tuple[int, List[str], List[Tuple[str, str, Optional[str]]], List[str]]:
    """
    Connect via IMAP, move matching messages from Spam to INBOX, mark matching INBOX unread as read.
    If message_ids_allow_open is set, only mark as read those message_ids (for per-inbox open-rate cap).
    Returns (num_moved_from_spam, marked read message_ids, can_reply tuples, message_ids flagged important).
    """
    num_moved = 0
    marked_read: List[str] = []
    marked_important: List[str] = []
    can_reply: List[Tuple[str, str, Optional[str]]] = []
    allow_open = message_ids_allow_open  # None = allow all
    try:
        use_ssl = port == 993
        if use_ssl:
            conn = imaplib.IMAP4_SSL(host, port=port)
        else:
            conn = imaplib.IMAP4(host, port=port)
        conn.login(username, password)
        move_set = set(message_ids_to_move_from_spam)
        mark_set = set(message_ids_to_mark_read_inbox)

        # Try to find and process Spam folder (Gmail-style LIST parsing for correct name)
        spam_folder = _imap_find_spam_folder_sync(conn)
        if spam_folder:
            try:
                select_name = f'"{spam_folder}"' if (" " in spam_folder or "/" in spam_folder) else spam_folder
                conn.select(select_name, readonly=False)
                typ2, data = conn.search(None, "ALL")
                if typ2 == "OK" and data and data[0]:
                    uids = data[0].split()[-max_messages:]
                    for uid in uids:
                        mid = _imap_fetch_message_id_sync(conn, uid)
                        if mid and mid in move_set:
                            conn.copy(uid, "INBOX")
                            conn.store(uid, "+FLAGS", "\\Deleted")
                            num_moved += 1
                    conn.expunge()
                conn.select("INBOX")
            except Exception as e:
                logger.warning("Warmup receiver: Spam folder %s error: %s", spam_folder, e)

        # INBOX: find unread, get Message-ID, mark read (only if in allow_open when set) and collect for reply
        conn.select("INBOX", readonly=False)
        typ, data = conn.search(None, "UNSEEN")
        if typ == "OK" and data and data[0]:
            uids = data[0].split()[-max_messages:]
            for uid in uids:
                mid = _imap_fetch_message_id_sync(conn, uid)
                if not mid or mid not in mark_set:
                    continue
                if allow_open is not None and mid not in allow_open:
                    can_reply.append((mid, uid.decode() if isinstance(uid, bytes) else str(uid), None))
                    continue
                conn.store(uid, "+FLAGS", "\\Seen")
                if mark_important_message_ids and mid in mark_important_message_ids:
                    try:
                        conn.store(uid, "+FLAGS", "\\Flagged")
                        marked_important.append(mid)
                    except Exception as fe:
                        logger.warning("Warmup receiver: IMAP mark important (flagged) failed for %s: %s", mid, fe)
                marked_read.append(mid)
                try:
                    typ2, subj_data = conn.fetch(uid, "(BODY.PEEK[HEADER.FIELDS (SUBJECT)])")
                    subject = None
                    if typ2 == "OK" and subj_data:
                        raw = subj_data[0][1].decode("utf-8", errors="replace") if isinstance(subj_data[0][1], bytes) else str(subj_data[0][1])
                        msg = email.message_from_string(raw)
                        subject = (msg.get("Subject", "") or "").strip() or None
                    can_reply.append((mid, uid.decode() if isinstance(uid, bytes) else str(uid), subject))
                except Exception:
                    can_reply.append((mid, uid.decode() if isinstance(uid, bytes) else str(uid), None))
        conn.logout()
    except Exception as e:
        logger.warning("Warmup receiver IMAP for %s: %s", host, e)
    return (num_moved, marked_read, can_reply, marked_important)


def _imap_move_spam_to_inbox_only_sync(
    host: str,
    port: int,
    username: str,
    password: str,
    message_ids_to_move: List[str],
    max_messages: int = 100,
) -> int:
    """Only move matching messages from Spam to INBOX (report not spam). Returns count moved."""
    num_moved = 0
    move_set = set(message_ids_to_move)
    if not move_set:
        return 0
    try:
        use_ssl = port == 993
        if use_ssl:
            conn = imaplib.IMAP4_SSL(host, port=port)
        else:
            conn = imaplib.IMAP4(host, port=port)
        conn.login(username, password)
        spam_folder = _imap_find_spam_folder_sync(conn)
        if spam_folder:
            try:
                select_name = f'"{spam_folder}"' if (" " in spam_folder or "/" in spam_folder) else spam_folder
                conn.select(select_name, readonly=False)
                typ2, data = conn.search(None, "ALL")
                if typ2 == "OK" and data and data[0]:
                    uids = data[0].split()[-max_messages:]
                    for uid in uids:
                        mid = _imap_fetch_message_id_sync(conn, uid)
                        if mid and mid in move_set:
                            conn.copy(uid, "INBOX")
                            conn.store(uid, "+FLAGS", "\\Deleted")
                            num_moved += 1
                    conn.expunge()
            except Exception as e:
                logger.warning("Warmup receiver: Spam move only %s: %s", spam_folder, e)
        conn.logout()
    except Exception as e:
        logger.warning("Warmup receiver IMAP move spam only for %s: %s", host, e)
    return num_moved


def _imap_process_spam_and_inbox_sync_oauth(
    host: str,
    port: int,
    username: str,
    access_token: str,
    message_ids_to_move_from_spam: List[str],
    message_ids_to_mark_read_inbox: List[str],
    max_messages: int = 50,
    message_ids_allow_open: Optional[set] = None,
    mark_important_message_ids: Optional[set] = None,
) -> Tuple[int, List[str], List[Tuple[str, str, Optional[str]]], List[str]]:
    """Same as _imap_process_spam_and_inbox_sync but authenticate with XOAUTH2 (Outlook)."""
    num_moved = 0
    marked_read: List[str] = []
    marked_important: List[str] = []
    can_reply: List[Tuple[str, str, Optional[str]]] = []
    allow_open = message_ids_allow_open
    try:
        use_ssl = port == 993
        if use_ssl:
            conn = imaplib.IMAP4_SSL(host, port=port)
        else:
            conn = imaplib.IMAP4(host, port=port)
        xoauth2 = build_imap_xoauth2_string(username, access_token)
        conn.authenticate("XOAUTH2", lambda _: xoauth2)
        move_set = set(message_ids_to_move_from_spam)
        mark_set = set(message_ids_to_mark_read_inbox)

        spam_folder = _imap_find_spam_folder_sync(conn)
        if spam_folder:
            try:
                select_name = f'"{spam_folder}"' if (" " in spam_folder or "/" in spam_folder) else spam_folder
                conn.select(select_name, readonly=False)
                typ2, data = conn.search(None, "ALL")
                if typ2 == "OK" and data and data[0]:
                    uids = data[0].split()[-max_messages:]
                    for uid in uids:
                        mid = _imap_fetch_message_id_sync(conn, uid)
                        if mid and mid in move_set:
                            conn.copy(uid, "INBOX")
                            conn.store(uid, "+FLAGS", "\\Deleted")
                            num_moved += 1
                    conn.expunge()
                conn.select("INBOX")
            except Exception as e:
                logger.warning("Warmup receiver: Spam folder OAuth %s: %s", spam_folder, e)

        conn.select("INBOX", readonly=False)
        typ, data = conn.search(None, "UNSEEN")
        if typ == "OK" and data and data[0]:
            uids = data[0].split()[-max_messages:]
            for uid in uids:
                mid = _imap_fetch_message_id_sync(conn, uid)
                if not mid or mid not in mark_set:
                    continue
                if allow_open is not None and mid not in allow_open:
                    can_reply.append((mid, uid.decode() if isinstance(uid, bytes) else str(uid), None))
                    continue
                conn.store(uid, "+FLAGS", "\\Seen")
                if mark_important_message_ids and mid in mark_important_message_ids:
                    try:
                        conn.store(uid, "+FLAGS", "\\Flagged")
                        marked_important.append(mid)
                    except Exception as fe:
                        logger.warning("Warmup receiver: IMAP OAuth mark important (flagged) failed for %s: %s", mid, fe)
                marked_read.append(mid)
                try:
                    typ2, subj_data = conn.fetch(uid, "(BODY.PEEK[HEADER.FIELDS (SUBJECT)])")
                    subject = None
                    if typ2 == "OK" and subj_data:
                        raw = subj_data[0][1].decode("utf-8", errors="replace") if isinstance(subj_data[0][1], bytes) else str(subj_data[0][1])
                        msg = email.message_from_string(raw)
                        subject = (msg.get("Subject", "") or "").strip() or None
                    can_reply.append((mid, uid.decode() if isinstance(uid, bytes) else str(uid), subject))
                except Exception:
                    can_reply.append((mid, uid.decode() if isinstance(uid, bytes) else str(uid), None))
        conn.logout()
    except Exception as e:
        logger.warning("Warmup receiver IMAP OAuth for %s: %s", host, e)
    return (num_moved, marked_read, can_reply, marked_important)


def _imap_mark_important_by_message_id_sync(
    host: str,
    port: int,
    username: str,
    password: Optional[str],
    norm_message_id: str,
    *,
    access_token: Optional[str] = None,
) -> bool:
    """
    Best-effort: find message in INBOX by Message-ID and add \\Flagged (important-style signal for IMAP).
    """
    if not norm_message_id or not host or not username:
        return False
    try:
        use_ssl = port == 993
        if use_ssl:
            conn = imaplib.IMAP4_SSL(host, port=port)
        else:
            conn = imaplib.IMAP4(host, port=port)
        if access_token:
            xoauth2 = build_imap_xoauth2_string(username, access_token)
            conn.authenticate("XOAUTH2", lambda _: xoauth2)
        elif password:
            conn.login(username, password)
        else:
            return False
        conn.select("INBOX", readonly=False)
        candidates = [norm_message_id, f"<{norm_message_id}>"]
        uid = None
        for cid in candidates:
            try:
                # imaplib: single parenthesized SEARCH criterion
                esc = (cid or "").replace("\\", "\\\\").replace('"', '\\"')
                typ, data = conn.search(None, f'(HEADER Message-ID "{esc}")')
                if typ == "OK" and data and data[0]:
                    uids = data[0].split()
                    if uids:
                        uid = uids[-1]
                        break
            except Exception:
                continue
        if not uid:
            conn.logout()
            return False
        try:
            conn.store(uid, "+FLAGS", "\\Flagged")
        except Exception:
            conn.logout()
            return False
        conn.logout()
        return True
    except Exception as e:
        logger.warning("Warmup receiver: IMAP mark important by Message-ID failed: %s", e)
        return False


def _send_reply_via_smtp_sync(
    smtp_host: str,
    smtp_port: int,
    smtp_username: str,
    smtp_password: str,
    from_email: str,
    to_email: str,
    subject: str,
    body: str,
    in_reply_to: str,
    references: str,
) -> None:
    """Send a single reply email via SMTP with In-Reply-To and References."""
    msg = MIMEMultipart("alternative")
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    if in_reply_to and not in_reply_to.startswith("<"):
        in_reply_to = f"<{in_reply_to}>"
    msg["In-Reply-To"] = in_reply_to or ""
    ref = (references or "").strip()
    if not ref and in_reply_to:
        ref = in_reply_to
    msg["References"] = ref
    msg.attach(MIMEText(body, "plain"))
    if smtp_port == 465:
        server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=30)
    else:
        server = smtplib.SMTP(smtp_host, smtp_port, timeout=30)
        if smtp_port == 587:
            server.starttls()
    server.login(smtp_username, smtp_password)
    server.sendmail(from_email, [to_email], msg.as_string())
    server.quit()


def _send_reply_via_smtp_oauth_sync(
    smtp_host: str,
    smtp_port: int,
    smtp_username: str,
    access_token: str,
    from_email: str,
    to_email: str,
    subject: str,
    body: str,
    in_reply_to: str,
    references: str,
) -> None:
    """Send a single reply via SMTP with XOAUTH2 (Outlook)."""
    msg = MIMEMultipart("alternative")
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    if in_reply_to and not in_reply_to.startswith("<"):
        in_reply_to = f"<{in_reply_to}>"
    msg["In-Reply-To"] = in_reply_to or ""
    ref = (references or "").strip()
    if not ref and in_reply_to:
        ref = in_reply_to
    msg["References"] = ref
    msg.attach(MIMEText(body, "plain"))
    if smtp_port == 465:
        server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=30)
    else:
        server = smtplib.SMTP(smtp_host, smtp_port, timeout=30)
        if smtp_port == 587:
            server.starttls()
    xoauth2 = build_smtp_xoauth2_string(smtp_username, access_token)
    server.docmd("AUTH", "XOAUTH2 " + xoauth2)
    server.sendmail(from_email, [to_email], msg.as_string())
    server.quit()


class WarmupReceiverService:
    """For each platform receiver account: move warm-up from Spam to INBOX, mark read, send replies from template pool."""

    def __init__(
        self,
        db: Any,
        admin_db: Any,
        smtp_service: Any,
        warmup_llm_service: Any = None,
        email_service: Any = None,
    ):
        self.db = db
        self.admin_db = admin_db
        self.smtp_service = smtp_service
        self.warmup_llm_service = warmup_llm_service
        self.email_service = email_service
        self.multiturn_enabled = (os.getenv("WARMUP_MULTITURN_ENABLED") or "1").lower() in ("1", "true", "yes")

    async def _load_thread_history(self, thread_id: str) -> List[Dict[str, str]]:
        docs = await self.db.warmup_messages.find({"thread_id": thread_id}).sort("sent_at", -1).limit(6).to_list(None)
        return [{"role": d.get("role", "other"), "body": d.get("body", "")} for d in reversed(docs)]

    def _in_human_window(self, now_utc: datetime, tz_name: str, start_hour: int, end_hour: int) -> bool:
        try:
            local_now = now_utc.astimezone(ZoneInfo(tz_name))
        except Exception:
            local_now = now_utc
        h = local_now.hour
        is_weekend = local_now.weekday() >= 5
        if is_weekend and random.random() < 0.45:
            return False
        if start_hour <= end_hour:
            return start_hour <= h <= end_hour
        return h >= start_hour or h <= end_hour

    def _next_delay_minutes(self, turn_count: int) -> int:
        # Later turns naturally get longer delays.
        if turn_count <= 1:
            return random.randint(90, 240)
        if turn_count <= 3:
            return random.randint(180, 720)
        return random.randint(360, 1440)

    async def _warmup_should_mark_receiver_important(
        self,
        inbox: Dict[str, Any],
        sent_doc: Dict[str, Any],
        *,
        event: str,
        reply_rate: float,
        now_utc: datetime,
        extra_marked_today: Dict[str, int],
    ) -> Tuple[bool, bool]:
        """
        Whether the receiver should mark this warmup message important (and optional Gmail STARRED / Outlook flag).
        event: "open" | "reply"
        extra_marked_today: inbox_id -> marks already applied this run (before DB visible).
        """
        if sent_doc.get("receiver_marked_important_at"):
            return False, False
        inbox_id = sent_doc.get("inbox_id")
        if not inbox_id or not inbox:
            return False, False
        day = _compute_warmup_day_index_from_inbox(inbox, now_utc)
        lo, hi = _warmup_phase_important_band(day)
        day_start = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
        sent_today = await self.db.warmup_sent.count_documents(
            {"inbox_id": inbox_id, "sent_at": {"$gte": day_start}}
        )
        marked_today = await self.db.warmup_sent.count_documents(
            {"inbox_id": inbox_id, "receiver_marked_important_at": {"$gte": day_start}}
        )
        marked_today += int(extra_marked_today.get(inbox_id, 0))
        p = random.uniform(lo, hi)
        target_max = int(math.ceil(sent_today * hi)) if sent_today else 0
        if sent_today >= 3 and target_max > 0 and marked_today >= target_max:
            return False, False
        rr = max(0.15, min(0.95, float(reply_rate or DEFAULT_WARMUP_TARGET_REPLY_RATE)))
        # Phase 1: mostly on replies; rare on open-only
        if 1 <= day <= 7:
            if event == "open":
                if random.random() >= 0.05:
                    return False, False
            else:
                if random.random() >= min(0.95, p / rr):
                    return False, False
        elif 8 <= day <= 15:
            if event == "open":
                if random.random() >= p * 0.5:
                    return False, False
            else:
                if random.random() >= min(0.95, p * 0.55 / rr):
                    return False, False
        elif 16 <= day <= 23:
            if event == "open":
                if random.random() >= p * 0.55:
                    return False, False
            else:
                if random.random() >= min(0.95, p * 0.35 / rr):
                    return False, False
        else:
            if event == "open":
                if random.random() >= p * 0.5:
                    return False, False
            else:
                if random.random() >= min(0.95, p * 0.5 / rr):
                    return False, False
        add_star = 16 <= day <= 23 and random.random() < 0.25
        return True, add_star

    async def _build_receiver_behavior_profile(self, receiver_account_id: str) -> Dict[str, Any]:
        """Build stable receiver behavior profile (synthetic/learned) and persist on receiver account."""
        async def _synthetic_profile() -> Dict[str, Any]:
            p = random.choice(SYNTHETIC_RECEIVER_PERSONAS)
            s = random.randint(*p["start"])
            e = random.randint(*p["end"])
            gmin, gmax = p["gap"]
            return {
                "profile_source": "synthetic",
                "persona": p["name"],
                "persona_timezone": random.choice(HUMAN_TIMEZONES),
                "active_start_hour": s,
                "active_end_hour": e,
                "turn_dropoff_chance": round(random.uniform(*p["drop"]), 2),
                "next_action_min": gmin,
                "next_action_max": gmax,
            }

        default_profile: Dict[str, Any] = {
            "profile_source": "default",
            "persona": "office_receiver",
            "persona_timezone": random.choice(HUMAN_TIMEZONES),
            "active_start_hour": 8,
            "active_end_hour": 21,
            "turn_dropoff_chance": 0.25,
            "next_action_min": 120,
            "next_action_max": 720,
        }
        try:
            rec_doc = await self.admin_db.warmup_receiver_accounts.find_one(
                {"id": receiver_account_id},
                {"warmup_behavior_profile": 1},
            )
            existing = (rec_doc or {}).get("warmup_behavior_profile")
            # Keep synthetic/default sticky so behavior doesn't jitter between runs.
            if existing and existing.get("profile_source") in ("synthetic", "default"):
                return existing

            warm_msgs = await self.db.warmup_messages.find(
                {"receiver_account_id": receiver_account_id, "role": "receiver"}
            ).sort("sent_at", -1).limit(250).to_list(None)
            if len(warm_msgs) < 6:
                profile = await _synthetic_profile()
                await self.admin_db.warmup_receiver_accounts.update_one(
                    {"id": receiver_account_id},
                    {"$set": {"warmup_behavior_profile": profile, "updated_at": datetime.now(timezone.utc)}},
                )
                return profile

            hours: List[int] = []
            ts: List[datetime] = []
            weekend = 0
            weekdays = 0
            for m in warm_msgs:
                sent_at = m.get("sent_at")
                if not sent_at:
                    continue
                if isinstance(sent_at, str):
                    from dateutil import parser
                    sent_at = parser.parse(sent_at)
                if getattr(sent_at, "tzinfo", None) is None and hasattr(sent_at, "replace"):
                    sent_at = sent_at.replace(tzinfo=timezone.utc)
                hours.append(sent_at.hour)
                ts.append(sent_at)
                if sent_at.weekday() >= 5:
                    weekend += 1
                else:
                    weekdays += 1
            if len(hours) < 6:
                profile = await _synthetic_profile()
                await self.admin_db.warmup_receiver_accounts.update_one(
                    {"id": receiver_account_id},
                    {"$set": {"warmup_behavior_profile": profile, "updated_at": datetime.now(timezone.utc)}},
                )
                return profile

            sorted_hours = sorted(hours)
            i15 = sorted_hours[max(0, int(len(sorted_hours) * 0.15) - 1)]
            i85 = sorted_hours[min(len(sorted_hours) - 1, int(len(sorted_hours) * 0.85))]
            ts_sorted = sorted(ts)
            gaps: List[float] = []
            for i in range(1, len(ts_sorted)):
                d = (ts_sorted[i] - ts_sorted[i - 1]).total_seconds() / 60.0
                if 5 <= d <= 60 * 48:
                    gaps.append(d)
            gaps_sorted = sorted(gaps) if gaps else []
            median_gap = int(gaps_sorted[len(gaps_sorted) // 2]) if gaps_sorted else 360
            weekend_ratio = weekend / max(1, weekend + weekdays)

            profile = {
                "profile_source": "learned",
                "persona": "learned_receiver",
                "persona_timezone": random.choice(HUMAN_TIMEZONES),
                "active_start_hour": max(6, min(11, i15)),
                "active_end_hour": max(max(6, min(11, i15)) + 6, min(23, i85 + 1)),
                "turn_dropoff_chance": round(min(0.55, max(0.12, 0.20 + weekend_ratio * 0.25)), 2),
                "next_action_min": max(90, int(median_gap * 0.6)),
                "next_action_max": min(1440, max(max(90, int(median_gap * 0.6)) + 60, int(median_gap * 1.8))),
            }
            await self.admin_db.warmup_receiver_accounts.update_one(
                {"id": receiver_account_id},
                {"$set": {"warmup_behavior_profile": profile, "updated_at": datetime.now(timezone.utc)}},
            )
            return profile
        except Exception:
            return default_profile

    def _is_repetitive(self, text: str, recent_texts: List[str]) -> bool:
        candidate = (text or "").strip().lower()
        if not candidate:
            return True
        for old in recent_texts:
            ref = (old or "").strip().lower()
            if not ref:
                continue
            if candidate == ref:
                return True
            if difflib.SequenceMatcher(a=candidate, b=ref).ratio() >= 0.88:
                return True
        return False

    def _last_user_message_requires_answer(self, history: List[Dict[str, str]]) -> bool:
        if not history:
            return False
        last = history[-1]
        body = (last.get("body") or "").strip().lower()
        if not body:
            return False
        if "?" in body:
            return True
        question_markers = ("can you", "could you", "what", "when", "where", "why", "how", "do you", "are you")
        return any(m in body for m in question_markers)

    def _select_intent(self, thread: Dict, history: List[Dict[str, str]]) -> str:
        stage = (thread.get("stage") or "active").lower()
        turn_count = int(thread.get("turn_count") or 1)
        max_turns = max(1, int(thread.get("max_turns") or 3))
        needs_answer = self._last_user_message_requires_answer(history)
        near_end = turn_count >= max(2, max_turns - 1)

        if needs_answer:
            # Never choose close intent when a direct question is pending.
            return random.choice(["answer_directly", "clarify_and_continue", "continue"])
        if stage == "new":
            return random.choice(["acknowledge", "continue"])
        if stage in ("cooldown", "active") and near_end:
            return random.choice(["close_softly", "continue", "acknowledge"])
        return random.choice(["acknowledge", "continue"])

    async def _build_reply_behavior_profile(self, inbox_id: str) -> Dict[str, Any]:
        """Use prior sent/replied logs to tune human-like reply timing for this inbox."""
        def _synthetic_profile() -> Dict[str, Any]:
            p = random.choice(SYNTHETIC_REPLY_ARCHETYPES)
            return {
                "profile_source": "synthetic",
                "archetype": p["name"],
                "min_reply_delay_min": p["reply_min"],
                "max_reply_delay_min": p["reply_max"],
                "next_action_min": p["next_min"],
                "next_action_max": p["next_max"],
            }

        profile = {
            "profile_source": "default",
            "archetype": "balanced_responder",
            "min_reply_delay_min": 30,
            "max_reply_delay_min": 90,
            "next_action_min": 120,
            "next_action_max": 720,
        }
        try:
            inbox_doc = await self.db.inboxes.find_one({"id": inbox_id}, {"warmup_reply_behavior_profile": 1})
            existing = (inbox_doc or {}).get("warmup_reply_behavior_profile")
            # Keep synthetic/default profile sticky until enough data exists to learn safely.
            if existing and existing.get("profile_source") in ("synthetic", "default"):
                return existing

            rows = await self.db.warmup_sent.find(
                {"inbox_id": inbox_id, "sent_at": {"$exists": True}, "replied_at": {"$exists": True, "$ne": None}}
            ).sort("sent_at", -1).limit(250).to_list(None)
            delays: List[int] = []
            for r in rows:
                sent_at = r.get("sent_at")
                replied_at = r.get("replied_at")
                if not sent_at or not replied_at:
                    continue
                if isinstance(sent_at, str):
                    from dateutil import parser
                    sent_at = parser.parse(sent_at)
                if isinstance(replied_at, str):
                    from dateutil import parser
                    replied_at = parser.parse(replied_at)
                if getattr(sent_at, "tzinfo", None) is None and hasattr(sent_at, "replace"):
                    sent_at = sent_at.replace(tzinfo=timezone.utc)
                if getattr(replied_at, "tzinfo", None) is None and hasattr(replied_at, "replace"):
                    replied_at = replied_at.replace(tzinfo=timezone.utc)
                minutes = int((replied_at - sent_at).total_seconds() / 60.0)
                if 5 <= minutes <= 60 * 48:
                    delays.append(minutes)
            if len(delays) < 5:
                synthetic = _synthetic_profile()
                await self.db.inboxes.update_one(
                    {"id": inbox_id},
                    {"$set": {"warmup_reply_behavior_profile": synthetic, "updated_at": datetime.now(timezone.utc)}},
                )
                return synthetic
            delays.sort()
            p20 = delays[max(0, int(len(delays) * 0.20) - 1)]
            p80 = delays[min(len(delays) - 1, int(len(delays) * 0.80))]
            med = delays[len(delays) // 2]
            profile["profile_source"] = "learned"
            profile["archetype"] = "learned"
            profile["min_reply_delay_min"] = max(20, p20)
            profile["max_reply_delay_min"] = max(profile["min_reply_delay_min"] + 15, p80)
            profile["next_action_min"] = max(90, int(med * 0.8))
            profile["next_action_max"] = min(1440, max(profile["next_action_min"] + 30, int(med * 2.0)))
            await self.db.inboxes.update_one(
                {"id": inbox_id},
                {"$set": {"warmup_reply_behavior_profile": profile, "updated_at": datetime.now(timezone.utc)}},
            )
            return profile
        except Exception:
            return profile

    async def _ensure_thread(
        self,
        sent_doc: Dict,
        receiver_account_id: str,
        receiver_behavior: Optional[Dict[str, Any]] = None,
    ) -> Dict:
        thread_id = sent_doc.get("thread_id")
        now = datetime.now(timezone.utc)
        if thread_id:
            existing = await self.db.warmup_threads.find_one({"id": thread_id})
            if existing:
                return existing
        receiver_behavior = receiver_behavior or {}
        thread_id = str(uuid.uuid4())
        doc = {
            "id": thread_id,
            "inbox_id": sent_doc["inbox_id"],
            "user_id": sent_doc["user_id"],
            "receiver_account_id": receiver_account_id,
            "receiver_email": sent_doc.get("receiver_email"),
            "root_message_id": sent_doc["message_id"],
            "stage": "active",
            "turn_count": max(1, int(sent_doc.get("turn_index") or 0) + 1),
            "max_turns": random.randint(2, 6),
            "persona_timezone": receiver_behavior.get("persona_timezone") or random.choice(HUMAN_TIMEZONES),
            "active_start_hour": int(receiver_behavior.get("active_start_hour") or random.randint(7, 10)),
            "active_end_hour": int(receiver_behavior.get("active_end_hour") or random.randint(18, 22)),
            "turn_dropoff_chance": float(receiver_behavior.get("turn_dropoff_chance") or round(random.uniform(0.15, 0.45), 2)),
            "last_sender_role": "inbox",
            "last_subject": sent_doc.get("subject"),
            "started_at": now,
            "last_activity_at": now,
            "next_action_at": now,
            "created_at": now,
            "updated_at": now,
        }
        await self.db.warmup_threads.insert_one(doc)
        await self.db.warmup_sent.update_one({"id": sent_doc["id"]}, {"$set": {"thread_id": thread_id, "updated_at": now}})
        return doc

    async def run(self, max_replies_per_account_per_run: int = 2) -> Dict[str, int]:
        """
        One receiver cycle: for each active receiver account, process Spam/INBOX and send up to
        max_replies_per_account_per_run replies. Returns moved_from_spam, opened, replied counts.
        """
        receivers = await self.admin_db.warmup_receiver_accounts.find({"is_active": True}).to_list(None)
        moved_from_spam = 0
        opened = 0
        replied = 0

        for rec in receivers:
            try:
                effective_max_replies = max_replies_per_account_per_run
                daily_cap = rec.get("daily_reply_cap")
                if daily_cap is not None:
                    try:
                        cap = max(0, int(daily_cap))
                        day_start = datetime.now(timezone.utc).replace(
                            hour=0, minute=0, second=0, microsecond=0
                        )
                        replied_today = await self.db.warmup_sent.count_documents(
                            {
                                "receiver_account_id": rec.get("id"),
                                "replied_at": {"$gte": day_start},
                            }
                        )
                        remaining = max(0, cap - int(replied_today or 0))
                        effective_max_replies = min(effective_max_replies, remaining)
                    except Exception as e:
                        logger.warning(
                            "Warmup receiver: daily_reply_cap eval failed for %s: %s",
                            rec.get("email"),
                            e,
                        )
                m, o, r = await self._process_one_receiver(rec, effective_max_replies)
                moved_from_spam += m
                opened += o  # o = number of messages marked read in INBOX
                replied += r
            except Exception as e:
                logger.exception("Warmup receiver: error processing %s: %s", rec.get("email"), e)

        return {"moved_from_spam": moved_from_spam, "opened": opened, "replied": replied}

    async def run_spam_to_inbox_only(self) -> int:
        """
        Daily pass: for each active receiver, move all warmup emails from Spam to INBOX (report not spam).
        Does not mark read or send replies. Returns total moved across all receivers.
        """
        receivers = await self.admin_db.warmup_receiver_accounts.find({"is_active": True}).to_list(None)
        total_moved = 0
        for rec in receivers:
            try:
                total_moved += await self._move_spam_to_inbox_one_receiver(rec)
            except Exception as e:
                logger.exception("Warmup receiver spam-to-inbox: error for %s: %s", rec.get("email"), e)
        return total_moved

    async def _move_spam_to_inbox_one_receiver(self, rec: Dict) -> int:
        """Move warmup messages from Spam to INBOX for one receiver. Returns count moved."""
        receiver_account_id = rec["id"]
        receiver_email = rec.get("email")
        if not receiver_email:
            return 0
        sent_cursor = self.db.warmup_sent.find(
            {"receiver_account_id": receiver_account_id, "receiver_email": receiver_email}
        )
        sent_list = await sent_cursor.to_list(None)
        if not sent_list:
            return 0
        message_ids_all = [s["message_id"] for s in sent_list]
        move_set = {_normalize_message_id(m) for m in message_ids_all}

        provider = rec.get("provider")
        is_outlook_oauth = (
            provider == "outlook"
            and (rec.get("auth_method") == "oauth" or rec.get("outlook_refresh_token"))
        )
        is_gmail_oauth = (
            provider == "gmail"
            and (rec.get("auth_method") == "oauth" or rec.get("gmail_refresh_token"))
        )
        num_moved = 0

        if is_outlook_oauth:
            try:
                refresh_token = self.smtp_service._decrypt_password(rec["outlook_refresh_token"])
                access_token = await get_access_token_async(refresh_token)
                junk_msgs = await graph_list_junk_messages(access_token, 100)
                for j in junk_msgs:
                    mid = j.get("internetMessageId")
                    if mid and mid in move_set:
                        await graph_move_to_inbox(access_token, j["id"])
                        num_moved += 1
            except Exception as e:
                logger.warning("Warmup receiver spam-to-inbox Outlook %s: %s", receiver_email, e)
        elif is_gmail_oauth:
            try:
                refresh_token = self.smtp_service._decrypt_password(rec["gmail_refresh_token"])
                client_id = rec.get("google_client_id") or ""
                secret_encrypted = rec.get("google_client_secret_encrypted")
                client_secret = (
                    self.smtp_service._decrypt_password(secret_encrypted) if secret_encrypted else ""
                )
                if refresh_token and client_id and client_secret:
                    access_token = await get_gmail_access_token_async(
                        refresh_token, client_id, client_secret, scope="https://mail.google.com/"
                    )
                    gmail_service = build_gmail_service(access_token, refresh_token, client_id, client_secret)
                    spam_msgs = await asyncio.to_thread(gmail_api_list_spam, gmail_service, 100)
                    for j in spam_msgs:
                        mid = j.get("message_id")
                        if mid and mid in move_set:
                            await asyncio.to_thread(gmail_api_move_to_inbox, gmail_service, j["id"])
                            num_moved += 1
            except Exception as e:
                logger.warning("Warmup receiver spam-to-inbox Gmail %s: %s", receiver_email, e)
        else:
            try:
                imap_password = self.smtp_service._decrypt_password(rec["imap_password"]) if rec.get("imap_password") else None
            except Exception as e:
                logger.warning("Warmup receiver spam-to-inbox decrypt %s: %s", receiver_email, e)
                return 0
            if imap_password:
                num_moved = await asyncio.to_thread(
                    _imap_move_spam_to_inbox_only_sync,
                    rec.get("imap_host"),
                    rec.get("imap_port", 993),
                    rec.get("imap_username"),
                    imap_password,
                    list(move_set),
                    100,
                )
        return num_moved

    async def _process_one_receiver(
        self, rec: Dict, max_replies: int
    ) -> Tuple[int, int, int]:
        """Process one receiver account: decrypt, IMAP (spam + inbox), send replies. Returns (moved, opened, replied)."""
        receiver_account_id = rec["id"]
        receiver_email = rec.get("email")
        if not receiver_email:
            return (0, 0, 0)
        receiver_behavior = await self._build_receiver_behavior_profile(receiver_account_id)

        provider = rec.get("provider")
        is_outlook_oauth = (
            provider == "outlook"
            and (rec.get("auth_method") == "oauth" or rec.get("outlook_refresh_token"))
        )
        is_gmail_oauth = (
            provider == "gmail"
            and (rec.get("auth_method") == "oauth" or rec.get("gmail_refresh_token"))
        )
        gmail_service = None  # used for Gmail OAuth (Gmail API, not IMAP)

        if is_outlook_oauth:
            try:
                refresh_token = self.smtp_service._decrypt_password(rec["outlook_refresh_token"])
            except Exception as e:
                logger.warning("Warmup receiver: Outlook token decrypt failed for %s: %s", receiver_email, e)
                return (0, 0, 0)
            try:
                access_token = await get_access_token_async(refresh_token)
            except Exception as e:
                logger.warning("Warmup receiver: Outlook token refresh failed for %s: %s", receiver_email, e)
                return (0, 0, 0)
            imap_password = None
            smtp_password = None
        elif is_gmail_oauth:
            try:
                refresh_token = self.smtp_service._decrypt_password(rec["gmail_refresh_token"])
                client_id = rec.get("google_client_id") or ""
                secret_encrypted = rec.get("google_client_secret_encrypted")
                client_secret = (
                    self.smtp_service._decrypt_password(secret_encrypted) if secret_encrypted else ""
                )
            except Exception as e:
                logger.warning("Warmup receiver: Gmail token decrypt failed for %s: %s", receiver_email, e)
                return (0, 0, 0)
            if not refresh_token or not client_id or not client_secret:
                logger.warning("Warmup receiver: Gmail OAuth config incomplete for %s", receiver_email)
                return (0, 0, 0)
            try:
                access_token = await get_gmail_access_token_async(
                    refresh_token,
                    client_id,
                    client_secret,
                    scope="https://mail.google.com/",
                )
                gmail_service = build_gmail_service(access_token, refresh_token, client_id, client_secret)
            except Exception as e:
                logger.warning("Warmup receiver: Gmail token refresh failed for %s: %s", receiver_email, e)
                return (0, 0, 0)
            imap_password = None
            smtp_password = None
        else:
            try:
                imap_password = self.smtp_service._decrypt_password(rec["imap_password"]) if rec.get("imap_password") else None
                smtp_password = self.smtp_service._decrypt_password(rec["smtp_password"]) if rec.get("smtp_password") else None
            except Exception as e:
                logger.warning("Warmup receiver: decrypt failed for %s: %s", receiver_email, e)
                return (0, 0, 0)
            access_token = None
            if not imap_password:
                return (0, 0, 0)

        # warmup_sent rows for this receiver that we sent to this email
        sent_cursor = self.db.warmup_sent.find(
            {"receiver_account_id": receiver_account_id, "receiver_email": receiver_email}
        )
        sent_list = await sent_cursor.to_list(None)
        if not sent_list:
            await self.admin_db.warmup_receiver_accounts.update_one(
                {"id": receiver_account_id},
                {"$set": {"last_used_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)}},
            )
            return (0, 0, 0)

        message_ids_all = [s["message_id"] for s in sent_list]
        by_message_id = {_normalize_message_id(s["message_id"]): s for s in sent_list}
        move_set = {_normalize_message_id(m) for m in message_ids_all if _normalize_message_id(m)}
        mark_set = set(move_set)

        # Per-inbox open-rate cap (30–50%) + human-like delay (30–90 min after send) + same-day cap
        now_utc = datetime.now(timezone.utc)
        cutoff_24h = now_utc - timedelta(hours=24)
        inbox_open_rates: Dict[str, float] = {}
        inbox_opened_24h: Dict[str, int] = {}
        inbox_sent_24h: Dict[str, int] = {}
        for s in sent_list:
            iid = s.get("inbox_id")
            if not iid:
                continue
            if iid not in inbox_open_rates:
                inv = await self.db.inboxes.find_one({"id": iid})
                r = (inv or {}).get("warmup_target_open_rate")
                inbox_open_rates[iid] = float(r) if r is not None else DEFAULT_WARMUP_TARGET_OPEN_RATE
            if iid not in inbox_opened_24h:
                inbox_opened_24h[iid] = await self.db.warmup_sent.count_documents(
                    {"inbox_id": iid, "opened_at": {"$gte": cutoff_24h}}
                )
            if iid not in inbox_sent_24h:
                inbox_sent_24h[iid] = await self.db.warmup_sent.count_documents(
                    {"inbox_id": iid, "sent_at": {"$gte": cutoff_24h}}
                )
        allow_open_set: set = set()
        for s in sent_list:
            mid = _normalize_message_id(s.get("message_id"))
            if not mid:
                continue
            iid = s.get("inbox_id")
            rate = inbox_open_rates.get(iid, DEFAULT_WARMUP_TARGET_OPEN_RATE)
            # Same-day cap: don't open more than rate * sent_24h for this inbox today
            sent_24h = inbox_sent_24h.get(iid, 0)
            opened_24h = inbox_opened_24h.get(iid, 0)
            if sent_24h > 0 and opened_24h >= rate * sent_24h:
                continue
            # Human-like delay: only open if message is at least 30–90 min old
            sent_at = s.get("sent_at")
            if sent_at:
                if isinstance(sent_at, str):
                    try:
                        from dateutil import parser
                        sent_at = parser.parse(sent_at)
                    except Exception:
                        sent_at = None
                if getattr(sent_at, "tzinfo", None) is None and hasattr(sent_at, "replace"):
                    sent_at = sent_at.replace(tzinfo=timezone.utc)
                if sent_at:
                    age_min = (now_utc - sent_at).total_seconds() / 60.0
                    required_min = random.uniform(MIN_DELAY_OPEN_REPLY_MINUTES, MAX_DELAY_OPEN_REPLY_MINUTES)
                    if age_min < required_min:
                        continue
            if random.random() < rate:
                allow_open_set.add(mid)

        # Track per-inbox "mark important" quota within this run (DB counts + local).
        extra_marked_today: Dict[str, int] = {}
        inbox_cache: Dict[str, Any] = {}

        if is_outlook_oauth:
            # Use Microsoft Graph API (token has Mail.Read, Mail.Send)
            num_moved_spam = 0
            marked_read_ids: List[str] = []
            can_reply_list: List[Tuple[str, str, Optional[str]]] = []  # (message_id, graph_id, subject)
            try:
                junk_msgs = await graph_list_junk_messages(access_token, 50)
                for j in junk_msgs:
                    mid = j.get("internetMessageId")
                    if mid and mid in move_set:
                        await graph_move_to_inbox(access_token, j["id"])
                        num_moved_spam += 1
                inbox_msgs = await graph_list_inbox_messages(access_token, 50)
                for m in inbox_msgs:
                    mid = m.get("internetMessageId")
                    if not mid or mid not in mark_set:
                        continue
                    if not m.get("isRead") and mid in allow_open_set:
                        await graph_mark_read(access_token, m["id"])
                        marked_read_ids.append(mid)
                        sent_doc_open = by_message_id.get(mid)
                        iid_open = sent_doc_open.get("inbox_id") if sent_doc_open else None
                        if sent_doc_open and iid_open:
                            if iid_open not in inbox_cache:
                                inbox_cache[iid_open] = await self.db.inboxes.find_one({"id": iid_open}) or {}
                            inv_open = inbox_cache[iid_open]
                            rr_open = float(inv_open.get("warmup_target_reply_rate") or DEFAULT_WARMUP_TARGET_REPLY_RATE)
                            should_imp, star = await self._warmup_should_mark_receiver_important(
                                inv_open,
                                sent_doc_open,
                                event="open",
                                reply_rate=rr_open,
                                now_utc=now_utc,
                                extra_marked_today=extra_marked_today,
                            )
                            if should_imp:
                                mark_ts_imp = datetime.now(timezone.utc)
                                try:
                                    await graph_mark_important(access_token, m["id"], add_flag=star)
                                    extra_marked_today[iid_open] = extra_marked_today.get(iid_open, 0) + 1
                                    await self.db.warmup_sent.update_one(
                                        {"message_id": sent_doc_open["message_id"], "receiver_account_id": receiver_account_id},
                                        {"$set": {
                                            "receiver_marked_important_at": mark_ts_imp,
                                            "warmup_receiver_important_starred": star,
                                            "updated_at": mark_ts_imp,
                                        }},
                                    )
                                    sent_doc_open["receiver_marked_important_at"] = mark_ts_imp
                                    sent_doc_open["warmup_receiver_important_starred"] = star
                                except Exception as ie:
                                    logger.warning(
                                        "Warmup receiver: Graph mark important failed for %s: %s",
                                        receiver_email,
                                        ie,
                                    )
                    can_reply_list.append((mid, m["id"], m.get("subject")))
            except Exception as e:
                logger.warning("Warmup receiver: Graph mail failed for %s: %s", receiver_email, e)
                num_moved_spam = 0
                marked_read_ids = []
                can_reply_list = []
        elif is_gmail_oauth:
            # Use Gmail API (no IMAP/SMTP)
            num_moved_spam = 0
            marked_read_ids = []
            can_reply_list = []  # (message_id, gmail_api_id, subject)
            if gmail_service:
                try:
                    spam_msgs = await asyncio.to_thread(gmail_api_list_spam, gmail_service, 50)
                    for j in spam_msgs:
                        mid = j.get("message_id")
                        if mid and mid in move_set:
                            await asyncio.to_thread(gmail_api_move_to_inbox, gmail_service, j["id"])
                            num_moved_spam += 1
                    inbox_msgs = await asyncio.to_thread(gmail_api_list_inbox, gmail_service, 50)
                    for m in inbox_msgs:
                        mid = m.get("message_id")
                        if not mid or mid not in mark_set:
                            continue
                        if not m.get("isRead") and mid in allow_open_set:
                            await asyncio.to_thread(gmail_api_mark_read, gmail_service, m["id"])
                            marked_read_ids.append(mid)
                            sent_doc_open = by_message_id.get(mid)
                            iid_open = sent_doc_open.get("inbox_id") if sent_doc_open else None
                            if sent_doc_open and iid_open:
                                if iid_open not in inbox_cache:
                                    inbox_cache[iid_open] = await self.db.inboxes.find_one({"id": iid_open}) or {}
                                inv_open = inbox_cache[iid_open]
                                rr_open = float(inv_open.get("warmup_target_reply_rate") or DEFAULT_WARMUP_TARGET_REPLY_RATE)
                                should_imp, star = await self._warmup_should_mark_receiver_important(
                                    inv_open,
                                    sent_doc_open,
                                    event="open",
                                    reply_rate=rr_open,
                                    now_utc=now_utc,
                                    extra_marked_today=extra_marked_today,
                                )
                                if should_imp:
                                    mark_ts_imp = datetime.now(timezone.utc)
                                    try:
                                        await asyncio.to_thread(
                                            lambda gs=gmail_service, mid=m["id"], st=star: gmail_api_mark_important(
                                                gs, mid, add_starred=st
                                            )
                                        )
                                        extra_marked_today[iid_open] = extra_marked_today.get(iid_open, 0) + 1
                                        await self.db.warmup_sent.update_one(
                                            {"message_id": sent_doc_open["message_id"], "receiver_account_id": receiver_account_id},
                                            {"$set": {
                                                "receiver_marked_important_at": mark_ts_imp,
                                                "warmup_receiver_important_starred": star,
                                                "updated_at": mark_ts_imp,
                                            }},
                                        )
                                        sent_doc_open["receiver_marked_important_at"] = mark_ts_imp
                                        sent_doc_open["warmup_receiver_important_starred"] = star
                                    except Exception as ie:
                                        logger.warning(
                                            "Warmup receiver: Gmail mark important failed for %s: %s",
                                            receiver_email,
                                            ie,
                                        )
                        can_reply_list.append((mid, m["id"], m.get("subject")))
                except Exception as e:
                    logger.warning("Warmup receiver: Gmail API failed for %s: %s", receiver_email, e)
        else:
            host = rec.get("imap_host")
            port = rec.get("imap_port", 993)
            username = rec.get("imap_username")
            mark_imp_open: set = set()
            for mid in sorted(allow_open_set):
                doc_o = by_message_id.get(mid)
                if not doc_o:
                    continue
                iid_o = doc_o.get("inbox_id")
                if not iid_o:
                    continue
                if iid_o not in inbox_cache:
                    inbox_cache[iid_o] = await self.db.inboxes.find_one({"id": iid_o}) or {}
                inv_o = inbox_cache[iid_o]
                rr_o = float(inv_o.get("warmup_target_reply_rate") or DEFAULT_WARMUP_TARGET_REPLY_RATE)
                should_imp, _ = await self._warmup_should_mark_receiver_important(
                    inv_o,
                    doc_o,
                    event="open",
                    reply_rate=rr_o,
                    now_utc=now_utc,
                    extra_marked_today=extra_marked_today,
                )
                if should_imp:
                    mark_imp_open.add(mid)
            num_moved_spam, marked_read_ids, can_reply_list, imap_marked_important_ids = await asyncio.to_thread(
                _imap_process_spam_and_inbox_sync,
                host,
                port,
                username,
                imap_password,
                message_ids_all,
                message_ids_all,
                50,
                allow_open_set,
                mark_imp_open,
            )
            for mid_imp in imap_marked_important_ids:
                doc_imp = by_message_id.get(mid_imp)
                if not doc_imp:
                    continue
                iid_imp = doc_imp.get("inbox_id")
                if not iid_imp:
                    continue
                extra_marked_today[iid_imp] = extra_marked_today.get(iid_imp, 0) + 1
                mark_ts_imp = datetime.now(timezone.utc)
                await self.db.warmup_sent.update_one(
                    {"message_id": doc_imp["message_id"], "receiver_account_id": receiver_account_id},
                    {"$set": {
                        "receiver_marked_important_at": mark_ts_imp,
                        "warmup_receiver_important_starred": False,
                        "updated_at": mark_ts_imp,
                    }},
                )
                doc_imp["receiver_marked_important_at"] = mark_ts_imp
                doc_imp["warmup_receiver_important_starred"] = False

        now = datetime.now(timezone.utc)
        for mid in marked_read_ids:
            doc = by_message_id.get(mid)
            if doc and not doc.get("opened_at"):
                await self.db.warmup_sent.update_one(
                    {"message_id": doc["message_id"], "receiver_account_id": receiver_account_id},
                    {"$set": {"opened_at": now, "updated_at": now}},
                )

        # Reply: pick up to max_replies from can_reply_list that don't have replied_at yet.
        # Replies are generated with Groq (or deterministic fallback) using user warmup style.
        can_send_reply = (
            smtp_password is not None or (is_outlook_oauth and access_token) or (is_gmail_oauth and gmail_service)
        )
        if not can_send_reply:
            await self.admin_db.warmup_receiver_accounts.update_one(
                {"id": receiver_account_id},
                {"$set": {"last_used_at": now, "updated_at": now}},
            )
            return (num_moved_spam, len(marked_read_ids), 0)

        reply_count = 0
        for mid, uid, subj in can_reply_list[: max_replies * 2]:
            if reply_count >= max_replies:
                break
            sent_doc = by_message_id.get(mid)
            if not sent_doc or sent_doc.get("replied_at"):
                continue
            thread = await self._ensure_thread(sent_doc, receiver_account_id, receiver_behavior)
            if self.multiturn_enabled:
                if thread.get("stage") == "closed":
                    continue
                max_turns = int(thread.get("max_turns") or 3)
                turn_count = int(thread.get("turn_count") or 1)
                if turn_count >= max_turns:
                    await self.db.warmup_threads.update_one(
                        {"id": thread["id"]},
                        {"$set": {"stage": "closed", "close_reason": "max_turns", "ended_at": now, "updated_at": now}},
                    )
                    continue
                next_action_at = thread.get("next_action_at")
                if next_action_at and next_action_at > now:
                    continue
                tz_name = thread.get("persona_timezone") or receiver_behavior.get("persona_timezone") or random.choice(HUMAN_TIMEZONES)
                start_hour = int(thread.get("active_start_hour") or receiver_behavior.get("active_start_hour") or 8)
                end_hour = int(thread.get("active_end_hour") or receiver_behavior.get("active_end_hour") or 20)
                if not self._in_human_window(now, tz_name, start_hour, end_hour):
                    continue
                # Natural drop-off chance after first few turns.
                dropoff = float(thread.get("turn_dropoff_chance") or receiver_behavior.get("turn_dropoff_chance") or 0.2)
                if turn_count >= 2 and random.random() < dropoff:
                    await self.db.warmup_threads.update_one(
                        {"id": thread["id"]},
                        {"$set": {"stage": "closed", "close_reason": "natural_dropoff", "ended_at": now, "updated_at": now}},
                    )
                    continue
            # Reply only after open (human-like thread order)
            if not sent_doc.get("opened_at"):
                continue
            reply_behavior = await self._build_reply_behavior_profile(sent_doc["inbox_id"])
            # Human-like delay: only reply if message is at least profile-shaped delay old
            sent_at = sent_doc.get("sent_at")
            if sent_at:
                if isinstance(sent_at, str):
                    try:
                        from dateutil import parser
                        sent_at = parser.parse(sent_at)
                    except Exception:
                        sent_at = None
                if sent_at and getattr(sent_at, "tzinfo", None) is None and hasattr(sent_at, "replace"):
                    sent_at = sent_at.replace(tzinfo=timezone.utc)
                if sent_at:
                    age_min = (now_utc - sent_at).total_seconds() / 60.0
                    if age_min < random.uniform(
                        reply_behavior.get("min_reply_delay_min", MIN_DELAY_OPEN_REPLY_MINUTES),
                        reply_behavior.get("max_reply_delay_min", MAX_DELAY_OPEN_REPLY_MINUTES),
                    ):
                        continue
            inbox_id = sent_doc["inbox_id"]
            inbox = await self.db.inboxes.find_one({"id": inbox_id})
            if not inbox:
                continue
            # Per-inbox reply-rate cap (30–50%): skip replying with probability (1 - rate)
            reply_rate = inbox.get("warmup_target_reply_rate")
            if reply_rate is None:
                reply_rate = DEFAULT_WARMUP_TARGET_REPLY_RATE
            if random.random() >= reply_rate:
                continue
            from_email_inbox = inbox.get("email")
            if not from_email_inbox:
                continue
            subject_reply = f"Re: {sent_doc.get('subject', '')}"[:200]
            style_templates = await self.db.warmup_send_templates.find(
                {"user_id": sent_doc["user_id"], "body": {"$exists": True}}
            ).limit(10).to_list(None)
            style_samples = [t.get("body", "") for t in style_templates]
            history = await self._load_thread_history(thread["id"])
            selected_intent = self._select_intent(thread, history)
            generated = (
                await self.warmup_llm_service.generate_reply(
                    style_samples=style_samples,
                    thread_history=history,
                    turn_index=int(thread.get("turn_count") or 1),
                    intent=selected_intent,
                    banned_phrases=[h.get("body", "") for h in history[-3:]],
                )
                if self.warmup_llm_service
                else {"body": "Thanks for the update.", "source": "fallback", "quality_score": 0.5, "model": None}
            )
            body = (generated.get("body") or "").strip() or "Thanks for the update."
            if self._is_repetitive(body, [h.get("body", "") for h in history[-4:]]):
                regen = (
                    await self.warmup_llm_service.generate_reply(
                        style_samples=style_samples,
                        thread_history=history,
                        turn_index=int(thread.get("turn_count") or 1),
                        intent="clarify_and_continue" if self._last_user_message_requires_answer(history) else "continue",
                        banned_phrases=[h.get("body", "") for h in history[-5:]],
                    )
                    if self.warmup_llm_service
                    else {"body": ""}
                )
                body = (regen.get("body") or body).strip()
            if self.email_service is not None:
                try:
                    ctx = WarmupSenderService._warmup_placeholder_contact(inbox, rec)
                    body = self.email_service.parse_spintax(body or "")
                    body = self.email_service.replace_placeholders(body, ctx)
                except Exception as pe:
                    logger.warning("Warmup receiver: spintax/placeholders on reply failed: %s", pe)
            in_reply_to = sent_doc["message_id"]
            references = in_reply_to
            if not in_reply_to.startswith("<"):
                in_reply_to = f"<{in_reply_to}>"
            try:
                if is_outlook_oauth:
                    await graph_send_reply(access_token, uid, body, from_email=receiver_email)
                elif is_gmail_oauth:
                    await asyncio.to_thread(
                        gmail_api_send_mail,
                        gmail_service,
                        from_email_inbox,
                        subject_reply,
                        body,
                        from_email=receiver_email,
                        in_reply_to=in_reply_to,
                        references=references,
                    )
                else:
                    await asyncio.to_thread(
                        _send_reply_via_smtp_sync,
                        rec.get("smtp_host"),
                        rec.get("smtp_port", 587),
                        rec.get("smtp_username"),
                        smtp_password,
                        receiver_email,
                        from_email_inbox,
                        subject_reply,
                        body,
                        in_reply_to,
                        references,
                    )
            except Exception as e:
                logger.warning("Warmup receiver: send reply failed %s -> %s: %s", receiver_email, from_email_inbox, e)
                continue
            await self.db.warmup_sent.update_one(
                {"message_id": sent_doc["message_id"], "receiver_account_id": receiver_account_id},
                {"$set": {
                    "replied_at": now,
                    "receiver_message_uid": uid,
                    "reply_generation_source": generated.get("source"),
                    "reply_quality_score": generated.get("quality_score"),
                    "updated_at": now,
                }},
            )
            sent_doc_after = await self.db.warmup_sent.find_one(
                {"message_id": sent_doc["message_id"], "receiver_account_id": receiver_account_id}
            )
            if sent_doc_after and not sent_doc_after.get("receiver_marked_important_at"):
                rr_m = float(inbox.get("warmup_target_reply_rate") or DEFAULT_WARMUP_TARGET_REPLY_RATE)
                should_r, star_r = await self._warmup_should_mark_receiver_important(
                    inbox,
                    sent_doc_after,
                    event="reply",
                    reply_rate=rr_m,
                    now_utc=now_utc,
                    extra_marked_today=extra_marked_today,
                )
                if should_r:
                    mark_ts_r = datetime.now(timezone.utc)
                    try:
                        if is_outlook_oauth:
                            await graph_mark_important(access_token, uid, add_flag=star_r)
                        elif is_gmail_oauth and gmail_service:
                            await asyncio.to_thread(
                                lambda gs=gmail_service, mid=uid, st=star_r: gmail_api_mark_important(
                                    gs, mid, add_starred=st
                                )
                            )
                        else:
                            ok_flag = await asyncio.to_thread(
                                _imap_mark_important_by_message_id_sync,
                                rec.get("imap_host"),
                                rec.get("imap_port", 993),
                                rec.get("imap_username"),
                                imap_password,
                                _normalize_message_id(sent_doc["message_id"]),
                            )
                            if not ok_flag:
                                raise RuntimeError("IMAP mark important failed")
                        extra_marked_today[inbox_id] = extra_marked_today.get(inbox_id, 0) + 1
                        await self.db.warmup_sent.update_one(
                            {"message_id": sent_doc["message_id"], "receiver_account_id": receiver_account_id},
                            {"$set": {
                                "receiver_marked_important_at": mark_ts_r,
                                "warmup_receiver_important_starred": star_r if (is_outlook_oauth or is_gmail_oauth) else False,
                                "updated_at": mark_ts_r,
                            }},
                        )
                        if mid in by_message_id:
                            by_message_id[mid]["receiver_marked_important_at"] = mark_ts_r
                            by_message_id[mid]["warmup_receiver_important_starred"] = star_r if (is_outlook_oauth or is_gmail_oauth) else False
                    except Exception as ie:
                        logger.warning("Warmup receiver: mark important after reply failed: %s", ie)
            next_action_floor = int(
                receiver_behavior.get(
                    "next_action_min",
                    reply_behavior.get("next_action_min", self._next_delay_minutes(int(thread.get("turn_count") or 1))),
                )
            )
            next_action_ceiling = int(
                receiver_behavior.get(
                    "next_action_max",
                    reply_behavior.get("next_action_max", max(240, self._next_delay_minutes(int(thread.get("turn_count") or 1)))),
                )
            )
            if next_action_ceiling < next_action_floor:
                next_action_ceiling = next_action_floor + 30
            next_action_at = now + timedelta(
                minutes=random.randint(next_action_floor, next_action_ceiling)
            )
            await self.db.warmup_messages.insert_one({
                "id": str(uuid.uuid4()),
                "thread_id": thread["id"],
                "inbox_id": sent_doc["inbox_id"],
                "user_id": sent_doc["user_id"],
                "receiver_account_id": receiver_account_id,
                "role": "receiver",
                "message_id": uid,
                "in_reply_to": in_reply_to,
                "references": references,
                "subject": subject_reply,
                "body": body,
                "from_email": receiver_email,
                "to_email": from_email_inbox,
                "provider": provider,
                "provider_thread_ref": uid,
                "llm_meta": {
                    "source": generated.get("source"),
                    "model": generated.get("model"),
                    "quality_score": generated.get("quality_score"),
                },
                "sent_at": now,
                "created_at": now,
                "updated_at": now,
            })
            await self.db.warmup_threads.update_one(
                {"id": thread["id"]},
                {"$set": {
                    "stage": "cooldown",
                    "turn_count": int(thread.get("turn_count") or 1) + 1,
                    "last_sender_role": "receiver",
                    "last_subject": subject_reply,
                    "last_activity_at": now,
                    "next_action_at": next_action_at,
                    "updated_at": now,
                }},
            )
            reply_count += 1

        await self.admin_db.warmup_receiver_accounts.update_one(
            {"id": receiver_account_id},
            {"$set": {"last_used_at": now, "updated_at": now}},
        )
        return (num_moved_spam, len(marked_read_ids), reply_count)
