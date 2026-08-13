"""
Per-recipient campaign enrichment:
LLM → search queries → Serper (snippets) → LLM picks 0–2 Serper URLs →
fetch pages (SSRF-safe, robots.txt) → LLM compacts snippets + page text →
LLM personalizes template. Reuses Smart Leads helpers and Serper integration.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
from typing import Any, Dict, List, Optional, Set

from services.enrichment_page_fetch import fetch_enrichment_pages
from services.serper_helpers import get_serper_api_key_for_user, serper_search
from services.smart_leads_helpers import (
    parse_ai_json,
    queries_from_llm,
    sanitize_query_list,
)

_MAX_READ_MORE_URLS = 2
_LLM_PRE = (0.15, 0.45)
_LLM_POST_GAP = 0.85


def _email_domain(email: Optional[str]) -> str:
    e = (email or "").strip().lower()
    if "@" not in e:
        return ""
    return e.split("@", 1)[-1].strip()


def _merge_organic_rows(serp_results: List[Dict[str, Any]], max_rows: int = 20) -> List[Dict[str, str]]:
    seen: set[str] = set()
    out: List[Dict[str, str]] = []
    for serp in serp_results:
        organic = serp.get("organic") if isinstance(serp, dict) else None
        if not isinstance(organic, list):
            continue
        for row in organic:
            if not isinstance(row, dict):
                continue
            link = str(row.get("link") or "").strip()
            key = link or str(row.get("title") or "") + str(row.get("snippet") or "")
            if key in seen:
                continue
            seen.add(key)
            title = str(row.get("title") or "")[:200]
            snippet = str(row.get("snippet") or "")[:400]
            if title or snippet:
                out.append({"title": title, "link": link[:500], "snippet": snippet})
            if len(out) >= max_rows:
                return out
    return out


async def _llm_json(
    llm_service,
    user_id: str,
    provider: str,
    prompt: str,
    *,
    timeout: float = 90.0,
) -> Optional[Dict[str, Any]]:
    lo, hi = _LLM_PRE
    await asyncio.sleep(random.uniform(lo, hi))
    try:
        text = await llm_service.generate_text(
            user_id,
            provider,
            prompt,
            timeout=timeout,
            inter_request_delay_sec=_LLM_POST_GAP,
        )
    except Exception as e:
        logging.warning("campaign enrichment LLM call failed: %s", e)
        return None
    return parse_ai_json(text)


def _fallback_search_query(contact: Dict[str, Any]) -> str:
    parts = [
        str(contact.get("company") or "").strip(),
        str(contact.get("first_name") or "").strip(),
        str(contact.get("last_name") or "").strip(),
    ]
    q = " ".join(p for p in parts if p).strip()
    if not q:
        q = _email_domain(str(contact.get("email") or "")) or "company"
    return q[:240]


def _resolve_provider(campaign: Dict[str, Any]) -> str:
    return (
        (campaign.get("external_enrichment_provider") or "").strip()
        or (campaign.get("ai_generation_provider") or "").strip()
        or "openai"
    )


def _read_more_urls_from_llm(
    parsed: Optional[Dict[str, Any]],
    allowed_urls: Set[str],
    *,
    max_n: int = _MAX_READ_MORE_URLS,
) -> List[str]:
    """Keep only URLs that appear exactly in Serper organic results."""
    if not parsed or not allowed_urls:
        return []
    raw = parsed.get("read_more_urls")
    if not isinstance(raw, list):
        return []
    out: List[str] = []
    for x in raw:
        s = str(x).strip()
        if s in allowed_urls and s not in out:
            out.append(s)
        if len(out) >= max_n:
            break
    return out


def _clean_str(value: Any, max_len: int) -> Optional[str]:
    text = str(value or "").strip()
    if not text:
        return None
    return text[:max_len]


def _clean_str_list(value: Any, *, max_n: int, max_len: int) -> List[str]:
    if not isinstance(value, list):
        return []
    out: List[str] = []
    for item in value:
        text = _clean_str(item, max_len)
        if text and text not in out:
            out.append(text)
        if len(out) >= max_n:
            break
    return out


def _normalize_lead_object_from_llm(
    llm_lead_object: Any,
    *,
    first: str,
    last: str,
    title: str,
    linkedin: str,
    company: str,
    email: str,
    website: str,
    compact_blob: str,
) -> Dict[str, Any]:
    obj = llm_lead_object if isinstance(llm_lead_object, dict) else {}

    person_name_default = " ".join(x for x in [first, last] if x).strip() or None
    company_phone = _clean_str(obj.get("company_phone"), 120)
    company_phone_candidates = _clean_str_list(obj.get("company_phone_candidates"), max_n=5, max_len=120)
    if company_phone and company_phone not in company_phone_candidates:
        company_phone_candidates = [company_phone] + company_phone_candidates

    return {
        "person_name": _clean_str(obj.get("person_name"), 160) or person_name_default,
        "job_title": _clean_str(obj.get("job_title"), 200) or (title or None),
        "person_linkedin_url": _clean_str(obj.get("person_linkedin_url"), 500) or (linkedin or None),
        "company_name": _clean_str(obj.get("company_name"), 200) or (company or None),
        "company_domain": _clean_str(obj.get("company_domain"), 200) or (_email_domain(email) or None),
        "company_website_url": _clean_str(obj.get("company_website_url"), 500) or (website or None),
        "company_phone": company_phone,
        "company_phone_extension": _clean_str(obj.get("company_phone_extension"), 16),
        "company_phone_candidates": company_phone_candidates,
        "company_summary": _clean_str(obj.get("company_summary"), 1200) or compact_blob[:1200],
        "recent_news": _clean_str_list(obj.get("recent_news"), max_n=6, max_len=320),
    }


async def generate_enriched_email_content(
    *,
    llm_service,
    user_id: str,
    campaign: Dict[str, Any],
    contact: Dict[str, Any],
    template: Dict[str, Any],
) -> Optional[Dict[str, str]]:
    """
    Return {"subject": str, "body": str} or None if Serper/LLM unavailable or pipeline fails.
    Caller applies template body_type when sending.
    """
    if not llm_service:
        return None
    provider = _resolve_provider(campaign)
    serper_key = await get_serper_api_key_for_user(user_id)
    if not serper_key:
        logging.warning("campaign enrichment: no Serper API key for user_id=%s", user_id)
        return None

    custom = contact.get("custom_fields") or {}
    if not isinstance(custom, dict):
        custom = {}
    title = str(custom.get("title") or custom.get("job_title") or "").strip()
    linkedin = str(
        custom.get("linkedin_url") or custom.get("linkedin") or contact.get("linkedin_url") or ""
    ).strip()
    website = str(
        custom.get("website") or custom.get("company_website") or custom.get("url") or ""
    ).strip()
    first = str(contact.get("first_name") or "").strip()
    last = str(contact.get("last_name") or "").strip()
    company = str(contact.get("company") or "").strip()
    industry = str(contact.get("industry") or "").strip()
    email = str(contact.get("email") or "").strip()

    query_prompt = f"""You output JSON only. Build 1 to 3 short Google search queries to find **public** information about this person or their organization (company site, news, LinkedIn public lines, press). Use natural phrases a researcher would type.

