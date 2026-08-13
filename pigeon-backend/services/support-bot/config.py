"""
Application configuration from environment variables.
"""
import logging
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Paths (needed so .env is loaded from project dir regardless of cwd)
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

DATA_PATH = BASE_DIR / "data.json"
CHROMA_DIR = BASE_DIR / "chroma_db"
CACHE_DIR = BASE_DIR / ".cache"
CACHE_FILE = CACHE_DIR / "qa_cache.json"


def _get_env_int(
    name: str,
    default: int,
    *,
    min_value: Optional[int] = None,
    max_value: Optional[int] = None,
) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        logger.warning("Invalid int for %s=%r. Using default %s.", name, raw, default)
        return default
    if min_value is not None and value < min_value:
        logger.warning(
            "Value for %s=%s is below minimum %s. Clamping.", name, value, min_value
        )
        value = min_value
    if max_value is not None and value > max_value:
        logger.warning(
            "Value for %s=%s is above maximum %s. Clamping.", name, value, max_value
        )
        value = max_value
    return value


def _get_env_float(
    name: str,
    default: float,
    *,
    min_value: Optional[float] = None,
    max_value: Optional[float] = None,
) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except (TypeError, ValueError):
        logger.warning("Invalid float for %s=%r. Using default %s.", name, raw, default)
        return default
    if min_value is not None and value < min_value:
        logger.warning(
            "Value for %s=%s is below minimum %s. Clamping.", name, value, min_value
        )
        value = min_value
    if max_value is not None and value > max_value:
        logger.warning(
            "Value for %s=%s is above maximum %s. Clamping.", name, value, max_value
        )
        value = max_value
    return value


# Groq
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_TEMPERATURE = _get_env_float(
    "GROQ_TEMPERATURE",
    0.3,
    min_value=0.0,
    max_value=2.0,
)
GROQ_MAX_TOKENS = _get_env_int("GROQ_MAX_TOKENS", 1024, min_value=1)

# RAG
RAG_TOP_K = _get_env_int("RAG_TOP_K", 5, min_value=1, max_value=50)
IN_DOMAIN_DISTANCE_THRESHOLD = _get_env_float(
    "IN_DOMAIN_DISTANCE_THRESHOLD",
    0.65,  # Relaxed from 0.45 so valid answers get cached (Chroma distance: lower=better)
    min_value=0.0,
    max_value=1.0,
)

# Cache
CACHE_MAX_ENTRIES = _get_env_int("CACHE_MAX_ENTRIES", 5000, min_value=1)


def is_groq_available() -> bool:
    return bool(GROQ_API_KEY)


def validate_environment() -> None:
    """
    Validate that required files and directories exist or can be created.
    Raises a descriptive exception if something critical is missing.
    """
    if not DATA_PATH.exists():
        raise FileNotFoundError(
            f"Required knowledge base file not found at {DATA_PATH!s}. "
            "Ensure data.json is present in the project directory."
        )
    # Ensure directories are creatable.
    CHROMA_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
