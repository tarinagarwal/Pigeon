"""Core admin CRUD, system config, and audit log routes.

These endpoints provide admin-only CRUD access to core collections in the
main application database, plus management of feature flags, system config,
and audit logs in the admin database.
"""

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any
import uuid

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from pydantic import BaseModel

from database import db, admin_db
from admin_models import AuditLog, FeatureFlag, SystemConfig
from routes.dependencies import get_current_admin, get_current_super_admin, require_admin_permissions
from routes.blogs import extract_seo_keywords
from routes import domains as domain_routes


router = APIRouter(prefix="/admin")
campaign_deliverability_service = None


def init_campaign_deliverability_service(service):
    global campaign_deliverability_service
    campaign_deliverability_service = service


def _make_json_serializable(obj: Any) -> Any:
    """Recursively convert MongoDB types (ObjectId, datetime) to JSON-serializable types."""
    if isinstance(obj, ObjectId):
        return str(obj)
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _make_json_serializable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_make_json_serializable(v) for v in obj]
    return obj


def _extract_retry_after_seconds_from_error(error_text: str) -> Optional[int]:
    """Parse retry-after seconds from rate-limit error text."""
    text = (error_text or "").lower()
    match = re.search(r"retry after:\s*(\d+)\s*seconds", text)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            return None
    match = re.search(r"try again in\s*(\d+)\s*seconds", text)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            return None
    match = re.search(r"retry after:\s*(\d+)\s*minutes", text)
    if match:
        try:
            return int(match.group(1)) * 60
        except ValueError:
            return None
    match = re.search(r"try again in\s*(\d+)\s*minutes", text)
    if match:
        try:
            return int(match.group(1)) * 60
        except ValueError:
            return None
    return None


async def _log_admin_action(
    admin: Dict[str, Any],
    action: str,
    resource_type: str,
    resource_id: Optional[str],
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    log = AuditLog(
        admin_user_id=admin["id"],
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        metadata=metadata or {},
    )
    await admin_db.audit_logs.insert_one(log.model_dump())


# ---------------------------------------------------------------------------
# Campaigns
# ---------------------------------------------------------------------------


@router.get(
    "/campaigns",
    dependencies=[Depends(require_admin_permissions(["campaign.read"]))],
)
async def admin_list_campaigns(
    user_id: Optional[str] = Query(default=None),
    skip: int = 0,
    limit: int = 100,
    current_admin: dict = Depends(get_current_admin),
):
    query: Dict[str, Any] = {}
    if user_id:
        query["user_id"] = user_id
    campaigns = (
        await db.campaigns.find(query, {"_id": 0})
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
        .to_list(None)
    )
    total = await db.campaigns.count_documents(query)
    # Populate user email for each campaign (normalize ids to string for lookup)
    user_ids = list({str(c.get("user_id")) for c in campaigns if c.get("user_id")})
    user_emails: Dict[str, str] = {}
    if user_ids:
        users = await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "email": 1}).to_list(None)
        for u in users:
            uid = u.get("id")
            if uid is not None:
                user_emails[str(uid)] = (u.get("email") or "—")
    # Campaign metrics from email_logs (sent, opened, clicked, replied, rates)
    campaign_ids = [c["id"] for c in campaigns]
    metrics_by_id: Dict[str, Dict[str, Any]] = {}
    if campaign_ids:
        pipeline = [
            {"$match": {"campaign_id": {"$in": campaign_ids}, "status": {"$ne": "pending"}}},
            {"$group": {
                "_id": "$campaign_id",
                "attempted": {"$sum": 1},
                "failed": {"$sum": {"$cond": [{"$eq": ["$status", "failed"]}, 1, 0]}},
                "opened": {"$sum": {"$cond": [{"$in": ["$status", ["opened", "clicked", "replied"]]}, 1, 0]}},
                "clicked": {"$sum": {"$cond": [{"$in": ["$status", ["clicked", "replied"]]}, 1, 0]}},
                "replied": {"$sum": {"$cond": [{"$eq": ["$status", "replied"]}, 1, 0]}},
            }},
        ]
        agg = await db.email_logs.aggregate(pipeline).to_list(None)
        for doc in agg:
            cid = doc["_id"]
            attempted = doc.get("attempted", 0) or 0
            failed = doc.get("failed", 0) or 0
            delivered = max(attempted - failed, 0)
            opened = doc.get("opened", 0) or 0
            clicked = doc.get("clicked", 0) or 0
            replied = doc.get("replied", 0) or 0
            denom = delivered
            metrics_by_id[cid] = {
                "sent": delivered,
                "opened": opened,
                "clicked": clicked,
                "replied": replied,
                "open_rate": round((opened / denom * 100), 1) if denom > 0 else 0,
                "click_rate": round((clicked / denom * 100), 1) if denom > 0 else 0,
                "reply_rate": round((replied / denom * 100), 1) if denom > 0 else 0,
            }

    cutoff_24h = datetime.now(timezone.utc) - timedelta(hours=24)
    spam24_by_campaign: Dict[str, Dict[str, Any]] = {}
    tested_providers_24h_by_campaign: Dict[str, list[str]] = {}
    latest_deliverability_by_campaign: Dict[str, Dict[str, Any]] = {}
    if campaign_ids:
        checks_24h = await db.campaign_deliverability_checks.find(
            {"campaign_id": {"$in": campaign_ids}, "checked_at": {"$gte": cutoff_24h}},
            {"_id": 0, "campaign_id": 1, "classification": 1, "root_label": 1, "receiver_provider": 1, "checked_at": 1},
        ).to_list(None)
        spam_roots_map: Dict[str, Dict[str, set[str]]] = {}
        latest_spam_at_by_campaign: Dict[str, datetime] = {}
        tested_providers_map: Dict[str, set[str]] = {}
        for chk in checks_24h:
            cid = chk.get("campaign_id")
            if not cid:
                continue
            provider = (chk.get("receiver_provider") or "").strip().lower()
            if provider:
                tested_providers_map.setdefault(cid, set()).add(provider)
            if chk.get("classification") != "spam":
                continue
            root = (chk.get("root_label") or "").strip()
            if not root:
                continue
            spam_roots_map.setdefault(cid, {}).setdefault(root, set())
            if provider:
                spam_roots_map[cid][root].add(provider)
            checked_at = chk.get("checked_at")
            if isinstance(checked_at, datetime):
                prev = latest_spam_at_by_campaign.get(cid)
                if prev is None or checked_at > prev:
                    latest_spam_at_by_campaign[cid] = checked_at

        for cid, roots in spam_roots_map.items():
            root_labels = sorted(roots.keys())
            root_provider_labels = [
                f"{root} ({', '.join(sorted(list(providers)))})" if providers else root
                for root, providers in sorted(roots.items(), key=lambda x: x[0])
            ]
            spam24_by_campaign[cid] = {
                "roots": root_labels,
                "root_provider_labels": root_provider_labels,
                "latest_spam_at": latest_spam_at_by_campaign.get(cid),
            }
        for cid, providers in tested_providers_map.items():
            tested_providers_24h_by_campaign[cid] = sorted(list(providers))

        latest_pipeline = [
            {"$match": {"campaign_id": {"$in": campaign_ids}}},
            {"$sort": {"checked_at": -1}},
            {
                "$group": {
                    "_id": "$campaign_id",
                    "last_classification": {"$first": "$classification"},
                    "last_checked_at": {"$first": "$checked_at"},
                    "last_root_label": {"$first": "$root_label"},
                    "last_receiver_provider": {"$first": "$receiver_provider"},
                }
            },
        ]
        latest_docs = await db.campaign_deliverability_checks.aggregate(latest_pipeline).to_list(None)
        for doc in latest_docs:
            latest_deliverability_by_campaign[doc["_id"]] = {
                "last_classification": doc.get("last_classification"),
                "last_checked_at": doc.get("last_checked_at"),
                "last_root_label": doc.get("last_root_label"),
                "last_receiver_provider": doc.get("last_receiver_provider"),
            }

    result = []
    for c in campaigns:
        row = dict(c)
        row["user_email"] = user_emails.get(str(c.get("user_id") or ""), "—")
        m = metrics_by_id.get(c["id"]) or {}
        row["sent"] = m.get("sent", 0)
        row["opened"] = m.get("opened", 0)
        row["clicked"] = m.get("clicked", 0)
        row["replied"] = m.get("replied", 0)
        row["open_rate"] = m.get("open_rate", 0)
        row["click_rate"] = m.get("click_rate", 0)
        row["reply_rate"] = m.get("reply_rate", 0)
        spam24 = spam24_by_campaign.get(c["id"]) or {}
        latest_deliverability = latest_deliverability_by_campaign.get(c["id"]) or {}
        spam_roots = spam24.get("roots") or []
        tested_providers_24h = tested_providers_24h_by_campaign.get(c["id"]) or []
        row["deliverability_spam_last_24h"] = bool(spam_roots)
        row["deliverability_spam_roots_last_24h"] = spam_roots
        row["deliverability_spam_root_provider_labels_last_24h"] = spam24.get("root_provider_labels") or spam_roots
        row["deliverability_tested_providers_last_24h"] = tested_providers_24h
        row["deliverability_last_spam_root"] = spam_roots[0] if spam_roots else None
        row["deliverability_last_classification"] = latest_deliverability.get("last_classification")
        row["deliverability_last_checked_at"] = latest_deliverability.get("last_checked_at")
        row["deliverability_last_root_label"] = latest_deliverability.get("last_root_label")
        row["deliverability_last_receiver_provider"] = latest_deliverability.get("last_receiver_provider")
        result.append(row)
    return {"campaigns": result, "total": total}


