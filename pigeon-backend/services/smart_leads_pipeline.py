"""
Background pipeline: audience → LLM search queries → Serper (paginated) →
structured companies/people → LLM email candidates → validation.

Only emails that are mailbox-verified-strong (RCPT valid, not catch-all) and
ZeroBounce status valid are persisted.
"""

from __future__ import annotations

import asyncio
import functools
import json
import logging
import os
import random
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from database import db
from routes.schemas import SmartLeadsAudience
from services.email_validation import (
    risk_score,
    smart_leads_email_qualifies,
    validate_email_full,
)
from services.llm_service import LLMService
from services.serper_helpers import get_serper_api_key_for_user, serper_search
from services.zerobounce_helpers import get_zerobounce_api_key_for_user
from services.smart_leads_helpers import (
    looks_like_placeholder_name_email,
    looks_like_scraping_style_query,
    parse_ai_json,
)

# Defaults when older runs omit fields (not hard caps).
_DEFAULT_PAGES_PER_STAGE = 3
_DEFAULT_EMAILS = 100
_DEFAULT_COMPANY_QUERIES = 3
_DEFAULT_EMPLOYEE_QUERIES_PER_COMPANY = 3
# Upper bound on companies kept from normalization (no separate user control; keeps all plausible matches up to this).
_DEFAULT_MAX_COMPANIES = 100
_DEFAULT_PEOPLE_PER_COMPANY = 12
# Max people per email-guessing LLM call within one company (multiple calls per company if needed).
_EMAIL_GUESS_CHUNK = 30
_EMPLOYEE_QUERY_BATCH_SIZE = 8
_COMPANY_NORMALIZE_CHUNK_SIZE = 80
_PEOPLE_EXTRACT_CHUNK_SIZE = 60
_LLM_MAX_ATTEMPTS = 3


class SmartLeadsStopError(Exception):
    """Intentional early stop that keeps partial progress/results."""


class SmartLeadsCancelledError(SmartLeadsStopError):
    """Run was explicitly cancelled by the user."""


def _run_int(run: Dict[str, Any], key: str, default: int, lo: int, hi: Optional[int] = None) -> int:
    try:
        v = int(run.get(key)) if run.get(key) is not None else default
    except (TypeError, ValueError):
        v = default
    if hi is not None:
        return max(lo, min(hi, v))
    return max(lo, v)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _update_run(
    run_id: str,
    *,
    status: Optional[str] = None,
    stage: Optional[str] = None,
    stage_detail: Optional[str] = None,
    progress_percent: Optional[int] = None,
    error: Optional[str] = None,
    stats: Optional[Dict[str, Any]] = None,
    completed: bool = False,
) -> None:
    doc: Dict[str, Any] = {"updated_at": _now()}
    if status is not None:
        doc["status"] = status
    if stage is not None:
        doc["stage"] = stage
    if stage_detail is not None:
        doc["stage_detail"] = stage_detail
    if progress_percent is not None:
        doc["progress_percent"] = progress_percent
    if error is not None:
        doc["error"] = error
    if stats is not None:
        doc["stats"] = stats
    if completed:
        doc["completed_at"] = _now()
    await db.smart_leads_runs.update_one({"id": run_id}, {"$set": doc})


async def _ensure_not_cancelled(run_id: str, user_id: str) -> None:
    row = await db.smart_leads_runs.find_one({"id": run_id, "user_id": user_id}, {"_id": 0, "status": 1})
    if not row:
        raise SmartLeadsStopError("Run no longer exists")
    status = str(row.get("status") or "").lower()
    if status in {"cancelling", "cancelled"}:
        raise SmartLeadsCancelledError("Cancelled by user")


def _audience_prompt_blob(audience: SmartLeadsAudience) -> str:
    return json.dumps(audience.model_dump(exclude_none=True), ensure_ascii=False, indent=2)


# Pacing: Smart Leads runs LLM calls strictly one-after-another (no parallelism). We add a
# short random pause *before* each request and a longer pause *after* each successful response
# so we don't burst the provider (reduces 429 / rate-limit errors).
_LLM_PRE_CALL_JITTER_SEC = (0.2, 0.65)  # min, max uniform sleep before each call
_LLM_POST_CALL_GAP_MIN_SEC = 1.0
_LLM_POST_CALL_GAP_JITTER_SEC = 0.55  # extra random delay after each successful response


async def _llm_json(
    llm_service: LLMService,
    user_id: str,
    ai_provider: str,
    prompt: str,
    timeout: float = 120.0,
) -> Optional[Dict[str, Any]]:
    lo, hi = _LLM_PRE_CALL_JITTER_SEC
    await asyncio.sleep(random.uniform(lo, hi))
    post_gap = _LLM_POST_CALL_GAP_MIN_SEC + random.uniform(0, _LLM_POST_CALL_GAP_JITTER_SEC)
    try:
        text = await llm_service.generate_text(
            user_id,
            ai_provider,
            prompt,
            timeout=timeout,
            inter_request_delay_sec=post_gap,
        )
    except Exception as e:
        msg = str(e).strip() or "Unknown LLM error"
        raise SmartLeadsStopError(f"LLM/API error: {msg}") from e
    return parse_ai_json(text)


async def _llm_json_retry(
    llm_service: LLMService,
    user_id: str,
    ai_provider: str,
    prompt: str,
    *,
    timeout: float = 120.0,
    attempts: int = _LLM_MAX_ATTEMPTS,
    error_label: str = "Invalid LLM JSON response",
) -> Dict[str, Any]:
    last_err: Optional[str] = None
    for attempt in range(1, max(1, attempts) + 1):
        parsed = await _llm_json(llm_service, user_id, ai_provider, prompt, timeout=timeout)
        if isinstance(parsed, dict):
            return parsed
        last_err = f"{error_label} (attempt {attempt}/{attempts})"
    raise SmartLeadsStopError(last_err or error_label)


