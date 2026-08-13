"""
RAG pipeline: retrieve from ChromaDB, optionally generate answer with Groq.
"""
import json
import logging
import re
from pathlib import Path
import sys
import time
from typing import List, Optional, Tuple

# Ensure we import config/chroma_loader from this support-bot directory,
# not the main backend package.
_THIS_DIR = Path(__file__).resolve().parent
if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))

from chroma_loader import query_knowledge_base

# Load the local support-bot config module explicitly so we do not
# accidentally import the top-level backend config.
import importlib.util as _importlib_util

_config_path = _THIS_DIR / "config.py"
_spec = _importlib_util.spec_from_file_location("support_bot_config", _config_path)
assert _spec and _spec.loader
_config = _importlib_util.module_from_spec(_spec)
_spec.loader.exec_module(_config)

GROQ_API_KEY = _config.GROQ_API_KEY
GROQ_MODEL = _config.GROQ_MODEL
GROQ_TEMPERATURE = _config.GROQ_TEMPERATURE
GROQ_MAX_TOKENS = _config.GROQ_MAX_TOKENS
RAG_TOP_K = _config.RAG_TOP_K
IN_DOMAIN_DISTANCE_THRESHOLD = _config.IN_DOMAIN_DISTANCE_THRESHOLD
is_groq_available = _config.is_groq_available

logger = logging.getLogger(__name__)

# Limit of messages from recent chat history to include in the LLM prompt.
MAX_HISTORY_MESSAGES = 5

# ---------------------------------------------------------------------------
# Groq rate limiting (best-effort, per-process)
# Defaults reflect typical free-tier Groq limits; overridable via env/config later.
# ---------------------------------------------------------------------------
GROQ_RPM_LIMIT = 30        # requests per minute
GROQ_RPD_LIMIT = 1000      # requests per day
GROQ_TPM_LIMIT = 12_000    # tokens per minute
GROQ_TPD_LIMIT = 100_000   # tokens per day

_minute_window_start = 0.0
_minute_req_count = 0
_minute_token_count = 0

_day_window_start = 0.0
_day_req_count = 0
_day_token_count = 0

OUT_OF_SCOPE_MESSAGE = (
    "I’m set up to answer questions about Pigeon’s help articles. "
    "This message looks like it might be about something else, so I don’t want to guess "
    "and give you a wrong answer. If you have a question about Pigeon, feel free to ask."
)

SYSTEM_PROMPT = """You are the Pigeon support assistant.

Your job:
- Answer the user's question using ONLY the information from the Pigeon help articles provided below.
- If the help articles do not clearly answer the question, say that politely and honestly.

Style guidelines:
- Write for a non-technical user.
- Use short, clear sentences and everyday words.
- Do NOT mention or explain how you work (no talk of 'context', 'articles', 'AI model', 'LLM', 'retrieval', 'RAG', or similar).
- Do NOT say where the information came from; just answer naturally.
- It is OK to say you do not know or that something is not covered.

Safety:
- Do not make up product features or steps that are not in the help articles.
- If something is not covered or is unclear in the help articles, clearly say that instead of guessing.

Response format:
- You MUST respond with valid JSON only, no other text before or after.
- Format: {"answer": "<your natural-language answer>", "should_cache": <true or false>}
- In the answer string, use \\n for line breaks (never use literal newlines—they break JSON parsing).
- should_cache: set to true only when the question is self-contained and reusable across different conversations.
- Set should_cache to false when:
  - The question is a follow-up that depends on prior context (e.g. "tell me more", "what else", "continue", "and?", "go on")
  - The question uses vague pronouns without clear referent (e.g. "tell me more about it", "what about that", "how does this work")
  - The question is very short or ambiguous on its own (e.g. "more", "it", "that")
  - The answer only makes sense in the context of the previous exchange"""

# Lazily-created Groq client so we don't re-create it on every request.
_GROQ_CLIENT = None


def _get_groq_client():
    """Return a singleton Groq client instance, creating it on first use."""
    global _GROQ_CLIENT
    if _GROQ_CLIENT is None:
        from groq import Groq

        _GROQ_CLIENT = Groq(api_key=GROQ_API_KEY)
    return _GROQ_CLIENT


