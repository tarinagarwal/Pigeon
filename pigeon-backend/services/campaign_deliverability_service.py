import asyncio
import email
import imaplib
import logging
import random
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from services.gmail_oauth_receiver import (
    build_gmail_service,
    get_access_token_async as get_gmail_access_token_async,
    gmail_api_classify_probe,
    gmail_api_list_inbox,
    gmail_api_list_spam,
)
from services.email_service import EmailService
from services.outlook_oauth_service import (
    get_access_token_async as get_outlook_access_token_async,
    graph_list_inbox_messages,
    graph_list_junk_messages,
)

logger = logging.getLogger(__name__)

SPAM_FOLDER_NAMES = [
    "[Gmail]/Spam",
    "Junk E-mail",
    "Junk",
    "Spam",
    "Bulk Mail",
]


def _normalize_message_id(msg_id: str) -> str:
    value = (msg_id or "").strip()
    if value.startswith("<") and value.endswith(">"):
        value = value[1:-1]
    return value


def _probe_send_body_type(template: Optional[Dict[str, Any]]) -> str:
    """Match campaign templates: html, rich (WYSIWYG HTML), or plain — same as warmup / test sends."""
    if not template:
        return "plain"
    bt = template.get("body_type")
    body = str(template.get("body") or "")
    # Some legacy/plain templates still contain HTML fragments like <br>.
    # Prefer HTML send mode in that case so tags render instead of appearing literally.
    has_html_markup = bool(
        re.search(r"</?[a-zA-Z][^>]*>", body)
    )
    if bt == "html" or bt == "rich":
        return "html"
    if bt == "plain":
        return "html" if has_html_markup else "plain"
    return "html" if has_html_markup else "plain"


def _campaign_template_ids(campaign: Dict[str, Any]) -> List[str]:
    """Template IDs from email_sequence or legacy template_ids."""
    template_ids: List[str] = []
    raw_sequence = campaign.get("email_sequence") or []
    for step in raw_sequence:
        tid = step.get("template_id") if isinstance(step, dict) else None
        if isinstance(tid, str) and tid:
            template_ids.append(tid)
    if not template_ids:
        template_ids = [tid for tid in (campaign.get("template_ids") or []) if isinstance(tid, str) and tid]
    # Preserve order, unique
    seen = set()
    out: List[str] = []
    for tid in template_ids:
        if tid not in seen:
            seen.add(tid)
            out.append(tid)
    return out


def _as_utc_dt(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, str) and value.strip():
        raw = value.strip()
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(raw)
            if dt.tzinfo is None:
                return dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            return None
    return None