Recipient:
- Name: {first} {last}
- Work email domain: {_email_domain(email) or "unknown"}
- Company: {company or "unknown"}
- Industry: {industry or "unknown"}
- Title: {title or "unknown"}
- LinkedIn URL (hint): {linkedin or "none"}
- Website (hint): {website or "none"}

Rules:
- Queries must be safe for a search API: no requests for email databases, bulk lists, scraping, or CSV exports.
- Prefer company name + role, or company + product, or person name + company.
- Each query under 200 characters.

Return a JSON object with key "queries" whose value is an array of 1 to 3 strings. No markdown, no code fences."""

    parsed = await _llm_json(llm_service, user_id, provider, query_prompt)
    fb = _fallback_search_query(contact)
    raw_queries = queries_from_llm(parsed, fb, max_n=3)
    queries = sanitize_query_list(raw_queries, fb)[:3]

    serp_results: List[Dict[str, Any]] = []
    for q in queries:
        try:
            serp = await serper_search(serper_key, q, page=1, num=6)
            serp_results.append(serp)
        except Exception as e:
            logging.warning("campaign enrichment Serper failed for q=%r: %s", q[:80], e)

    rows = _merge_organic_rows(serp_results, max_rows=20)
    if not rows:
        logging.warning("campaign enrichment: no Serper organic rows for contact_id=%s", contact.get("id"))
        return None

    snippets_json = json.dumps(rows, ensure_ascii=False)
    phone_rows: List[Dict[str, str]] = []
    phone_query = ""
    if company:
        phone_query = f"{company} company phone number"
        try:
            phone_serp = await serper_search(serper_key, phone_query[:200], page=1, num=4)
            phone_rows = _merge_organic_rows([phone_serp], max_rows=6)
            if phone_rows:
                existing_links = {str(x.get("link") or "") for x in rows}
                for row in phone_rows:
                    link = str(row.get("link") or "")
                    if link and link in existing_links:
                        continue
                    rows.append(row)
                snippets_json = json.dumps(rows, ensure_ascii=False)
        except Exception as e:
            logging.warning("campaign enrichment phone search failed company=%r: %s", company[:80], e)
    allowed_url_set: Set[str] = {str(r.get("link") or "").strip() for r in rows if str(r.get("link") or "").strip()}

    page_extractions: List[Dict[str, str]] = []
    to_fetch: List[str] = []
    if allowed_url_set:
        allowed_list_sorted = sorted(allowed_url_set)
        read_more_prompt = f"""You output JSON only. Below are web search snippets (title, link, snippet) from Serper.

