"""Domain management routes"""
from fastapi import APIRouter, HTTPException, Depends, Request
from datetime import datetime, timezone
import asyncio
import hashlib
import os
import logging
import secrets
import re
import json
import uuid
from copy import deepcopy
from typing import Any, Dict, List, Optional
from cryptography.fernet import Fernet
from pymongo.errors import DuplicateKeyError
from starlette.responses import StreamingResponse

from database import db
from models import Domain
from routes.dependencies import get_current_user, verify_domain_ownership
from services.domain_service import DomainService
from services.email_infra_service import EmailInfraServiceError
from services.dns_provider_service import DNSProviderService, DNSProviderServiceError
from services.sendgrid_service import normalize_sendgrid_dkim_txt_value

router = APIRouter()

# Initialize service (will be injected from server.py)
domain_service: DomainService = None
plan_service = None
lifecycle_automation_service = None
dns_provider_service = DNSProviderService()

SUPPORTED_DNS_PROVIDERS = ("cloudflare", "godaddy", "namecheap", "clouddns")
BULK_DOMAIN_JOB_MAX_RETRIES = 10
BULK_DOMAIN_JOB_COLLECTION = "domain_bulk_jobs"
BULK_DOMAIN_RATE_LIMIT_WAIT_SECONDS = 45


def _normalize_domain_sending_provider(domain_doc: dict) -> dict:
    """
    Backfill legacy domains that were created before the domain-level sending provider
    was introduced.
    """
    if not domain_doc.get("sending_provider"):
        domain_doc["sending_provider"] = "sendgrid"
    if "tracking_domain_verified" not in domain_doc:
        domain_doc["tracking_domain_verified"] = False
    return domain_doc


def _normalize_tracking_domain(host: str) -> str:
    value = (host or "").strip().lower().rstrip(".")
    if value.startswith("http://") or value.startswith("https://"):
        raise HTTPException(status_code=400, detail="Use hostname only (no http/https).")
    if "/" in value:
        raise HTTPException(status_code=400, detail="Use hostname only (no path).")
    if not re.match(r"^[a-z0-9.-]+$", value):
        raise HTTPException(status_code=400, detail="Invalid tracking domain format.")
    return value


def _normalize_domain_key(value: str) -> str:
    normalized = (value or "").strip().lower().rstrip(".")
    if not normalized:
        raise HTTPException(status_code=400, detail="Domain is required.")
    if not re.match(r"^[a-z0-9.-]+$", normalized):
        raise HTTPException(status_code=400, detail="Invalid domain format.")
    if "." not in normalized:
        raise HTTPException(status_code=400, detail="Enter a valid domain (e.g. example.com).")
    return normalized


def _expected_tracking_cname_target() -> str:
    expected = (os.getenv("TRACKING_CNAME_TARGET") or "").strip().lower().rstrip(".")
    return expected


async def _resolve_registered_parent_domain_id(user_id: str, domain_name: str) -> Optional[str]:
    """
    If this hostname is a child of another domain row in the same account (e.g. mail.example.com
    when example.com exists), return the parent domain document id. Mirrors frontend domain tree.
    """
    name = (domain_name or "").strip().lower().rstrip(".")
    parts = name.split(".")
    if len(parts) < 3:
        return None
    for i in range(1, len(parts) - 1):
        candidate = ".".join(parts[i:])
        parent = await db.domains.find_one({"user_id": user_id, "domain": candidate}, {"id": 1})
        if parent:
            return parent.get("id")
    return None


async def _get_user_for_plan_limits(current_user: dict) -> dict:
    """
    Ensure plan checks include per-user extra_* allowances from the users collection.
    Auth payloads can be slim and miss those fields.
    """
    user_id = current_user.get("id")
    if not user_id:
        return current_user
    full_user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not full_user:
        return current_user
    return full_user


def _normalize_subdomain_label(value: str) -> str:
    label = (value or "").strip().lower().rstrip(".")
    if not label:
        raise HTTPException(status_code=400, detail="Subdomain label cannot be empty.")
    if "." in label:
        raise HTTPException(status_code=400, detail="Subdomain label must not contain dots.")
    if not re.match(r"^[a-z0-9-]+$", label):
        raise HTTPException(status_code=400, detail="Subdomain label can only include a-z, 0-9 and '-'.")
    if label.startswith("-") or label.endswith("-"):
        raise HTTPException(status_code=400, detail="Subdomain label cannot start or end with '-'.")
    return label


def _has_provider_dns_payload(domain_doc: Optional[dict]) -> bool:
    if not domain_doc:
        return False
    provider_sync = domain_doc.get("provider_sync") or {}
    dns_records = domain_doc.get("dns_records") or {}
    return bool(
        provider_sync.get("domain_id")
        and isinstance(dns_records.get("spf"), dict)
        and isinstance(dns_records.get("dkim"), dict)
        and isinstance(dns_records.get("dmarc"), dict)
        and dns_records.get("spf", {}).get("value")
        and dns_records.get("dkim", {}).get("value") is not None
        and dns_records.get("dmarc", {}).get("value")
    )


def _is_sendgrid_rate_limit_error(exc: Exception) -> bool:
    text = str(getattr(exc, "detail", exc) or "").lower()
    return (
        "rate limit" in text
        or "429" in text
        or "x-ratelimit" in text
        or "too many requests" in text
    )


def _is_plan_limit_error(exc: Exception) -> bool:
    text = str(getattr(exc, "detail", exc) or "").lower()
    return "plan limit reached" in text or "maximum" in text


async def _cleanup_partial_domain_for_bulk(user_id: str, domain_id: Optional[str], domain_name: str) -> None:
    """
    Best-effort rollback for a partially created bulk domain.
    Removes SendGrid auth/inbound-parse and local DB rows.
    """
    if domain_id:
        existing = await db.domains.find_one({"id": domain_id, "user_id": user_id}, {"_id": 0})
    else:
        existing = await db.domains.find_one({"user_id": user_id, "domain": domain_name}, {"_id": 0})

    target_domain_id = domain_id or ((existing or {}).get("id"))
    target_domain_name = (domain_name or (existing or {}).get("domain") or "").strip().lower().rstrip(".")
    provider_sync = (existing or {}).get("provider_sync") or {}
    sendgrid_domain_id = provider_sync.get("domain_id")
    matched_domain = (provider_sync.get("matched_domain") or "").strip().lower().rstrip(".")

    if target_domain_name:
        try:
            if sendgrid_domain_id:
                result = await domain_service.sendgrid_service.delete_domain_authentication_by_id(sendgrid_domain_id)
                if not result.get("success"):
                    await domain_service.sendgrid_service.delete_domain_authentication(matched_domain or target_domain_name)
            else:
                await domain_service.sendgrid_service.delete_domain_authentication(matched_domain or target_domain_name)
        except Exception:
            logging.exception("[BULK-DOMAIN] Rollback failed deleting SendGrid auth for %s", target_domain_name)

        try:
            await domain_service.sendgrid_service.delete_inbound_parse_setting(target_domain_name)
        except Exception:
            logging.exception("[BULK-DOMAIN] Rollback failed deleting inbound parse for %s", target_domain_name)

    if target_domain_id:
        await db.inbound_messages.delete_many({"domain_id": target_domain_id})
        await db.subdomains.delete_many({"domain_id": target_domain_id})
        await db.domains.delete_one({"id": target_domain_id, "user_id": user_id})