def _estimate_token_usage(prompt_text: str) -> int:
    """
    Very rough token estimate: 1 token ~= 4 characters, plus the configured
    max_tokens for the response.
    """
    approx_prompt_tokens = max(1, len(prompt_text) // 4)
    return approx_prompt_tokens + GROQ_MAX_TOKENS


def _can_use_groq(estimated_tokens: int) -> bool:
    """
    Best-effort in-process rate limiter for Groq usage.
    Returns False if sending this request would exceed any of the limits.
    """
    global _minute_window_start, _minute_req_count, _minute_token_count
    global _day_window_start, _day_req_count, _day_token_count

    now = time.time()

    # Reset minute window
    if now - _minute_window_start >= 60:
        _minute_window_start = now
        _minute_req_count = 0
        _minute_token_count = 0

    # Reset day window (24h rolling)
    if now - _day_window_start >= 86_400:
        _day_window_start = now
        _day_req_count = 0
        _day_token_count = 0

    # Check against limits
    next_minute_reqs = _minute_req_count + 1
    next_day_reqs = _day_req_count + 1
    next_minute_tokens = _minute_token_count + estimated_tokens
    next_day_tokens = _day_token_count + estimated_tokens

    if (
        next_minute_reqs > GROQ_RPM_LIMIT
        or next_day_reqs > GROQ_RPD_LIMIT
        or next_minute_tokens > GROQ_TPM_LIMIT
        or next_day_tokens > GROQ_TPD_LIMIT
    ):
        logger.info(
            "Groq rate limit guard: skipping Groq call "
            "(minute: %s reqs/%s tokens, day: %s reqs/%s tokens, est_tokens=%s)",
            _minute_req_count,
            _minute_token_count,
            _day_req_count,
            _day_token_count,
            estimated_tokens,
        )
        return False

    # Reserve capacity
    _minute_req_count = next_minute_reqs
    _day_req_count = next_day_reqs
    _minute_token_count = next_minute_tokens
    _day_token_count = next_day_tokens
    return True


def _get_retrieval_results(query: str) -> Tuple[Optional[dict], Optional[float], List[dict]]:
    """
    Query ChromaDB and return best match plus all top_k results for context.
    Returns (best_match, best_distance, list_of_all_matches_with_docs).
    """
    try:
        results = query_knowledge_base(query, top_k=RAG_TOP_K)
    except Exception as exc:
        logger.warning("Chroma query failed, treating as no results: %s", exc)
        return None, None, []

    if not results or not results.get("ids") or not results["ids"][0]:
        return None, None, []

    try:
        ids = results["ids"][0]
        docs: List[str] = results["documents"][0]
        distances: List[float] = results["distances"][0]
        metadatas = results.get("metadatas", [[]])[0]
    except (KeyError, IndexError, TypeError) as exc:
        logger.warning("Unexpected Chroma result format, treating as no results: %s", exc)
        return None, None, []

    matches = []
    for i, doc_id in enumerate(ids):
        doc = docs[i] if i < len(docs) else ""
        dist = distances[i] if i < len(distances) else 1.0
        meta = metadatas[i] if metadatas and i < len(metadatas) else {}
        matches.append({"id": doc_id, "document": doc, "distance": dist, "metadata": meta})

    if not matches or not str(matches[0].get("document", "")).strip():
        # If the best document is empty, treat as no usable results.
        return None, None, []

    best = matches[0]
    return best, best["distance"], matches


def _extract_answer_from_doc(doc: str) -> str:
    """For FAQ docs stored as 'question\\n\\nanswer', return only the answer part."""
    parts = doc.split("\n\n", 1)
    return parts[1] if len(parts) > 1 else doc


def _build_context(matches: List[dict]) -> str:
    """Build a single context string from retrieved documents for the LLM."""
    parts = []
    for i, m in enumerate(matches, 1):
        doc = m.get("document", "")
        distance = m.get("distance")
        # Coarse relevance label based on distance so the LLM can weigh blocks.
        if isinstance(distance, (int, float)):
            if distance <= IN_DOMAIN_DISTANCE_THRESHOLD:
                relevance = "very relevant"
            elif distance <= IN_DOMAIN_DISTANCE_THRESHOLD * 1.5:
                relevance = "somewhat relevant"
            else:
                relevance = "weak match"
            header = f"[{i}] ({relevance}, distance={distance:.3f})"
        else:
            header = f"[{i}]"
        parts.append(f"{header}\n{doc}")
    return "\n\n---\n\n".join(parts)


def _is_in_domain(best_distance: Optional[float]) -> bool:
    """
    Decide whether a query is considered in-domain based on retrieval distance.

    Returns False if distance is None or above the configured threshold.
    """
    if best_distance is None:
        return False
    return best_distance <= IN_DOMAIN_DISTANCE_THRESHOLD


# Patterns that suggest a question depends on prior context (fallback when Groq doesn't return JSON).
_CONTEXT_DEPENDENT_PATTERNS = re.compile(
    r"\b(tell me more|what else|go on|and\?|continue|more about (it|that|this)|"
    r"what about (it|that|this)|how does (it|that|this) work|explain (it|that|this))\b",
    re.IGNORECASE,
)


def _is_context_dependent_fallback(question: str, history: Optional[List[dict]]) -> bool:
    """
    Heuristic: treat as context-dependent (don't cache) when there's history
    and the question is short or matches follow-up patterns.
    Used when Groq response is not available or JSON parsing fails.
    """
    if not history or not question:
        return False
    q = question.strip().lower()
    if len(q) < 15 and any(w in q for w in ("it", "this", "that", "more", "else", "continue")):
        return True
    return bool(_CONTEXT_DEPENDENT_PATTERNS.search(q))


def answer_with_rag(query: str, history: Optional[List[dict]] = None) -> Tuple[str, bool, bool]:
    """
    Run RAG: retrieve from Chroma, then generate with Groq if available.
    Returns (answer_text, in_domain, should_cache).
    - If no retrieval results at all: return out-of-domain message, in_domain=False, should_cache=False.
    - If Groq available: use its JSON response with answer + should_cache.
    - If Groq is not available or fails: fall back to retrieval, use heuristic for should_cache.
    """
    best_match, best_distance, all_matches = _get_retrieval_results(query)
    has_any_results = best_match is not None and best_distance is not None and len(all_matches) > 0

    # No retrieval results at all -> out of scope
    if not has_any_results:
        return OUT_OF_SCOPE_MESSAGE, False, False

    # Helper: choose how to turn the best retrieved document into an answer.
    # - FAQ docs (source='faq') are stored as 'question\\n\\nanswer' so we drop the question.
    # - Blog docs (source='blog') are full markdown articles stored in `content`, so we keep them as-is.
    def _answer_from_best() -> str:
        meta = best_match.get("metadata") or {}
        source = meta.get("source")
        doc = best_match.get("document", "")
        if source == "blog":
            return doc
        return _extract_answer_from_doc(doc)

    # When Groq is available: always use it with whatever we retrieved (let the model decide from context),
    # but respect simple per-process rate limits so we don't exceed Groq quotas.
    if is_groq_available():
        try:
            context = _build_context(all_matches)

            history = history or []
            # Only keep the last N messages to keep prompts compact.
            recent = history[-MAX_HISTORY_MESSAGES:]
            history_lines = []
            for msg in recent:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                history_lines.append(f"{role.capitalize()}: {content}")
            history_block = "\n".join(history_lines) if history_lines else "None."

            user_content = (
                "Previous messages between you and the user:\n"
                f"{history_block}\n\n"
                "User's latest question:\n"
                f"{query}\n\n"
                "Information from the Pigeon help center (most relevant items first). "
                "Use only this information when you answer:\n\n"
                f"{context}"
            )

            est_tokens = _estimate_token_usage(user_content)
            if not _can_use_groq(est_tokens):
                # Rate limit reached: answer directly from retrieval.
                answer = _answer_from_best()
                should_cache = not _is_context_dependent_fallback(query, history)
                return answer, _is_in_domain(best_distance), should_cache

            client = _get_groq_client()
            response = client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
                ],
                temperature=GROQ_TEMPERATURE,
                max_tokens=GROQ_MAX_TOKENS,
            )
            raw = response.choices[0].message.content or ""
            in_domain = _is_in_domain(best_distance)

            # Parse JSON: {"answer": "...", "should_cache": true|false}
            text = raw.strip()
            if text.startswith("```"):
                text = re.sub(r"^```(?:json)?\s*", "", text)
                text = re.sub(r"\s*```$", "", text)

            answer = None
            should_cache = True

            try:
                parsed = json.loads(text)
                answer = (parsed.get("answer") or "").strip() or None
                should_cache = bool(parsed.get("should_cache", True))
            except (json.JSONDecodeError, TypeError):
                # Groq often outputs literal newlines inside "answer", which breaks JSON.
                # Fallback: regex-extract (handles unescaped newlines in answer string).
                match = re.search(
                    r'"answer"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"should_cache"\s*:\s*(true|false)',
                    text,
                    re.DOTALL,
                )
                if match:
                    answer = match.group(1).replace("\\n", "\n").replace('\\"', '"').strip() or None
                    should_cache = match.group(2).lower() == "true"
                else:
                    # Last resort: extract between "answer": " and ", "should_cache"
                    start_marker = '"answer": "'
                    end_marker = '", "should_cache"'
                    idx = text.find(start_marker)
                    if idx != -1:
                        start = idx + len(start_marker)
                        end = text.find(end_marker, start)
                        if end != -1:
                            answer = (
                                text[start:end]
                                .replace("\\n", "\n")
                                .replace('\\"', '"')
                                .strip()
                                or None
                            )
                            sc = re.search(r'"should_cache"\s*:\s*(true|false)', text[end:])
                            if sc:
                                should_cache = sc.group(1).lower() == "true"

            if answer is None:
                logger.warning("Groq JSON parse failed, using raw answer and heuristic")
                answer = raw.strip() or _answer_from_best()
                should_cache = not _is_context_dependent_fallback(query, history)
            else:
                answer = answer or _answer_from_best()

            return answer, in_domain, should_cache
        except Exception as e:
            logger.warning("Groq API error, falling back to retrieval-only: %s", e)
            answer = _answer_from_best()
            should_cache = not _is_context_dependent_fallback(query, history)
            return answer, _is_in_domain(best_distance), should_cache

    # No Groq: retrieval-only
    answer = _answer_from_best()
    should_cache = not _is_context_dependent_fallback(query, history)
    return answer, _is_in_domain(best_distance), should_cache