Pick **0 to {_MAX_READ_MORE_URLS}** URLs whose pages would add the most **factual** detail for personalizing a short B2B email (e.g. company overview, product, leadership, substantive news). Skip thin directories, obvious login-only pages, and generic aggregators when possible.

You MUST copy each chosen URL **exactly** as it appears in the "link" field in the snippets JSON — character for character. Do not invent or modify URLs.

Snippets JSON:
{snippets_json}

Allowed link strings (you may only return values from this list, 0 to {_MAX_READ_MORE_URLS} items):
{json.dumps(allowed_list_sorted, ensure_ascii=False)}

Return a JSON object: {{"read_more_urls": ["url1", ...]}} with 0 to {_MAX_READ_MORE_URLS} entries. No markdown, no code fences."""

        read_parsed = await _llm_json(llm_service, user_id, provider, read_more_prompt)
        to_fetch = _read_more_urls_from_llm(read_parsed, allowed_url_set, max_n=_MAX_READ_MORE_URLS)
        if to_fetch:
            try:
                page_extractions = await fetch_enrichment_pages(to_fetch, allowed_urls=allowed_url_set)
            except Exception as e:
                logging.warning("campaign enrichment page fetch batch failed: %s", e)
                page_extractions = []

    page_block = ""
    if page_extractions:
        page_block = f"""

Additional plain text extracted from web pages (fetched only from Serper result URLs, with robots.txt respected). Use as supporting detail; if this conflicts with search snippets, prefer the snippets.
Pages (JSON array of url + text excerpts):
{json.dumps(page_extractions, ensure_ascii=False)}"""

    compact_user_instruction = (campaign.get("external_enrichment_prompt") or "").strip()
    compact_prompt = f"""You output JSON only.

From the public web search snippets below, build a structured lead profile for B2B personalization.

Personalization target (use this to decide what is relevant):
- Recipient: {first or "N/A"} {last or "N/A"} ({title or "N/A"}) at {company or "N/A"}
- Campaign intent hint: {compact_user_instruction or "None provided"}
- Template subject: {template.get("subject") or ""}
- Template body preview: {(template.get("body") or "")[:800]}

Snippets (JSON array of title, link, snippet):
{snippets_json}
{page_block}

Return exactly this JSON object shape:
{{
  "company_summary": "string up to ~1200 chars",
  "lead_object": {{
    "person_name": "string or null",
    "job_title": "string or null",
    "person_linkedin_url": "string or null",
    "company_name": "string or null",
    "company_domain": "string or null",
    "company_website_url": "string or null",
    "company_phone": "string or null",
    "company_phone_extension": "string or null",
    "company_phone_candidates": ["string", "..."],
    "company_summary": "string up to ~1200 chars",
    "recent_news": ["string", "... up to 6 items"]
  }}
}}