def _chunks(items: List[Dict[str, Any]], size: int) -> List[List[Dict[str, Any]]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def _domain_from_url(url: Any) -> str:
    s = str(url or "").strip().lower()
    if not s:
        return ""
    s = s.split("://", 1)[-1]
    s = s.split("/", 1)[0]
    if s.startswith("www."):
        s = s[4:]
    return s


def _normalize_email(email: Any) -> str:
    em = str(email or "").strip().lower()
    if not em or "@" not in em:
        return ""
    return em


def _person_lookup_key(person: Dict[str, Any]) -> str:
    pid = str(person.get("id") or "").strip()
    if pid:
        return f"id:{pid}"
    linkedin = str(person.get("linkedin_url") or "").strip().lower()
    if linkedin:
        return f"li:{linkedin}"
    name = str(person.get("full_name") or "").strip().lower()
    company = str(person.get("company_name") or "").strip().lower()
    return f"nm:{name}|{company}"


def _compact_contact_hints_from_serper(organic: Any, limit: int = 8) -> List[Dict[str, str]]:
    """Trim Serper organic rows for LLM context (company contact-email search)."""
    out: List[Dict[str, str]] = []
    if not isinstance(organic, list):
        return out
    for row in organic:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "")[:200]
        link = str(row.get("link") or "")[:500]
        snippet = str(row.get("snippet") or "")[:400]
        if title or snippet:
            out.append({"title": title, "link": link, "snippet": snippet})
        if len(out) >= limit:
            break
    return out


def _extract_emails_from_contact_hints(contact_hints: List[Dict[str, str]], limit: int = 8) -> List[str]:
    """Parse likely email addresses from Serper hint snippets/titles."""
    found: List[str] = []
    seen: set[str] = set()
    for row in contact_hints:
        if not isinstance(row, dict):
            continue
        text = " ".join(
            [
                str(row.get("title") or ""),
                str(row.get("snippet") or ""),
                str(row.get("link") or ""),
            ]
        )
        # Standard email parser with light punctuation cleanup for snippets.
        for m in re.findall(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", text):
            em = _normalize_email(m.strip(".,;:()[]{}<>\"'"))
            if not em or em in seen:
                continue
            seen.add(em)
            found.append(em)
            if len(found) >= limit:
                return found
    return found


async def _llm_score_email_candidates(
    llm_service: LLMService,
    user_id: str,
    ai_provider: str,
    audience: SmartLeadsAudience,
    person: Dict[str, Any],
    company_name: str,
    contact_hints: List[Dict[str, str]],
    candidates_smtp: List[Dict[str, Any]],
) -> Dict[str, int]:
    """
    LLM scores each guessed address 1–10. On failure returns {} (caller defaults to neutral scores).
    """
    if not candidates_smtp:
        return {}
    blob = json.dumps(candidates_smtp, ensure_ascii=False, indent=2)
    hints_json = json.dumps(contact_hints, ensure_ascii=False, indent=2)
    person_mini = {
        k: person.get(k)
        for k in ("full_name", "title", "linkedin_url", "company_name")
        if person.get(k)
    }
    prompt = f"""You score candidate work email addresses for one person at a company.

Audience (ICP):
{_audience_prompt_blob(audience)}

Company name: {company_name}
Person (JSON):
{json.dumps(person_mini, ensure_ascii=False, indent=2)}

Public web snippets that may mention this company's contact addresses or domain (hints only; often generic info@ / support@):
{hints_json}

Candidates with SMTP check results (use only as signals; RCPT can be wrong on catch-all domains):
{blob}

Return ONLY valid JSON:
{{
  "scores": [
    {{"email": "lowercase@domain.com", "score": 8, "note": "short reason"}}
  ]
}}

Rules:
- Include exactly one entry per candidate email from the list above (lowercase).
- score is an integer 1-10 (10 = most likely this person's real inbox).
- Favor patterns that match the person's name and plausible company domain; down-rank obvious role aliases if inconsistent with title.
- If smtp is "invalid", keep score low (1-4) unless the SMTP signal is likely a false negative.
"""
    try:
        parsed = await _llm_json_retry(
            llm_service,
            user_id,
            ai_provider,
            prompt,
            timeout=90.0,
            error_label="Email scoring JSON invalid",
        )
    except SmartLeadsStopError:
        return {}
    out: Dict[str, int] = {}
    for item in parsed.get("scores") or []:
        if not isinstance(item, dict):
            continue
        em = _normalize_email(item.get("email"))
        if not em:
            continue
        try:
            s = int(item.get("score"))
        except (TypeError, ValueError):
            s = 5
        out[em] = max(1, min(10, s))
    return out


def _name_tokens(full_name: Any) -> List[str]:
    raw = str(full_name or "").strip().lower()
    if not raw:
        return []
    parts = re.split(r"[^a-z0-9]+", raw)
    return [p for p in parts if p]


def _email_pattern_candidates(full_name: Any, domain: str) -> List[str]:
    if not domain:
        return []
    toks = _name_tokens(full_name)
    if len(toks) < 2:
        return []
    first, last = toks[0], toks[-1]
    out = [
        f"{first}.{last}@{domain}",
        f"{first}{last}@{domain}",
        f"{first[0]}{last}@{domain}",
        f"{first}.{last[0]}@{domain}",
        f"{first}_{last}@{domain}",
        f"{first}-{last}@{domain}",
        f"{last}.{first}@{domain}",
        f"{first}@{domain}",
    ]
    seen: set[str] = set()
    deduped: List[str] = []
    for email in out:
        em = _normalize_email(email)
        if em and em not in seen:
            seen.add(em)
            deduped.append(em)
    return deduped


def _extract_domain_from_emails(rows: List[Dict[str, Any]]) -> str:
    counts: Dict[str, int] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        em = _normalize_email(row.get("email"))
        if not em:
            continue
        domain = em.split("@", 1)[1]
        counts[domain] = counts.get(domain, 0) + 1
    if not counts:
        return ""
    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]


