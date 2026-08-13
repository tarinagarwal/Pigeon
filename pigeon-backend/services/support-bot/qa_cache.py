"""
Persistent cache for question → answer pairs, stored in MongoDB.
Uses normalized question (strip, lower, collapse whitespace) as key.

This module intentionally has **no eviction policy or max size**: entries are
kept indefinitely, but are automatically invalidated when the underlying
`data.json` changes (based on file size + mtime).
"""

import hashlib
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

import importlib.util as _importlib_util

from database import admin_db
from models import SupportBotCacheEntry

logger = logging.getLogger(__name__)

_COLLECTION = admin_db.support_bot_cache

# Load the local support-bot config to get DATA_PATH without touching the
# top-level backend config module.
_THIS_DIR = Path(__file__).resolve().parent
_config_path = _THIS_DIR / "config.py"
_spec = _importlib_util.spec_from_file_location("support_bot_config_for_cache", _config_path)
assert _spec and _spec.loader
_config = _importlib_util.module_from_spec(_spec)
_spec.loader.exec_module(_config)
DATA_PATH = _config.DATA_PATH


def _normalize_question(question: str) -> Optional[str]:
    """Normalize for cache key: strip, lower, collapse whitespace."""
    if not isinstance(question, str):
        return None
    text = question.strip().lower()
    if not text:
        return None
    text = re.sub(r"\s+", " ", text)
    return text


def _cache_key(normalized_question: str) -> str:
    """Stable hash of normalized question for storage key."""
    return hashlib.sha256(normalized_question.encode("utf-8")).hexdigest()


def _data_version() -> str:
    """
    Compute a simple version string for the knowledge base.

    Uses file size and mtime so the cache can be invalidated when data.json changes
    without re-reading the full file into memory.
    """
    try:
        stat = DATA_PATH.stat()
    except OSError:
        # If the data file is missing or inaccessible, return a sentinel value.
        return "unknown"
    return f"{stat.st_size}:{int(stat.st_mtime)}"


async def get_cached_answer(question: str) -> Optional[str]:
    """
    Return cached answer if this question was seen before, else None.
    """
    normalized = _normalize_question(question)
    if not normalized:
        return None

    key = _cache_key(normalized)
    version = _data_version()

    doc = await _COLLECTION.find_one(
        {"question_hash": key, "data_version": version}, projection={"answer": 1}
    )
    if not doc:
        logger.info("Support-bot cache miss for question.")
        return None

    logger.info("Support-bot cache hit for question.")
    return doc.get("answer")


async def set_cached_answer(question: str, answer: str) -> None:
    """
    Store answer for this question in MongoDB without any eviction policy.
    """
    normalized = _normalize_question(question)
    if not normalized:
        return

    key = _cache_key(normalized)
    version = _data_version()

    logger.info(
        "Support-bot cache set: raw_question=%r, normalized=%r, answer_len=%d",
        question,
        normalized,
        len(answer),
    )

    entry = SupportBotCacheEntry(
        question_hash=key,
        normalized_question=normalized,
        raw_question=question,
        answer=answer,
        data_version=version,
    )
    entry_dict = entry.model_dump()

    # Upsert by (question_hash, data_version) so we overwrite if the same
    # question is asked again for the same knowledge base version.
    await _COLLECTION.update_one(
        {"question_hash": key, "data_version": version},
        {"$set": entry_dict},
        upsert=True,
    )


async def clear_cache() -> None:
    """Remove all cached entries from MongoDB."""
    await _COLLECTION.delete_many({})