Rules:
- Use only facts supported by snippets/page excerpts. Do not invent facts.
- If unknown, use null for fields.
- Include phone extension only when explicitly present in source text.
- Keep outputs concise and relevant for outreach personalization.
- No markdown, no code fences, no prose outside JSON."""

    compact_parsed = await _llm_json(llm_service, user_id, provider, compact_prompt, timeout=90.0)
    if not isinstance(compact_parsed, dict):
        logging.warning("campaign enrichment compact LLM returned invalid JSON")
        return None
    compact_blob = _clean_str(compact_parsed.get("company_summary"), 1200) or ""
    if not compact_blob:
        compact_blob = _clean_str(
            (compact_parsed.get("lead_object") or {}).get("company_summary")
            if isinstance(compact_parsed.get("lead_object"), dict)
            else None,
            1200,
        ) or ""
    if not compact_blob:
        return None

    lead_object = _normalize_lead_object_from_llm(
        compact_parsed.get("lead_object"),
        first=first,
        last=last,
        title=title,
        linkedin=linkedin,
        company=company,
        email=email,
        website=website,
        compact_blob=compact_blob,
    )

    body_type = template.get("body_type") or "html"
    is_html = body_type in ("html", "rich") or (
        template.get("body") and ("<" in template["body"] and ">" in template["body"])
    )
    html_instruction = (
        "The template body is HTML. You MUST preserve the exact HTML structure, all tags, and all styles. "
        "Only change the text content inside the tags. Do NOT remove, add, or alter HTML tags or attributes."
    ) if is_html else (
        "The template body is plain text. Return plain text in BODY. Do not use markdown (**bold** or [text](url))."
    )

    user_instruction = (campaign.get("external_enrichment_prompt") or "").strip()
    extra = f"\n\nAdditional instructions from the campaign owner:\n{user_instruction}" if user_instruction else ""

    final_prompt = f"""{html_instruction}

Use the research summary below to personalize the email template for this recipient. Stay truthful; only reference facts supported by the summary (or generic safe openers if the summary is thin).

Research summary:
{compact_blob}
{extra}

Recipient:
- First Name: {first or "N/A"}
- Last Name: {last or "N/A"}
- Company: {company or "N/A"}
- Industry: {industry or "N/A"}
- Email: {email or "N/A"}

Template:
Subject: {template.get("subject") or ""}
Body: {template.get("body") or ""}

Generate a personalized email.
- Do NOT repeat or restate the subject line inside the body.
- {html_instruction}

Return ONLY a valid JSON object with exactly two keys: "subject" (string) and "body" (string). No markdown, no code fence, no text before or after."""

    parsed_final = await _llm_json(llm_service, user_id, provider, final_prompt, timeout=120.0)
    if not parsed_final:
        # Retry raw generate + parse
        lo, hi = _LLM_PRE
        await asyncio.sleep(random.uniform(lo, hi))
        try:
            raw = await llm_service.generate_text(
                user_id,
                provider,
                final_prompt,
                timeout=120.0,
                inter_request_delay_sec=_LLM_POST_GAP,
            )
        except Exception as e:
            logging.warning("campaign enrichment final LLM failed: %s", e)
            return None
        parsed_final = parse_ai_json(raw)

    if not isinstance(parsed_final, dict):
        return None
    subject = str(parsed_final.get("subject") or "").strip() or str(template.get("subject") or "")
    body = parsed_final.get("body")
    if body is None:
        return None
    body = str(body).strip()
    if not body:
        return None
    if len(subject) > 300:
        subject = subject[:300].strip()
    return {
        "subject": subject,
        "body": body,
        "lead_artifact": {
            "provider": provider,
            "queries": queries,
            "phone_query": phone_query or None,
            "serper_rows": rows,
            "phone_search_rows": phone_rows,
            "selected_read_more_urls": to_fetch if allowed_url_set else [],
            "page_extractions": page_extractions,
            "compacted_facts": compact_blob,
            "lead_object": lead_object,
            "query_context": {
                "first_name": first or None,
                "last_name": last or None,
                "company": company or None,
                "industry": industry or None,
                "email_domain": _email_domain(email) or None,
                "title_hint": title or None,
                "linkedin_hint": linkedin or None,
                "website_hint": website or None,
                "campaign_prompt_hint": compact_user_instruction or None,
            },
        },
    }
