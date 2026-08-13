"""Shared parsing helpers for Smart Leads LLM outputs (testable)."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

# Phrases that look like bulk scraping / lead-database requests and are often blocked by Serp APIs.
_SCRAPING_STYLE_PATTERNS = re.compile(
    r"|".join(
        [
            r"email\s*database",
            r"list\s+of\s+[^\n]{0,80}?\s+emails?",
            r"(company|startup)\s+leads?\s+[^\n]{0,40}?\s+(emails?|ceo\s+emails?)",
            r"leads?\s+with\s+emails?",
            r"startup\s+database",
            r"\bdownload\b",
            r"\bcsv\b",
            r"bulk\s+leads?",
            r"scrap(e|ing)",
            r"export\s+(companies|leads|contacts)",
            r"find\s+[^\n]{0,40}?\s+emails?\s+(of|for)",
            r"\bwith\s+emails?\b",
            r"\bemail\s+list\b",
        ]
    ),
    re.IGNORECASE,
)


def looks_like_scraping_style_query(q: str) -> bool:
    s = (q or "").strip()
    if not s:
        return True
    return bool(_SCRAPING_STYLE_PATTERNS.search(s))


def sanitize_serper_search_query(q: str, fallback: str) -> str:
    """Replace scraping-style queries with a safe fallback (natural search)."""
    s = re.sub(r"\s+", " ", (q or "")).strip()
    if not s or looks_like_scraping_style_query(s):
        return fallback
    return s


def parse_ai_json(text: str) -> Optional[Dict[str, Any]]:
    t = (text or "").strip()
    if not t:
        return None
    fence = re.match(r"^```(?:json)?\s*([\s\S]*?)\s*```$", t, re.IGNORECASE)
    if fence:
        t = fence.group(1).strip()
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        # Try to find first JSON object
        start = t.find("{")
        end = t.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(t[start : end + 1])
            except json.JSONDecodeError:
                pass
    return None


def queries_from_llm(parsed: Optional[Dict[str, Any]], fallback: str, max_n: int = 3) -> List[str]:
    if not parsed:
        return [fallback][:max_n]
    raw = parsed.get("queries")
    if isinstance(raw, list):
        out = [str(x).strip() for x in raw if str(x).strip()]
        return out[:max_n] if out else [fallback][:max_n]
    q = parsed.get("query")
    if isinstance(q, str) and q.strip():
        return [q.strip()]
    return [fallback][:max_n]


def sanitize_query_list(queries: List[str], fallback: str) -> List[str]:
    """Map each query through sanitize_serper_search_query (same length as input)."""
    return [sanitize_serper_search_query(q, fallback) for q in queries]


_PLACEHOLDER_LOCAL_PARTS = {
    "firstname",
    "lastname",
    "first.last",
    "first_last",
    "first-last",
    "firstname.lastname",
    "firstname_lastname",
    "firstname-lastname",
    "firstnamelastname",
}


def looks_like_placeholder_name_email(email: Any) -> bool:
    """
    Detect obvious placeholder-style addresses that should never be treated as real leads.
    Examples: firstname@domain, lastname@domain, firstname.lastname@domain.
    """
    em = str(email or "").strip().lower()
    if not em or "@" not in em:
        return False
    local = em.split("@", 1)[0].strip(".-_ ")
    if not local:
        return False
    if local in _PLACEHOLDER_LOCAL_PARTS:
        return True
    return bool(re.fullmatch(r"first(name)?[._-]?last(name)?", local))
