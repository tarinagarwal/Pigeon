from pathlib import Path
import sys
import logging

from fastapi import APIRouter

from routes.schemas import SupportBotChatRequest, SupportBotChatResponse

# The support-bot service lives in a directory named "support-bot", which is not
# a valid Python package name. We add that directory to sys.path so its modules
# (rag.py, qa_cache.py, config.py, etc.) can be imported directly.
_SUPPORT_BOT_DIR = Path(__file__).resolve().parent.parent / "services" / "support-bot"
if str(_SUPPORT_BOT_DIR) not in sys.path:
    sys.path.insert(0, str(_SUPPORT_BOT_DIR))

from rag import answer_with_rag, OUT_OF_SCOPE_MESSAGE  # type: ignore
from qa_cache import get_cached_answer, set_cached_answer  # type: ignore

router = APIRouter(prefix="/support-bot", tags=["support-bot"])
logger = logging.getLogger(__name__)


@router.post("/chat", response_model=SupportBotChatResponse)
async def support_bot_chat(payload: SupportBotChatRequest) -> SupportBotChatResponse:
    """Public support-bot endpoint used by the frontend widget."""
    logger.info("Support-bot chat received: question=%r", payload.question)
    cached = await get_cached_answer(payload.question)
    if cached is not None:
        return SupportBotChatResponse(
            answer=cached,
            in_domain=True,
            from_cache=True,
        )

    history = None
    if payload.history:
        history = [{"role": m.role, "content": m.content} for m in payload.history]

    answer, in_domain, model_should_cache = answer_with_rag(payload.question, history=history)
    # Cache only when: (1) model says it's safe to cache, and (2) we have a real in-domain answer
    should_cache = model_should_cache and (in_domain or (answer != OUT_OF_SCOPE_MESSAGE))
    logger.debug("support_bot_chat: in_domain=%s, model_should_cache=%s, should_cache=%s", in_domain, model_should_cache, should_cache)

    if should_cache:
        await set_cached_answer(payload.question, answer)

    return SupportBotChatResponse(
        answer=answer,
        in_domain=in_domain,
        from_cache=False,
    )