@router.get(
    "/campaigns/{campaign_id}",
    dependencies=[Depends(require_admin_permissions(["campaign.read"]))],
)
async def admin_get_campaign(
    campaign_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    campaign = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return campaign


@router.post(
    "/campaigns/{campaign_id}/deliverability-test",
    dependencies=[Depends(require_admin_permissions(["campaign.write"]))],
)
async def admin_trigger_campaign_deliverability_test(
    campaign_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    if campaign_deliverability_service is None:
        raise HTTPException(status_code=503, detail="Deliverability service unavailable")
    campaign = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0, "id": 1, "name": 1})
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    try:
        result = await campaign_deliverability_service.run_manual_for_campaign(campaign_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logging.exception("Manual deliverability test failed for campaign %s: %s", campaign_id, exc)
        raise HTTPException(status_code=500, detail="Failed to run deliverability test")
    await _log_admin_action(
        current_admin,
        action="trigger_campaign_deliverability_test",
        resource_type="campaign",
        resource_id=campaign_id,
        metadata={"result": result},
    )
    return {"ok": True, "campaign_id": campaign_id, "result": result}


@router.post(
    "/campaigns",
    dependencies=[Depends(require_admin_permissions(["campaign.write"]))],
)
async def admin_create_campaign(
    payload: dict,
    current_admin: dict = Depends(get_current_admin),
):
    if "id" not in payload:
        payload["id"] = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    payload.setdefault("created_at", now)
    payload.setdefault("updated_at", now)
    await db.campaigns.insert_one(payload)
    payload.pop("_id", None)
    await _log_admin_action(
        current_admin,
        action="create_campaign",
        resource_type="campaign",
        resource_id=payload["id"],
        metadata={"payload": payload},
    )
    return payload


@router.put(
    "/campaigns/{campaign_id}",
    dependencies=[Depends(require_admin_permissions(["campaign.write"]))],
)
async def admin_update_campaign(
    campaign_id: str,
    payload: dict,
    current_admin: dict = Depends(get_current_admin),
):
    payload["updated_at"] = datetime.now(timezone.utc)
    result = await db.campaigns.update_one(
        {"id": campaign_id},
        {"$set": payload},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Campaign not found")
    updated = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
    await _log_admin_action(
        current_admin,
        action="update_campaign",
        resource_type="campaign",
        resource_id=campaign_id,
        metadata={"changes": payload},
    )
    return updated


@router.delete(
    "/campaigns/{campaign_id}",
    dependencies=[Depends(require_admin_permissions(["campaign.write"]))],
)
async def admin_delete_campaign(
    campaign_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    result = await db.campaigns.delete_one({"id": campaign_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Campaign not found")
    await _log_admin_action(
        current_admin,
        action="delete_campaign",
        resource_type="campaign",
        resource_id=campaign_id,
    )
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Contacts
# ---------------------------------------------------------------------------


@router.get(
    "/contacts",
    dependencies=[Depends(require_admin_permissions(["contact.read"]))],
)
async def admin_list_contacts(
    user_id: Optional[str] = Query(default=None),
    skip: int = 0,
    limit: int = 100,
    current_admin: dict = Depends(get_current_admin),
):
    query: Dict[str, Any] = {}
    if user_id:
        query["user_id"] = user_id
    contacts = await db.contacts.find(query, {"_id": 0}).skip(skip).limit(limit).to_list(None)
    total = await db.contacts.count_documents(query)
    return {"contacts": contacts, "total": total}


@router.get(
    "/contacts/{contact_id}",
    dependencies=[Depends(require_admin_permissions(["contact.read"]))],
)
async def admin_get_contact(
    contact_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    contact = await db.contacts.find_one({"id": contact_id}, {"_id": 0})
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact


@router.post(
    "/contacts",
    dependencies=[Depends(require_admin_permissions(["contact.write"]))],
)
async def admin_create_contact(
    payload: dict,
    current_admin: dict = Depends(get_current_admin),
):
    if "id" not in payload:
        payload["id"] = str(uuid.uuid4())
    payload.setdefault("created_at", datetime.now(timezone.utc))
    await db.contacts.insert_one(payload)
    payload.pop("_id", None)
    await _log_admin_action(
        current_admin,
        action="create_contact",
        resource_type="contact",
        resource_id=payload["id"],
        metadata={"payload": payload},
    )
    return payload


@router.put(
    "/contacts/{contact_id}",
    dependencies=[Depends(require_admin_permissions(["contact.write"]))],
)
async def admin_update_contact(
    contact_id: str,
    payload: dict,
    current_admin: dict = Depends(get_current_admin),
):
    payload["updated_at"] = datetime.now(timezone.utc)
    result = await db.contacts.update_one(
        {"id": contact_id},
        {"$set": payload},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Contact not found")
    updated = await db.contacts.find_one({"id": contact_id}, {"_id": 0})
    await _log_admin_action(
        current_admin,
        action="update_contact",
        resource_type="contact",
        resource_id=contact_id,
        metadata={"changes": payload},
    )
    return updated


@router.delete(
    "/contacts/{contact_id}",
    dependencies=[Depends(require_admin_permissions(["contact.write"]))],
)
async def admin_delete_contact(
    contact_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    result = await db.contacts.delete_one({"id": contact_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Contact not found")
    await _log_admin_action(
        current_admin,
        action="delete_contact",
        resource_type="contact",
        resource_id=contact_id,
    )
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Contact form submissions (website)
# ---------------------------------------------------------------------------

_CONTACT_SUBMISSION_ACTIVE_QUERY: Dict[str, Any] = {
    "$or": [{"archived": {"$ne": True}}, {"archived": {"$exists": False}}]
}


class ContactSubmissionPatchRequest(BaseModel):
    archived: bool


class BulkDeleteContactSubmissionsRequest(BaseModel):
    submission_ids: list[str]


@router.get(
    "/contact-submissions",
    dependencies=[Depends(require_admin_permissions(["contact.read"]))],
)
async def admin_list_contact_submissions(
    skip: int = 0,
    limit: int = 100,
    show_archived: bool = Query(
        False,
        description="When true, list includes archived submissions; when false, only active.",
    ),
    current_admin: dict = Depends(get_current_admin),
):
    query: Dict[str, Any] = {} if show_archived else _CONTACT_SUBMISSION_ACTIVE_QUERY
    cursor = (
        db.contact_submissions.find(query, {"_id": 0})
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    )
    submissions = await cursor.to_list(None)
    total_matching = await db.contact_submissions.count_documents(query)
    total_active = await db.contact_submissions.count_documents(_CONTACT_SUBMISSION_ACTIVE_QUERY)
    total_archived = await db.contact_submissions.count_documents({"archived": True})
    return {
        "submissions": [_make_json_serializable(s) for s in submissions],
        "total": total_matching,
        "total_active": total_active,
        "total_archived": total_archived,
    }


@router.post(
    "/contact-submissions/bulk-delete",
    dependencies=[Depends(require_admin_permissions(["contact.write"]))],
)
async def admin_bulk_delete_contact_submissions(
    payload: BulkDeleteContactSubmissionsRequest,
    current_admin: dict = Depends(get_current_admin),
):
    submission_ids = [
        sid.strip() for sid in payload.submission_ids if sid and sid.strip()
    ]
    if not submission_ids:
        raise HTTPException(status_code=400, detail="No submission IDs provided")

    result = await db.contact_submissions.delete_many({"id": {"$in": submission_ids}})

    for submission_id in submission_ids:
        await _log_admin_action(
            current_admin,
            action="delete_contact_submission",
            resource_type="contact_submission",
            resource_id=submission_id,
        )

    return {"deleted": result.deleted_count, "requested": len(submission_ids)}


@router.get(
    "/contact-submissions/{submission_id}",
    dependencies=[Depends(require_admin_permissions(["contact.read"]))],
)
async def admin_get_contact_submission(
    submission_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    submission = await db.contact_submissions.find_one(
        {"id": submission_id}, {"_id": 0}
    )
    if not submission:
        raise HTTPException(status_code=404, detail="Contact submission not found")
    return _make_json_serializable(submission)


@router.patch(
    "/contact-submissions/{submission_id}",
    dependencies=[Depends(require_admin_permissions(["contact.write"]))],
)
async def admin_patch_contact_submission(
    submission_id: str,
    body: ContactSubmissionPatchRequest,
    current_admin: dict = Depends(get_current_admin),
):
    result = await db.contact_submissions.update_one(
        {"id": submission_id},
        {"$set": {"archived": body.archived}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Contact submission not found")
    await _log_admin_action(
        current_admin,
        action="archive_contact_submission" if body.archived else "unarchive_contact_submission",
        resource_type="contact_submission",
        resource_id=submission_id,
    )
    submission = await db.contact_submissions.find_one(
        {"id": submission_id}, {"_id": 0}
    )
    return _make_json_serializable(submission)


@router.delete(
    "/contact-submissions/{submission_id}",
    dependencies=[Depends(require_admin_permissions(["contact.write"]))],
)
async def admin_delete_contact_submission(
    submission_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    result = await db.contact_submissions.delete_one({"id": submission_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Contact submission not found")
    await _log_admin_action(
        current_admin,
        action="delete_contact_submission",
        resource_type="contact_submission",
        resource_id=submission_id,
    )
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Domains
# ---------------------------------------------------------------------------


@router.get(
    "/domains",
    dependencies=[Depends(require_admin_permissions(["domain.read"]))],
)
async def admin_list_domains(
    user_id: Optional[str] = Query(default=None),
    skip: int = 0,
    limit: int = 100,
    current_admin: dict = Depends(get_current_admin),
):
    query: Dict[str, Any] = {}
    if user_id:
        query["user_id"] = user_id
    domains = await db.domains.find(query, {"_id": 0, "dkim_private_key": 0}).skip(skip).limit(limit).to_list(None)
    total = await db.domains.count_documents(query)
    return {"domains": domains, "total": total}


@router.get(
    "/domains/{domain_id}",
    dependencies=[Depends(require_admin_permissions(["domain.read"]))],
)
async def admin_get_domain(
    domain_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    domain = await db.domains.find_one(
        {"id": domain_id},
        {"_id": 0, "dkim_private_key": 0},
    )
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    return domain


@router.put(
    "/domains/{domain_id}",
    dependencies=[Depends(require_admin_permissions(["domain.write"]))],
)
async def admin_update_domain(
    domain_id: str,
    payload: dict,
    current_admin: dict = Depends(get_current_admin),
):
    payload["updated_at"] = datetime.now(timezone.utc)
    result = await db.domains.update_one(
        {"id": domain_id},
        {"$set": payload},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Domain not found")
    updated = await db.domains.find_one(
        {"id": domain_id},
        {"_id": 0, "dkim_private_key": 0},
    )
    await _log_admin_action(
        current_admin,
        action="update_domain",
        resource_type="domain",
        resource_id=domain_id,
        metadata={"changes": payload},
    )
    return updated


@router.delete(
    "/domains/{domain_id}",
    dependencies=[Depends(require_admin_permissions(["domain.write"]))],
)
async def admin_delete_domain(
    domain_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    result = await db.domains.delete_one({"id": domain_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Domain not found")
    await _log_admin_action(
        current_admin,
        action="delete_domain",
        resource_type="domain",
        resource_id=domain_id,
    )
    return {"deleted": True}


@router.post(
    "/domains/{domain_id}/verify",
    dependencies=[Depends(require_admin_permissions(["domain.write"]))],
)
async def admin_verify_domain(
    domain_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    """
    Admin verify for a specific DB domain row.
    Uses SendGrid in read-only mode through existing verification flow.
    """
    domain = await db.domains.find_one({"id": domain_id}, {"_id": 0})
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    if domain_routes.domain_service is None:
        raise HTTPException(status_code=503, detail="Domain service not initialized")

    try:
        verification_results = await domain_routes.domain_service.verify_dns_records(domain_id)
        health_score = await domain_routes.domain_service.calculate_health_score(domain_id)
        updated = await db.domains.find_one({"id": domain_id}, {"_id": 0, "dkim_private_key": 0})
    except Exception as exc:
        logging.error("Admin verify failed for domain %s: %s", domain_id, exc)
        raise HTTPException(status_code=400, detail=str(exc))

    await _log_admin_action(
        current_admin,
        action="verify_domain",
        resource_type="domain",
        resource_id=domain_id,
        metadata={"domain": domain.get("domain")},
    )
    return {
        "verification_results": verification_results,
        "health_score": health_score,
        "domain": updated,
    }


@router.post(
    "/domains/{domain_id}/sync-to-provider",
    dependencies=[Depends(require_admin_permissions(["domain.write"]))],
)
async def admin_sync_domain_to_provider(
    domain_id: str,
    payload: dict = Body(default_factory=dict),
    current_admin: dict = Depends(get_current_admin),
):
    """
    Admin provider sync.
    Creates SendGrid auth only when missing, otherwise reuses existing auth;
    always persists provider metadata for the DB row.
    """
    domain = await db.domains.find_one({"id": domain_id}, {"_id": 0})
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    if domain_routes.domain_service is None:
        raise HTTPException(status_code=503, detail="Domain service not initialized")

    domain_name = (domain.get("domain") or "").strip().lower().rstrip(".")
    if not domain_name:
        raise HTTPException(status_code=400, detail="Invalid domain row: missing domain name")

    requested_sendgrid_domain = (payload.get("sendgrid_domain") or "").strip().lower().rstrip(".")
    user_id = domain.get("user_id")
    user_sendgrid_label = ""
    if user_id:
        user_doc = await db.users.find_one({"id": user_id}, {"_id": 0, "sendgrid_domain_label": 1})
        user_sendgrid_label = (
            (user_doc or {}).get("sendgrid_domain_label") or ""
        ).strip().lower().rstrip(".")

    # Priority: explicit admin override > stored user label > previous provider sync > root domain.
    requested_or_user_domain = requested_sendgrid_domain or user_sendgrid_label
    resolved_requested_or_user_domain = ""

    if requested_or_user_domain:
        # Support short SendGrid labels (e.g. "em4148"), while keeping DB domain unchanged.
        # If no dot is present, treat as one-label subdomain under the current DB domain.
        if "." not in requested_or_user_domain:
            if not re.match(r"^[a-z0-9-]+$", requested_or_user_domain):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Invalid sendgrid_domain label '{requested_or_user_domain}'. "
                        "Use letters, numbers, and hyphens only."
                    ),
                )
            resolved_requested_or_user_domain = f"{requested_or_user_domain}.{domain_name}"
        else:
            resolved_requested_or_user_domain = requested_or_user_domain

        # Safety: allow only exact domain or subdomain of this DB domain.
        if not (
            resolved_requested_or_user_domain == domain_name
            or resolved_requested_or_user_domain.endswith(f".{domain_name}")
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid sendgrid_domain '{requested_or_user_domain}'. "
                    f"It must resolve to '{domain_name}' or a subdomain of it."
                ),
            )

    provider_sync_meta = domain.get("provider_sync") or {}
    preferred_lookup_domain = (provider_sync_meta.get("matched_domain") or "").strip().lower().rstrip(".")
    preferred_lookup_domain_candidate = ""
    if preferred_lookup_domain and (
        preferred_lookup_domain == domain_name
        or preferred_lookup_domain.endswith(f".{domain_name}")
    ):
        prefix = preferred_lookup_domain[: -(len(domain_name) + 1)]
        if preferred_lookup_domain == domain_name or ("." not in prefix and bool(prefix)):
            preferred_lookup_domain_candidate = preferred_lookup_domain

    effective_lookup_domain = (
        resolved_requested_or_user_domain
        or preferred_lookup_domain_candidate
        or domain_name
    )
    auto_created_user_label = False
    if not requested_sendgrid_domain and not user_sendgrid_label and effective_lookup_domain == domain_name:
        generated_label = f"em{uuid.uuid4().hex[:8]}"
        effective_lookup_domain = f"{generated_label}.{domain_name}"
        user_sendgrid_label = generated_label
        auto_created_user_label = True

    sendgrid_records = await domain_routes.domain_service.sendgrid_service.get_dns_records_for_domain(
        effective_lookup_domain,
        # Admin sync should create records when missing for the resolved lookup domain.
        allow_create=True,
    )
    print(
        "[admin sync-to-provider] SendGrid get_dns_records_for_domain\n"
        f"domain_id={domain_id}\n"
        f"effective_lookup_domain={effective_lookup_domain}\n"
        + json.dumps(_make_json_serializable(sendgrid_records), indent=2, default=str),
        flush=True,
    )
    if sendgrid_records.get("error"):
        error_text = str(sendgrid_records.get("error") or "")
        if "rate limit" in error_text.lower() or "429" in error_text:
            retry_after = _extract_retry_after_seconds_from_error(error_text)
            if retry_after is not None:
                raise HTTPException(
                    status_code=429,
                    detail=f"Rate limit reached. Please retry after {retry_after} seconds.",
                )
            raise HTTPException(
                status_code=429,
                detail="Rate limit reached. Please retry later.",
            )
        raise HTTPException(status_code=400, detail=error_text)

    sendgrid_info = sendgrid_records.get("sendgrid_info", {})
    previous_sync = domain.get("provider_sync") or {}
    now = datetime.now(timezone.utc)
    next_sync = {
        "provider": "sendgrid",
        "domain_id": sendgrid_info.get("domain_id"),
        "verified": bool(sendgrid_info.get("verified", False)),
        "matched_domain": sendgrid_info.get("matched_domain") or effective_lookup_domain,
        "synced_at": now,
    }
    no_effective_change = (
        previous_sync.get("provider") == next_sync["provider"]
        and previous_sync.get("domain_id") == next_sync["domain_id"]
        and bool(previous_sync.get("verified")) == next_sync["verified"]
    )

    matched_domain = (next_sync.get("matched_domain") or "").strip().lower().rstrip(".")
    derived_label = ""
    if matched_domain.endswith(f".{domain_name}"):
        prefix = matched_domain[: -(len(domain_name) + 1)]
        if prefix and "." not in prefix:
            derived_label = prefix
    if user_id and derived_label:
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"sendgrid_domain_label": derived_label, "updated_at": now}},
        )

    # Keep canonical DB domain unchanged; only provider lookup target may differ.
    domain_for_dns_records = {**domain, "domain": domain_name}

    refreshed_dns_records = domain_routes._build_domain_dns_records_payload(
        domain_for_dns_records,
        provider_records=sendgrid_records,
        provider="sendgrid",
    )

    await db.domains.update_one(
        {"id": domain_id},
        {
            "$set": {
                "provider_sync": next_sync,
                "dns_records": refreshed_dns_records,
                "updated_at": now,
            }
        },
    )

    await _log_admin_action(
        current_admin,
        action="sync_domain_to_provider",
        resource_type="domain",
        resource_id=domain_id,
        metadata={
            "domain_before": domain_name,
            "domain_after": domain_name,
            "domain_changed": False,
            "sync_lookup_domain": effective_lookup_domain,
            "sendgrid_domain_label": derived_label or user_sendgrid_label or None,
            "auto_created_user_label": auto_created_user_label,
            "no_changes": no_effective_change,
        },
    )
    return {
        "message": (
            "Domain provider sync already up to date."
            if no_effective_change
            else "Domain successfully synced."
        ),
        "provider": "sendgrid",
        "verified": next_sync["verified"],
        "matched_sendgrid_domain": next_sync["matched_domain"],
        "sendgrid_domain_label": derived_label or user_sendgrid_label or None,
        "stored_domain": domain_name,
        "records_count": (
            len(sendgrid_records.get("cname_records", []))
            + len(sendgrid_records.get("txt_records", []))
            + len(sendgrid_records.get("mx_records", []))
        ),
        "no_changes": no_effective_change,
    }


# ---------------------------------------------------------------------------
# Inboxes
# ---------------------------------------------------------------------------


@router.get(
    "/inboxes",
    dependencies=[Depends(require_admin_permissions(["inbox.read"]))],
)
async def admin_list_inboxes(
    user_id: Optional[str] = Query(default=None),
    skip: int = 0,
    limit: int = 100,
    current_admin: dict = Depends(get_current_admin),
):
    query: Dict[str, Any] = {}
    if user_id:
        query["user_id"] = user_id
    inboxes = await db.inboxes.find(
        query,
        {"_id": 0, "smtp_password": 0},
    ).skip(skip).limit(limit).to_list(None)
    total = await db.inboxes.count_documents(query)
    return {"inboxes": inboxes, "total": total}


@router.get(
    "/inboxes/{inbox_id}",
    dependencies=[Depends(require_admin_permissions(["inbox.read"]))],
)
async def admin_get_inbox(
    inbox_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    inbox = await db.inboxes.find_one(
        {"id": inbox_id},
        {"_id": 0, "smtp_password": 0},
    )
    if not inbox:
        raise HTTPException(status_code=404, detail="Inbox not found")
    return inbox


@router.put(
    "/inboxes/{inbox_id}",
    dependencies=[Depends(require_admin_permissions(["inbox.write"]))],
)
async def admin_update_inbox(
    inbox_id: str,
    payload: dict,
    current_admin: dict = Depends(get_current_admin),
):
    payload["updated_at"] = datetime.now(timezone.utc)
    result = await db.inboxes.update_one(
        {"id": inbox_id},
        {"$set": payload},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Inbox not found")
    updated = await db.inboxes.find_one(
        {"id": inbox_id},
        {"_id": 0, "smtp_password": 0},
    )
    await _log_admin_action(
        current_admin,
        action="update_inbox",
        resource_type="inbox",
        resource_id=inbox_id,
        metadata={"changes": payload},
    )
    return updated


@router.delete(
    "/inboxes/{inbox_id}",
    dependencies=[Depends(require_admin_permissions(["inbox.write"]))],
)
async def admin_delete_inbox(
    inbox_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    result = await db.inboxes.delete_one({"id": inbox_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Inbox not found")
    await _log_admin_action(
        current_admin,
        action="delete_inbox",
        resource_type="inbox",
        resource_id=inbox_id,
    )
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------


@router.get(
    "/templates",
    dependencies=[Depends(require_admin_permissions(["template.read"]))],
)
async def admin_list_templates(
    user_id: Optional[str] = Query(default=None),
    skip: int = 0,
    limit: int = 100,
    current_admin: dict = Depends(get_current_admin),
):
    query: Dict[str, Any] = {}
    if user_id:
        query["user_id"] = user_id
    templates = await db.templates.find(query, {"_id": 0}).skip(skip).limit(limit).to_list(None)
    total = await db.templates.count_documents(query)
    return {"templates": templates, "total": total}


@router.get(
    "/templates/{template_id}",
    dependencies=[Depends(require_admin_permissions(["template.read"]))],
)
async def admin_get_template(
    template_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    template = await db.templates.find_one({"id": template_id}, {"_id": 0})
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.post(
    "/templates",
    dependencies=[Depends(require_admin_permissions(["template.write"]))],
)
async def admin_create_template(
    payload: dict,
    current_admin: dict = Depends(get_current_admin),
):
    if "id" not in payload:
        payload["id"] = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    payload.setdefault("created_at", now)
    payload.setdefault("updated_at", now)
    await db.templates.insert_one(payload)
    payload.pop("_id", None)
    await _log_admin_action(
        current_admin,
        action="create_template",
        resource_type="template",
        resource_id=payload["id"],
        metadata={"payload": payload},
    )
    return payload


@router.put(
    "/templates/{template_id}",
    dependencies=[Depends(require_admin_permissions(["template.write"]))],
)
async def admin_update_template(
    template_id: str,
    payload: dict,
    current_admin: dict = Depends(get_current_admin),
):
    payload["updated_at"] = datetime.now(timezone.utc)
    result = await db.templates.update_one(
        {"id": template_id},
        {"$set": payload},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    updated = await db.templates.find_one({"id": template_id}, {"_id": 0})
    await _log_admin_action(
        current_admin,
        action="update_template",
        resource_type="template",
        resource_id=template_id,
        metadata={"changes": payload},
    )
    return updated


@router.delete(
    "/templates/{template_id}",
    dependencies=[Depends(require_admin_permissions(["template.write"]))],
)
async def admin_delete_template(
    template_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    used = await db.campaigns.count_documents({"template_ids": template_id})
    if used > 0:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete template: it is used by one or more campaigns.",
        )
    result = await db.templates.delete_one({"id": template_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    await _log_admin_action(
        current_admin,
        action="delete_template",
        resource_type="template",
        resource_id=template_id,
    )
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Blogs (admin_db.blogs)
# ---------------------------------------------------------------------------


@router.get(
    "/blogs",
    dependencies=[Depends(require_admin_permissions(["blog.read"]))],
)
async def admin_list_blogs(
    status: Optional[str] = Query(default=None),
    skip: int = 0,
    limit: int = 100,
    current_admin: dict = Depends(get_current_admin),
):
    query: Dict[str, Any] = {}
    if status:
        query["status"] = status
    cursor = admin_db.blogs.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit)
    blogs = await cursor.to_list(None)
    total = await admin_db.blogs.count_documents(query)
    return {"blogs": blogs, "total": total}


@router.get(
    "/blogs/{blog_id}",
    dependencies=[Depends(require_admin_permissions(["blog.read"]))],
)
async def admin_get_blog(
    blog_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    blog = await admin_db.blogs.find_one({"id": blog_id}, {"_id": 0})
    if not blog:
        raise HTTPException(status_code=404, detail="Blog not found")
    return blog


@router.post(
    "/blogs",
    dependencies=[Depends(require_admin_permissions(["blog.write"]))],
)
async def admin_create_blog(
    payload: dict,
    current_admin: dict = Depends(get_current_admin),
):
    """Create a single blog document in admin_db.blogs."""
    if "id" not in payload:
        payload["id"] = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    payload.setdefault("created_at", now)
    payload.setdefault("updated_at", now)
    if payload.get("status") == "published" and not payload.get("published_at"):
        payload["published_at"] = now
    if not payload.get("slug") and payload.get("title"):
        payload["slug"] = _slugify(payload["title"])
    # Auto-generate SEO keywords from title, excerpt, content (tokenization)
    kw_list = extract_seo_keywords(
        payload.get("title"),
        payload.get("excerpt"),
        payload.get("content"),
    )
    payload["keywords"] = ", ".join(kw_list) if kw_list else ""
    payload["tags"] = _normalize_tags(payload.get("tags"))
    existing = await admin_db.blogs.find_one({"slug": payload["slug"]})
    if existing:
        raise HTTPException(status_code=400, detail=f"Blog with slug '{payload['slug']}' already exists")
    await admin_db.blogs.insert_one(payload)
    payload.pop("_id", None)
    await _log_admin_action(
        current_admin,
        action="create_blog",
        resource_type="blog",
        resource_id=payload["id"],
        metadata={"title": payload.get("title")},
    )
    return payload


@router.put(
    "/blogs/{blog_id}",
    dependencies=[Depends(require_admin_permissions(["blog.write"]))],
)
async def admin_update_blog(
    blog_id: str,
    payload: dict,
    current_admin: dict = Depends(get_current_admin),
):
    now = datetime.now(timezone.utc)
    payload["updated_at"] = now
    # Re-generate SEO keywords when title, excerpt, or content change
    existing_blog = await admin_db.blogs.find_one(
        {"id": blog_id},
        {"title": 1, "excerpt": 1, "content": 1, "published_at": 1},
    )
    if existing_blog and any(k in payload for k in ("title", "excerpt", "content")):
        t = {**existing_blog, **payload}
        kw_list = extract_seo_keywords(t.get("title"), t.get("excerpt"), t.get("content"))
        payload["keywords"] = ", ".join(kw_list) if kw_list else ""
    if "tags" in payload:
        payload["tags"] = _normalize_tags(payload.get("tags"))
    if payload.get("status") == "published" and not payload.get("published_at"):
        if existing_blog and not existing_blog.get("published_at"):
            payload["published_at"] = now
    if "slug" in payload:
        existing = await admin_db.blogs.find_one({"slug": payload["slug"], "id": {"$ne": blog_id}})
        if existing:
            raise HTTPException(status_code=400, detail=f"Blog with slug '{payload['slug']}' already exists")
    result = await admin_db.blogs.update_one(
        {"id": blog_id},
        {"$set": payload},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Blog not found")
    updated = await admin_db.blogs.find_one({"id": blog_id}, {"_id": 0})
    await _log_admin_action(
        current_admin,
        action="update_blog",
        resource_type="blog",
        resource_id=blog_id,
        metadata={"changes": list(payload.keys())},
    )
    return updated


# Max concurrent workers for bulk blog creation
BULK_BLOG_MAX_WORKERS = 10


def _build_blog_doc_for_bulk(item: dict, slug: str, now: datetime) -> dict:
    """Build a single blog document for bulk insert. Caller must ensure slug is unique."""
    title = (item.get("title") or "").strip()
    content = item.get("content") or ""
    excerpt = item.get("excerpt") or ""
    kw_list = extract_seo_keywords(title, excerpt, content)
    blog_doc: dict = {
        "id": item.get("id") or str(uuid.uuid4()),
        "title": title,
        "slug": slug,
        "content": content,
        "excerpt": excerpt,
        "author": item.get("author") or "",
        "featured_image_url": item.get("featured_image_url") or "",
        "tags": _normalize_tags(item.get("tags")),
        "status": item.get("status") if item.get("status") in ("draft", "published") else "draft",
        "keywords": ", ".join(kw_list) if kw_list else "",
        "created_at": item.get("created_at") or now,
        "updated_at": now,
    }
    published_at = item.get("published_at")
    if blog_doc["status"] == "published":
        if published_at:
            try:
                if hasattr(published_at, "isoformat"):
                    blog_doc["published_at"] = published_at
                else:
                    from datetime import datetime as _dt
                    parsed = _dt.fromisoformat(str(published_at))
                    blog_doc["published_at"] = parsed
            except Exception:
                blog_doc["published_at"] = now
        else:
            blog_doc["published_at"] = now
    return blog_doc


@router.post(
    "/blogs/bulk",
    dependencies=[Depends(require_admin_permissions(["blog.write"]))],
)
async def admin_bulk_create_blogs(
    payload: list[dict],
    current_admin: dict = Depends(get_current_admin),
):
    """
    Bulk create blogs in admin_db.blogs using multiple async workers.

    Accepts a JSON array of blog objects. Items are validated, then processed
    in parallel (up to BULK_BLOG_MAX_WORKERS at a time). Returns created blogs
    and per-item errors.
    """
    if not isinstance(payload, list) or not payload:
        raise HTTPException(status_code=400, detail="Request body must be a non-empty JSON array of blog objects")

    created: list[dict] = []
    errors: list[dict] = []
    now = datetime.now(timezone.utc)
    seen_slugs: set[str] = set()

    # 1) Normalize and validate; collect (idx, item, slug) for valid items; collect validation errors
    to_process: list[tuple[int, dict, str]] = []
    for idx, raw_item in enumerate(payload):
        item = dict(raw_item or {})
        title = (item.get("title") or "").strip()
        if not title:
            errors.append({"index": idx, "title": None, "slug": item.get("slug"), "detail": "title is required"})
            continue
        slug = (item.get("slug") or "").strip() or _slugify(title)
        if slug in seen_slugs:
            errors.append({"index": idx, "title": title, "slug": slug, "detail": f"Duplicate slug '{slug}' in bulk payload"})
            continue
        seen_slugs.add(slug)
        to_process.append((idx, item, slug))

    if not to_process:
        return {"created": [], "created_count": 0, "errors": errors, "error_count": len(errors)}

    # 2) Single query: which of these slugs already exist in DB?
    slugs_to_check = [s for _, _, s in to_process]
    cursor = admin_db.blogs.find({"slug": {"$in": slugs_to_check}}, {"slug": 1})
    existing_slugs_set: set[str] = {doc["slug"] async for doc in cursor}

    # 3) Filter out items whose slug already exists; add to errors
    still_to_process: list[tuple[int, dict, str]] = []
    for idx, item, slug in to_process:
        if slug in existing_slugs_set:
            errors.append({"index": idx, "title": item.get("title"), "slug": slug, "detail": f"Blog with slug '{slug}' already exists"})
        else:
            still_to_process.append((idx, item, slug))
    if not still_to_process:
        return {
            "created": [],
            "created_count": 0,
            "errors": errors,
            "error_count": len(errors),
        }

    # 4) Build blog documents for remaining items and insert them in a single bulk operation
    blog_docs: list[dict] = []
    index_by_slug: dict[str, int] = {}
    for idx, item, slug in still_to_process:
        doc = _build_blog_doc_for_bulk(item, slug, now)
        blog_docs.append(doc)
        index_by_slug[slug] = idx

    try:
        result = await admin_db.blogs.insert_many(blog_docs, ordered=False)
        inserted_ids = set(result.inserted_ids)
    except Exception as exc:
        errors.append({"index": -1, "title": None, "slug": None, "detail": str(exc)})
        return {
            "created": [],
            "created_count": 0,
            "errors": errors,
            "error_count": len(errors),
        }

    # Drop _id from successfully inserted docs and log admin actions
    for doc in blog_docs:
        if doc.get("_id") not in inserted_ids:
            # Skip documents that failed to insert, if any
            continue
        doc.pop("_id", None)
        await _log_admin_action(
            current_admin,
            action="create_blog",
            resource_type="blog",
            resource_id=doc["id"],
            metadata={"title": doc.get("title"), "bulk": True},
        )
        created.append(doc)

    # Sort created by original payload index for consistent ordering
    created.sort(key=lambda d: index_by_slug.get(d.get("slug", ""), 0))

    return {
        "created": created,
        "created_count": len(created),
        "errors": errors,
        "error_count": len(errors),
    }


@router.delete(
    "/blogs/{blog_id}",
    dependencies=[Depends(require_admin_permissions(["blog.write"]))],
)
async def admin_delete_blog(
    blog_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    result = await admin_db.blogs.delete_one({"id": blog_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Blog not found")
    await _log_admin_action(
        current_admin,
        action="delete_blog",
        resource_type="blog",
        resource_id=blog_id,
    )
    return {"deleted": True}


def _slugify(text: str) -> str:
    """Simple slug from title: lowercase, replace spaces with hyphens, strip non-alnum."""
    import re
    s = text.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[-\s]+", "-", s)
    return s.strip("-") or "blog"


def _normalize_tags(tags: Any) -> list[str]:
    """Accept tags as list of strings or comma-separated string; return list of non-empty trimmed strings."""
    if tags is None:
        return []
    if isinstance(tags, str):
        return [t.strip() for t in tags.split(",") if t.strip()]
    if isinstance(tags, list):
        out = []
        for x in tags:
            if isinstance(x, str) and x.strip():
                out.append(x.strip())
        return out
    return []


# ---------------------------------------------------------------------------
# Email logs & alerts (read-focused)
# ---------------------------------------------------------------------------


@router.get(
    "/emails/logs",
    dependencies=[Depends(require_admin_permissions(["email.read"]))],
)
async def admin_list_email_logs(
    user_id: Optional[str] = Query(default=None),
    campaign_id: Optional[str] = Query(default=None),
    skip: int = 0,
    limit: int = 100,
    current_admin: dict = Depends(get_current_admin),
):
    query: Dict[str, Any] = {}
    if user_id:
        query["user_id"] = user_id
    if campaign_id:
        query["campaign_id"] = campaign_id
    logs = await db.email_logs.find(query, {"_id": 0}).sort("sent_at", -1).skip(skip).limit(limit).to_list(None)
    total = await db.email_logs.count_documents(query)
    return {"email_logs": logs, "total": total}


@router.get(
    "/emails/ip-stats",
    dependencies=[Depends(require_admin_permissions(["email.read"]))],
)
async def admin_email_ip_stats(
    limit: int = 100,
    current_admin: dict = Depends(get_current_admin),
):
    """
    Aggregate Email Infra sending IPs with sent / opened / replied counts.
    Only includes logs where sender_type='smtp', provider='email_infra', and email_infra_ip is set.
    """
    pipeline = [
        {
            "$match": {
                "sender_type": "smtp",
                "status": {"$ne": "pending"},
                "email_infra_ip": {"$exists": True, "$ne": None, "$ne": ""},
            }
        },
        {
            "$group": {
                "_id": "$email_infra_ip",
                "sent": {"$sum": 1},
                "opened": {
                    "$sum": {
                        "$cond": [
                            {"$in": ["$status", ["opened", "clicked", "replied"]]},
                            1,
                            0,
                        ]
                    }
                },
                "replied": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$status", "replied"]},
                            1,
                            0,
                        ]
                    }
                },
            }
        },
        {"$sort": {"sent": -1}},
        {"$limit": limit},
    ]
    docs = await db.email_logs.aggregate(pipeline).to_list(None)
    ips = [
        {
            "ip": d.get("_id"),
            "sent": d.get("sent", 0) or 0,
            "opened": d.get("opened", 0) or 0,
            "replied": d.get("replied", 0) or 0,
        }
        for d in docs
    ]
    return {"ips": ips, "total": len(ips)}


@router.get(
    "/alerts",
    dependencies=[Depends(require_admin_permissions(["alert.read"]))],
)
async def admin_list_alerts(
    user_id: Optional[str] = Query(default=None),
    skip: int = 0,
    limit: int = 100,
    current_admin: dict = Depends(get_current_admin),
):
    query: Dict[str, Any] = {}
    if user_id:
        query["user_id"] = user_id
    alerts = await db.alerts.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit).to_list(None)
    total = await db.alerts.count_documents(query)
    return {"alerts": alerts, "total": total}


@router.post(
    "/alerts",
    dependencies=[Depends(require_admin_permissions(["alert.write"]))],
)
async def admin_create_alert(
    payload: dict,
    current_admin: dict = Depends(get_current_admin),
):
    """Create a custom alert for a user or all users"""
    import uuid
    from datetime import datetime, timezone
    
    # Extract data from payload
    alert_type = payload.get("type")
    title = payload.get("title")
    message = payload.get("message")
    user_id = payload.get("user_id")
    send_to_all = payload.get("send_to_all", False)
    actionable = payload.get("actionable", False)
    action_link = payload.get("action_link")
    
    # Validate required fields
    if not alert_type or not title or not message:
        raise HTTPException(status_code=400, detail="type, title, and message are required")

    if send_to_all:
        # Send alert to all users
        users = await db.users.find({}, {"_id": 0, "id": 1}).to_list(None)
        user_ids = [user["id"] for user in users]

        if not user_ids:
            raise HTTPException(status_code=400, detail="No users found")

        now = datetime.now(timezone.utc)
        alert_docs: list[dict] = []
        for uid in user_ids:
            doc = {
                "id": str(uuid.uuid4()),
                "user_id": uid,
                "type": alert_type,
                "title": title,
                "message": message,
                "time": now,
                "is_read": False,
                "actionable": actionable,
                "created_at": now,
            }
            if action_link:
                doc["action_link"] = action_link
            alert_docs.append(doc)

        if not alert_docs:
            raise HTTPException(status_code=400, detail="No users found")

        result = await db.alerts.insert_many(alert_docs)
        inserted_count = len(result.inserted_ids)

        await _log_admin_action(
            current_admin,
            action="create_alert_broadcast",
            resource_type="alert",
            resource_id="broadcast",
            metadata={"title": title, "user_count": len(user_ids)},
        )

        return {
            "alerts_created": inserted_count,
            "message": f"Alert sent to {inserted_count} users",
        }
    else:
        # Send alert to specific user
        if not user_id:
            raise HTTPException(status_code=400, detail="user_id is required when send_to_all is False")
        
        alert_data = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "type": alert_type,
            "title": title,
            "message": message,
            "time": datetime.now(timezone.utc),
            "is_read": False,
            "actionable": actionable,
            "created_at": datetime.now(timezone.utc),
        }
        
        if action_link:
            alert_data["action_link"] = action_link
        
        await db.alerts.insert_one(alert_data)
        await _log_admin_action(
            current_admin,
            action="create_alert",
            resource_type="alert",
            resource_id=alert_data["id"],
            metadata={"user_id": user_id, "title": title},
        )
        
        alert_data.pop("_id", None)
        return alert_data


@router.delete(
    "/alerts/{alert_id}",
    dependencies=[Depends(require_admin_permissions(["alert.write"]))],
)
async def admin_delete_alert(
    alert_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    result = await db.alerts.delete_one({"id": alert_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Alert not found")
    await _log_admin_action(
        current_admin,
        action="delete_alert",
        resource_type="alert",
        resource_id=alert_id,
    )
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Tickets (support) - admin
# ---------------------------------------------------------------------------

@router.get(
    "/tickets",
    dependencies=[Depends(require_admin_permissions(["ticket.read"]))],
)
async def admin_list_tickets(
    user_id: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    skip: int = 0,
    limit: int = 100,
    current_admin: dict = Depends(get_current_admin),
):
    query: Dict[str, Any] = {}
    if user_id:
        query["user_id"] = user_id
    if status:
        query["status"] = status
    tickets = (
        await db.tickets.find(query, {"_id": 0})
        .sort("updated_at", -1)
        .skip(skip)
        .limit(limit)
        .to_list(None)
    )
    total = await db.tickets.count_documents(query)
    return {"tickets": tickets, "total": total}


@router.get(
    "/tickets/{ticket_id}",
    dependencies=[Depends(require_admin_permissions(["ticket.read"]))],
)
async def admin_get_ticket(
    ticket_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket


@router.post(
    "/tickets",
    dependencies=[Depends(require_admin_permissions(["ticket.write"]))],
)
async def admin_create_ticket(
    payload: dict,
    current_admin: dict = Depends(get_current_admin),
):
    if "id" not in payload:
        payload["id"] = str(uuid.uuid4())
    if "user_id" not in payload:
        raise HTTPException(status_code=400, detail="user_id is required")
    now = datetime.now(timezone.utc)
    payload.setdefault("status", "open")
    payload.setdefault("priority", "medium")
    payload.setdefault("created_at", now)
    payload.setdefault("updated_at", now)
    await db.tickets.insert_one(payload)
    payload.pop("_id", None)
    await _log_admin_action(
        current_admin,
        action="create_ticket",
        resource_type="ticket",
        resource_id=payload["id"],
        metadata={"user_id": payload["user_id"], "subject": payload.get("subject")},
    )
    return payload


@router.put(
    "/tickets/{ticket_id}",
    dependencies=[Depends(require_admin_permissions(["ticket.write"]))],
)
async def admin_update_ticket(
    ticket_id: str,
    payload: dict,
    current_admin: dict = Depends(get_current_admin),
):
    payload["updated_at"] = datetime.now(timezone.utc)
    # Only set fields that are allowed to be updated
    allowed = {"subject", "description", "status", "priority", "assigned_to", "updated_at"}
    updates = {k: v for k, v in payload.items() if k in allowed}
    result = await db.tickets.update_one(
        {"id": ticket_id},
        {"$set": updates},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")
    updated = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    await _log_admin_action(
        current_admin,
        action="update_ticket",
        resource_type="ticket",
        resource_id=ticket_id,
        metadata={"changes": updates},
    )
    return updated


@router.delete(
    "/tickets/{ticket_id}",
    dependencies=[Depends(require_admin_permissions(["ticket.write"]))],
)
async def admin_delete_ticket(
    ticket_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    result = await db.tickets.delete_one({"id": ticket_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")
    await db.ticket_comments.delete_many({"ticket_id": ticket_id})
    await _log_admin_action(
        current_admin,
        action="delete_ticket",
        resource_type="ticket",
        resource_id=ticket_id,
    )
    return {"deleted": True}


@router.get(
    "/tickets/{ticket_id}/comments",
    dependencies=[Depends(require_admin_permissions(["ticket.read"]))],
)
async def admin_list_ticket_comments(
    ticket_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    ticket = await db.tickets.find_one({"id": ticket_id})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    comments = (
        await db.ticket_comments.find({"ticket_id": ticket_id}, {"_id": 0})
        .sort("created_at", 1)
        .to_list(None)
    )
    return {"comments": comments}


@router.post(
    "/tickets/{ticket_id}/comments",
    dependencies=[Depends(require_admin_permissions(["ticket.write"]))],
)
async def admin_add_ticket_comment(
    ticket_id: str,
    payload: dict,
    current_admin: dict = Depends(get_current_admin),
):
    ticket = await db.tickets.find_one({"id": ticket_id})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    body = (payload.get("body") or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Comment body is required")
    now = datetime.now(timezone.utc)
    comment = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "author_id": current_admin["id"],
        "author_type": "admin",
        "body": body,
        "created_at": now,
    }
    await db.ticket_comments.insert_one(comment)
    await db.tickets.update_one(
        {"id": ticket_id},
        {"$set": {"updated_at": now}},
    )
    comment.pop("_id", None)
    await _log_admin_action(
        current_admin,
        action="add_ticket_comment",
        resource_type="ticket",
        resource_id=ticket_id,
        metadata={"comment_id": comment["id"]},
    )

    # Notify the ticket owner: in-app alert + email (if enabled)
    user_id = ticket.get("user_id")
    if user_id:
        frontend_url = (os.getenv("FRONTEND_URL") or "").rstrip("/")
        view_ticket_url = f"{frontend_url}/tickets/{ticket_id}" if frontend_url else ""
        ticket_subject = (ticket.get("subject") or "Support ticket").strip()
        reply_body = body

        # In-app alert
        try:
            alert_data = {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "type": "info",
                "title": "Support replied to your ticket",
                "message": f'"{ticket_subject[:60]}{"..." if len(ticket_subject) > 60 else ""}" — {reply_body[:150]}{"..." if len(reply_body) > 150 else ""}',
                "time": now,
                "is_read": False,
                "actionable": True,
                "created_at": now,
            }
            if view_ticket_url:
                alert_data["action_link"] = view_ticket_url
            await db.alerts.insert_one(alert_data)
        except Exception as e:
            logging.warning("Failed to create ticket-reply alert for user %s: %s", user_id, e)

        # Email notification (respects user preference ticket_reply)
        try:
            from services.notification_service import notification_service
            from services.email_templates import ticket_reply_notification
            if notification_service and view_ticket_url:
                subject, body_plain, body_html = ticket_reply_notification(
                    ticket_id, ticket_subject, reply_body, view_ticket_url
                )
                await notification_service.send_notification_if_enabled(
                    user_id,
                    "ticket_reply",
                    subject,
                    body_plain,
                    body_html,
                )
        except Exception as e:
            logging.warning("Failed to send ticket-reply email for user %s: %s", user_id, e)

    return comment


# ---------------------------------------------------------------------------
# System config & feature flags
# ---------------------------------------------------------------------------


@router.get(
    "/system/config",
    dependencies=[Depends(require_admin_permissions(["system.read"]))],
)
async def admin_list_system_config(
    current_admin: dict = Depends(get_current_admin),
):
    configs = await admin_db.system_configs.find({}, {"_id": 0}).to_list(None)
    return {"configs": configs}


@router.put(
    "/system/config/{key}",
    dependencies=[Depends(require_admin_permissions(["system.write"]))],
)
async def admin_upsert_system_config(
    key: str,
    payload: dict,
    current_admin: dict = Depends(get_current_admin),
):
    now = datetime.now(timezone.utc)
    value = payload.get("value")
    config = SystemConfig(
        key=key,
        value=value,
        description=payload.get("description"),
        created_at=now,
        updated_at=now,
    )
    doc = config.model_dump()
    # Upsert based on key
    await admin_db.system_configs.update_one(
        {"key": key},
        {"$set": doc},
        upsert=True,
    )
    doc.pop("_id", None)
    await _log_admin_action(
        current_admin,
        action="upsert_system_config",
        resource_type="system_config",
        resource_id=key,
        metadata={"value": value},
    )
    return doc


@router.delete(
    "/system/config/{key}",
    dependencies=[Depends(require_admin_permissions(["system.write"]))],
)
async def admin_delete_system_config(
    key: str,
    current_admin: dict = Depends(get_current_admin),
):
    result = await admin_db.system_configs.delete_one({"key": key})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="System config key not found")
    await _log_admin_action(
        current_admin,
        action="delete_system_config",
        resource_type="system_config",
        resource_id=key,
    )
    return {"deleted": True, "key": key}


@router.get(
    "/system/flags",
    dependencies=[Depends(require_admin_permissions(["system.read"]))],
)
async def admin_list_feature_flags(
    current_admin: dict = Depends(get_current_admin),
):
    flags = await admin_db.feature_flags.find({}, {"_id": 0}).to_list(None)
    return {"flags": flags}


@router.put(
    "/system/flags/{key}",
    dependencies=[Depends(require_admin_permissions(["system.write"]))],
)
async def admin_upsert_feature_flag(
    key: str,
    payload: dict,
    current_admin: dict = Depends(get_current_admin),
):
    now = datetime.now(timezone.utc)
    value = payload.get("value")
    flag = FeatureFlag(
        key=key,
        value=value,
        description=payload.get("description"),
        created_at=now,
        updated_at=now,
    )
    doc = flag.model_dump()
    await admin_db.feature_flags.update_one(
        {"key": key},
        {"$set": doc},
        upsert=True,
    )
    doc.pop("_id", None)
    await _log_admin_action(
        current_admin,
        action="upsert_feature_flag",
        resource_type="feature_flag",
        resource_id=key,
        metadata={"value": value},
    )
    return doc


# ---------------------------------------------------------------------------
# Subscription plans (admin_db.plans)
# ---------------------------------------------------------------------------


def _plan_display_from_numeric(
    max_google_accounts: int,
    max_domains: int,
    max_subdomains: int,
) -> dict:
    """Compute *_display from numeric limits so Pricing page shows correct values."""
    def _fmt(n: int) -> str:
        if n == -1:
            return "Custom"
        return f"{n:,}" if n >= 1000 else str(n)

    return {
        "google_accounts_display": "—" if max_google_accounts == 0 else _fmt(max_google_accounts),
        "domains_display": _fmt(max_domains),
        "subdomains_display": _fmt(max_subdomains),
    }


@router.get(
    "/plans",
    dependencies=[Depends(require_admin_permissions(["system.read"]))],
)
async def admin_list_plans(
    active_only: bool = Query(False, description="If true, return only active plans"),
    current_admin: dict = Depends(get_current_admin),
):
    """List all plans (or only active)."""
    query = {"active": True} if active_only else {}
    cursor = admin_db.plans.find(query, {"_id": 0}).sort("order", 1)
    plans = await cursor.to_list(None)
    return {"plans": plans}


@router.get(
    "/plans/{plan_id}",
    dependencies=[Depends(require_admin_permissions(["system.read"]))],
)
async def admin_get_plan(
    plan_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    """Get a single plan by id."""
    plan = await admin_db.plans.find_one({"id": plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return plan


@router.post(
    "/plans",
    dependencies=[Depends(require_admin_permissions(["system.write"]))],
)
async def admin_create_plan(
    payload: dict,
    current_admin: dict = Depends(get_current_admin),
):
    """Create a new plan."""
    now = datetime.now(timezone.utc)
    plan_id = payload.get("id") or str(uuid.uuid4())
    if await admin_db.plans.find_one({"id": plan_id}):
        raise HTTPException(status_code=400, detail=f"Plan with id '{plan_id}' already exists")
    doc = {
        "id": plan_id,
        "name": payload.get("name", "New Plan"),
        "price": payload.get("price", "0"),
        "annual_price": payload.get("annual_price"),
        "description": payload.get("description", ""),
        "badge": payload.get("badge"),
        "best_for": payload.get("best_for"),
        "cta": payload.get("cta", "Get started"),
        "cta_subtext": payload.get("cta_subtext"),
        "popular": bool(payload.get("popular", False)),
        "max_domains": int(payload.get("max_domains", 1)) if payload.get("max_domains") is not None else 1,
        "max_subdomains": int(payload.get("max_subdomains", 1)) if payload.get("max_subdomains") is not None else 1,
        "max_google_accounts": int(payload.get("max_google_accounts", 0)) if payload.get("max_google_accounts") is not None else 0,
        "max_campaigns": int(payload.get("max_campaigns", 1)) if payload.get("max_campaigns") is not None else 1,
        "max_monthly_smtp_emails": int(payload.get("max_monthly_smtp_emails", -1)) if payload.get("max_monthly_smtp_emails") is not None else -1,
        "warmup": bool(payload.get("warmup", False)),
        "support": payload.get("support", "Community"),
        "features": payload.get("features", []),
        "daily_limit_formula": payload.get("daily_limit_formula"),
        "razorpay_plan_id_monthly": (payload.get("razorpay_plan_id_monthly") or "").strip() or None,
        "razorpay_plan_id_annual": (payload.get("razorpay_plan_id_annual") or "").strip() or None,
        "lemon_squeezy_variant_id_monthly": (payload.get("lemon_squeezy_variant_id_monthly") or "").strip() or None,
        "lemon_squeezy_variant_id_annual": (payload.get("lemon_squeezy_variant_id_annual") or "").strip() or None,
        "order": int(payload.get("order", 0)) if payload.get("order") is not None else 0,
        "active": bool(payload.get("active", True)),
        "single_plan_page_disabled": bool(payload.get("single_plan_page_disabled", False)),
        "created_at": now,
        "updated_at": now,
    }
    doc.update(
        _plan_display_from_numeric(
            doc["max_google_accounts"],
            doc["max_domains"],
            doc["max_subdomains"],
        )
    )
    await admin_db.plans.insert_one(doc)
    doc.pop("_id", None)
    await _log_admin_action(
        current_admin,
        action="create_plan",
        resource_type="plan",
        resource_id=plan_id,
        metadata={"name": doc.get("name")},
    )
    return doc


@router.put(
    "/plans/{plan_id}",
    dependencies=[Depends(require_admin_permissions(["system.write"]))],
)
async def admin_update_plan(
    plan_id: str,
    payload: dict,
    current_admin: dict = Depends(get_current_admin),
):
    """Update an existing plan."""
    existing = await admin_db.plans.find_one({"id": plan_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Plan not found")
    update_data = {k: v for k, v in payload.items() if k != "id"}
    update_data["updated_at"] = datetime.now(timezone.utc)
    max_ga = update_data.get("max_google_accounts", existing.get("max_google_accounts", 0))
    max_dom = update_data.get("max_domains", existing.get("max_domains", 1))
    max_sub = update_data.get("max_subdomains", existing.get("max_subdomains", 1))
    if not isinstance(max_ga, (int, float)):
        max_ga = int(max_ga) if max_ga is not None else 0
    if not isinstance(max_dom, (int, float)):
        max_dom = int(max_dom) if max_dom is not None else 1
    if not isinstance(max_sub, (int, float)):
        max_sub = int(max_sub) if max_sub is not None else 1
    max_ga, max_dom, max_sub = int(max_ga), int(max_dom), int(max_sub)
    update_data.update(
        _plan_display_from_numeric(max_ga, max_dom, max_sub)
    )
    await admin_db.plans.update_one(
        {"id": plan_id},
        {"$set": update_data},
    )
    updated = await admin_db.plans.find_one({"id": plan_id}, {"_id": 0})
    await _log_admin_action(
        current_admin,
        action="update_plan",
        resource_type="plan",
        resource_id=plan_id,
        metadata={"changes": list(update_data.keys())},
    )
    return updated


@router.delete(
    "/plans/{plan_id}",
    dependencies=[Depends(require_admin_permissions(["system.write"]))],
)
async def admin_delete_plan(
    plan_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    """Soft-delete plan (set active=False). Does not remove plan document."""
    existing = await admin_db.plans.find_one({"id": plan_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Plan not found")
    await admin_db.plans.update_one(
        {"id": plan_id},
        {"$set": {"active": False, "updated_at": datetime.now(timezone.utc)}},
    )
    await _log_admin_action(
        current_admin,
        action="delete_plan",
        resource_type="plan",
        resource_id=plan_id,
    )
    return {"message": "Plan deactivated", "plan_id": plan_id}


@router.delete(
    "/plans/{plan_id}/permanent",
    dependencies=[Depends(require_admin_permissions(["system.write"]))],
)
async def admin_delete_plan_permanent(
    plan_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    """Permanently remove the plan document from the database. Cannot be undone."""
    result = await admin_db.plans.delete_one({"id": plan_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Plan not found")
    await _log_admin_action(
        current_admin,
        action="delete_plan_permanent",
        resource_type="plan",
        resource_id=plan_id,
    )
    return {"deleted": True, "plan_id": plan_id}


# ---------------------------------------------------------------------------
# Audit logs
# ---------------------------------------------------------------------------


@router.get(
    "/audit/logs",
    # Any authenticated admin can view audit logs (no audit.read permission required)
    summary="List audit logs",
)
async def admin_list_audit_logs(
    admin_user_id: Optional[str] = Query(default=None),
    resource_type: Optional[str] = Query(default=None),
    action: Optional[str] = Query(default=None),
    skip: int = 0,
    limit: int = 100,
    current_admin: dict = Depends(get_current_admin),
):
    query: Dict[str, Any] = {}
    if admin_user_id:
        query["admin_user_id"] = admin_user_id
    if resource_type:
        query["resource_type"] = resource_type
    if action:
        query["action"] = action
    logs = await admin_db.audit_logs.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit).to_list(None)
    total = await admin_db.audit_logs.count_documents(query)
    return {"logs": logs, "total": total}


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


@router.post(
    "/users",
    dependencies=[Depends(require_admin_permissions(["user.write"]))],
)
async def admin_create_user(
    payload: dict,
    current_admin: dict = Depends(get_current_admin),
):
    from routes.auth_utils import get_password_hash
    from models import User as UserModel
    from datetime import datetime, timezone
    import uuid
    
    from routes.auth_utils import normalize_email
    email = normalize_email(payload.get("email") or "")
    # Check if user already exists
    existing_user = await db.users.find_one({"email": email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Create user (store email lowercase)
    user_data = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": get_password_hash(payload.get("password", "defaultpassword")),
        "status": payload.get("status", "active"),
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc)
    }
    
    result = await db.users.insert_one(user_data)
    user_data.pop("password_hash", None)  # Don't return password hash
    
    await _log_admin_action(
        current_admin,
        action="create_user",
        resource_type="user",
        resource_id=user_data["id"],
        metadata={"email": payload["email"]},
    )
    
    return user_data


@router.get(
    "/users",
    dependencies=[Depends(require_admin_permissions(["user.read"]))],
)
async def admin_list_users(
    skip: int = 0,
    limit: int = 100,
    subscription_status: Optional[str] = Query(None, description="Filter by subscription_status: trial, active, cancelled, etc."),
    plan_id: Optional[str] = Query(None, description="Filter by plan_id (e.g. free, starter, growth)"),
    created_after: Optional[str] = Query(None, description="Filter users created after: 7d, 30d (days) or ISO date"),
    search: Optional[str] = Query(None, description="Search by email or name (case-insensitive partial match)"),
    current_admin: dict = Depends(get_current_admin),
):
    query: Dict[str, Any] = {}
    if subscription_status:
        query["subscription_status"] = subscription_status
    if plan_id:
        query["plan_id"] = plan_id
    if created_after:
        try:
            if created_after.endswith("d") and created_after[:-1].isdigit():
                days = int(created_after[:-1])
                since = datetime.now(timezone.utc) - timedelta(days=days)
            else:
                since = datetime.fromisoformat(created_after.replace("Z", "+00:00"))
            query["created_at"] = {"$gte": since}
        except (ValueError, TypeError):
            pass
    if search and search.strip():
        import re
        pattern = re.escape(search.strip())
        # Allow searching by email, name (if present), first_name, last_name, and company
        query["$or"] = [
            {"email": {"$regex": pattern, "$options": "i"}},
            {"name": {"$regex": pattern, "$options": "i"}},
            {"first_name": {"$regex": pattern, "$options": "i"}},
            {"last_name": {"$regex": pattern, "$options": "i"}},
            {"company": {"$regex": pattern, "$options": "i"}},
        ]
    users = await db.users.find(
        query,
        {"_id": 0, "password_hash": 0},
    ).skip(skip).limit(limit).sort("created_at", -1).to_list(None)

    # Ensure admin UI receives a friendly full name and company field.
    for u in users:
        # Derive name from first_name / last_name when not explicitly stored
        if not u.get("name"):
            first = (u.get("first_name") or "").strip()
            last = (u.get("last_name") or "").strip()
            full_name = (first + " " + last).strip()
            if full_name:
                u["name"] = full_name
        # Always include company key so the admin table can display it
        if "company" not in u:
            u["company"] = u.get("company") or None

    total = await db.users.count_documents(query)
    return {"users": users, "total": total}


@router.get(
    "/users/stats/summary",
    dependencies=[Depends(require_admin_permissions(["user.read"]))],
)
async def admin_users_stats(
    current_admin: dict = Depends(get_current_admin),
):
    """Return counts for admin dashboard: total, on_trial, new_this_week, by plan."""
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    total = await db.users.count_documents({})
    on_trial = await db.users.count_documents({"subscription_status": "trial"})
    new_this_week = await db.users.count_documents({"created_at": {"$gte": week_ago}})
    paid_active = await db.users.count_documents({"subscription_status": "active", "plan_id": {"$nin": [None, "", "free"]}})
    free_count = await db.users.count_documents({"$or": [{"plan_id": {"$in": [None, "", "free"]}}, {"plan_id": {"$exists": False}}]})
    return {
        "total": total,
        "on_trial": on_trial,
        "new_this_week": new_this_week,
        "paid_active": paid_active,
        "free": free_count,
    }


class BulkDeleteUsersRequest(BaseModel):
    user_ids: list[str]


@router.post(
    "/users/bulk-delete",
    dependencies=[Depends(require_admin_permissions(["user.write"]))],
)
async def admin_bulk_delete_users(
    payload: BulkDeleteUsersRequest,
    current_admin: dict = Depends(get_current_admin),
):
    user_ids = [uid.strip() for uid in payload.user_ids if uid and uid.strip()]
    if not user_ids:
        raise HTTPException(status_code=400, detail="No user IDs provided")

    result = await db.users.delete_many({"id": {"$in": user_ids}})

    for user_id in user_ids:
        await _log_admin_action(
            current_admin,
            action="delete_user",
            resource_type="user",
            resource_id=user_id,
        )

    return {"deleted": result.deleted_count, "requested": len(user_ids)}


@router.get(
    "/users/{user_id}",
    dependencies=[Depends(require_admin_permissions(["user.read"]))],
)
async def admin_get_user(
    user_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    settings = await db.user_settings.find_one(
        {"user_id": user_id},
        {"_id": 0, "use_app_google_oauth": 1, "email_infra": 1},
    )
    user["use_app_google_oauth"] = bool(settings and settings.get("use_app_google_oauth") is True)
    user["email_infra"] = {
        "enabled": bool(settings and settings.get("email_infra", {}).get("enabled") is True)
    }
    from services.plan_service import sync_stored_plan_with_entitlements_if_needed

    user = await sync_stored_plan_with_entitlements_if_needed(db, user)
    return user


@router.post(
    "/users/{user_id}/impersonate",
    dependencies=[Depends(require_admin_permissions(["user.read"]))],
)
async def admin_impersonate_user(
    user_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    """Generate a short-lived impersonation token so admin can debug as this user in the main app."""
    from routes.auth_utils import create_impersonation_token

    user = await db.users.find_one({"id": user_id}, {"id": 1, "email": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.get("status") == "banned":
        raise HTTPException(status_code=400, detail="Cannot impersonate a banned user")

    token = create_impersonation_token(user_id)
    await _log_admin_action(
        current_admin,
        action="impersonate",
        resource_type="user",
        resource_id=user_id,
        metadata={"email": user.get("email")},
    )
    return {"token": token, "expires_in": 3600}


@router.put(
    "/users/{user_id}",
    dependencies=[Depends(require_admin_permissions(["user.write"]))],
)
async def admin_update_user(
    user_id: str,
    payload: dict,
    current_admin: dict = Depends(get_current_admin),
):
    # Don't allow changing email or password via this endpoint
    update_data = {k: v for k, v in payload.items() if k not in ["email", "password", "password_hash", "id", "created_at"]}
    # Per-user Google OAuth: store in user_settings, not on user document
    use_app_google_oauth = update_data.pop("use_app_google_oauth", None)
    email_infra = update_data.pop("email_infra", None)
    user_settings_updates = {}
    if use_app_google_oauth is not None:
        user_settings_updates["use_app_google_oauth"] = bool(use_app_google_oauth)
    if isinstance(email_infra, dict):
        user_settings_updates["email_infra"] = {
            "enabled": bool(email_infra.get("enabled") is True)
        }
    if user_settings_updates:
        user_settings_updates["updated_at"] = datetime.now(timezone.utc)
        await db.user_settings.update_one(
            {"user_id": user_id},
            {"$set": user_settings_updates},
            upsert=True,
        )
    if "plan_id" in update_data and update_data["plan_id"]:
        plan_exists = await admin_db.plans.find_one({"id": update_data["plan_id"]})
        if not plan_exists:
            raise HTTPException(status_code=400, detail=f"Plan '{update_data['plan_id']}' not found")

    # Normalize per-user extra limits to non-negative integers. These are
    # additive bonuses on top of the user's plan and are only honored for
    # non-free plans inside PlanService.
    for key in (
        "extra_max_domains",
        "extra_max_subdomains",
        "extra_max_google_accounts",
        "extra_max_campaigns",
        "extra_max_monthly_smtp_emails",
    ):
        if key in update_data:
            raw = update_data[key]
            if raw in ("", None):
                update_data[key] = 0
            else:
                try:
                    update_data[key] = max(0, int(raw))
                except (TypeError, ValueError):
                    update_data[key] = 0
    # Normalize subscription dates: empty string -> None (clear the field)
    for key in ("subscription_start", "subscription_end"):
        if key in update_data and update_data[key] == "":
            update_data[key] = None
    # Normalize provider subscription IDs so admin can clear/update reliably.
    for key in ("razorpay_subscription_id", "lemon_squeezy_subscription_id"):
        if key in update_data:
            raw_val = update_data[key]
            if raw_val is None:
                continue
            if isinstance(raw_val, str):
                cleaned = raw_val.strip()
                update_data[key] = cleaned or None
    update_data["updated_at"] = datetime.now(timezone.utc)
    
    if update_data:
        result = await db.users.update_one(
            {"id": user_id},
            {"$set": update_data},
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="User not found")
    
    updated_user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    settings = await db.user_settings.find_one(
        {"user_id": user_id},
        {"_id": 0, "use_app_google_oauth": 1, "email_infra": 1},
    )
    updated_user["use_app_google_oauth"] = bool(settings and settings.get("use_app_google_oauth") is True)
    updated_user["email_infra"] = {
        "enabled": bool(settings and settings.get("email_infra", {}).get("enabled") is True)
    }
    
    await _log_admin_action(
        current_admin,
        action="update_user",
        resource_type="user",
        resource_id=user_id,
        metadata={
            "changes": {
                **update_data,
                **({"use_app_google_oauth": bool(use_app_google_oauth)} if use_app_google_oauth is not None else {}),
                **(
                    {"email_infra": {"enabled": bool(email_infra.get("enabled") is True)}}
                    if isinstance(email_infra, dict)
                    else {}
                ),
            }
        },
    )
    
    return updated_user


@router.put(
    "/users/{user_id}/ban",
    dependencies=[Depends(require_admin_permissions(["user.write"]))],
)
async def admin_ban_user(
    user_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    result = await db.users.update_one(
        {"id": user_id},
        {"$set": {"status": "banned", "banned_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    await _log_admin_action(
        current_admin,
        action="ban_user",
        resource_type="user",
        resource_id=user_id,
    )
    return {"message": "User banned successfully"}


@router.put(
    "/users/{user_id}/unban",
    dependencies=[Depends(require_admin_permissions(["user.write"]))],
)
async def admin_unban_user(
    user_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    result = await db.users.update_one(
        {"id": user_id},
        {"$set": {"status": "active", "banned_at": None, "updated_at": datetime.now(timezone.utc)}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    await _log_admin_action(
        current_admin,
        action="unban_user",
        resource_type="user",
        resource_id=user_id,
    )
    return {"message": "User unbanned successfully"}


@router.delete(
    "/users/{user_id}",
    dependencies=[Depends(require_admin_permissions(["user.write"]))],
)
async def admin_delete_user(
    user_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    result = await db.users.delete_one({"id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    await _log_admin_action(
        current_admin,
        action="delete_user",
        resource_type="user",
        resource_id=user_id,
    )
    return {"deleted": True}


@router.post(
    "/users/{user_id}/send-alert",
    dependencies=[Depends(require_admin_permissions(["alert.write"]))],
)
async def admin_send_user_alert(
    user_id: str,
    payload: dict = Body(...),
    current_admin: dict = Depends(get_current_admin),
):
    """Send an in-app alert to a user, and optionally also send via email via notification service."""
    from services.notification_service import notification_service

    title = payload.get("title") or payload.get("subject")
    message = payload.get("message")
    send_email = payload.get("send_email", False)

    if not title or not message:
        raise HTTPException(status_code=400, detail="title and message are required")

    user = await db.users.find_one({"id": user_id}, {"email": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Create in-app alert
    now = datetime.now(timezone.utc)
    alert_data = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "type": payload.get("type", "info"),
        "title": title,
        "message": message,
        "time": now,
        "is_read": False,
        "actionable": bool(payload.get("action_link")),
        "created_at": now,
    }
    if payload.get("action_link"):
        alert_data["action_link"] = payload["action_link"]
    await db.alerts.insert_one(alert_data)

    # Optionally send email via notification service (uses app SendGrid/SMTP)
    email_sent = False
    if send_email and user.get("email") and notification_service:
        body_plain = message
        body_html = message.replace("\n", "<br>")
        try:
            email_sent = await notification_service.send_notification_always(
                user_id=user_id,
                notification_type="admin_alert",
                subject=title,
                body_plain=body_plain,
                body_html=body_html,
            )
        except Exception as e:
            logging.exception("Failed to send alert email to %s: %s", user["email"], e)

    await _log_admin_action(
        current_admin,
        action="send_user_alert",
        resource_type="user",
        resource_id=user_id,
        metadata={"title": title, "email_sent": email_sent},
    )

    return {
        "alert_id": alert_data["id"],
        "email_sent": email_sent,
        "message": "Alert sent" + (" and email delivered" if email_sent else ""),
    }


@router.post(
    "/users/{user_id}/add-credits",
    dependencies=[Depends(require_admin_permissions(["user.write"]))],
)
async def admin_add_credits(
    user_id: str,
    payload: dict = Body(...),
    current_admin: dict = Depends(get_current_admin),
):
    """Manually top up warmup credits for a user without a payment provider."""
    from services.credit_service import CreditService

    amount = payload.get("amount")
    note = payload.get("note", "").strip()

    if not isinstance(amount, int) or amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be a positive integer")

    user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "email": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    credit_service = CreditService(db)
    transaction = await credit_service.add_credits(
        user_id,
        amount,
        reason="admin_topup",
        purchased=True,
        metadata={
            "admin_id": current_admin.get("id"),
            "admin_email": current_admin.get("email"),
            "note": note or None,
        },
    )

    await _log_admin_action(
        current_admin,
        action="add_credits",
        resource_type="user",
        resource_id=user_id,
        metadata={"amount": amount, "note": note, "transaction_id": transaction.get("id")},
    )

    new_balance = await credit_service.get_balance(user_id)
    return {"transaction_id": transaction.get("id"), "amount_added": amount, "new_balance": new_balance}


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------


@router.get(
    "/analytics",
    dependencies=[Depends(require_admin_permissions(["analytics.read"]))],
)
async def admin_get_analytics(
    start_date: Optional[str] = Query(default=None, description="Start date (YYYY-MM-DD, UTC)"),
    end_date: Optional[str] = Query(default=None, description="End date (YYYY-MM-DD, UTC, inclusive)"),
    current_admin: dict = Depends(get_current_admin),
):
    """Get system-wide analytics data for all tenants."""
    now = datetime.now(timezone.utc)
    start_dt: datetime
    end_dt_exclusive: datetime

    # Default window: last 7 days including today (UTC).
    if not start_date and not end_date:
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        start_dt = today_start - timedelta(days=6)
        end_dt_exclusive = today_start + timedelta(days=1)
    else:
        try:
            parsed_start = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc) if start_date else None
            parsed_end = datetime.strptime(end_date, "%Y-%m-%d").replace(tzinfo=timezone.utc) if end_date else None
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

        if parsed_start and parsed_end:
            start_dt = parsed_start
            end_dt_exclusive = parsed_end + timedelta(days=1)
        elif parsed_start and not parsed_end:
            start_dt = parsed_start
            end_dt_exclusive = now + timedelta(seconds=1)
        elif parsed_end and not parsed_start:
            start_dt = parsed_end
            end_dt_exclusive = parsed_end + timedelta(days=1)
        else:
            today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            start_dt = today_start - timedelta(days=6)
            end_dt_exclusive = today_start + timedelta(days=1)

    if start_dt >= end_dt_exclusive:
        raise HTTPException(status_code=400, detail="start_date must be before or equal to end_date.")

    match_filter = {
        "sent_at": {"$gte": start_dt, "$lt": end_dt_exclusive},
        "status": {"$ne": "pending"},
    }

    # Get overall system analytics for selected range.
    total_sent = await db.email_logs.count_documents(match_filter)
    total_opened = await db.email_logs.count_documents({
        **match_filter,
        "status": {"$in": ["opened", "clicked", "replied"]},
    })
    total_clicked = await db.email_logs.count_documents({
        **match_filter,
        "status": {"$in": ["clicked", "replied"]},
    })
    total_replied = await db.email_logs.count_documents({
        **match_filter,
        "status": "replied",
    })
    
    # Calculate overall rates
    open_rate = round((total_opened / total_sent * 100) if total_sent > 0 else 0, 2)
    click_rate = round((total_clicked / total_sent * 100) if total_sent > 0 else 0, 2)
    reply_rate = round((total_replied / total_sent * 100) if total_sent > 0 else 0, 2)
    
    # Get analytics by tenant
    pipeline = [
        {"$match": match_filter},
        {
            "$lookup": {
                "from": "users",
                "localField": "user_id",
                "foreignField": "id",
                "as": "user"
            }
        },
        {
            "$group": {
                "_id": "$user_id",
                "user": {"$first": {"$arrayElemAt": ["$user", 0]}},
                "total_sent": {"$sum": 1},
                "total_opened": {
                    "$sum": {
                        "$cond": [{"$in": ["$status", ["opened", "clicked", "replied"]]}, 1, 0]
                    }
                },
                "total_clicked": {
                    "$sum": {
                        "$cond": [{"$in": ["$status", ["clicked", "replied"]]}, 1, 0]
                    }
                },
                "total_replied": {
                    "$sum": {
                        "$cond": [{"$eq": ["$status", "replied"]}, 1, 0]
                    }
                }
            }
        },
        {
            "$project": {
                "tenant_id": "$_id",
                "tenant_name": "$user.email",
                "total_sent": 1,
                "total_opened": 1,
                "total_clicked": 1,
                "total_replied": 1,
                "open_rate": {
                    "$round": [
                        {
                            "$multiply": [
                                {
                                    "$cond": [
                                        {"$gt": ["$total_sent", 0]},
                                        {"$divide": ["$total_opened", "$total_sent"]},
                                        0
                                    ]
                                },
                                100
                            ]
                        },
                        2
                    ]
                },
                "click_rate": {
                    "$round": [
                        {
                            "$multiply": [
                                {
                                    "$cond": [
                                        {"$gt": ["$total_sent", 0]},
                                        {"$divide": ["$total_clicked", "$total_sent"]},
                                        0
                                    ]
                                },
                                100
                            ]
                        },
                        2
                    ]
                },
                "reply_rate": {
                    "$round": [
                        {
                            "$multiply": [
                                {
                                    "$cond": [
                                        {"$gt": ["$total_sent", 0]},
                                        {"$divide": ["$total_replied", "$total_sent"]},
                                        0
                                    ]
                                },
                                100
                            ]
                        },
                        2
                    ]
                }
            }
        }
    ]
    
    by_tenant = await db.email_logs.aggregate(pipeline).to_list(None)
    
    # Get top performing campaigns
    top_campaigns_pipeline = [
        {"$match": match_filter},
        {
            "$lookup": {
                "from": "users",
                "localField": "user_id",
                "foreignField": "id",
                "as": "user"
            }
        },
        {
            "$group": {
                "_id": "$campaign_id",
                "campaign_id": {"$first": "$campaign_id"},
                "user": {"$first": {"$arrayElemAt": ["$user", 0]}},
                "total_sent": {"$sum": 1},
                "total_opened": {
                    "$sum": {
                        "$cond": [{"$in": ["$status", ["opened", "clicked", "replied"]]}, 1, 0]
                    }
                },
                "total_clicked": {
                    "$sum": {
                        "$cond": [{"$in": ["$status", ["clicked", "replied"]]}, 1, 0]
                    }
                },
                "total_replied": {
                    "$sum": {
                        "$cond": [{"$eq": ["$status", "replied"]}, 1, 0]
                    }
                }
            }
        },
        {
            "$addFields": {
                "open_rate": {
                    "$round": [
                        {
                            "$multiply": [
                                {
                                    "$cond": [
                                        {"$gt": ["$total_sent", 0]},
                                        {"$divide": ["$total_opened", "$total_sent"]},
                                        0
                                    ]
                                },
                                100
                            ]
                        },
                        2
                    ]
                },
                "click_rate": {
                    "$round": [
                        {
                            "$multiply": [
                                {
                                    "$cond": [
                                        {"$gt": ["$total_sent", 0]},
                                        {"$divide": ["$total_clicked", "$total_sent"]},
                                        0
                                    ]
                                },
                                100
                            ]
                        },
                        2
                    ]
                },
                "reply_rate": {
                    "$round": [
                        {
                            "$multiply": [
                                {
                                    "$cond": [
                                        {"$gt": ["$total_sent", 0]},
                                        {"$divide": ["$total_replied", "$total_sent"]},
                                        0
                                    ]
                                },
                                100
                            ]
                        },
                        2
                    ]
                }
            }
        },
        {
            "$lookup": {
                "from": "campaigns",
                "localField": "campaign_id",
                "foreignField": "id",
                "as": "campaign_details"
            }
        },
        {
            "$addFields": {
                "campaign_name": {"$ifNull": [{"$arrayElemAt": ["$campaign_details.name", 0]}, "Unknown Campaign"]}
            }
        },
        {
            "$sort": {"open_rate": -1}
        },
        {"$limit": 5}
    ]
    
    top_campaigns = await db.email_logs.aggregate(top_campaigns_pipeline).to_list(None)

    daily_pipeline = [
        {"$match": match_filter},
        {
            "$group": {
                "_id": {
                    "$dateToString": {
                        "format": "%Y-%m-%d",
                        "date": "$sent_at",
                        "timezone": "UTC",
                    }
                },
                "count": {"$sum": 1},
            }
        },
        {"$sort": {"_id": 1}},
    ]
    daily_rows = await db.email_logs.aggregate(daily_pipeline).to_list(None)
    daily_map = {r["_id"]: r["count"] for r in daily_rows}

    # Fill missing days with 0 for a continuous range.
    daily_sent = []
    cursor_day = start_dt.replace(hour=0, minute=0, second=0, microsecond=0)
    last_day = (end_dt_exclusive - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    while cursor_day <= last_day:
        day_key = cursor_day.strftime("%Y-%m-%d")
        daily_sent.append({"date": day_key, "count": int(daily_map.get(day_key, 0))})
        cursor_day += timedelta(days=1)

    return _make_json_serializable({
        "total_sent": total_sent,
        "total_opened": total_opened,
        "total_clicked": total_clicked,
        "total_replied": total_replied,
        "open_rate": open_rate,
        "click_rate": click_rate,
        "reply_rate": reply_rate,
        "start_date": start_dt.strftime("%Y-%m-%d"),
        "end_date": (end_dt_exclusive - timedelta(days=1)).strftime("%Y-%m-%d"),
        "daily_sent": daily_sent,
        "by_tenant": by_tenant,
        "top_campaigns": top_campaigns
    })


@router.get("/stats")
async def admin_system_stats(current_admin: dict = Depends(get_current_admin)):
    """Get system-wide statistics for the admin dashboard."""
    # Get counts for various entities
    total_campaigns = await db.campaigns.count_documents({})
    total_contacts = await db.contacts.count_documents({})
    total_domains = await db.domains.count_documents({})
    total_inboxes = await db.inboxes.count_documents({})
    
    # Get alert count (approximate, since alerts are dynamically generated)
    # We'll count recent activity that might trigger alerts
    recent_alerts = await admin_db.audit_logs.count_documents({})
    
    return {
        "total_campaigns": total_campaigns,
        "total_contacts": total_contacts,
        "total_domains": total_domains,
        "total_inboxes": total_inboxes,
        "active_alerts": recent_alerts,  # Approximate count
        "timestamp": datetime.now(timezone.utc)
    }


# ---------------------------------------------------------------------------
# Product update notifications (email users who have product_updates enabled)
# ---------------------------------------------------------------------------


class ProductUpdateNotificationRequest(BaseModel):
    subject: str
    body: str


@router.post(
    "/notifications/product-update",
    dependencies=[Depends(get_current_super_admin)],
)
async def admin_send_product_update_notification(
    payload: ProductUpdateNotificationRequest = Body(...),
    current_admin: dict = Depends(get_current_super_admin),
):
    """Send a product-update email to every user who has 'product_updates' notification preference enabled. Body can be plain text or HTML."""
    from services.notification_service import notification_service
    if not notification_service:
        raise HTTPException(status_code=503, detail="Notification service not configured (SENDGRID_API_KEY and NOTIFICATION_FROM_EMAIL or SMTP not set in .env)")
    users = await db.users.find({"status": {"$ne": "banned"}}, {"id": 1}).to_list(None)
    sent = 0
    for u in users:
        try:
            if await notification_service.send_notification_if_enabled(
                u["id"], "product_updates", payload.subject, payload.body
            ):
                sent += 1
        except Exception:
            pass
    await _log_admin_action(
        current_admin,
        "product_update_notification",
        "notification",
        None,
        {"subject": payload.subject, "recipients_count": sent},
    )
    return {"message": f"Product update sent to {sent} users", "sent": sent}

