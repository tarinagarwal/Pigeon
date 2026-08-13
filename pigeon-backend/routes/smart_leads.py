"""Smart Leads: Serper web search + user-configured LLM; full pipeline runs."""

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from database import db
from routes.dependencies import get_current_user
from routes.schemas import SmartLeadsAudience, SmartLeadsDiscoverRequest, SmartLeadsRunCreateRequest
from services.llm_service import LLMService
from services.serper_helpers import get_serper_api_key_for_user
from services.zerobounce_helpers import get_zerobounce_api_key_for_user
from services.smart_leads_helpers import parse_ai_json, sanitize_serper_search_query
from services.smart_leads_pipeline import run_smart_leads_pipeline

router = APIRouter()

llm_service: Optional[LLMService] = None
_RUN_TASKS: Dict[str, asyncio.Task] = {}


def init_llm_service(service: LLMService) -> None:
    global llm_service
    llm_service = service


def _launch_pipeline_task(run_id: str, resume: bool = False) -> None:
    async def _runner() -> None:
        try:
            assert llm_service is not None
            await run_smart_leads_pipeline(run_id, llm_service, resume=resume)
        finally:
            _RUN_TASKS.pop(run_id, None)

    _RUN_TASKS[run_id] = asyncio.create_task(_runner())


async def _finalize_if_orphan_cancelling(run: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not run:
        return run
    rid = str(run.get("id") or "")
    status = str(run.get("status") or "").lower()
    if not rid or status != "cancelling":
        return run
    task = _RUN_TASKS.get(rid)
    if task is not None and not task.done():
        return run
    now = datetime.now(timezone.utc)
    await db.smart_leads_runs.update_one(
        {"id": rid},
        {
            "$set": {
                "status": "cancelled",
                "stage": "cancelled",
                "stage_detail": "Cancelled (no active worker)",
                "updated_at": now,
                "completed_at": now,
                "error": None,
            }
        },
    )
    run["status"] = "cancelled"
    run["stage"] = "cancelled"
    run["stage_detail"] = "Cancelled (no active worker)"
    run["updated_at"] = now
    run["completed_at"] = now
    run["error"] = None
    return run


def _build_serper_query(audience: SmartLeadsAudience) -> str:
    if audience.search_query_override and audience.search_query_override.strip():
        return audience.search_query_override.strip()
    parts: List[str] = []
    for v in (
        audience.target_company,
        audience.industry,
        audience.job_titles_or_roles,
        audience.geography,
        audience.company_size,
        audience.keywords,
    ):
        if v and str(v).strip():
            parts.append(str(v).strip())
    if audience.audience_notes and audience.audience_notes.strip():
        parts.append(audience.audience_notes.strip())
    return " ".join(parts) if parts else "B2B SaaS companies"


def _compact_organic(raw: Dict[str, Any], limit: int) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    organic = raw.get("organic") or []
    for row in organic[:limit]:
        if not isinstance(row, dict):
            continue
        item: Dict[str, Any] = {
            "title": row.get("title"),
            "link": row.get("link"),
            "snippet": row.get("snippet"),
            "position": row.get("position"),
        }
        if row.get("date"):
            item["date"] = row["date"]
        out.append(item)
    return out


def _build_llm_prompt(audience: SmartLeadsAudience, organic: List[Dict[str, Any]]) -> str:
    audience_blob = audience.model_dump(exclude_none=True)
    organic_json = json.dumps(organic, ensure_ascii=False, indent=2)
    return f"""You are a B2B prospecting assistant for cold outreach.

The user described their target audience (ICP) as JSON:
{json.dumps(audience_blob, ensure_ascii=False, indent=2)}

Below are organic Google search results (title, link, snippet) from Serper for a query derived from that audience.
Analyze which results best match the ICP, which are noise, and what the user should do next.

Search results (JSON array):
{organic_json}

Respond with ONLY valid JSON (no markdown, no commentary outside JSON) using exactly this shape:
{{
  "summary": "2-4 sentences on what the search surfaced and how it relates to the audience.",
  "audience_fit": "Brief assessment of whether the search query was specific enough and what to refine.",
  "top_results": [
    {{
      "title": "string (from results or paraphrased)",
      "url": "string",
      "relevance_score": 1,
      "why_it_matters": "one sentence"
    }}
  ],
  "suggested_follow_up_searches": ["up to 5 shorter Google queries to run next"],
  "outreach_angles": ["up to 5 bullet hooks or angles for email based on snippets"]
}}

Rules:
- Include at most 7 entries in top_results; only include results that exist in the provided search results (use their URLs).
- relevance_score is 1-10 integer.
- If results are weak or off-topic, say so honestly in summary and audience_fit and still give follow_up_searches.
- Infer what the user likely sells from the ICP. **Down-rank or omit** results that are **direct competitor vendors** (same product category as the user’s business) unless the audience explicitly wants to research competitors—prefer potential **customer** companies.
"""


@router.post("/smart-leads/discover")
async def discover_smart_leads(
    body: SmartLeadsDiscoverRequest,
    current_user: dict = Depends(get_current_user),
):
    """Legacy single-request discover: one Serper call + LLM analysis."""
    if llm_service is None:
        raise HTTPException(status_code=500, detail="LLM service not initialized")

    user_id = current_user["id"]
    serper_key = await get_serper_api_key_for_user(user_id)
    if not serper_key:
        raise HTTPException(
            status_code=503,
            detail="Smart Leads search is not configured. Add your Serper API key in Settings → Integrations.",
        )

    q = sanitize_serper_search_query(
        _build_serper_query(body.audience),
        "B2B SaaS companies",
    )
    num = max(1, int(body.num_results or 10))

    serper_payload: Dict[str, Any] = {"q": q, "num": num}

    try:
        async with httpx.AsyncClient() as client:
            serper_resp = await client.post(
                "https://google.serper.dev/search",
                headers={"X-API-KEY": serper_key, "Content-Type": "application/json"},
                json=serper_payload,
                timeout=30.0,
            )
            serper_resp.raise_for_status()
            serper_raw = serper_resp.json()
    except httpx.HTTPStatusError as e:
        detail = e.response.text[:500] if e.response is not None else str(e)
        logging.warning("Serper HTTP error: %s", detail)
        raise HTTPException(
            status_code=502,
            detail=f"Serper search failed: {e.response.status_code if e.response else e}",
        )
    except Exception as e:
        logging.exception("Serper request failed")
        raise HTTPException(status_code=502, detail=f"Serper search failed: {e!s}")

    organic_compact = _compact_organic(serper_raw, num)
    credits = serper_raw.get("credits")

    prompt = _build_llm_prompt(body.audience, organic_compact)
    try:
        ai_text = await llm_service.generate_text(
            user_id,
            body.ai_provider,
            prompt,
            timeout=90.0,
        )
    except Exception as e:
        logging.exception("Smart Leads LLM failed")
        raise HTTPException(status_code=400, detail=str(e))

    ai_parsed = parse_ai_json(ai_text)

    return {
        "search_query": q,
        "serper": {
            "organic": organic_compact,
            "credits": credits,
        },
        "ai": ai_parsed,
        "ai_raw": None if ai_parsed is not None else ai_text,
    }


@router.post("/smart-leads/runs")
async def create_smart_leads_run(
    body: SmartLeadsRunCreateRequest,
    current_user: dict = Depends(get_current_user),
):
    if llm_service is None:
        raise HTTPException(status_code=500, detail="LLM service not initialized")

    user_id = current_user["id"]
    serper_key = await get_serper_api_key_for_user(user_id)
    if not serper_key:
        raise HTTPException(
            status_code=503,
            detail="Add your Serper API key in Settings → Integrations (Integrations tab) to run Smart Leads.",
        )
    if not await get_zerobounce_api_key_for_user(user_id):
        raise HTTPException(
            status_code=503,
            detail="Add your ZeroBounce API key in Settings → Integrations (ZeroBounce) to run Smart Leads.",
        )

    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    doc = {
        "id": run_id,
        "user_id": user_id,
        "audience": body.audience.model_dump(exclude_none=True),
        "ai_provider": body.ai_provider.strip(),
        "max_emails": body.max_emails,
        "company_search_pages": body.company_search_pages,
        "employee_search_pages": body.employee_search_pages,
        "company_queries": body.company_queries,
        "employee_queries_per_company": body.employee_queries_per_company,
        "max_companies": body.max_companies,
        "max_people_per_company": body.max_people_per_company,
        "status": "running",
        "stage": "queued",
        "stage_detail": "Starting…",
        "progress_percent": 0,
        "error": None,
        "stats": {"companies": 0, "people": 0, "emails": 0, "mx_ok": 0},
        "created_at": now,
        "updated_at": now,
        "completed_at": None,
    }
    await db.smart_leads_runs.insert_one(doc)

    _launch_pipeline_task(run_id, resume=False)

    return {"run_id": run_id, "status": "running"}


@router.post("/smart-leads/runs/{run_id}/continue")
async def continue_smart_leads_run(
    run_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Resume a failed run from saved companies/people (skips completed phases where possible)."""
    if llm_service is None:
        raise HTTPException(status_code=500, detail="LLM service not initialized")

    user_id = current_user["id"]
    run = await db.smart_leads_runs.find_one({"id": run_id, "user_id": user_id})
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.get("status") != "failed":
        raise HTTPException(status_code=400, detail="Only failed runs can be continued")

    serper_key = await get_serper_api_key_for_user(user_id)
    if not serper_key:
        raise HTTPException(
            status_code=503,
            detail="Add your Serper API key in Settings → Integrations (Integrations tab) to run Smart Leads.",
        )
    if not await get_zerobounce_api_key_for_user(user_id):
        raise HTTPException(
            status_code=503,
            detail="Add your ZeroBounce API key in Settings → Integrations (ZeroBounce) to run Smart Leads.",
        )

    _launch_pipeline_task(run_id, resume=True)
    return {"run_id": run_id, "status": "running"}


@router.post("/smart-leads/runs/{run_id}/stop")
async def stop_smart_leads_run(
    run_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    run = await db.smart_leads_runs.find_one({"id": run_id, "user_id": user_id}, {"_id": 0, "status": 1})
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    status = str(run.get("status") or "").lower()
    if status in {"completed", "failed", "cancelled"}:
        raise HTTPException(status_code=400, detail=f"Cannot stop a run with status '{status}'")

    now = datetime.now(timezone.utc)
    task = _RUN_TASKS.get(run_id)
    has_live_task = task is not None and not task.done()
    if not has_live_task:
        await db.smart_leads_runs.update_one(
            {"id": run_id, "user_id": user_id},
            {
                "$set": {
                    "status": "cancelled",
                    "stage": "cancelled",
                    "stage_detail": "Cancelled (no active worker)",
                    "updated_at": now,
                    "completed_at": now,
                    "error": None,
                }
            },
        )
        return {"run_id": run_id, "status": "cancelled"}

    await db.smart_leads_runs.update_one(
        {"id": run_id, "user_id": user_id},
        {
            "$set": {
                "status": "cancelling",
                "stage": "stopping",
                "stage_detail": "Stop requested…",
                "updated_at": now,
                "error": None,
            }
        },
    )
    return {"run_id": run_id, "status": "cancelling"}


@router.get("/smart-leads/runs/{run_id}/status")
async def smart_leads_run_status(
    run_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    job = await db.smart_leads_runs.find_one({"id": run_id, "user_id": user_id}, {"_id": 0})
    job = await _finalize_if_orphan_cancelling(job)
    if not job:
        raise HTTPException(status_code=404, detail="Run not found")
    return {
        "run_id": job["id"],
        "status": job.get("status"),
        "stage": job.get("stage"),
        "stage_detail": job.get("stage_detail"),
        "progress_percent": job.get("progress_percent", 0),
        "stats": job.get("stats") or {},
        "error": job.get("error"),
        "updated_at": job.get("updated_at"),
    }


@router.get("/smart-leads/runs")
async def list_smart_leads_runs(
    skip: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    cursor = (
        db.smart_leads_runs.find(
            {"user_id": user_id},
            {
                "_id": 0,
                "id": 1,
                "status": 1,
                "stage": 1,
                "stage_detail": 1,
                "progress_percent": 1,
                "stats": 1,
                "error": 1,
                "audience": 1,
                "company_search_pages": 1,
                "employee_search_pages": 1,
                "company_queries": 1,
                "employee_queries_per_company": 1,
                "max_companies": 1,
                "max_people_per_company": 1,
                "created_at": 1,
                "updated_at": 1,
                "completed_at": 1,
            },
        )
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    )
    items = await cursor.to_list(None)
    for i, row in enumerate(items):
        items[i] = await _finalize_if_orphan_cancelling(row)
    total = await db.smart_leads_runs.count_documents({"user_id": user_id})
    return {"runs": items, "total": total, "skip": skip, "limit": limit}


@router.get("/smart-leads/runs/{run_id}")
async def get_smart_leads_run_detail(
    run_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    run = await db.smart_leads_runs.find_one({"id": run_id, "user_id": user_id}, {"_id": 0})
    run = await _finalize_if_orphan_cancelling(run)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    companies = await db.smart_leads_companies.find(
        {"run_id": run_id, "user_id": user_id},
        {"_id": 0},
    ).to_list(None)
    people = await db.smart_leads_people.find(
        {"run_id": run_id, "user_id": user_id},
        {"_id": 0},
    ).to_list(None)
    emails = await db.smart_leads_emails.find(
        {"run_id": run_id, "user_id": user_id},
        {"_id": 0},
    ).to_list(None)

    return {
        "run": run,
        "companies": companies,
        "people": people,
        "emails": emails,
    }