async def _process_bulk_domain_create_job(job_id: str) -> None:
    job = await db[BULK_DOMAIN_JOB_COLLECTION].find_one({"id": job_id}, {"_id": 0})
    if not job:
        return

    user_id = job.get("user_id")
    requested_domains = job.get("domains") or []
    started_at = datetime.now(timezone.utc)
    await db[BULK_DOMAIN_JOB_COLLECTION].update_one(
        {"id": job_id},
        {"$set": {"status": "running", "started_at": started_at, "updated_at": started_at}},
    )

    processed = 0
    created = 0
    failed = 0
    skipped = 0
    results: List[Dict[str, Any]] = []
    total = len(requested_domains)

    mode = str(job.get("mode") or "domains")
    current_user = {
        "id": user_id,
        # Internal bulk subdomain registration creates full domain rows,
        # but should not consume "max_domains" plan quota.
        "_skip_domain_plan_limit": mode == "subdomains",
    }
    stop_due_to_plan_limit = False

    for domain_name in requested_domains:
        if stop_due_to_plan_limit:
            break
        processed += 1
        last_error = ""
        success_record = None
        if await db.domains.find_one({"user_id": user_id, "domain": domain_name}, {"id": 1}):
            skipped += 1
            results.append(
                {
                    "domain": domain_name,
                    "status": "skipped",
                    "attempts": 0,
                    "reason": "already_exists",
                }
            )
            await db[BULK_DOMAIN_JOB_COLLECTION].update_one(
                {"id": job_id},
                {"$set": {"processed_count": processed, "created_count": created, "failed_count": failed, "skipped_count": skipped, "updated_at": datetime.now(timezone.utc)}},
            )
            continue

        for attempt in range(1, BULK_DOMAIN_JOB_MAX_RETRIES + 1):
            created_domain_id: Optional[str] = None
            try:
                created_domain = await create_domain(
                    Domain(user_id=user_id, domain=domain_name),
                    current_user=current_user,
                )
                created_domain_id = created_domain.get("id")

                if not created_domain_id:
                    raise Exception("Domain creation returned no id")

                try:
                    await sync_domain_to_provider(created_domain_id, current_user=current_user)
                except Exception as sync_exc:
                    if _is_sendgrid_rate_limit_error(sync_exc):
                        logging.warning(
                            "[BULK-DOMAIN] SendGrid rate-limited during sync for %s (attempt %s/%s). Waiting %ss and retrying.",
                            domain_name,
                            attempt,
                            BULK_DOMAIN_JOB_MAX_RETRIES,
                            BULK_DOMAIN_RATE_LIMIT_WAIT_SECONDS,
                        )
                        await _cleanup_partial_domain_for_bulk(user_id, created_domain_id, domain_name)
                        await asyncio.sleep(BULK_DOMAIN_RATE_LIMIT_WAIT_SECONDS)
                        continue
                    raise

                refreshed = await db.domains.find_one(
                    {"id": created_domain_id, "user_id": user_id},
                    {"_id": 0},
                )
                if not _has_provider_dns_payload(refreshed):
                    raise Exception("Provider DNS payload missing after sync")

                success_record = {
                    "domain": domain_name,
                    "status": "created",
                    "attempts": attempt,
                    "domain_id": created_domain_id,
                }
                created += 1
                break
            except Exception as exc:
                last_error = str(exc)
                if _is_plan_limit_error(exc):
                    # Non-retriable in this job run; avoid hammering same failure.
                    stop_due_to_plan_limit = True
                    break
                await _cleanup_partial_domain_for_bulk(user_id, created_domain_id, domain_name)
                if attempt < BULK_DOMAIN_JOB_MAX_RETRIES:
                    await asyncio.sleep(1.5)

        if success_record:
            results.append(success_record)
        else:
            failed += 1
            results.append(
                {
                    "domain": domain_name,
                    "status": "failed",
                    "attempts": BULK_DOMAIN_JOB_MAX_RETRIES,
                    "error": last_error or "Unknown error",
                }
            )

        pending = max(0, total - (created + failed + skipped))
        await db[BULK_DOMAIN_JOB_COLLECTION].update_one(
            {"id": job_id},
            {
                "$set": {
                    "processed_count": processed,
                    "created_count": created,
                    "failed_count": failed,
                    "skipped_count": skipped,
                    "pending_count": pending,
                    "results": results,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )

    if stop_due_to_plan_limit and processed < total:
        remaining = requested_domains[processed:]
        skipped += len(remaining)
        for domain_name in remaining:
            results.append(
                {
                    "domain": domain_name,
                    "status": "skipped",
                    "attempts": 0,
                    "reason": "stopped_due_to_plan_limit",
                }
            )
        await db[BULK_DOMAIN_JOB_COLLECTION].update_one(
            {"id": job_id},
            {
                "$set": {
                    "processed_count": processed,
                    "created_count": created,
                    "failed_count": failed,
                    "skipped_count": skipped,
                    "pending_count": 0,
                    "results": results,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )

    completed_at = datetime.now(timezone.utc)
    final_status = "completed"
    if stop_due_to_plan_limit:
        final_status = "failed"
    elif failed > 0 and created == 0:
        final_status = "failed"
    elif failed > 0:
        final_status = "completed_with_errors"

    await db[BULK_DOMAIN_JOB_COLLECTION].update_one(
        {"id": job_id},
        {
            "$set": {
                "status": final_status,
                "completed_at": completed_at,
                "processed_count": processed,
                "created_count": created,
                "failed_count": failed,
                "skipped_count": skipped,
                "pending_count": 0,
                "results": results,
                "updated_at": completed_at,
            }
        },
    )


def _bulk_job_sse_pack(event: str, payload: Dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, default=str)}\n\n"


async def _require_root_domain(user_id: str, domain_doc: dict, detail: str) -> None:
    """Receiving, link tracking, etc. are configured on the account root domain, not registered subdomains."""
    if await _resolve_registered_parent_domain_id(user_id, domain_doc.get("domain", "")):
        raise HTTPException(status_code=400, detail=detail)

def init_domain_service(service: DomainService):
    """Initialize domain service"""
    global domain_service
    domain_service = service


def init_lifecycle_automation_service(service):
    """Inject lifecycle automation service."""
    global lifecycle_automation_service
    lifecycle_automation_service = service


def init_plan_service(service):
    global plan_service
    plan_service = service


def _derive_email_infra_mailbox_password(user_id: str, domain_id: str, email: str) -> str:
    """
    Derive deterministic mailbox password when seed exists; else generate random.
    Mirrors logic in `pigeon-backend/routes/inboxes.py`.
    """
    seed = (os.getenv("EMAIL_INFRA_MAILBOX_PASSWORD_SEED") or os.getenv("ENCRYPTION_KEY") or "").strip()
    if not seed:
        return secrets.token_urlsafe(24)
    raw = f"{seed}:{user_id}:{domain_id}:{email.lower()}"
    digest = hashlib.sha256(raw.encode()).hexdigest()
    return f"EiMbx!{digest[:24]}"


async def _is_email_infra_enabled_for_user(user_id: str) -> bool:
    """Per-user toggle, stored in user_settings.email_infra.enabled."""
    settings = await db.user_settings.find_one(
        {"user_id": user_id},
        {"_id": 0, "email_infra": 1},
    )
    return bool(settings and settings.get("email_infra", {}).get("enabled") is True)


def _dns_secret_box() -> Fernet:
    key = os.getenv("ENCRYPTION_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="ENCRYPTION_KEY is not configured.")
    raw = key.encode() if isinstance(key, str) else key
    return Fernet(raw)


def _encrypt_dns_secret(value: str) -> str:
    return _dns_secret_box().encrypt(value.encode()).decode()


def _decrypt_dns_secret(value: str) -> str:
    return _dns_secret_box().decrypt(value.encode()).decode()


def _mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}{'*' * (len(value) - 8)}{value[-4:]}"


def _validate_dns_provider_credentials(provider: str, payload: dict) -> Dict[str, str]:
    p = (provider or "").strip().lower()
    if p == "cloudflare":
        token = (payload.get("api_token") or "").strip()
        if not token:
            raise HTTPException(status_code=400, detail="api_token is required for cloudflare.")
        return {"api_token": token}
    if p == "godaddy":
        api_key = (payload.get("api_key") or "").strip()
        api_secret = (payload.get("api_secret") or "").strip()
        if not api_key or not api_secret:
            raise HTTPException(status_code=400, detail="api_key and api_secret are required for godaddy.")
        return {"api_key": api_key, "api_secret": api_secret}
    if p == "namecheap":
        api_user = (payload.get("api_user") or "").strip()
        api_key = (payload.get("api_key") or "").strip()
        username = (payload.get("username") or api_user).strip()
        client_ip = (payload.get("client_ip") or "").strip()
        if not api_user or not api_key or not client_ip:
            raise HTTPException(status_code=400, detail="api_user, api_key and client_ip are required for namecheap.")
        return {"api_user": api_user, "api_key": api_key, "username": username, "client_ip": client_ip}
    if p == "clouddns":
        service_account_json = (payload.get("service_account_json") or "").strip()
        if not service_account_json:
            raise HTTPException(
                status_code=400,
                detail="service_account_json is required for clouddns.",
            )
        creds = {"service_account_json": service_account_json}
        if (payload.get("project_id") or "").strip():
            creds["project_id"] = (payload.get("project_id") or "").strip()
        if (payload.get("managed_zone") or "").strip():
            creds["managed_zone"] = (payload.get("managed_zone") or "").strip()
        return creds
    raise HTTPException(status_code=400, detail=f"Unsupported provider '{provider}'.")


async def _build_auto_dns_records(domain: dict) -> List[Dict[str, Any]]:
    domain_name = domain["domain"]
    provider_records = await domain_service._get_provider_specific_records(domain_name, "sendgrid")
    txt_records = provider_records.get("txt_records", []) if provider_records else []

    provider_spf = None
    provider_dkim = None
    for record in txt_records:
        value = (record.get("value") or "").lower()
        name = (record.get("name") or "").lower()
        if not provider_spf and "v=spf1" in value:
            provider_spf = record
        if not provider_dkim and (
            "v=dkim1" in value or "k=rsa" in value or ("p=" in value and "_domainkey" in name)
        ):
            provider_dkim = record

    dmarc_policy = os.getenv("DMARC_POLICY", "quarantine")
    dmarc_value = (
        f"v=DMARC1; p={dmarc_policy}; "
        f"rua=mailto:dmarc@{domain_name}; "
        f"ruf=mailto:dmarc@{domain_name}; "
        "fo=1; aspf=r; adkim=r"
    )
    dkim_selector = domain.get("dkim_selector", "sendgrid")
    matched_fqdn = (
        (provider_records.get("sendgrid_info") or {}).get("matched_domain") or ""
        if provider_records
        else ""
    ).strip().lower().rstrip(".")
    spf_txt_name = _dns_name_replace_at_with_matched(
        provider_spf.get("name", "@") if provider_spf else "@",
        matched_fqdn,
    )
    dkim_txt_name = _dns_name_replace_at_with_matched(
        provider_dkim.get("name", f"{dkim_selector}._domainkey") if provider_dkim else f"{dkim_selector}._domainkey",
        matched_fqdn,
    )
    records: List[Dict[str, Any]] = [
        {"type": "TXT", "name": spf_txt_name, "value": provider_spf.get("value") if provider_spf else ""},
        {
            "type": "TXT",
            "name": dkim_txt_name,
            "value": normalize_sendgrid_dkim_txt_value(provider_dkim.get("value", "")) if provider_dkim else "",
        },
        {"type": "TXT", "name": "_dmarc", "value": dmarc_value},
    ]

    for cname in (provider_records or {}).get("cname_records", []) or []:
        if cname.get("name") and cname.get("value"):
            records.append({"type": "CNAME", "name": cname["name"], "value": cname["value"]})
    for mx in (provider_records or {}).get("mx_records", []) or []:
        if mx.get("name") and mx.get("value"):
            records.append(
                {
                    "type": "MX",
                    "name": mx["name"],
                    "value": mx["value"],
                    "priority": int(mx.get("priority", 10)),
                }
            )

    deduped: List[Dict[str, Any]] = []
    seen = set()
    for rec in records:
        key = (rec.get("type"), rec.get("name"), rec.get("value"), rec.get("priority"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(rec)
    return deduped


def _dns_name_replace_at_with_matched(name: str, matched_fqdn: str) -> str:
    """Use SendGrid matched hostname instead of @ for display and stored dns_records."""
    n = (name or "").strip()
    m = (matched_fqdn or "").strip().lower().rstrip(".")
    if n == "@" and m:
        return m
    return name


def _build_domain_dns_records_payload(
    domain: dict,
    provider_records: Optional[dict] = None,
    provider: str = "sendgrid",
) -> Dict[str, Any]:
    """Build canonical dns_records payload persisted on domain documents."""
    provider_spf = None
    provider_dkim = None

    if provider_records:
        txt_records = provider_records.get("txt_records", []) or []
        for record in txt_records:
            value = (record.get("value") or "")
            name = (record.get("name") or "")
            lower_value = value.lower()
            lower_name = name.lower()
            if provider_spf is None and "v=spf1" in lower_value:
                provider_spf = record
            elif provider_dkim is None and (
                "v=dkim1" in lower_value
                or "k=rsa" in lower_value
                or ("p=" in lower_value and "_domainkey" in lower_name)
            ):
                provider_dkim = record

    dmarc_policy = os.getenv("DMARC_POLICY", "quarantine")
    dmarc_value = (
        f"v=DMARC1; p={dmarc_policy}; "
        f"rua=mailto:dmarc@{domain['domain']}; "
        f"ruf=mailto:dmarc@{domain['domain']}; "
        "fo=1; aspf=r; adkim=r"
    )
    dkim_selector = domain.get("dkim_selector", "sendgrid")
    dkim_value = (
        normalize_sendgrid_dkim_txt_value(provider_dkim["value"])
        if provider_dkim
        else ""
    )

    matched_fqdn = ""
    if provider_records:
        matched_fqdn = (
            (provider_records.get("sendgrid_info") or {}).get("matched_domain") or ""
        ).strip().lower().rstrip(".")

    spf_name = _dns_name_replace_at_with_matched(
        provider_spf["name"] if provider_spf else "@",
        matched_fqdn,
    )
    dkim_name = _dns_name_replace_at_with_matched(
        provider_dkim["name"] if provider_dkim else f"{dkim_selector}._domainkey",
        matched_fqdn,
    )

    records: Dict[str, Any] = {
        "provider": provider,
        "spf": {
            "type": "TXT",
            "name": spf_name,
            "value": provider_spf["value"] if provider_spf else "",
            "verified": bool(domain.get("spf_verified", False)),
        },
        "dkim": {
            "type": "TXT",
            "name": dkim_name,
            "value": dkim_value,
            "verified": bool(domain.get("dkim_verified", False)),
        },
        "dmarc": {
            "type": "TXT",
            "name": "_dmarc",
            "value": dmarc_value,
            "verified": bool(domain.get("dmarc_verified", False)),
        },
    }
    if provider_records:
        records["provider_specific"] = provider_records
    return records


async def _sync_domain_with_sendgrid_records(
    domain_doc: dict,
    *,
    allow_create: bool,
) -> Dict[str, Any]:
    """
    Fetch SendGrid auth records for a domain row and return normalized provider_sync + dns_records payloads.
    """
    domain_name = (domain_doc.get("domain") or "").strip().lower().rstrip(".")
    if not domain_name:
        raise HTTPException(status_code=400, detail="Invalid domain row: missing domain name")

    provider_sync_meta = domain_doc.get("provider_sync") or {}
    preferred_lookup_domain = (provider_sync_meta.get("matched_domain") or "").strip().lower().rstrip(".")

    can_reuse_preferred = False
    if preferred_lookup_domain and preferred_lookup_domain.endswith(f".{domain_name}"):
        prefix = preferred_lookup_domain[: -(len(domain_name) + 1)]
        can_reuse_preferred = "." not in prefix and bool(prefix)

    lookup_domain = preferred_lookup_domain if can_reuse_preferred else domain_name
    sendgrid_records = await domain_service.sendgrid_service.get_dns_records_for_domain(
        lookup_domain,
        allow_create=allow_create and not can_reuse_preferred,
    )

    # Retry with domain scope when a stale preferred mapping no longer exists.
    if (
        sendgrid_records.get("error")
        and can_reuse_preferred
        and "No existing SendGrid domain authentication found" in str(sendgrid_records.get("error"))
        and allow_create
    ):
        lookup_domain = domain_name
        sendgrid_records = await domain_service.sendgrid_service.get_dns_records_for_domain(
            lookup_domain,
            allow_create=True,
        )

    if sendgrid_records.get("error"):
        raise HTTPException(status_code=400, detail=sendgrid_records.get("error"))

    sendgrid_info = sendgrid_records.get("sendgrid_info", {})
    now = datetime.now(timezone.utc)
    next_sync = {
        "provider": "sendgrid",
        "domain_id": sendgrid_info.get("domain_id"),
        "verified": sendgrid_info.get("verified", False),
        "matched_domain": sendgrid_info.get("matched_domain") or lookup_domain,
        "synced_at": now,
    }
    previous_sync = domain_doc.get("provider_sync") or {}
    no_effective_change = (
        previous_sync.get("provider") == next_sync["provider"]
        and previous_sync.get("domain_id") == next_sync["domain_id"]
        and bool(previous_sync.get("verified")) == bool(next_sync["verified"])
    )
    refreshed_dns_records = _build_domain_dns_records_payload(
        domain_doc,
        provider_records=sendgrid_records,
        provider="sendgrid",
    )

    return {
        "provider_sync": next_sync,
        "dns_records": refreshed_dns_records,
        "updated_at": now,
        "verified": bool(sendgrid_info.get("verified", False)),
        "records_count": (
            len(sendgrid_records.get("cname_records", []))
            + len(sendgrid_records.get("txt_records", []))
            + len(sendgrid_records.get("mx_records", []))
        ),
        "no_effective_change": no_effective_change,
    }




@router.post("/domains")
async def create_domain(domain: Domain, current_user: dict = Depends(get_current_user)):
    """Add new domain"""
    create_lock_id: Optional[str] = None
    lock_acquired = False
    try:
        logging.info(
            "[DOMAIN-CREATE] Incoming request: user_id=%s, payload=%s",
            current_user.get("id"),
            {k: getattr(domain, k, None) for k in ("domain", "user_id")},
        )
        # Ensure user_id matches authenticated user
        if domain.user_id != current_user["id"]:
            raise HTTPException(status_code=403, detail="Cannot create domain for another user")

        normalized_domain = _normalize_domain_key(domain.domain)
        create_lock_id = f"{current_user['id']}:{normalized_domain}"
        try:
            await db.domain_creation_locks.insert_one(
                {
                    "id": create_lock_id,
                    "user_id": current_user["id"],
                    "domain_normalized": normalized_domain,
                    "created_at": datetime.now(timezone.utc),
                }
            )
            lock_acquired = True
        except DuplicateKeyError:
            raise HTTPException(
                status_code=409,
                detail=f"Domain creation already in progress for '{normalized_domain}'. Please wait and retry.",
            )

        # Plan limit check
        skip_domain_plan_limit = bool(current_user.get("_skip_domain_plan_limit"))
        if plan_service and not skip_domain_plan_limit:
            plan_user = await _get_user_for_plan_limits(current_user)
            limits = await plan_service.get_user_limits(plan_user)
            count = await plan_service.domains_count(current_user["id"])
            if limits.get("max_domains", 1) != -1 and count >= limits["max_domains"]:
                raise HTTPException(
                    status_code=403,
                    detail=f"Plan limit reached: maximum {limits['max_domains']} domains. Upgrade to add more.",
                )

        # Check if domain already exists anywhere in the system (no duplicates across users)
        existing_domain = await db.domains.find_one(
            {
                "$or": [
                    {"domain_normalized": normalized_domain},
                    {"domain": {"$regex": f"^{re.escape(normalized_domain)}\\.?$", "$options": "i"}},
                ]
            }
        )
        
        if existing_domain:
            if existing_domain.get("user_id") == current_user["id"]:
                logging.warning(f"[DOMAIN-CREATE] Domain {normalized_domain} already exists in database for user {current_user['id']}")
                raise HTTPException(
                    status_code=400,
                    detail=f"Domain '{normalized_domain}' already exists in your account. Please delete it first if you want to recreate it."
                )
            logging.warning(f"[DOMAIN-CREATE] Domain {normalized_domain} already registered by another account")
            raise HTTPException(
                status_code=400,
                detail=f"Domain '{normalized_domain}' is already registered by another account. Each domain can only be added once in the system."
            )
        
        logging.warning(f"[DOMAIN-CREATE] Creating new domain {normalized_domain} for user {current_user['id']}")
        
        # Create domain document
        domain_dict = domain.model_dump()
        email_infra_enabled = await _is_email_infra_enabled_for_user(current_user["id"])
        email_infra_data = {"enabled": email_infra_enabled}
        if email_infra_enabled:
            vps_preference = (os.getenv("EMAIL_INFRA_DEFAULT_VPS_ID") or "").strip() or "auto-select"
            try:
                infra_domain = await domain_service.email_infra_service.create_domain(
                    domain=normalized_domain,
                    vps_id=vps_preference,
                )
                email_infra_data.update({
                    "status": infra_domain.get("status", "pending"),
                    "domain_id": infra_domain.get("id"),
                    "vps_id": infra_domain.get("vps_id"),
                    "mx_host": infra_domain.get("mx_host"),
                    "inbound_webhook_url": infra_domain.get("inbound_webhook_url"),
                    "last_verify_dns": None,
                    "last_sync_at": datetime.now(timezone.utc),
                    "last_error": None,
                })
            except EmailInfraServiceError as exc:
                logging.error("[DOMAIN-CREATE] Email Infra create failed for %s: %s", normalized_domain, exc)
                email_infra_data.update({
                    "status": "failed",
                    "domain_id": None,
                    "vps_id": None,
                    "mx_host": None,
                    "inbound_webhook_url": None,
                    "last_verify_dns": None,
                    "last_sync_at": datetime.now(timezone.utc),
                    "last_error": str(exc),
                })
        domain_dict.update({
            "domain": normalized_domain,
            "domain_normalized": normalized_domain,
            "dkim_selector": "sendgrid",
            "status": "pending",
            "email_infra": email_infra_data,
            "created_at": datetime.now(timezone.utc)
        })
        # Persist DB-first DNS payload only at creation time.
        # Provider sync is explicit and read-only via /sync-to-provider.
        provider_records = None
        domain_dict["dns_records"] = _build_domain_dns_records_payload(
            domain_dict,
            provider_records=provider_records,
            provider="sendgrid",
        )
        
        logging.warning(f"[DOMAIN-CREATE] Inserting domain {normalized_domain} into database")
        
        try:
            await db.domains.insert_one(domain_dict)
        except DuplicateKeyError:
            raise HTTPException(
                status_code=400,
                detail=f"Domain '{normalized_domain}' already exists in the system.",
            )

        # Keep create behavior aligned with manual Sync:
        # create/recreate SendGrid auth records and persist canonical dns_records/provider_sync now.
        try:
            sync_payload = await _sync_domain_with_sendgrid_records(
                domain_dict,
                allow_create=True,
            )
            await db.domains.update_one(
                {"id": domain_dict["id"], "user_id": current_user["id"]},
                {
                    "$set": {
                        "provider_sync": sync_payload["provider_sync"],
                        "dns_records": sync_payload["dns_records"],
                        "updated_at": sync_payload["updated_at"],
                    }
                },
            )
            domain_dict["provider_sync"] = sync_payload["provider_sync"]
            domain_dict["dns_records"] = sync_payload["dns_records"]
            domain_dict["updated_at"] = sync_payload["updated_at"]
        except Exception as sync_exc:
            # Domain is already in DB — do not fail the creation.
            # SendGrid rate limits (429) or transient errors are non-fatal here;
            # the user can trigger a manual sync from the domain settings.
            logging.warning(
                "[DOMAIN-CREATE] Initial SendGrid sync failed for %s (domain saved, sync pending): %s",
                normalized_domain,
                sync_exc,
            )

        domain_dict.pop("_id", None)
        domain_dict.pop("dkim_private_key", None)  # Don't return private key
        
        return domain_dict
    except HTTPException as http_exc:
        # Log structured info for debugging 4xx errors from this endpoint
        logging.warning(
            "[DOMAIN-CREATE] HTTPException status=%s detail=%s user_id=%s domain=%s",
            http_exc.status_code,
            http_exc.detail,
            current_user.get("id"),
            getattr(domain, "domain", None),
        )
        raise
    except Exception as e:
        logging.error(
            "[DOMAIN-CREATE] Unexpected error for user_id=%s domain=%s: %s",
            current_user.get("id"),
            getattr(domain, "domain", None),
            e,
            exc_info=True,
        )
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        if lock_acquired and create_lock_id:
            try:
                await db.domain_creation_locks.delete_one({"id": create_lock_id})
            except Exception:
                logging.warning("[DOMAIN-CREATE] Failed to release creation lock for %s", create_lock_id)

@router.get("/domains")
async def get_domains(current_user: dict = Depends(get_current_user)):
    """List user domains"""
    domains = await db.domains.find(
        {"user_id": current_user["id"]},
        {"_id": 0, "dkim_private_key": 0}  # Don't return private key
    ).sort("created_at", -1).to_list(None)
    return [_normalize_domain_sending_provider(d) for d in domains]

@router.get("/domains/{domain_id}")
async def get_domain(domain_id: str, current_user: dict = Depends(get_current_user)):
    """Get domain details"""
    domain = await verify_domain_ownership(domain_id, current_user["id"])
    # Remove private key from response
    domain.pop("dkim_private_key", None)
    return _normalize_domain_sending_provider(domain)


@router.post("/domains/bulk/background")
async def start_bulk_domain_create_job(payload: dict, current_user: dict = Depends(get_current_user)):
    """
    Queue a resilient background bulk-domain creation job.
    Supports:
    - mode=subdomains with domain_id + names[] (labels)
    - mode=domains with domains[] (fully qualified)
    """
    mode = (payload.get("mode") or "subdomains").strip().lower()
    requested_names = payload.get("names") or payload.get("domains") or []
    if not isinstance(requested_names, list) or not requested_names:
        raise HTTPException(status_code=400, detail="Provide at least one domain/subdomain entry.")

    normalized_domains: List[str] = []
    base_domain_doc = None

    if mode == "subdomains":
        domain_id = (payload.get("domain_id") or "").strip()
        if not domain_id:
            raise HTTPException(status_code=400, detail="domain_id is required for subdomain bulk mode.")
        base_domain_doc = await verify_domain_ownership(domain_id, current_user["id"])
        root_domain = _normalize_domain_key(base_domain_doc.get("domain", ""))
        for raw in requested_names:
            label = _normalize_subdomain_label(str(raw))
            normalized_domains.append(f"{label}.{root_domain}")
    elif mode == "domains":
        for raw in requested_names:
            normalized_domains.append(_normalize_domain_key(str(raw)))
    else:
        raise HTTPException(status_code=400, detail="Invalid mode. Use 'subdomains' or 'domains'.")

    # De-duplicate while preserving order
    deduped_domains = list(dict.fromkeys(normalized_domains))
    if not deduped_domains:
        raise HTTPException(status_code=400, detail="No valid domains to process.")

    # Plan guard: subdomain mode must use subdomain quota; domain mode uses domain quota.
    if plan_service:
        plan_user = await _get_user_for_plan_limits(current_user)
        limits = await plan_service.get_user_limits(plan_user)
        if mode == "subdomains":
            current_count = await plan_service.subdomains_count(current_user["id"])
            max_subdomains = limits.get("max_subdomains", 1)
            if max_subdomains != -1 and current_count + len(deduped_domains) > max_subdomains:
                remaining = max(0, max_subdomains - current_count)
                raise HTTPException(
                    status_code=403,
                    detail=(
                        f"Plan limit reached: you can create {remaining} more subdomain(s), "
                        f"but requested {len(deduped_domains)}."
                    ),
                )
        else:
            current_count = await plan_service.domains_count(current_user["id"])
            max_domains = limits.get("max_domains", 1)
            if max_domains != -1 and current_count + len(deduped_domains) > max_domains:
                remaining = max(0, max_domains - current_count)
                raise HTTPException(
                    status_code=403,
                    detail=(
                        f"Plan limit reached: you can create {remaining} more domain(s), "
                        f"but requested {len(deduped_domains)}."
                    ),
                )

    now = datetime.now(timezone.utc)
    job_id = str(uuid.uuid4())
    job_doc = {
        "id": job_id,
        "type": "bulk_domain_create",
        "user_id": current_user["id"],
        "status": "queued",
        "mode": mode,
        "source_domain_id": base_domain_doc.get("id") if base_domain_doc else None,
        "source_domain": base_domain_doc.get("domain") if base_domain_doc else None,
        "domains": deduped_domains,
        "total_count": len(deduped_domains),
        "processed_count": 0,
        "created_count": 0,
        "failed_count": 0,
        "skipped_count": 0,
        "pending_count": len(deduped_domains),
        "results": [],
        "created_at": now,
        "updated_at": now,
        "started_at": None,
        "completed_at": None,
    }
    await db[BULK_DOMAIN_JOB_COLLECTION].insert_one(job_doc)
    asyncio.create_task(_process_bulk_domain_create_job(job_id))
    return {
        "job_id": job_id,
        "status": "queued",
        "total_count": len(deduped_domains),
    }


@router.get("/domains/bulk/background/{job_id}")
async def get_bulk_domain_create_job(job_id: str, current_user: dict = Depends(get_current_user)):
    job = await db[BULK_DOMAIN_JOB_COLLECTION].find_one(
        {"id": job_id, "user_id": current_user["id"], "type": "bulk_domain_create"},
        {"_id": 0},
    )
    if not job:
        raise HTTPException(status_code=404, detail="Bulk job not found")
    return job


@router.get("/domains/bulk/background/{job_id}/stream")
async def stream_bulk_domain_create_job(job_id: str, current_user: dict = Depends(get_current_user)):
    job = await db[BULK_DOMAIN_JOB_COLLECTION].find_one(
        {"id": job_id, "user_id": current_user["id"], "type": "bulk_domain_create"},
        {"_id": 0},
    )
    if not job:
        raise HTTPException(status_code=404, detail="Bulk job not found")

    async def _stream():
        yield _bulk_job_sse_pack("open", {"type": "open", "job_id": job_id})
        last_signature = None
        while True:
            current = await db[BULK_DOMAIN_JOB_COLLECTION].find_one(
                {"id": job_id, "user_id": current_user["id"], "type": "bulk_domain_create"},
                {"_id": 0},
            )
            if not current:
                yield _bulk_job_sse_pack("failed", {"type": "failed", "job_id": job_id, "error": "Bulk job not found"})
                break

            signature = (
                current.get("status"),
                current.get("processed_count"),
                current.get("created_count"),
                current.get("failed_count"),
                current.get("skipped_count"),
                len(current.get("results", []) or []),
            )
            if signature != last_signature:
                last_signature = signature
                status = str(current.get("status") or "")
                event_type = "progress"
                if status == "failed":
                    event_type = "failed"
                elif status in ("completed", "completed_with_errors"):
                    event_type = "done"
                payload = {"type": event_type, "job": current}
                yield _bulk_job_sse_pack(event_type, payload)
                if event_type in ("done", "failed"):
                    break

            await asyncio.sleep(1)

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@router.get("/dns-providers")
async def list_dns_providers(current_user: dict = Depends(get_current_user)):
    settings = await db.user_settings.find_one({"user_id": current_user["id"]}, {"_id": 0, "dns_providers": 1})
    provider_settings = (settings or {}).get("dns_providers", {}) or {}
    output = []
    for provider in SUPPORTED_DNS_PROVIDERS:
        item = provider_settings.get(provider, {}) or {}
        encrypted_credentials = item.get("credentials_encrypted")
        previews = {}
        if encrypted_credentials:
            try:
                creds = json.loads(_decrypt_dns_secret(encrypted_credentials))
                for k, v in creds.items():
                    if isinstance(v, str) and v:
                        previews[k] = _mask_secret(v)
            except Exception:
                previews = {"status": "********"}
        output.append(
            {
                "provider": provider,
                "connected": bool(encrypted_credentials),
                "credential_previews": previews,
                "updated_at": item.get("updated_at"),
            }
        )
    return {"providers": output}


@router.put("/dns-providers/{provider}")
async def upsert_dns_provider(provider: str, payload: dict, current_user: dict = Depends(get_current_user)):
    provider_key = (provider or "").strip().lower()
    if provider_key not in SUPPORTED_DNS_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unsupported provider '{provider_key}'.")
    credentials = _validate_dns_provider_credentials(provider_key, payload)

    update_path = f"dns_providers.{provider_key}"
    await db.user_settings.update_one(
        {"user_id": current_user["id"]},
        {
            "$set": {
                "user_id": current_user["id"],
                f"{update_path}.credentials_encrypted": _encrypt_dns_secret(json.dumps(credentials)),
                f"{update_path}.updated_at": datetime.now(timezone.utc),
            }
        },
        upsert=True,
    )
    return {"provider": provider_key, "connected": True}


@router.delete("/dns-providers/{provider}")
async def delete_dns_provider(provider: str, current_user: dict = Depends(get_current_user)):
    provider_key = (provider or "").strip().lower()
    if provider_key not in SUPPORTED_DNS_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unsupported provider '{provider_key}'.")

    await db.user_settings.update_one(
        {"user_id": current_user["id"]},
        {"$unset": {f"dns_providers.{provider_key}": ""}},
        upsert=True,
    )
    return {"provider": provider_key, "connected": False}


@router.post("/domains/{domain_id}/auto-dns-setup")
async def auto_dns_setup(domain_id: str, payload: dict, current_user: dict = Depends(get_current_user)):
    domain = await verify_domain_ownership(domain_id, current_user["id"])
    provider = (payload.get("provider") or "cloudflare").strip().lower()
    if provider not in SUPPORTED_DNS_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unsupported provider '{provider}'.")

    settings = await db.user_settings.find_one({"user_id": current_user["id"]}, {"_id": 0, "dns_providers": 1})
    provider_settings = ((settings or {}).get("dns_providers", {}) or {}).get(provider, {})
    encrypted_credentials = provider_settings.get("credentials_encrypted")
    if not encrypted_credentials:
        raise HTTPException(status_code=400, detail=f"{provider} is not connected. Connect provider API first.")

    try:
        credentials = json.loads(_decrypt_dns_secret(encrypted_credentials))
    except Exception:
        raise HTTPException(status_code=400, detail=f"Failed to decrypt saved credentials for {provider}. Reconnect provider.")

    try:
        records = await _build_auto_dns_records(domain)
        result = await dns_provider_service.apply_records(
            provider=provider,
            zone_name=domain["domain"].strip().lower().rstrip("."),
            credentials=credentials,
            records=records,
        )
        await db.domains.update_one(
            {"id": domain_id, "user_id": current_user["id"]},
            {
                "$set": {
                    "dns_auto_setup.last_provider": provider,
                    "dns_auto_setup.last_run_at": datetime.now(timezone.utc),
                    "dns_auto_setup.last_error": None,
                }
            },
        )
        return {"message": "DNS records created/updated automatically.", "provider": provider, "result": result}
    except DNSProviderServiceError as exc:
        await db.domains.update_one(
            {"id": domain_id, "user_id": current_user["id"]},
            {
                "$set": {
                    "dns_auto_setup.last_provider": provider,
                    "dns_auto_setup.last_run_at": datetime.now(timezone.utc),
                    "dns_auto_setup.last_error": str(exc),
                }
            },
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/domains/{domain_id}/tracking-domain")
async def set_tracking_domain(domain_id: str, payload: dict, current_user: dict = Depends(get_current_user)):
    """Set or clear a custom tracking domain for a sending domain."""
    domain = await verify_domain_ownership(domain_id, current_user["id"])
    raw = payload.get("tracking_domain")
    if raw is None:
        raise HTTPException(status_code=400, detail="tracking_domain is required.")

    if str(raw).strip() == "":
        await db.domains.update_one(
            {"id": domain_id, "user_id": current_user["id"]},
            {"$set": {
                "tracking_domain": None,
                "tracking_domain_verified": False,
                "tracking_domain_verified_at": None,
                "updated_at": datetime.now(timezone.utc),
            }},
        )
    else:
        await _require_root_domain(
            current_user["id"],
            domain,
            "Link tracking can only be configured on the root domain; subdomains use the root domain's tracking settings.",
        )
        normalized = _normalize_tracking_domain(str(raw))
        await db.domains.update_one(
            {"id": domain_id, "user_id": current_user["id"]},
            {"$set": {
                "tracking_domain": normalized,
                "tracking_domain_verified": False,
                "tracking_domain_verified_at": None,
                "updated_at": datetime.now(timezone.utc),
            }},
        )

    updated = await db.domains.find_one({"id": domain_id, "user_id": current_user["id"]}, {"_id": 0, "dkim_private_key": 0})
    if not updated:
        raise HTTPException(status_code=404, detail="Domain not found")
    return _normalize_domain_sending_provider(updated)


@router.post("/domains/{domain_id}/verify-tracking-domain")
async def verify_tracking_domain(domain_id: str, current_user: dict = Depends(get_current_user)):
    """Verify that tracking_domain CNAME points to TRACKING_CNAME_TARGET."""
    domain = await verify_domain_ownership(domain_id, current_user["id"])
    await _require_root_domain(
        current_user["id"],
        domain,
        "Link tracking can only be configured on the root domain; subdomains use the root domain's tracking settings.",
    )
    tracking_domain = (domain.get("tracking_domain") or "").strip().lower()
    if not tracking_domain:
        raise HTTPException(status_code=400, detail="Set tracking_domain first.")

    expected_target = _expected_tracking_cname_target()
    result = await domain_service.verify_tracking_domain_cname(tracking_domain, expected_target)
    now = datetime.now(timezone.utc)
    update = {
        "tracking_domain_verified": bool(result.get("valid")),
        "tracking_domain_verified_at": now if result.get("valid") else None,
        "updated_at": now,
    }
    await db.domains.update_one({"id": domain_id, "user_id": current_user["id"]}, {"$set": update})

    updated = await db.domains.find_one({"id": domain_id, "user_id": current_user["id"]}, {"_id": 0, "dkim_private_key": 0})
    return {
        "verification": result,
        "domain": _normalize_domain_sending_provider(updated) if updated else None,
    }


@router.get("/tracking/verify-host")
async def verify_tracking_host_for_proxy(domain: str, request: Request):
    """
    Caddy on_demand_tls `ask` endpoint.
    Returns 200 only for verified tracking hosts to prevent arbitrary cert issuance.
    """
    shared_secret = (os.getenv("TRACKING_PROXY_SHARED_SECRET") or "").strip()
    if shared_secret:
        provided = (request.headers.get("x-tracking-proxy-secret") or "").strip()
        if provided != shared_secret:
            raise HTTPException(status_code=403, detail="Forbidden")

    host = _normalize_tracking_domain(domain)
    doc = await db.domains.find_one(
        {"tracking_domain": host, "tracking_domain_verified": True},
        {"_id": 0, "id": 1, "tracking_domain": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Not verified")
    return {"ok": True, "tracking_domain": host}

@router.post("/domains/{domain_id}/verify")
async def verify_domain(domain_id: str, current_user: dict = Depends(get_current_user)):
    """Verify DNS records for domain"""
    try:
        # Verify ownership and use only that DB-selected domain for verify/sync.
        owned_domain = await verify_domain_ownership(domain_id, current_user["id"])
        
        results = await domain_service.verify_dns_records(domain_id)
        # Do not rewrite dns_records during user verify.
        # Verify should only refresh status flags/health so admin-synced field mapping remains stable.
        health_score = await domain_service.calculate_health_score(domain_id)
        email_infra_verification = None

        enabled_for_user = await _is_email_infra_enabled_for_user(current_user["id"])
        # TEMP debug prints instead of logging so they always show in dev terminal
        print("[EMAIL-INFRA][verify] enabled_for_user:", enabled_for_user)
        if enabled_for_user:
            owned_domain = await db.domains.find_one({"id": domain_id}, {"_id": 0, "email_infra": 1})
            infra_domain_id = (owned_domain or {}).get("email_infra", {}).get("domain_id")
            print("[EMAIL-INFRA][verify] infra_domain_id:", infra_domain_id)
            print("[EMAIL-INFRA][verify] owned_email_infra:", (owned_domain or {}).get("email_infra"))
            if infra_domain_id:
                try:
                    email_infra_verification = await domain_service.email_infra_service.verify_domain_dns(infra_domain_id)
                    print("[EMAIL-INFRA][verify] verify_dns response:", email_infra_verification)
                    # Persist latest verification payload
                    await db.domains.update_one(
                        {"id": domain_id},
                        {
                            "$set": {
                                "email_infra.last_verify_dns": email_infra_verification,
                                "email_infra.last_sync_at": datetime.now(timezone.utc),
                                "email_infra.last_error": None,
                            }
                        },
                    )
                    # If we have a pending email_infra status, refresh it from Email Infra
                    owned_meta = (owned_domain or {}).get("email_infra") or {}
                    if owned_meta.get("status") in (None, "pending"):
                        try:
                            infra_domain = await domain_service.email_infra_service.get_domain(infra_domain_id)
                            print("[EMAIL-INFRA][verify] get_domain response:", infra_domain)
                        except EmailInfraServiceError as exc:
                            print("[EMAIL-INFRA][verify] get_domain error:", str(exc))
                            infra_domain = None
                        if infra_domain:
                            await db.domains.update_one(
                                {"id": domain_id},
                                {
                                    "$set": {
                                        "email_infra.status": infra_domain.get("status", owned_meta.get("status")),
                                        "email_infra.vps_id": infra_domain.get("vps_id", owned_meta.get("vps_id")),
                                        "email_infra.mx_host": infra_domain.get("mx_host", owned_meta.get("mx_host")),
                                        "email_infra.inbound_webhook_url": infra_domain.get(
                                            "inbound_webhook_url", owned_meta.get("inbound_webhook_url")
                                        ),
                                    }
                                },
                            )
                except EmailInfraServiceError as exc:
                    email_infra_verification = {"ok": False, "message": str(exc)}
                    print("[EMAIL-INFRA][verify] verify_dns error:", str(exc))
                    await db.domains.update_one(
                        {"id": domain_id},
                        {
                            "$set": {
                                "email_infra.last_error": str(exc),
                                "email_infra.last_sync_at": datetime.now(timezone.utc),
                            }
                        },
                    )
        
        # Fetch updated domain to return current status
        updated_domain = await db.domains.find_one({"id": domain_id})
        if updated_domain:
            updated_domain.pop("_id", None)
            updated_domain.pop("dkim_private_key", None)
            _normalize_domain_sending_provider(updated_domain)
            if (
                lifecycle_automation_service
                and updated_domain.get("status") == "verified"
                and updated_domain.get("user_id") == current_user["id"]
            ):
                try:
                    await lifecycle_automation_service.emit_event(
                        current_user["id"],
                        "domain_verified",
                        {"domain_id": domain_id, "domain": updated_domain.get("domain")},
                    )
                except Exception:
                    logging.exception(
                        "Failed to emit lifecycle domain_verified for user %s domain %s",
                        current_user["id"],
                        domain_id,
                    )
        
        return {
            "verification_results": results,
            "health_score": health_score,
            "email_infra_verification": email_infra_verification,
            "domain": updated_domain  # Include updated domain in response
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/domains/{domain_id}/sync-to-provider")
async def sync_domain_to_provider(domain_id: str, current_user: dict = Depends(get_current_user)):
    """Sync existing domain to SendGrid.
    
    This is useful when:
    - Domain was created with a different provider (e.g., Pigeon)
    - Existing SendGrid auth data needs a refresh
    - Need to configure domain in the SendGrid dashboard
    """
    try:
        # Verify ownership
        domain = await verify_domain_ownership(domain_id, current_user["id"])
        domain_name = domain["domain"]
        
        logging.info(f"Sync to provider requested for domain: {domain_name}")
        
        logging.info("Current email provider: sendgrid")

        logging.info(f"Syncing domain {domain_name} to SendGrid...")
        sync_payload = await _sync_domain_with_sendgrid_records(
            domain,
            allow_create=True,
        )
        await db.domains.update_one(
            {"id": domain_id, "user_id": current_user["id"]},
            {"$set": {
                "provider_sync": sync_payload["provider_sync"],
                "dns_records": sync_payload["dns_records"],
                "updated_at": sync_payload["updated_at"],
            }}
        )
        
        return {
            "message": (
                "Domain provider sync already up to date."
                if sync_payload["no_effective_change"]
                else "Domain successfully synced."
            ),
            "provider": "sendgrid",
            "verified": sync_payload["verified"],
            "records_count": sync_payload["records_count"],
            "no_changes": sync_payload["no_effective_change"],
        }
            
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error syncing domain to provider: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to sync domain: {str(e)}")


@router.post("/domains/{domain_id}/verify-receiving-mx")
async def verify_receiving_mx(domain_id: str, current_user: dict = Depends(get_current_user)):
    """Verify that the receiving MX record (mx.sendgrid.net) is present in DNS for this domain.
    Call this after adding the MX record and before enabling receiving."""
    domain = await verify_domain_ownership(domain_id, current_user["id"])
    try:
        result = await domain_service.verify_receiving_mx(domain_id)
        return result
    except Exception as e:
        logging.error(f"Error verifying receiving MX for domain {domain_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/domains/{domain_id}/enable-receiving")
async def enable_receiving(domain_id: str, current_user: dict = Depends(get_current_user)):
    """Enable receiving mail for this domain via SendGrid Inbound Parse."""
    domain = await verify_domain_ownership(domain_id, current_user["id"])
    if domain.get("inbound_parse_enabled"):
        updated = await db.domains.find_one({"id": domain_id}, {"_id": 0})
        if updated:
            updated.pop("_id", None)
            updated.pop("dkim_private_key", None)
        return updated or domain
    # Receiving requires the MX record to be present for the specific hostname.
    # Subdomains may be able to receive without having full SPF/DKIM/DMARC "status=verified"
    # (those checks are primarily for outbound sending verification).
    mx_result = await domain_service.verify_receiving_mx(domain_id)
    if not mx_result.get("valid"):
        raise HTTPException(
            status_code=400,
            detail=mx_result.get("message") or "Receiving MX record not found.",
        )
    webhook_url = os.getenv("SENDGRID_INBOUND_PARSE_URL")
    if not webhook_url:
        raise HTTPException(
            status_code=503,
            detail="Inbound parse webhook URL not configured (SENDGRID_INBOUND_PARSE_URL).",
        )
    try:
        await domain_service.sendgrid_service.create_inbound_parse_setting(
            domain["domain"], webhook_url, spam_check=True
        )
    except Exception as e:
        logging.error(f"Failed to create Inbound Parse for {domain['domain']}: {e}")
        raise HTTPException(status_code=502, detail=f"SendGrid Inbound Parse setup failed: {str(e)}")
    await db.domains.update_one(
        {"id": domain_id},
        {
            "$set": {
                "inbound_parse_enabled": True,
                # We verified the MX just above.
                "mx_verified": True,
            }
        },
    )
    updated = await db.domains.find_one({"id": domain_id}, {"_id": 0})
    if updated:
        updated.pop("_id", None)
        updated.pop("dkim_private_key", None)
    return updated


@router.post("/domains/{domain_id}/disable-receiving")
async def disable_receiving(domain_id: str, current_user: dict = Depends(get_current_user)):
    """Disable receiving mail for this domain (removes SendGrid Inbound Parse)."""
    domain = await verify_domain_ownership(domain_id, current_user["id"])
    if not domain.get("inbound_parse_enabled"):
        updated = await db.domains.find_one({"id": domain_id}, {"_id": 0})
        if updated:
            updated.pop("_id", None)
            updated.pop("dkim_private_key", None)
        return updated or domain
    domain_name = domain["domain"]
    try:
        inbound_result = await domain_service.sendgrid_service.delete_inbound_parse_setting(domain_name)
        if not inbound_result.get("success"):
            logging.warning("[DOMAIN-DISABLE-RECEIVING] SendGrid Inbound Parse deletion: %s", inbound_result.get("error"))
    except Exception as e:
        logging.warning("[DOMAIN-DISABLE-RECEIVING] Error deleting Inbound Parse for %s: %s", domain_name, e)
    await db.domains.update_one(
        {"id": domain_id},
        {"$set": {"inbound_parse_enabled": False}},
    )
    updated = await db.domains.find_one({"id": domain_id}, {"_id": 0})
    if updated:
        updated.pop("_id", None)
        updated.pop("dkim_private_key", None)
    return updated


@router.get("/domains/{domain_id}/dns-records")
async def get_dns_records(domain_id: str, current_user: dict = Depends(get_current_user)):
    """Get DNS records to add for SendGrid domain authentication."""
    domain = await verify_domain_ownership(domain_id, current_user["id"])
    current_provider = "sendgrid"

    saved_records = domain.get("dns_records")
    if not isinstance(saved_records, dict) or not saved_records:
        raise HTTPException(status_code=404, detail="DNS records not found. Sync the domain with SendGrid first.")
    records = deepcopy(saved_records)

    # Keep verification badges current with latest domain status.
    if isinstance(records.get("spf"), dict):
        records["spf"]["verified"] = bool(domain.get("spf_verified", False))
    if isinstance(records.get("dkim"), dict):
        records["dkim"]["verified"] = bool(domain.get("dkim_verified", False))
    if isinstance(records.get("dmarc"), dict):
        records["dmarc"]["verified"] = bool(domain.get("dmarc_verified", False))
    if not records.get("provider"):
        records["provider"] = current_provider

    records["tracking"] = {
        "cname_target": _expected_tracking_cname_target(),
        "configured_domain": domain.get("tracking_domain"),
        "configured_verified": bool(domain.get("tracking_domain_verified")),
    }
    if await _is_email_infra_enabled_for_user(current_user["id"]):
        infra_meta = domain.get("email_infra", {}) if isinstance(domain.get("email_infra"), dict) else {}
        infra_domain_id = infra_meta.get("domain_id")
        infra_domain = None
        infra_verify = None
        infra_error = infra_meta.get("last_error")
        if infra_domain_id:
            try:
                infra_domain = await domain_service.email_infra_service.get_domain(infra_domain_id)
            except EmailInfraServiceError as exc:
                infra_error = str(exc)
        records["email_infra"] = {
            "enabled": True,
            "domain_id": infra_domain_id,
            "status": (infra_domain or {}).get("status") or infra_meta.get("status"),
            "vps_id": (infra_domain or {}).get("vps_id") or infra_meta.get("vps_id"),
            "mx_host": (infra_domain or {}).get("mx_host") or infra_meta.get("mx_host"),
            "inbound_webhook_url": (infra_domain or {}).get("inbound_webhook_url") or infra_meta.get("inbound_webhook_url"),
            "dkim": (infra_domain or {}).get("dkim"),
            "spf": (infra_domain or {}).get("spf"),
            "dmarc": (infra_domain or {}).get("dmarc"),
            "last_verify_dns": infra_verify or infra_meta.get("last_verify_dns"),
            "last_error": infra_error,
        }
    # print('records', records);
    return records


@router.post("/domains/{domain_id}/email-infra")
async def create_email_infra_for_domain(
    domain_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Create and attach an Email Infra domain for an existing domain, when
    Email Infra is enabled for the user but this particular domain does not yet
    have Pigeon DNS configured.
    """
    if not await _is_email_infra_enabled_for_user(current_user["id"]):
        raise HTTPException(status_code=400, detail="Email Infra is not enabled for this account.")

    domain = await db.domains.find_one(
        {"id": domain_id, "user_id": current_user["id"]},
        {"_id": 0, "domain": 1, "email_infra": 1},
    )
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")

    existing_meta = domain.get("email_infra") if isinstance(domain.get("email_infra"), dict) else {}
    infra_domain_id = existing_meta.get("domain_id")
    if infra_domain_id:
        # "Verify"/refresh behavior: do not re-create; just fetch latest infra status and persist it.
        try:
            infra_domain = await domain_service.email_infra_service.get_domain(infra_domain_id)
            email_infra_data = {
                **existing_meta,
                "enabled": True,
                "status": infra_domain.get("status") or existing_meta.get("status") or "pending",
                "domain_id": infra_domain_id,
                "vps_id": infra_domain.get("vps_id") or existing_meta.get("vps_id"),
                "mx_host": infra_domain.get("mx_host") or existing_meta.get("mx_host"),
                "inbound_webhook_url": infra_domain.get("inbound_webhook_url") or existing_meta.get("inbound_webhook_url"),
                "last_error": None,
                "last_sync_at": datetime.now(timezone.utc),
            }
            await db.domains.update_one(
                {"id": domain_id, "user_id": current_user["id"]},
                {"$set": {"email_infra": email_infra_data}},
            )
        except EmailInfraServiceError as exc:
            await db.domains.update_one(
                {"id": domain_id, "user_id": current_user["id"]},
                {
                    "$set": {
                        "email_infra.last_error": str(exc),
                        "email_infra.last_sync_at": datetime.now(timezone.utc),
                    }
                },
            )
            raise HTTPException(status_code=400, detail=f"Failed to refresh Email Infra domain: {exc}") from exc

        updated = await db.domains.find_one(
            {"id": domain_id, "user_id": current_user["id"]},
            {"_id": 0},
        )
        if not updated:
            raise HTTPException(status_code=404, detail="Domain not found")
        return updated

    vps_preference = (os.getenv("EMAIL_INFRA_DEFAULT_VPS_ID") or "").strip() or "auto-select"
    try:
        infra_domain = await domain_service.email_infra_service.create_domain(
            domain=domain["domain"],
            vps_id=vps_preference,
        )
    except EmailInfraServiceError as exc:
        raise HTTPException(status_code=400, detail=f"Failed to create Email Infra domain: {exc}") from exc

    email_infra_data = {
        **existing_meta,
        "enabled": True,
        "status": infra_domain.get("status", "pending"),
        "domain_id": infra_domain.get("id"),
        "vps_id": infra_domain.get("vps_id"),
        "mx_host": infra_domain.get("mx_host"),
        "inbound_webhook_url": infra_domain.get("inbound_webhook_url"),
        "last_verify_dns": None,
        "last_sync_at": datetime.now(timezone.utc),
        "last_error": None,
    }

    await db.domains.update_one(
        {"id": domain_id, "user_id": current_user["id"]},
        {"$set": {"email_infra": email_infra_data}},
    )

    updated = await db.domains.find_one(
        {"id": domain_id, "user_id": current_user["id"]},
        {"_id": 0},
    )
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to refresh domain after Email Infra creation.")

    return updated


@router.delete("/domains/{domain_id}/email-infra")
async def delete_email_infra_for_domain(
    domain_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Remove Pigeon DNS from this domain: delete the domain in Email Infra (when provisioned)
    and clear `email_infra` so the user can recreate it. Sending falls back to SendGrid if needed.
    """
    if not await _is_email_infra_enabled_for_user(current_user["id"]):
        raise HTTPException(status_code=400, detail="Email Infra is not enabled for this account.")

    domain = await db.domains.find_one(
        {"id": domain_id, "user_id": current_user["id"]},
        {"_id": 0},
    )
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")

    infra_meta = domain.get("email_infra") if isinstance(domain.get("email_infra"), dict) else {}
    if not infra_meta.get("enabled"):
        raise HTTPException(status_code=400, detail="Pigeon DNS is not configured for this domain.")

    infra_domain_id = infra_meta.get("domain_id")
    if infra_domain_id:
        try:
            await domain_service.email_infra_service.delete_domain(infra_domain_id)
        except EmailInfraServiceError as exc:
            raise HTTPException(status_code=400, detail=f"Failed to delete Email Infra domain: {exc}") from exc

    patch: dict = {"email_infra": {"enabled": False}}
    if domain.get("sending_provider") == "email_infra":
        patch["sending_provider"] = "sendgrid"

    await db.domains.update_one(
        {"id": domain_id, "user_id": current_user["id"]},
        {"$set": patch},
    )

    updated = await db.domains.find_one(
        {"id": domain_id, "user_id": current_user["id"]},
        {"_id": 0},
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Domain not found")
    updated.pop("dkim_private_key", None)
    return _normalize_domain_sending_provider(updated)


@router.post("/domains/{domain_id}/sending-provider")
async def set_domain_sending_provider(
    domain_id: str,
    payload: dict,
    current_user: dict = Depends(get_current_user),
):
    """
    Set which provider is used for *sending* on a domain level.

    - `sendgrid`: send outbound via SendGrid
    - `email_infra`: send outbound via Email Infra (VPS/IP pool)
    """
    provider = (payload.get("sending_provider") or "").strip()
    if provider not in ("sendgrid", "email_infra"):
        raise HTTPException(status_code=400, detail="Invalid sending_provider. Use 'sendgrid' or 'email_infra'.")

    # Verify ownership
    domain = await verify_domain_ownership(domain_id, current_user["id"])
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")

    if provider == "email_infra":
        email_infra_enabled_for_user = await _is_email_infra_enabled_for_user(current_user["id"])
        if not email_infra_enabled_for_user:
            raise HTTPException(status_code=400, detail="Enable Email Infra in settings first.")

        infra = domain.get("email_infra") if isinstance(domain.get("email_infra"), dict) else {}
        infra_domain_id = infra.get("domain_id")
        infra_vps_id = infra.get("vps_id")
        infra_status = (infra.get("status") or "").lower()

        # Domain must already be synced/provisioned with Email Infra.
        if not infra_domain_id or not infra_vps_id:
            raise HTTPException(
                status_code=400,
                detail="Email Infra domain is not ready. Create/verify Email Infra DNS for this domain first.",
            )
        if infra_status and infra_status not in ("ready", "verified"):
            raise HTTPException(
                status_code=400,
                detail=f"Email Infra is not ready yet (status: {infra.get('status')}). Verify Email Infra DNS first.",
            )

        # Auto-provision missing infra mailboxes for existing SMTP inboxes on this domain.
        # This keeps the “one sending provider per domain” behavior consistent.
        inbox_docs = await db.inboxes.find(
            {"user_id": current_user["id"], "domain_id": domain_id, "sender_type": "smtp"}
        ).to_list(None)

        for inbox in inbox_docs:
            inbox_id = inbox.get("id")
            inbox_email = (inbox.get("email") or "").strip().lower()
            if not inbox_id or not inbox_email:
                continue

            if inbox.get("mailbox_id"):
                # Mailbox already provisioned.
                continue

            # Ensure SMTP config resolves to the infra path in existing code.
            await db.inboxes.update_one(
                {"id": inbox_id},
                {"$set": {"smtp_provider": "pigeon"}},
            )

            mailbox_password = _derive_email_infra_mailbox_password(current_user["id"], domain_id, inbox_email)

            mailbox = await domain_service.email_infra_service.create_mailbox(
                email=inbox_email,
                password=mailbox_password,
                domain_id=infra_domain_id,
                vps_id=infra_vps_id,
                ip_id=None,
            )
            mailbox_id = (mailbox or {}).get("id")
            if not mailbox_id:
                raise HTTPException(status_code=502, detail="Email Infra mailbox creation returned no mailbox id.")

            # Wait for infra mailbox to be fully ready.
            await asyncio.sleep(30)
            verified_ok = False
            for attempt in range(1, 21):
                try:
                    verify_payload = await domain_service.email_infra_service.verify_mailbox(mailbox_id)
                    if verify_payload.get("ok"):
                        verified_ok = True
                        break
                except EmailInfraServiceError:
                    # Keep retrying until attempts exhausted.
                    pass
                if attempt < 20:
                    await asyncio.sleep(10)

            if not verified_ok:
                raise HTTPException(
                    status_code=502,
                    detail="Email Infra mailbox was not ready after repeated verification attempts.",
                )

            await db.inboxes.update_one(
                {"id": inbox_id},
                {"$set": {"mailbox_id": mailbox_id}},
            )

    # Persist domain-level sending provider
    await db.domains.update_one(
        {"id": domain_id, "user_id": current_user["id"]},
        {"$set": {"sending_provider": provider}},
    )

    updated = await db.domains.find_one({"id": domain_id, "user_id": current_user["id"]}, {"_id": 0})
    if not updated:
        raise HTTPException(status_code=404, detail="Domain not found after update")
    return _normalize_domain_sending_provider(updated)


@router.post("/domains/background/verify-dns")
async def background_verify_domains(request: Request):
    """Background DNS-based verification for all domains (cron-friendly).

    - Uses only DNS + DB expectations (no SendGrid API calls)
    - Intended to be called by a secure cron on a frequent interval
    - Optionally protected by a shared secret header X-CRON-SECRET
    """
    logging.warning("[BACKGROUND-DNS] Cron endpoint called: /domains/background/verify-dns")
    cron_secret = os.getenv("CRON_SECRET")
    if cron_secret:
        provided = request.headers.get("x-cron-secret")
        if not provided or provided != cron_secret:
            logging.warning("[BACKGROUND-DNS] Invalid or missing X-CRON-SECRET header")
            raise HTTPException(status_code=403, detail="Forbidden")

    if not domain_service:
        logging.error("[BACKGROUND-DNS] Domain service not initialized")
        raise HTTPException(status_code=503, detail="Domain service not initialized")

    domain_ids = []
    async for doc in db.domains.find({}, {"id": 1, "domain": 1}):
        if "id" in doc:
            domain_ids.append(doc["id"])

    logging.warning(f"[BACKGROUND-DNS] Found {len(domain_ids)} domains to verify")

    results_summary = []
    for domain_id in domain_ids:
        try:
            logging.warning(f"[BACKGROUND-DNS] Verifying domain_id={domain_id} via DNS-only")
            verification = await domain_service.verify_dns_records_dns_only(domain_id)
            results_summary.append(
                {
                    "domain_id": domain_id,
                    "spf_verified": verification.get("spf_verified"),
                    "dkim_verified": verification.get("dkim_verified"),
                    "dmarc_verified": verification.get("dmarc_verified"),
                    "mx_verified": verification.get("mx_verified"),
                }
            )
        except Exception as e:
            logging.error(f"[BACKGROUND-DNS] Failed to verify domain {domain_id}: {e}")
            results_summary.append(
                {
                    "domain_id": domain_id,
                    "error": str(e),
                }
            )

    logging.warning(
        f"[BACKGROUND-DNS] Completed run. Total={len(domain_ids)}, "
        f"errors={len([r for r in results_summary if 'error' in r])}"
    )

    return {
        "count": len(domain_ids),
        "results": results_summary,
    }

@router.put("/domains/{domain_id}")
async def update_domain(domain_id: str, domain_update: dict, current_user: dict = Depends(get_current_user)):
    """Update domain (e.g., SPF include domain)"""
    try:
        # Verify ownership
        domain = await verify_domain_ownership(domain_id, current_user["id"])
        
        # Forward inbound webhook updates to Email Infra when enabled for this user.
        if "inbound_webhook_url" in domain_update and await _is_email_infra_enabled_for_user(current_user["id"]):
            requested_webhook_url = domain_update.pop("inbound_webhook_url")
            infra_domain_id = (domain.get("email_infra") or {}).get("domain_id")
            if infra_domain_id:
                try:
                    infra_resp = await domain_service.email_infra_service.update_domain_webhook(
                        infra_domain_id,
                        requested_webhook_url,
                    )
                    domain_update["email_infra.inbound_webhook_url"] = infra_resp.get("inbound_webhook_url", requested_webhook_url)
                    domain_update["email_infra.last_error"] = None
                    domain_update["email_infra.last_sync_at"] = datetime.now(timezone.utc)
                except EmailInfraServiceError as exc:
                    domain_update["email_infra.inbound_webhook_url"] = requested_webhook_url
                    domain_update["email_infra.last_error"] = str(exc)
                    domain_update["email_infra.last_sync_at"] = datetime.now(timezone.utc)
        
        # Update domain
        domain_update["updated_at"] = datetime.now(timezone.utc)
        await db.domains.update_one(
            {"id": domain_id},
            {"$set": domain_update}
        )
        
        # Fetch updated domain
        updated_domain = await db.domains.find_one({"id": domain_id})
        updated_domain.pop("_id", None)
        updated_domain.pop("dkim_private_key", None)  # Don't return private key
        _normalize_domain_sending_provider(updated_domain)
        return updated_domain
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/domains/{domain_id}")
async def delete_domain(domain_id: str, current_user: dict = Depends(get_current_user)):
    """Delete domain from database and SendGrid"""
    # Verify ownership
    domain = await verify_domain_ownership(domain_id, current_user["id"])
    domain_name = domain["domain"]
    infra_deletion_result = None
    
    # Check if domain has inboxes
    inbox_count = await db.inboxes.count_documents({"domain_id": domain_id})
    if inbox_count > 0:
        raise HTTPException(status_code=400, detail="Cannot delete domain with existing inboxes")
    
    logging.warning(f"[DOMAIN-DELETE] Deleting domain {domain_name} (ID: {domain_id})")

    # Delete in Email Infra first when feature is enabled for this user.
    if await _is_email_infra_enabled_for_user(current_user["id"]):
        infra_domain_id = (domain.get("email_infra") or {}).get("domain_id")
        if infra_domain_id:
            try:
                await domain_service.email_infra_service.delete_domain(infra_domain_id)
                infra_deletion_result = {"success": True}
            except EmailInfraServiceError as exc:
                infra_deletion_result = {"success": False, "error": str(exc)}
                logging.warning(f"[DOMAIN-DELETE] Email Infra deletion failed for {domain_name}: {exc}")
    
    # Delete from SendGrid (domain auth + inbound parse)
    sendgrid_deletion_result = None
    sendgrid_scope_cleanup_result = None
    try:
        logging.warning(f"[DOMAIN-DELETE] Attempting to delete {domain_name} from SendGrid...")
        provider_sync = domain.get("provider_sync") or {}
        sendgrid_domain_id = provider_sync.get("domain_id")
        matched_domain = (provider_sync.get("matched_domain") or "").strip().lower().rstrip(".")

        if sendgrid_domain_id:
            sendgrid_deletion_result = await domain_service.sendgrid_service.delete_domain_authentication_by_id(
                sendgrid_domain_id
            )
            # Fallback to hostname-based deletion if id-based deletion fails unexpectedly.
            if not sendgrid_deletion_result.get("success"):
                logging.warning(
                    "[DOMAIN-DELETE] SendGrid delete by id failed for %s (id=%s). Trying hostname fallback.",
                    domain_name,
                    sendgrid_domain_id,
                )
                sendgrid_deletion_result = await domain_service.sendgrid_service.delete_domain_authentication(
                    matched_domain or domain_name
                )
        else:
            sendgrid_deletion_result = await domain_service.sendgrid_service.delete_domain_authentication(
                matched_domain or domain_name
            )
        
        if sendgrid_deletion_result.get("success"):
            logging.warning(f"[DOMAIN-DELETE] Successfully deleted from SendGrid: {sendgrid_deletion_result.get('message')}")
        else:
            logging.warning(f"[DOMAIN-DELETE] SendGrid deletion failed: {sendgrid_deletion_result.get('error')}")

        # Also remove scoped related auth rows (handles emXXXX.<domain> and emXXXX.<subdomain-domain> leftovers).
        sendgrid_scope_cleanup_result = await domain_service.sendgrid_service.delete_domain_authentications_for_scope(
            domain_name
        )
        if sendgrid_scope_cleanup_result.get("success"):
            logging.warning(
                "[DOMAIN-DELETE] Scoped SendGrid cleanup for %s deleted=%s matched=%s",
                domain_name,
                sendgrid_scope_cleanup_result.get("deleted_count", 0),
                sendgrid_scope_cleanup_result.get("matched_count", 0),
            )
        else:
            logging.warning(
                "[DOMAIN-DELETE] Scoped SendGrid cleanup failed for %s: %s",
                domain_name,
                sendgrid_scope_cleanup_result.get("error") or sendgrid_scope_cleanup_result.get("errors"),
            )
    except Exception as e:
        # Log error but don't block domain deletion from database
        logging.error(f"[DOMAIN-DELETE] Error deleting from SendGrid: {e}")
    if domain.get("inbound_parse_enabled"):
        try:
            inbound_result = await domain_service.sendgrid_service.delete_inbound_parse_setting(domain_name)
            if inbound_result.get("success"):
                logging.warning(f"[DOMAIN-DELETE] Inbound Parse setting deleted for {domain_name}")
            else:
                logging.warning(f"[DOMAIN-DELETE] Inbound Parse deletion failed: {inbound_result.get('error')}")
        except Exception as e:
            logging.error(f"[DOMAIN-DELETE] Error deleting Inbound Parse for {domain_name}: {e}")
    
    # Delete stored inbound messages for this domain
    try:
        await db.inbound_messages.delete_many({"domain_id": domain_id})
    except Exception as e:
        logging.warning(f"[DOMAIN-DELETE] Could not delete inbound_messages for {domain_id}: {e}")
    
    # Delete from database
    await db.domains.delete_one({"id": domain_id})
    # Also delete subdomains
    await db.subdomains.delete_many({"domain_id": domain_id})
    
    logging.warning(f"[DOMAIN-DELETE] Domain {domain_name} deleted from database")
    
    response = {"message": "Domain deleted successfully"}
    if sendgrid_deletion_result:
        response["sendgrid"] = sendgrid_deletion_result
    if sendgrid_scope_cleanup_result is not None:
        response["sendgrid_scope_cleanup"] = sendgrid_scope_cleanup_result
    if infra_deletion_result is not None:
        response["email_infra"] = infra_deletion_result
    
    return response