class CampaignDeliverabilityService:
    """
    On-demand campaign deliverability probes (manual runs from admin or user API).

    Classifies whether a probe mail lands in inbox or spam on warmup receiver accounts.
    There is no background scheduler; checks run only when triggered via run_manual_for_campaign.
    """

    def __init__(
        self,
        db: Any,
        admin_db: Any,
        smtp_service: Any,
        gmail_service: Any,
        email_service: Any = None,
    ) -> None:
        self.db = db
        self.admin_db = admin_db
        self.smtp_service = smtp_service
        self.gmail_service = gmail_service
        self.email_service = email_service

    async def run_manual_for_campaign(self, campaign_id: str) -> Dict[str, Any]:
        campaign = await self.db.campaigns.find_one(
            {"id": campaign_id},
            {"_id": 0, "id": 1, "user_id": 1, "sender_type": 1, "sender_ids": 1, "template_ids": 1, "email_sequence": 1, "contact_ids": 1, "contact_list_ids": 1},
        )
        if not campaign:
            raise ValueError("Campaign not found")

        if self.email_service is None:
            raise ValueError(
                "Placement tests use campaign templates only; email rendering is unavailable. Check server configuration."
            )
        eligible_templates = await self._list_eligible_campaign_templates(campaign)
        if not eligible_templates:
            raise ValueError(
                "Placement tests use campaign templates only. Link at least one template with a non-empty subject "
                "and body to this campaign, then try again."
            )

        receivers = await self.admin_db.warmup_receiver_accounts.find(
            {"is_active": True},
            {"_id": 0},
        ).to_list(None)
        if not receivers:
            raise ValueError("No active warmup receiver accounts")

        units = await self._resolve_campaign_units(campaign)
        if not units:
            raise ValueError("No eligible sender inboxes with domain/subdomain found for this campaign")

        now = datetime.now(timezone.utc)
        # Manual/UI runs: poll more often and cap wait so the request returns in a reasonable time.
        # Probes for different (unit, receiver) pairs run in parallel so Gmail + Outlook + multiple
        # domains finish much faster than a sequential loop (which could exceed several minutes).
        # Wall-clock time is roughly one probe’s duration (parallel), not the sum of all probes.
        # Gmail delivery + indexing can exceed 60s; allow headroom so classification is not "unknown".
        manual_timeout = 120
        manual_poll = 4.0

        async def _one_manual_check(unit: Dict[str, Any], receiver: Dict[str, Any]) -> Dict[str, Any]:
            classification = await self._run_unit_check(
                campaign,
                unit,
                receiver,
                now,
                classify_timeout_seconds=manual_timeout,
                classify_poll_seconds=manual_poll,
            )
            return {
                "domain_id": unit.get("domain_id"),
                "subdomain_id": unit.get("subdomain_id"),
                "root_label": unit.get("root_label"),
                "classification": classification,
                "receiver_provider": receiver.get("provider"),
            }

        tasks: List[Any] = []
        for unit in units:
            selected_receivers = self._pick_receivers_for_provider_coverage(receivers)
            for receiver in selected_receivers:
                tasks.append(_one_manual_check(unit, receiver))

        row_results: List[Dict[str, Any]] = await asyncio.gather(*tasks)
        summary = {"checked": 0, "spam": 0, "inbox": 0, "unknown": 0, "error": 0}
        for row in row_results:
            summary["checked"] += 1
            c = row.get("classification") or "error"
            summary[c] = summary.get(c, 0) + 1
        return {"campaign_id": campaign_id, "summary": summary, "results": row_results}

    def _pick_receivers_for_provider_coverage(self, receivers: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        gmail_receivers = [r for r in receivers if (r.get("provider") or "").lower() == "gmail"]
        outlook_receivers = [r for r in receivers if (r.get("provider") or "").lower() == "outlook"]
        selected: List[Dict[str, Any]] = []
        if gmail_receivers:
            selected.append(random.choice(gmail_receivers))
        if outlook_receivers:
            selected.append(random.choice(outlook_receivers))
        if not selected and receivers:
            selected.append(random.choice(receivers))
        return selected

    async def _resolve_campaign_units(self, campaign: Dict[str, Any]) -> List[Dict[str, Any]]:
        campaign_id = campaign.get("id")
        user_id = campaign.get("user_id")
        if not campaign_id or not user_id:
            return []

        sender_type = campaign.get("sender_type", "gmail")
        sender_ids = list(campaign.get("sender_ids") or [])
        if not sender_ids:
            query = {"user_id": user_id, "sender_type": sender_type}
            if sender_type == "smtp":
                query["status"] = "ready"
            sender_ids = [
                row.get("id")
                for row in await self.db.inboxes.find(query, {"_id": 0, "id": 1}).to_list(None)
                if row.get("id")
            ]
        if not sender_ids:
            return []

        inboxes = await self.db.inboxes.find(
            {"id": {"$in": sender_ids}, "user_id": user_id, "sender_type": sender_type},
            {"_id": 0, "id": 1, "email": 1, "sender_type": 1, "gmail_auth_method": 1, "domain_id": 1, "subdomain_id": 1},
        ).to_list(None)
        if sender_type == "smtp":
            ready_ids = {
                row.get("id")
                for row in await self.db.inboxes.find(
                    {"id": {"$in": sender_ids}, "user_id": user_id, "sender_type": "smtp", "status": "ready"},
                    {"_id": 0, "id": 1},
                ).to_list(None)
            }
            inboxes = [i for i in inboxes if i.get("id") in ready_ids]

        domain_ids = {i.get("domain_id") for i in inboxes if i.get("domain_id")}
        subdomain_ids = {i.get("subdomain_id") for i in inboxes if i.get("subdomain_id")}
        domains = await self.db.domains.find({"id": {"$in": list(domain_ids)}}, {"_id": 0, "id": 1, "domain": 1}).to_list(None) if domain_ids else []
        subdomains = await self.db.subdomains.find(
            {"id": {"$in": list(subdomain_ids)}},
            {"_id": 0, "id": 1, "full_domain": 1, "subdomain": 1},
        ).to_list(None) if subdomain_ids else []
        domains_by_id = {d["id"]: d for d in domains if d.get("id")}
        subdomains_by_id = {s["id"]: s for s in subdomains if s.get("id")}

        grouped: Dict[Tuple[Optional[str], Optional[str]], List[Dict[str, Any]]] = {}
        for inbox in inboxes:
            key = (inbox.get("domain_id"), inbox.get("subdomain_id"))
            if not key[0] and not key[1]:
                continue
            grouped.setdefault(key, []).append(inbox)

        units: List[Dict[str, Any]] = []
        for (domain_id, subdomain_id), unit_inboxes in grouped.items():
            root_label = self._unit_root_label(unit_inboxes[0], domains_by_id, subdomains_by_id)
            units.append(
                {
                    "campaign_id": campaign_id,
                    "user_id": user_id,
                    "domain_id": domain_id,
                    "subdomain_id": subdomain_id,
                    "root_label": root_label,
                    "inboxes": unit_inboxes,
                }
            )
        return units

    def _unit_root_label(
        self,
        inbox: Dict[str, Any],
        domains_by_id: Dict[str, Dict[str, Any]],
        subdomains_by_id: Dict[str, Dict[str, Any]],
    ) -> str:
        subdomain_id = inbox.get("subdomain_id")
        domain_id = inbox.get("domain_id")
        if subdomain_id and subdomains_by_id.get(subdomain_id):
            return (subdomains_by_id[subdomain_id].get("full_domain") or "").strip() or (
                subdomains_by_id[subdomain_id].get("subdomain") or ""
            ).strip()
        if domain_id and domains_by_id.get(domain_id):
            return (domains_by_id[domain_id].get("domain") or "").strip()
        email_value = (inbox.get("email") or "").strip()
        if "@" in email_value:
            return email_value.split("@", 1)[1].lower()
        return ""

    async def _run_unit_check(
        self,
        campaign: Dict[str, Any],
        unit: Dict[str, Any],
        receiver: Dict[str, Any],
        now: datetime,
        *,
        classify_timeout_seconds: int = 90,
        classify_poll_seconds: float = 12.0,
    ) -> str:
        sender_inbox = random.choice(unit["inboxes"])
        probe_id = str(uuid.uuid4())
        marker = probe_id.split("-")[0]
        outbound_message_id = f"<deliverability-{probe_id}@pigeon.local>"
        try:
            subject, body, body_type = await self._build_probe_content(campaign, sender_inbox, marker)
        except ValueError as exc:
            checked_at = datetime.now(timezone.utc)
            await self._persist_check(
                unit=unit,
                sender_inbox=sender_inbox,
                receiver=receiver,
                classification="error",
                checked_at=checked_at,
                sent_at=None,
                probe_message_id=outbound_message_id,
                marker=marker,
                error=str(exc),
            )
            await self._update_state(unit, checked_at, "error", unit.get("root_label") or "")
            return "error"

        receiver_email = (receiver.get("email") or "").strip()
        if not receiver_email:
            await self._persist_check(
                unit=unit,
                sender_inbox=sender_inbox,
                receiver=receiver,
                classification="error",
                checked_at=now,
                sent_at=None,
                probe_message_id=outbound_message_id,
                marker=marker,
                error="receiver_email_missing",
            )
            await self._update_state(unit, now, "error", unit.get("root_label") or "")
            return "error"

        sent_at = datetime.now(timezone.utc)
        send_error: Optional[str] = None
        try:
            await self._send_probe(
                sender_inbox, campaign, receiver_email, subject, body, outbound_message_id, body_type=body_type
            )
        except Exception as exc:
            send_error = str(exc)

        classification = (
            "error"
            if send_error
            else await self._classify_probe(
                receiver,
                outbound_message_id,
                marker,
                timeout_seconds=classify_timeout_seconds,
                poll_interval_seconds=classify_poll_seconds,
            )
        )
        checked_at = datetime.now(timezone.utc)
        await self._persist_check(
            unit=unit,
            sender_inbox=sender_inbox,
            receiver=receiver,
            classification=classification,
            checked_at=checked_at,
            sent_at=sent_at if not send_error else None,
            probe_message_id=outbound_message_id,
            marker=marker,
            error=send_error,
        )
        await self._update_state(unit, checked_at, classification, unit.get("root_label") or "")
        return classification if classification in {"spam", "inbox", "unknown"} else "error"

    async def _inject_unsubscribe_url_for_probe(self, user_id: str, subject: str, body: str) -> Tuple[str, str]:
        """Resolve {{unsubscribe_url}} like template test sends (real tracking base + one-off token)."""
        if not self.email_service or not user_id:
            return subject, body
        combined = f"{subject or ''} {body or ''}"
        if not re.search(r"\{\{?\s*unsubscribe_url\s*\}?\}", combined, re.IGNORECASE):
            return subject, body
        tracking_base = await self.email_service._get_tracking_base(user_id=user_id, domain_id=None)
        test_log_id = str(uuid.uuid4())
        unsub_url = f"{tracking_base}/api/unsubscribe/{test_log_id}"
        return (
            EmailService._inject_unsubscribe_url_placeholder(subject or "", unsub_url),
            EmailService._inject_unsubscribe_url_placeholder(body or "", unsub_url),
        )

    async def _build_probe_content(
        self,
        campaign: Dict[str, Any],
        sender_inbox: Dict[str, Any],
        marker: str,
    ) -> Tuple[str, str, str]:
        """Build subject/body from a random eligible campaign template only (no synthetic probe copy).

        Resolution order matches campaign sends: spintax first, then merge fields (including custom
        fields and inbox/sender aliases), then hard inbox token pass, then {{unsubscribe_url}} if
        present. MIME type follows template ``body_type`` (plain / html / rich→html).

        HTML may include an invisible `<!--pigeon-probe:...-->` comment; inbox/spam matching still
        uses Message-ID first.
        """
        if self.email_service is None:
            raise ValueError(
                "Placement tests use campaign templates only; email rendering is unavailable."
            )

        template = await self._pick_random_campaign_template(campaign)
        if not template:
            raise ValueError(
                "Placement tests use campaign templates only. No template with both subject and body is linked to this campaign."
            )

        random_contact = await self._pick_random_campaign_contact(campaign)
        placeholder_context = self._probe_placeholder_context(sender_inbox, random_contact)

        raw_subject = template.get("subject") or ""
        raw_body = template.get("body") or ""
        # Same order as EmailService.send_email: spintax before placeholders (variables may live inside spins).
        parsed_subject = self.email_service.parse_spintax(raw_subject)
        parsed_body = self.email_service.parse_spintax(raw_body)
        rendered_subject = self.email_service.replace_placeholders(parsed_subject, placeholder_context).strip()
        rendered_body = self.email_service.replace_placeholders(parsed_body, placeholder_context).strip()

        # Match send_email: ensure {{inbox_name}} / {{inbox_email}} resolve even if formatting missed regex path
        inbox_email = (sender_inbox.get("email") or "").strip()
        inbox_name = EmailService.get_effective_inbox_name(inbox=sender_inbox, inbox_email=inbox_email)
        if inbox_email:
            for token in ("{{inbox_email}}", "{inbox_email}"):
                rendered_subject = rendered_subject.replace(token, inbox_email)
                rendered_body = rendered_body.replace(token, inbox_email)
        if inbox_name:
            for token in ("{{inbox_name}}", "{inbox_name}"):
                rendered_subject = rendered_subject.replace(token, inbox_name)
                rendered_body = rendered_body.replace(token, inbox_name)

        user_id = campaign.get("user_id")
        rendered_subject, rendered_body = await self._inject_unsubscribe_url_for_probe(
            str(user_id) if user_id else "", rendered_subject, rendered_body
        )

        if not rendered_subject:
            raise ValueError(
                "Placement test: template subject is empty after spintax and placeholders. Update the template."
            )
        if not rendered_body:
            raise ValueError(
                "Placement test: template body is empty after spintax and placeholders. Update the template."
            )

        send_body_type = _probe_send_body_type(template)

        # Unique token in subject so receivers can match even if Message-ID is rewritten in transit.
        probe_suffix = f" [EMA:{marker}]"
        max_subj = 220
        if len(rendered_subject) + len(probe_suffix) > max_subj:
            rendered_subject = rendered_subject[: max_subj - len(probe_suffix)].rstrip() + probe_suffix
        else:
            rendered_subject = rendered_subject + probe_suffix

        if send_body_type == "html" and marker and "<!--pigeon-probe:" not in rendered_body:
            rendered_body = rendered_body.rstrip() + f"\n<!--pigeon-probe:{marker}-->"

        return rendered_subject[:max_subj], rendered_body[:8000], send_body_type

    async def _list_eligible_campaign_templates(self, campaign: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Templates linked to the campaign with non-empty subject and body in the database."""
        template_ids = _campaign_template_ids(campaign)
        if not template_ids:
            return []
        template_docs = await self.db.templates.find(
            {"id": {"$in": template_ids}, "user_id": campaign.get("user_id")},
            {"_id": 0, "id": 1, "subject": 1, "body": 1, "body_type": 1},
        ).to_list(None)
        return [
            t
            for t in template_docs
            if str(t.get("subject") or "").strip() and str(t.get("body") or "").strip()
        ]

    async def _pick_random_campaign_template(self, campaign: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        eligible = await self._list_eligible_campaign_templates(campaign)
        if not eligible:
            return None
        return random.choice(eligible)

    def _probe_placeholder_context(
        self, sender_inbox: Dict[str, Any], contact: Optional[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Use a real campaign contact when available; otherwise sample values so merge fields resolve."""
        if contact:
            return self._build_placeholder_context(sender_inbox, contact)
        sample = {
            "first_name": "Alex",
            "last_name": "Sample",
            "email": "alex.sample@example.com",
            "company": "Sample Co",
            "industry": "Technology",
            "custom_fields": {},
        }
        return self._build_placeholder_context(sender_inbox, sample)

    async def _pick_random_campaign_contact(self, campaign: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        contact_ids = set(campaign.get("contact_ids") or [])
        contact_list_ids = [cid for cid in (campaign.get("contact_list_ids") or []) if isinstance(cid, str) and cid]
        if contact_list_ids:
            contact_lists = await self.db.contact_lists.find(
                {"id": {"$in": contact_list_ids}, "user_id": campaign.get("user_id")},
                {"_id": 0, "contact_ids": 1},
            ).to_list(None)
            for cl in contact_lists:
                for cid in cl.get("contact_ids") or []:
                    if isinstance(cid, str) and cid:
                        contact_ids.add(cid)
        if not contact_ids:
            return None
        contacts = await self.db.contacts.find(
            {"id": {"$in": list(contact_ids)}, "user_id": campaign.get("user_id")},
            {"_id": 0, "id": 1, "email": 1, "first_name": 1, "last_name": 1, "company": 1, "industry": 1, "custom_fields": 1},
        ).to_list(None)
        if not contacts:
            return None
        return random.choice(contacts)

    def _build_placeholder_context(self, sender_inbox: Dict[str, Any], contact: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """Same merge-field inputs as campaign sends; inbox display name uses EmailService heuristics."""
        contact = contact or {}
        sender_email = (sender_inbox.get("email") or "").strip()
        sender_name = EmailService.get_effective_inbox_name(inbox=sender_inbox, inbox_email=sender_email)
        return {
            "first_name": contact.get("first_name", "") or "",
            "last_name": contact.get("last_name", "") or "",
            "email": contact.get("email", "") or "",
            "company": contact.get("company", "") or "",
            "industry": contact.get("industry", "") or "",
            "custom_fields": contact.get("custom_fields", {}) or {},
            "inbox_email": sender_email,
            "inbox_name": sender_name,
            "sender_email": sender_email,
            "sender_name": sender_name,
            "receiver_email": contact.get("email", "") or "",
            "receiver_name": (
                (contact.get("first_name", "") or "") + " " + (contact.get("last_name", "") or "")
            ).strip(),
        }

    async def _send_probe(
        self,
        sender_inbox: Dict[str, Any],
        campaign: Dict[str, Any],
        receiver_email: str,
        subject: str,
        body: str,
        outbound_message_id: str,
        *,
        body_type: str = "plain",
    ) -> None:
        user_id = (campaign.get("user_id") or "").strip()
        if self.email_service and user_id:
            await self.email_service.assert_smtp_monthly_quota_if_needed(user_id, sender_inbox)

        sender_type = sender_inbox.get("sender_type", "smtp")
        inbox_id = sender_inbox.get("id")
        if sender_type == "gmail":
            if sender_inbox.get("gmail_auth_method") == "app_password":
                await self.smtp_service.send_email_via_smtp_gmail_app_password(
                    inbox_id,
                    receiver_email,
                    subject,
                    body,
                    tracking_pixel_url=None,
                    reply_to_email=None,
                    outbound_message_id=outbound_message_id,
                    body_type=body_type,
                )
            else:
                await self.gmail_service.send_email(
                    inbox_id,
                    user_id,
                    receiver_email,
                    subject,
                    body,
                    tracking_pixel_url=None,
                    body_type=body_type,
                    outbound_message_id=outbound_message_id,
                )
        else:
            await self.smtp_service.send_email_via_smtp(
                inbox_id,
                receiver_email,
                subject,
                body,
                tracking_pixel_url=None,
                reply_to_email=None,
                outbound_message_id=outbound_message_id,
                body_type=body_type,
            )

        if self.email_service and user_id and inbox_id:
            try:
                await self.email_service.record_outbound_send_for_usage(
                    user_id=user_id,
                    sender_id=str(inbox_id),
                    send_source="deliverability_probe",
                    to_email=receiver_email,
                    subject=subject,
                    inbox=sender_inbox,
                    message_id=outbound_message_id,
                    campaign_id=campaign.get("id"),
                )
            except Exception as exc:
                logger.warning("Deliverability probe metering failed user=%s: %s", user_id, exc)

    async def _classify_probe(
        self,
        receiver: Dict[str, Any],
        probe_message_id: str,
        marker: str,
        timeout_seconds: int = 90,
        poll_interval_seconds: float = 12.0,
    ) -> str:
        probe_mid = _normalize_message_id(probe_message_id)
        marker_lower = marker.lower()
        deadline = datetime.now(timezone.utc) + timedelta(seconds=timeout_seconds)
        sleep_s = max(1.5, float(poll_interval_seconds))
        while datetime.now(timezone.utc) < deadline:
            try:
                status = await self._classify_probe_once(receiver, probe_mid, marker_lower)
                if status in {"spam", "inbox"}:
                    return status
            except Exception as exc:
                logger.debug("Deliverability classify retry: %s", exc)
            if datetime.now(timezone.utc) >= deadline:
                break
            await asyncio.sleep(sleep_s)
        return "unknown"

    async def _classify_probe_once(self, receiver: Dict[str, Any], probe_mid: str, marker_lower: str) -> str:
        provider = (receiver.get("provider") or "").strip().lower()
        auth_method = (receiver.get("auth_method") or "").strip().lower()
        has_outlook_oauth = provider == "outlook" and (auth_method == "oauth" or bool(receiver.get("outlook_refresh_token")))
        has_gmail_oauth = provider == "gmail" and (auth_method == "oauth" or bool(receiver.get("gmail_refresh_token")))

        if has_outlook_oauth:
            refresh_token = self.smtp_service._decrypt_password(receiver["outlook_refresh_token"])
            access_token = await get_outlook_access_token_async(refresh_token)
            junk = await graph_list_junk_messages(access_token, 80)
            if self._graph_has_probe(junk, probe_mid, marker_lower):
                return "spam"
            inbox = await graph_list_inbox_messages(access_token, 80)
            if self._graph_has_probe(inbox, probe_mid, marker_lower):
                return "inbox"
            return "unknown"

        if has_gmail_oauth:
            refresh_token = self.smtp_service._decrypt_password(receiver["gmail_refresh_token"])
            client_id = receiver.get("google_client_id") or ""
            secret_encrypted = receiver.get("google_client_secret_encrypted")
            client_secret = self.smtp_service._decrypt_password(secret_encrypted) if secret_encrypted else ""
            if not refresh_token or not client_id or not client_secret:
                return "unknown"
            access_token = await get_gmail_access_token_async(
                refresh_token,
                client_id,
                client_secret,
                scope="https://mail.google.com/",
            )
            gmail_service = build_gmail_service(access_token, refresh_token, client_id, client_secret)
            placed = await asyncio.to_thread(
                gmail_api_classify_probe,
                gmail_service,
                probe_mid,
                marker_lower,
            )
            if placed in {"spam", "inbox"}:
                return placed
            spam = await asyncio.to_thread(gmail_api_list_spam, gmail_service, 80)
            if self._gmail_has_probe(spam, probe_mid, marker_lower):
                return "spam"
            inbox = await asyncio.to_thread(gmail_api_list_inbox, gmail_service, 80)
            if self._gmail_has_probe(inbox, probe_mid, marker_lower):
                return "inbox"
            return "unknown"

        imap_password = self.smtp_service._decrypt_password(receiver["imap_password"]) if receiver.get("imap_password") else None
        host = receiver.get("imap_host")
        username = receiver.get("imap_username")
        if not imap_password or not host or not username:
            return "unknown"
        port = receiver.get("imap_port", 993)
        return await asyncio.to_thread(
            self._classify_probe_imap_sync,
            host,
            int(port or 993),
            username,
            imap_password,
            probe_mid,
            marker_lower,
        )

    def _graph_has_probe(self, messages: List[Dict[str, Any]], probe_mid: str, marker_lower: str) -> bool:
        for msg in messages or []:
            mid = _normalize_message_id(msg.get("internetMessageId") or "")
            subject = (msg.get("subject") or "").lower()
            if mid and mid == probe_mid:
                return True
            if marker_lower and marker_lower in subject:
                return True
        return False

    def _gmail_has_probe(self, messages: List[Dict[str, Any]], probe_mid: str, marker_lower: str) -> bool:
        for msg in messages or []:
            mid = _normalize_message_id(msg.get("message_id") or "")
            subject = (msg.get("subject") or "").lower()
            if mid and mid == probe_mid:
                return True
            if marker_lower and marker_lower in subject:
                return True
        return False

    def _classify_probe_imap_sync(
        self,
        host: str,
        port: int,
        username: str,
        password: str,
        probe_mid: str,
        marker_lower: str,
    ) -> str:
        conn = None
        try:
            conn = imaplib.IMAP4_SSL(host, port=port) if port == 993 else imaplib.IMAP4(host, port=port)
            conn.login(username, password)
            spam_folders = self._imap_spam_folders(conn)
            for folder in spam_folders:
                if self._imap_folder_has_probe(conn, folder, probe_mid, marker_lower):
                    return "spam"
            if self._imap_folder_has_probe(conn, "INBOX", probe_mid, marker_lower):
                return "inbox"
            return "unknown"
        except Exception:
            return "unknown"
        finally:
            try:
                if conn is not None:
                    conn.logout()
            except Exception:
                pass

    def _imap_spam_folders(self, conn: imaplib.IMAP4) -> List[str]:
        folders: List[str] = []
        typ, listed = conn.list()
        if typ != "OK" or not listed:
            return folders
        for row in listed:
            line = row.decode("utf-8", errors="replace") if isinstance(row, bytes) else str(row)
            for candidate in SPAM_FOLDER_NAMES:
                if candidate in line:
                    parts = line.split('"')
                    folder = parts[-2] if len(parts) >= 3 else candidate
                    if folder not in folders:
                        folders.append(folder)
        return folders

    def _imap_folder_has_probe(
        self,
        conn: imaplib.IMAP4,
        folder: str,
        probe_mid: str,
        marker_lower: str,
        max_messages: int = 80,
    ) -> bool:
        try:
            select_name = f'"{folder}"' if (" " in folder or "/" in folder) else folder
            typ, _ = conn.select(select_name, readonly=True)
            if typ != "OK":
                return False
            typ, data = conn.search(None, "ALL")
            if typ != "OK" or not data or not data[0]:
                return False
            for uid in data[0].split()[-max_messages:]:
                typ_h, raw = conn.fetch(uid, "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID SUBJECT)])")
                if typ_h != "OK" or not raw:
                    continue
                first = raw[0]
                if not isinstance(first, tuple):
                    continue
                headers = first[1].decode("utf-8", errors="replace") if isinstance(first[1], bytes) else str(first[1])
                msg = email.message_from_string(headers)
                mid = _normalize_message_id(msg.get("Message-ID", ""))
                subject = (msg.get("Subject", "") or "").lower()
                if mid and mid == probe_mid:
                    return True
                if marker_lower and marker_lower in subject:
                    return True
            return False
        except Exception:
            return False

    async def _persist_check(
        self,
        unit: Dict[str, Any],
        sender_inbox: Dict[str, Any],
        receiver: Dict[str, Any],
        classification: str,
        checked_at: datetime,
        sent_at: Optional[datetime],
        probe_message_id: str,
        marker: str,
        error: Optional[str],
    ) -> None:
        now = datetime.now(timezone.utc)
        doc = {
            "id": str(uuid.uuid4()),
            "campaign_id": unit["campaign_id"],
            "user_id": unit.get("user_id"),
            "sender_inbox_id": sender_inbox.get("id"),
            "sender_email": sender_inbox.get("email"),
            "domain_id": unit.get("domain_id"),
            "subdomain_id": unit.get("subdomain_id"),
            "root_label": unit.get("root_label") or "",
            "receiver_account_id": receiver.get("id"),
            "receiver_email": receiver.get("email"),
            "receiver_provider": receiver.get("provider"),
            "probe_message_id": probe_message_id,
            "probe_marker": marker,
            "classification": classification,
            "sent_at": sent_at,
            "checked_at": checked_at,
            "error": error,
            "created_at": now,
            "updated_at": now,
        }
        await self.db.campaign_deliverability_checks.insert_one(doc)

    async def _update_state(
        self,
        unit: Dict[str, Any],
        checked_at: datetime,
        classification: str,
        root_label: str,
    ) -> None:
        min_wait_minutes = 120
        max_wait_minutes = 24 * 60
        next_check_at = checked_at + timedelta(minutes=random.randint(min_wait_minutes, max_wait_minutes))
        update = {
            "campaign_id": unit["campaign_id"],
            "domain_id": unit.get("domain_id"),
            "subdomain_id": unit.get("subdomain_id"),
            "user_id": unit.get("user_id"),
            "root_label": root_label or "",
            "last_checked_at": checked_at,
            "last_classification": classification,
            "next_check_at": next_check_at,
            "updated_at": datetime.now(timezone.utc),
        }
        if classification == "spam":
            update["last_spam_at"] = checked_at
        await self.db.campaign_deliverability_state.update_one(
            {
                "campaign_id": unit["campaign_id"],
                "domain_id": unit.get("domain_id"),
                "subdomain_id": unit.get("subdomain_id"),
            },
            {"$set": update, "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