def _dedupe_companies(companies: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for c in companies:
        if not isinstance(c, dict):
            continue
        linkedin = str(c.get("linkedin_url") or "").strip().lower()
        website_domain = _domain_from_url(c.get("website_url"))
        name = str(c.get("name") or "").strip().lower()
        key = linkedin or website_domain or name
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(c)
        if len(out) >= limit:
            break
    return out


def _dedupe_people(people: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for p in people:
        if not isinstance(p, dict):
            continue
        linkedin = str(p.get("linkedin_url") or "").strip().lower()
        name = str(p.get("full_name") or "").strip().lower()
        title = str(p.get("title") or "").strip().lower()
        key = linkedin or f"{name}|{title}"
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(p)
        if len(out) >= limit:
            break
    return out


def _extract_exact_queries(value: Any, n_expected: int) -> Optional[List[str]]:
    if not isinstance(value, list):
        return None
    queries = [str(q).strip() for q in value if str(q).strip()]
    if len(queries) != n_expected:
        return None
    return queries


def _queries_are_safe(queries: List[str]) -> bool:
    return all(not looks_like_scraping_style_query(q) for q in queries)


def _fallback_company_query(audience: SmartLeadsAudience) -> str:
    tc = (audience.target_company or "").strip()
    ind = (audience.industry or "").strip()
    geo = (audience.geography or "").strip()
    if tc:
        return f"{tc} company LinkedIn"
    if ind and geo:
        return f"{ind} companies {geo}"
    if ind:
        return f"top {ind} companies"
    if geo:
        return f"B2B companies {geo}"
    return "B2B SaaS companies"


def _fallback_company_queries(audience: SmartLeadsAudience, n: int) -> List[str]:
    base = _fallback_company_query(audience)
    ind = (audience.industry or "").strip()
    geo = (audience.geography or "").strip()
    kws = (audience.keywords or "").strip()
    candidates: List[str] = [base]
    if ind and geo:
        candidates.append(f"top {ind} companies {geo}")
    if ind:
        candidates.append(f"{ind} companies LinkedIn")
    if geo:
        candidates.append(f"B2B companies in {geo}")
    if kws:
        candidates.append(f'companies "{kws}"')
    out: List[str] = []
    for q in candidates:
        if q and q not in out and not looks_like_scraping_style_query(q):
            out.append(q)
    while len(out) < n:
        out.append(base)
    return out[:n]


def _fallback_employee_queries(company_name: str, audience: SmartLeadsAudience, n: int) -> List[str]:
    roles = (audience.job_titles_or_roles or "").strip() or "marketing director"
    cands = [
        f'site:linkedin.com/in "{company_name}" {roles}',
        f'site:linkedin.com/in "{company_name}" "Head"',
        f'site:linkedin.com/in "{company_name}" ("VP" OR "Director" OR "Head")',
    ]
    out: List[str] = []
    for q in cands:
        if q and q not in out and not looks_like_scraping_style_query(q):
            out.append(q)
    while len(out) < n:
        out.append(out[0] if out else f'site:linkedin.com/in "{company_name}"')
    return out[:n]


async def run_smart_leads_pipeline(run_id: str, llm_service: LLMService, resume: bool = False) -> None:
    run = await db.smart_leads_runs.find_one({"id": run_id})
    if not run:
        logging.error("smart_leads run not found: %s", run_id)
        return

    user_id = run["user_id"]
    ai_provider = run["ai_provider"]
    max_emails = _run_int(run, "max_emails", _DEFAULT_EMAILS, 1)
    company_pages = _run_int(run, "company_search_pages", _DEFAULT_PAGES_PER_STAGE, 1)
    employee_pages = _run_int(run, "employee_search_pages", _DEFAULT_PAGES_PER_STAGE, 1)
    n_company_queries = _run_int(run, "company_queries", _DEFAULT_COMPANY_QUERIES, 1)
    n_employee_queries = _run_int(run, "employee_queries_per_company", _DEFAULT_EMPLOYEE_QUERIES_PER_COMPANY, 1)
    max_companies = _run_int(run, "max_companies", _DEFAULT_MAX_COMPANIES, 1)
    max_people_per_company = _run_int(run, "max_people_per_company", _DEFAULT_PEOPLE_PER_COMPANY, 1)
    audience = SmartLeadsAudience(**(run.get("audience") or {}))
    serper_key = await get_serper_api_key_for_user(user_id)
    if not serper_key:
        await _update_run(
            run_id,
            status="failed",
            stage="error",
            stage_detail="Serper API key not configured",
            error="Add your Serper API key in Settings → Integrations (or set SERPER_API_KEY on the server).",
            progress_percent=0,
        )
        return

    zerobounce_key = await get_zerobounce_api_key_for_user(user_id)
    if zerobounce_key:
        logging.info("Smart Leads run_id=%s: ZeroBounce key found (len=%d)", run_id, len(zerobounce_key))
    else:
        logging.warning("Smart Leads run_id=%s: ZeroBounce key not found — validation will use basic checks only", run_id)

    # --- Resume: use saved companies/people and skip finished phases when possible ---
    resume_mode = "full"
    company_records: List[Dict[str, Any]] = []
    all_people: List[Dict[str, Any]] = []

    if resume:
        if run.get("status") != "failed":
            logging.warning("smart_leads resume skipped run_id=%s status=%s", run_id, run.get("status"))
            resume = False
        else:
            existing_companies = await db.smart_leads_companies.find(
                {"run_id": run_id, "user_id": user_id},
                {"_id": 0},
            ).to_list(None)
            existing_people = await db.smart_leads_people.find(
                {"run_id": run_id, "user_id": user_id},
                {"_id": 0},
            ).to_list(None)
            nc, np = len(existing_companies), len(existing_people)
            if nc > 0 and np == 0:
                resume_mode = "from_people"
                company_records = existing_companies
                # Clean partial people if any edge-case duplicates
                await db.smart_leads_people.delete_many({"run_id": run_id, "user_id": user_id})
            elif nc > 0 and np > 0:
                resume_mode = "from_email"
                company_records = existing_companies
                all_people = existing_people
                await db.smart_leads_emails.delete_many({"run_id": run_id, "user_id": user_id})
            else:
                resume_mode = "full"

    stats: Dict[str, Any] = {"companies": 0, "people": 0, "emails": 0, "mx_ok": 0}
    if resume_mode == "from_people":
        stats["companies"] = len(company_records)
    elif resume_mode == "from_email":
        stats["companies"] = len(company_records)
        stats["people"] = len(all_people)

    try:
        await _ensure_not_cancelled(run_id, user_id)
        if resume:
            await db.smart_leads_runs.update_one(
                {"id": run_id},
                {"$set": {"error": None, "updated_at": _now()}, "$unset": {"completed_at": ""}},
            )

        if resume_mode == "full":
            await _update_run(
                run_id,
                status="running",
                stage="company_queries",
                stage_detail="Generating company search queries with AI",
                progress_percent=5,
            )
        elif resume_mode == "from_people":
            await _update_run(
                run_id,
                status="running",
                stage="employee_queries",
                stage_detail="Resuming — finding people at each company",
                progress_percent=45,
            )
        else:  # from_email
            await _update_run(
                run_id,
                status="running",
                stage="email_generation",
                stage_detail="Resuming — guessing work emails",
                progress_percent=82,
            )

        if resume_mode == "full":
            companies: List[Dict[str, Any]] = []
            await _ensure_not_cancelled(run_id, user_id)
            company_prompt = f"""You help build **Google search queries** to discover companies matching an ICP. Results are used via a search API (Serper): queries must look like what a real person would type into Google.

Target audience (ICP) JSON:
{_audience_prompt_blob(audience)}

Return ONLY valid JSON: one object with key "queries" mapping to an array of exactly {n_company_queries} strings.
Shape: {{"queries": ["...", "..."]}} with length {n_company_queries}.

CRITICAL — Serper / search API policy:
- Use **natural, short, informational or discovery** queries (company discovery, industry + geography lists, best tools, etc.).
- **Do NOT** use scraping-style or bulk-data phrasing, for example:
  "list of companies ... with emails", "email database", "startup database download", "company leads ... emails",
  "bulk leads", "CSV", "export", "scraping", or anything that asks for mass personal contact data.
- **Good examples (buyer-side, not vendor roundups):** "mid-market retail brands hiring ecommerce UK",
  "B2B manufacturing companies Texas", "Series B fintech startups USA", "healthcare providers digital patient tools",
  "SaaS companies Bangalore 50-200 employees".
- **Avoid example styles that mostly return seller content:** e.g. "best CRM tools", "top X software vendors",
  "alternatives to [product]"—those pages are usually written **by competitors** marketing the category.
- You may add "LinkedIn" or site:linkedin.com/company **sparingly** to bias toward **prospect company** pages
  (organizations to sell to), not competitor homepages.
- Vary angles across the {n_company_queries} queries (industry, geo, segment, hiring, news, associations, "companies in ...").
- The array must have exactly {n_company_queries} entries (no more, no fewer).
- No text outside the JSON object.

COMPETITOR vs CUSTOMER CONTENT (queries — critical):
- The user wants **companies to sell to** (their customers), surfaced via searches where **buyers and practitioners**
  show up—not search result pages dominated by **rival vendors** publishing category marketing.
- Infer what the user likely sells from industry, keywords, audience notes, and target company. **Do not** write queries
  whose top results will skew toward **competitor-owned content**: vendor blogs, "best tools" listicles, software
  comparison sites, affiliate roundups, or head-to-head competitor brands—unless the audience explicitly asks to
  research competitors.
- **Prefer** query angles that surface **customer/buyer contexts**: organizations in the target industry and region,
  hiring at those companies, trade news naming real companies, industry associations or events, case studies or
  press **about** end-user companies, forums or communities where **customers** discuss problems (not where vendors pitch).
- Still prefer **buyers, users, or adjacent** operating companies—not brands that compete head-to-head with the user’s
  offering.
"""
            company_queries: Optional[List[str]] = None
            for attempt in range(1, _LLM_MAX_ATTEMPTS + 1):
                cq_parsed = await _llm_json_retry(
                    llm_service,
                    user_id,
                    ai_provider,
                    company_prompt,
                    error_label="Company query generation failed to return valid JSON",
                )
                company_queries = _extract_exact_queries(cq_parsed.get("queries"), n_company_queries)
                if company_queries and _queries_are_safe(company_queries):
                    break
                if attempt == _LLM_MAX_ATTEMPTS:
                    logging.warning(
                        "company query generation fallback run_id=%s after %s attempts",
                        run_id,
                        _LLM_MAX_ATTEMPTS,
                    )
                    company_queries = _fallback_company_queries(audience, n_company_queries)
            assert company_queries is not None and len(company_queries) == n_company_queries

            await _update_run(
                run_id,
                stage="company_search",
                stage_detail="Searching Google via Serper (companies)",
                progress_percent=12,
            )

            raw_organic: List[Dict[str, Any]] = []
            for qi, q in enumerate(company_queries):
                await _ensure_not_cancelled(run_id, user_id)
                for page in range(1, company_pages + 1):
                    await _ensure_not_cancelled(run_id, user_id)
                    try:
                        serp = await serper_search(serper_key, q, page=page, num=10)
                    except Exception as e:
                        raise SmartLeadsStopError(f"Serper/API error during company search: {e}") from e
                    organic = serp.get("organic") or []
                    # Empty page: no more results for this query — skip remaining pages for this query only.
                    if not organic:
                        break
                    for row in organic:
                        if isinstance(row, dict):
                            raw_organic.append(
                                {
                                    "query_index": qi,
                                    "page": page,
                                    "title": row.get("title"),
                                    "link": row.get("link"),
                                    "snippet": row.get("snippet"),
                                    "position": row.get("position"),
                                }
                            )
                    await _update_run(
                        run_id,
                        stage_detail=f"Company search query {qi + 1}/{len(company_queries)}, page {page}",
                        progress_percent=12 + min(20, qi * 7 + page * 2),
                    )

            companies = []
            if raw_organic:
                await _update_run(
                    run_id,
                    stage="company_normalize",
                    stage_detail="Structuring company results with AI",
                    progress_percent=35,
                )
                company_chunks = _chunks(raw_organic, _COMPANY_NORMALIZE_CHUNK_SIZE)
                all_companies: List[Dict[str, Any]] = []
                for chunk_i, company_chunk in enumerate(company_chunks, start=1):
                    await _ensure_not_cancelled(run_id, user_id)
                    await _update_run(
                        run_id,
                        stage="company_normalize",
                        stage_detail=f"Structuring company results with AI (batch {chunk_i}/{len(company_chunks)})",
                        progress_percent=35 + min(8, chunk_i),
                    )
                    norm_prompt = f"""You normalize web search results into companies for sales prospecting.

Audience JSON:
{_audience_prompt_blob(audience)}

Raw organic search results (JSON array):
{json.dumps(company_chunk, ensure_ascii=False, indent=2)}

Return ONLY valid JSON:
{{
  "companies": [
    {{
      "name": "company display name",
      "linkedin_url": "https://www.linkedin.com/company/... or null",
      "website_url": "https://... or null",
      "snippet": "short snippet from results"
    }}
  ]
}}

Rules:
- Include as many distinct, plausible companies from the results as fit the ICP, up to {max_companies} total; dedupe by LinkedIn company URL or domain when possible.
- Prefer rows that look like real companies matching the ICP.
- linkedin_url must be linkedin.com/company/ when present.

COMPETITOR FILTER (critical — do not include competitors):
- From the audience JSON, infer what product or service **our user** sells or offers (use industry, keywords, audience notes, job titles, and any company/site hints).
- **Exclude** any company that appears to be a **direct competitor** in the same product category (another vendor selling the same core offering). Example: if the user sells sales engagement / outreach software, **do not** include other major outreach or sales-engagement SaaS vendors as “prospects” unless the audience explicitly names them as targets to include.
- Prefer **potential customers** (brands that might *buy* the user’s solution) over **rival vendors**.
- If you are unsure whether a company is a competitor, **leave it out** rather than include it.
"""
                    norm = await _llm_json_retry(
                        llm_service,
                        user_id,
                        ai_provider,
                        norm_prompt,
                        timeout=120.0,
                        error_label="Company normalization failed to return valid JSON",
                    )
                    if isinstance(norm.get("companies"), list):
                        all_companies.extend([c for c in norm["companies"] if isinstance(c, dict)])
                companies = _dedupe_companies(all_companies, max_companies)
            else:
                await _update_run(
                    run_id,
                    stage="company_normalize",
                    stage_detail="No Serper results — skipped company structuring",
                    progress_percent=35,
                )

            company_records = []
            for c in companies[:max_companies]:
                cid = str(uuid.uuid4())
                rec = {
                    "id": cid,
                    "run_id": run_id,
                    "user_id": user_id,
                    "name": c.get("name"),
                    "linkedin_url": c.get("linkedin_url"),
                    "website_url": c.get("website_url"),
                    "snippet": c.get("snippet"),
                    "created_at": _now(),
                }
                company_records.append(rec)
                await db.smart_leads_companies.insert_one(rec)

            stats["companies"] = len(company_records)
            await _update_run(run_id, stats=dict(stats), progress_percent=45)

        if resume_mode != "from_email":
            all_people = []
            employee_queries_by_company: Dict[str, List[str]] = {}
            company_name_by_id: Dict[str, str] = {str(c.get("id")): str(c.get("name") or "Company") for c in company_records}

            if company_records:
                total_batches = (len(company_records) + _EMPLOYEE_QUERY_BATCH_SIZE - 1) // _EMPLOYEE_QUERY_BATCH_SIZE
                for batch_start in range(0, len(company_records), _EMPLOYEE_QUERY_BATCH_SIZE):
                    await _ensure_not_cancelled(run_id, user_id)
                    batch = company_records[batch_start : batch_start + _EMPLOYEE_QUERY_BATCH_SIZE]
                    batch_num = batch_start // _EMPLOYEE_QUERY_BATCH_SIZE + 1
                    await _update_run(
                        run_id,
                        stage="employee_queries",
                        stage_detail=f"Generating people queries with AI (batch {batch_num}/{total_batches})",
                        progress_percent=45,
                    )
                    batch_companies = [
                        {
                            "company_id": c.get("id"),
                            "company_name": c.get("name"),
                            "company_linkedin": c.get("linkedin_url"),
                        }
                        for c in batch
                    ]
                    batch_prompt = f"""Build Google search queries to find people (LinkedIn profiles) for each company in a batch.

Audience / target roles:
{_audience_prompt_blob(audience)}

Companies (JSON):
{json.dumps(batch_companies, ensure_ascii=False, indent=2)}

Return ONLY valid JSON:
{{
  "companies": [
    {{
      "company_id": "must match one company_id from input",
      "queries": ["...", "..."]
    }}
  ]
}}

Rules:
- Include every input company_id exactly once.
- For each company, return exactly {n_employee_queries} natural Google queries.
- Prefer role + company + LinkedIn patterns; site:linkedin.com/in is allowed.
- Do NOT ask for emails, databases, downloads, CSV, exports, or scraping-style queries.
- No text outside the JSON object.
"""
                    batch_queries: Optional[Dict[str, List[str]]] = None
                    for attempt in range(1, _LLM_MAX_ATTEMPTS + 1):
                        batch_parsed = await _llm_json_retry(
                            llm_service,
                            user_id,
                            ai_provider,
                            batch_prompt,
                            error_label="Employee query batch generation failed to return valid JSON",
                        )
                        raw_companies = batch_parsed.get("companies")
                        if not isinstance(raw_companies, list):
                            if attempt == _LLM_MAX_ATTEMPTS:
                                raise SmartLeadsStopError("Employee query batch output missing 'companies' array")
                            continue
                        candidate: Dict[str, List[str]] = {}
                        for row in raw_companies:
                            if not isinstance(row, dict):
                                continue
                            cid = str(row.get("company_id") or "").strip()
                            if not cid or cid not in company_name_by_id:
                                continue
                            q = _extract_exact_queries(row.get("queries"), n_employee_queries)
                            if q and _queries_are_safe(q):
                                candidate[cid] = q
                        expected_ids = {str(c.get("id")) for c in batch}
                        if expected_ids.issubset(set(candidate.keys())):
                            batch_queries = candidate
                            break
                        if attempt == _LLM_MAX_ATTEMPTS:
                            logging.warning(
                                "employee query batch fallback run_id=%s batch=%s/%s (%s/%s valid)",
                                run_id,
                                batch_num,
                                total_batches,
                                len(candidate),
                                len(expected_ids),
                            )
                            batch_queries = dict(candidate)
                            for comp_row in batch:
                                cid = str(comp_row.get("id"))
                                if cid not in batch_queries:
                                    cname = str(comp_row.get("name") or "Company")
                                    batch_queries[cid] = _fallback_employee_queries(
                                        cname,
                                        audience,
                                        n_employee_queries,
                                    )
                    assert batch_queries is not None
                    for cid, q in batch_queries.items():
                        employee_queries_by_company[cid] = q

            for ci, comp in enumerate(company_records):
                await _ensure_not_cancelled(run_id, user_id)
                cname = comp.get("name") or "Company"
                await _update_run(
                    run_id,
                    stage="employee_queries",
                    stage_detail=f"Finding people at: {cname}",
                    progress_percent=45 + min(25, ci * 5),
                )

                eq_seed = employee_queries_by_company.get(str(comp.get("id")))
                if not eq_seed:
                    logging.warning("employee query missing fallback run_id=%s company=%s", run_id, cname)
                    eq_seed = _fallback_employee_queries(cname, audience, n_employee_queries)
                eq_list = eq_seed

                emp_organic: List[Dict[str, Any]] = []
                for ei, eq in enumerate(eq_list):
                    await _ensure_not_cancelled(run_id, user_id)
                    for page in range(1, employee_pages + 1):
                        await _ensure_not_cancelled(run_id, user_id)
                        try:
                            serp = await serper_search(serper_key, eq, page=page, num=10)
                        except Exception as e:
                            raise SmartLeadsStopError(f"Serper/API error during people search: {e}") from e
                        organic = serp.get("organic") or []
                        # Empty page: skip further pages for this employee query.
                        if not organic:
                            break
                        for row in organic:
                            if isinstance(row, dict):
                                emp_organic.append(
                                    {
                                        "company_id": comp["id"],
                                        "title": row.get("title"),
                                        "link": row.get("link"),
                                        "snippet": row.get("snippet"),
                                    }
                                )

                plist: List[Dict[str, Any]] = []
                if emp_organic:
                    people_chunks = _chunks(emp_organic, _PEOPLE_EXTRACT_CHUNK_SIZE)
                    all_people_for_company: List[Dict[str, Any]] = []
                    for chunk_i, people_chunk in enumerate(people_chunks, start=1):
                        await _ensure_not_cancelled(run_id, user_id)
                        extract_prompt = f"""Extract individual professional leads from search results.

Company: {cname}
Audience:
{_audience_prompt_blob(audience)}

Search results (JSON):
{json.dumps(people_chunk, ensure_ascii=False, indent=2)}

Return ONLY valid JSON:
{{
  "people": [
    {{
      "full_name": "string or null",
      "title": "job title or null",
      "linkedin_url": "https://www.linkedin.com/in/... or null",
      "snippet": "short"
    }}
  ]
}}

Rules:
- At most {max_people_per_company} people; dedupe by linkedin_url.
- Only include rows that plausibly match the audience roles.
- Do not treat employees of **direct competitor vendors** (same product category as the user’s business) as target leads unless the audience explicitly asks for them—prefer people at prospect/customer organizations.
"""
                        people_parsed = await _llm_json_retry(
                            llm_service,
                            user_id,
                            ai_provider,
                            extract_prompt,
                            timeout=120.0,
                            error_label="People extraction failed to return valid JSON",
                        )
                        if isinstance(people_parsed.get("people"), list):
                            all_people_for_company.extend(
                                [p for p in people_parsed["people"] if isinstance(p, dict)]
                            )
                    plist = _dedupe_people(all_people_for_company, max_people_per_company)

                for p in plist:
                    pid = str(uuid.uuid4())
                    prow = {
                        "id": pid,
                        "run_id": run_id,
                        "user_id": user_id,
                        "company_id": comp["id"],
                        "company_name": cname,
                        "full_name": p.get("full_name"),
                        "title": p.get("title"),
                        "linkedin_url": p.get("linkedin_url"),
                        "snippet": p.get("snippet"),
                        "created_at": _now(),
                    }
                    all_people.append(prow)
                    await db.smart_leads_people.insert_one(prow)

        stats["people"] = len(all_people)
        await _update_run(run_id, stats=dict(stats), progress_percent=78)

        await _update_run(
            run_id,
            stage="email_generation",
            stage_detail=(
                "Generating email candidates and validating MX"
                if all_people
                else "No people extracted — skipped email generation"
            ),
            progress_percent=82,
        )

        llm_email_rows: List[Dict[str, Any]] = []
        company_contact_hints: Dict[str, List[Dict[str, str]]] = {}
        if all_people:
            await _update_run(
                run_id,
                stage="email_generation",
                stage_detail="Fetching company contact-email search hints (Serper)",
                progress_percent=83,
            )
            for comp in company_records:
                await _ensure_not_cancelled(run_id, user_id)
                cid_h = str(comp.get("id") or "")
                cname_h = str(comp.get("name") or "Company").strip() or "Company"
                if not cid_h:
                    continue
                domain_h = _domain_from_url(comp.get("website_url"))
                # Build 2–3 hint queries: generic contact page, email format, and
                # domain-scoped exposure (only when domain is known).
                hint_queries = [
                    f'"{cname_h}" contact email',
                    f'"{cname_h}" email format',
                ]
                if domain_h:
                    hint_queries.append(f'"@{domain_h}"')
                merged_hints: List[Dict[str, str]] = []
                seen_links: set[str] = set()
                for q_hint in hint_queries:
                    await _ensure_not_cancelled(run_id, user_id)
                    try:
                        serp_h = await serper_search(serper_key, q_hint, page=1, num=5)
                        for row in _compact_contact_hints_from_serper(serp_h.get("organic"), 5):
                            link_key = row.get("link", "")
                            if link_key not in seen_links:
                                seen_links.add(link_key)
                                merged_hints.append(row)
                    except Exception as e:
                        logging.warning(
                            "Smart Leads contact hint search failed run_id=%s company=%s query=%r: %s",
                            run_id,
                            cname_h,
                            q_hint,
                            e,
                        )
                company_contact_hints[cid_h] = merged_hints[:12]

            # Persist company-level emails extracted from hint search rows so UI can show them.
            for comp in company_records:
                cid_h = str(comp.get("id") or "")
                if not cid_h:
                    continue
                hint_rows = company_contact_hints.get(cid_h, [])
                company_emails = _extract_emails_from_contact_hints(hint_rows, limit=8)
                comp["company_emails"] = company_emails
                await db.smart_leads_companies.update_one(
                    {"id": cid_h, "run_id": run_id, "user_id": user_id},
                    {"$set": {"company_emails": company_emails}},
                )

            n_cos = max(1, len(company_records))
            for ci, comp in enumerate(company_records):
                await _ensure_not_cancelled(run_id, user_id)
                plist = [p for p in all_people if p.get("company_id") == comp.get("id")]
                if not plist:
                    continue
                cname = comp.get("name") or "Company"
                cid_loop = str(comp.get("id") or "")
                hint_rows = company_contact_hints.get(cid_loop, [])
                # One LLM request per company (chunked if many people at that company).
                for chunk_start in range(0, len(plist), _EMAIL_GUESS_CHUNK):
                    await _ensure_not_cancelled(run_id, user_id)
                    chunk = plist[chunk_start : chunk_start + _EMAIL_GUESS_CHUNK]
                    batch_num = chunk_start // _EMAIL_GUESS_CHUNK + 1
                    n_batches = (len(plist) + _EMAIL_GUESS_CHUNK - 1) // _EMAIL_GUESS_CHUNK
                    detail = (
                        f"Guessing emails: {cname} ({len(chunk)} people"
                        + (f", batch {batch_num}/{n_batches}" if n_batches > 1 else "")
                        + ")"
                    )
                    # Spread progress 82→99 across companies (sub-chunks update detail only).
                    prog = 82 + min(17, int(17 * (ci + (chunk_start + len(chunk)) / max(len(plist), 1)) / n_cos))
                    await _update_run(
                        run_id,
                        stage="email_generation",
                        stage_detail=detail,
                        progress_percent=prog,
                    )
                    people_json = [
                        {
                            "person_id": p.get("id"),
                            "full_name": p.get("full_name"),
                            "company_name": p.get("company_name"),
                            "title": p.get("title"),
                            "linkedin_url": p.get("linkedin_url"),
                        }
                        for p in chunk
                    ]
                    email_prompt = f"""You generate plausible work email addresses for outreach validation.

Audience:
{_audience_prompt_blob(audience)}

Company: {cname}

Public web snippets (extra Serper query for this company — contact / info emails, domains, press pages; use as clues only):
{json.dumps(hint_rows, ensure_ascii=False, indent=2)}

People at this company only (JSON):
{json.dumps(people_json, ensure_ascii=False, indent=2)}

Return ONLY valid JSON:
{{
  "emails": [
    {{
      "person_id": "required; must match one person_id from input",
      "emails": ["lower.case@companydomain.com", "alt.pattern@companydomain.com"],
      "full_name": "optional",
      "company_name": "optional",
      "patterns": ["first.last@domain", "f.last@domain"],
      "confidence": "low|medium|high"
    }}
  ]
}}

Rules:
- Include every person_id from input exactly once when possible.
- For each person, return 2-6 candidate emails using different realistic corporate patterns.
- Use realistic corporate domains (infer from company name / known email patterns); do not invent random domains that cannot exist.
- If domain unknown for someone, skip that person rather than fabricating.
- No duplicate emails within a person.
- The system runs SMTP RCPT checks on each guess and has the LLM score all candidates (1-10) for ranking; no live test messages are sent from Smart Leads.
"""

                    em_parsed = await _llm_json(
                        llm_service, user_id, ai_provider, email_prompt, timeout=120.0
                    )
                    if em_parsed and isinstance(em_parsed.get("emails"), list):
                        llm_email_rows.extend([e for e in em_parsed["emails"] if isinstance(e, dict)])

        # Build per-company fallback domains from known websites and LLM outputs.
        company_domain: Dict[str, str] = {}
        company_name_by_id = {str(c.get("id")): str(c.get("name") or "") for c in company_records}
        for comp in company_records:
            cid = str(comp.get("id"))
            direct = _domain_from_url(comp.get("website_url"))
            if direct:
                company_domain[cid] = direct
        if llm_email_rows:
            for cid, cname in company_name_by_id.items():
                candidates = [
                    row
                    for row in llm_email_rows
                    if str(row.get("company_id") or "").strip() == cid
                    or str(row.get("company_name") or "").strip().lower() == cname.strip().lower()
                ]
                if candidates and not company_domain.get(cid):
                    inferred = _extract_domain_from_emails(candidates)
                    if inferred:
                        company_domain[cid] = inferred

        people_by_lookup: Dict[str, Dict[str, Any]] = {}
        people_by_id: Dict[str, Dict[str, Any]] = {}
        for p in all_people:
            people_by_lookup[_person_lookup_key(p)] = p
            pid = str(p.get("id") or "").strip()
            if pid:
                people_by_id[pid] = p

        llm_candidates_by_person: Dict[str, List[Dict[str, Any]]] = {}
        for row in llm_email_rows:
            pid = str(row.get("person_id") or "").strip()
            target: Optional[Dict[str, Any]] = people_by_id.get(pid) if pid else None
            if not target:
                pseudo = {
                    "id": "",
                    "linkedin_url": row.get("linkedin_url"),
                    "full_name": row.get("full_name"),
                    "company_name": row.get("company_name"),
                }
                target = people_by_lookup.get(_person_lookup_key(pseudo))
            if not target:
                continue
            tkey = _person_lookup_key(target)
            llm_candidates_by_person.setdefault(tkey, []).append(row)

        inserted_emails = 0
        tested_candidates = 0
        people_evaluated = 0
        n_people_validate = len(all_people)
        per_person_cap = 10
        _validate_with_zb = functools.partial(
            validate_email_full,
            zerobounce_api_key=zerobounce_key,
        )
        if n_people_validate:
            await _update_run(
                run_id,
                stage="email_generation",
                stage_detail=f"Validating email candidates (0/{n_people_validate})…",
                progress_percent=94,
            )
        for person in all_people:
            await _ensure_not_cancelled(run_id, user_id)
            people_evaluated += 1
            if n_people_validate and (
                people_evaluated == 1
                or people_evaluated == n_people_validate
                or people_evaluated % 5 == 0
            ):
                vprog = 94 + min(5, int(5 * people_evaluated / n_people_validate))
                await _update_run(
                    run_id,
                    stage="email_generation",
                    stage_detail=(
                        f"Validating email candidates ({people_evaluated}/{n_people_validate})…"
                    ),
                    progress_percent=vprog,
                )
            pkey = _person_lookup_key(person)
            cid = str(person.get("company_id") or "")
            domain = company_domain.get(cid, "")

            candidate_rows = llm_candidates_by_person.get(pkey, [])
            candidate_emails: List[str] = []
            for row in candidate_rows:
                em = _normalize_email(row.get("email"))
                if em:
                    candidate_emails.append(em)
                raw_multi = row.get("emails")
                if isinstance(raw_multi, list):
                    candidate_emails.extend([_normalize_email(x) for x in raw_multi])
            candidate_emails.extend(_email_pattern_candidates(person.get("full_name"), domain))
            seen_cands: set[str] = set()
            deduped_candidates: List[str] = []
            for em in candidate_emails:
                if not em or em in seen_cands:
                    continue
                if looks_like_placeholder_name_email(em):
                    continue
                seen_cands.add(em)
                deduped_candidates.append(em)
            deduped_candidates = deduped_candidates[:per_person_cap]
            if not deduped_candidates:
                continue

            cand_validations: List[tuple[str, Dict[str, Any]]] = []
            for em in deduped_candidates:
                await _ensure_not_cancelled(run_id, user_id)
                tested_candidates += 1
                validation = await asyncio.to_thread(_validate_with_zb, em, None)
                cand_validations.append((em, validation))

            cname_for_llm = (
                str(person.get("company_name") or "").strip()
                or str(company_name_by_id.get(cid, "") or "").strip()
                or "Company"
            )
            candidates_for_llm = [
                {
                    "email": em,
                    "smtp": v.get("smtp_status"),
                    "catch_all_domain": bool(v.get("catch_all")),
                }
                for em, v in cand_validations
            ]
            score_by_email: Dict[str, int] = {em: 5 for em, _ in cand_validations}
            scored = await _llm_score_email_candidates(
                llm_service,
                user_id,
                ai_provider,
                audience,
                person,
                cname_for_llm,
                company_contact_hints.get(cid, []),
                candidates_for_llm,
            )
            score_by_email.update(scored)
            for em, _ in cand_validations:
                score_by_email.setdefault(em, 5)

            def _finalize_rank(em: str, validation: Dict[str, Any]) -> tuple[int, ...]:
                catch_all = bool(validation.get("catch_all"))
                validation["risk_score"] = risk_score(
                    str(validation.get("normalized") or em),
                    str(validation.get("smtp_status") or ""),
                    catch_all,
                )
                # mailbox_verified_strong is already set by validate_email_full;
                # re-use it directly rather than recomputing with stale smtp logic.
                strong_mailbox = bool(validation.get("mailbox_verified_strong"))
                validation["valid"] = strong_mailbox
                validation["llm_candidate_score"] = score_by_email.get(em, 5)
                zb_ok = smart_leads_email_qualifies(validation)
                usable = zb_ok
                llm_s = score_by_email.get(em, 5)
                return (
                    0 if usable else 1,
                    int(validation.get("risk_score", 100)),
                    0 if strong_mailbox else 1,
                    0 if catch_all else 2,
                    -llm_s,
                )

            ranked_pairs: List[tuple[tuple[int, ...], str, Dict[str, Any]]] = []
            for em, validation in cand_validations:
                ranked_pairs.append((_finalize_rank(em, validation), em, validation))
            ranked_pairs.sort(key=lambda x: x[0])

            chosen_em: Optional[str] = None
            chosen_validation: Optional[Dict[str, Any]] = None
            for _rank, em, validation in ranked_pairs:
                if smart_leads_email_qualifies(validation):
                    chosen_em = em
                    chosen_validation = validation
                    break

            # Fallback: if no strongly-qualified mailbox exists, keep the best
            # catch-all candidate so users can still review risky options.
            if not chosen_em or not chosen_validation:
                for _rank, em, validation in ranked_pairs:
                    if (
                        str(validation.get("smtp_status") or "") == "valid"
                        and bool(validation.get("catch_all"))
                        and bool(validation.get("syntax_ok"))
                        and bool(validation.get("mx_ok"))
                        and bool(validation.get("stop_forum_spam_ok"))
                    ):
                        chosen_em = em
                        chosen_validation = validation
                        break

            if not chosen_em or not chosen_validation:
                continue

            is_catch_all_risky = bool(chosen_validation.get("catch_all"))
            best_row = {
                "email": chosen_em,
                "full_name": person.get("full_name"),
                "company_name": person.get("company_name"),
                "pattern": None,
                "confidence": "medium" if is_catch_all_risky else "high",
                "person_id": person.get("id"),
                "tested_candidates": deduped_candidates,
                "llm_candidate_score": score_by_email.get(chosen_em, 5),
            }
            best_validation = chosen_validation

            # Cap how many qualifying rows are persisted across the run.
            if inserted_emails >= max_emails:
                continue
            eid = str(uuid.uuid4())
            await db.smart_leads_emails.insert_one(
                {
                    "id": eid,
                    "run_id": run_id,
                    "user_id": user_id,
                    "email": best_row.get("email"),
                    "full_name": best_row.get("full_name"),
                    "company_name": best_row.get("company_name"),
                    "pattern": best_row.get("pattern"),
                    "confidence": best_row.get("confidence"),
                    "validation": best_validation,
                    "emails_json": json.dumps(best_row, ensure_ascii=False),
                    "created_at": _now(),
                }
            )
            inserted_emails += 1

        stats["emails"] = inserted_emails
        stats["mx_ok"] = inserted_emails
        stats["tested_candidates"] = tested_candidates
        stats["people_evaluated"] = people_evaluated

        await _update_run(
            run_id,
            status="completed",
            stage="done",
            stage_detail="Completed",
            progress_percent=100,
            stats=dict(stats),
            completed=True,
        )
    except SmartLeadsCancelledError as e:
        logging.info("Smart Leads pipeline cancelled run_id=%s: %s", run_id, e)
        await _update_run(
            run_id,
            status="cancelled",
            stage="cancelled",
            stage_detail="Cancelled by user",
            error=None,
            stats=dict(stats),
            completed=True,
        )
    except SmartLeadsStopError as e:
        logging.warning("Smart Leads pipeline stopped early run_id=%s: %s", run_id, e)
        await _update_run(
            run_id,
            status="failed",
            stage="stopped",
            stage_detail=str(e)[:200],
            error=str(e)[:2000],
            stats=dict(stats),
            completed=True,
        )
    except Exception as e:
        logging.exception("Smart Leads pipeline failed run_id=%s", run_id)
        await _update_run(
            run_id,
            status="failed",
            stage="error",
            stage_detail=str(e)[:200],
            error=str(e)[:2000],
            stats=dict(stats),
            completed=True,
        )
