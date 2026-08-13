import pytest

from services.warmup_llm_service import WarmupLLMService


@pytest.mark.asyncio
async def test_fallback_when_disabled(monkeypatch):
    monkeypatch.setenv("WARMUP_GROQ_ENABLED", "0")
    svc = WarmupLLMService()
    out = await svc.generate_reply(style_samples=["Thanks for checking in."], thread_history=[], turn_index=1)
    assert out["source"] == "fallback"
    assert out["body"]


@pytest.mark.asyncio
async def test_sanitize_removes_links(monkeypatch):
    monkeypatch.setenv("WARMUP_GROQ_ENABLED", "0")
    svc = WarmupLLMService()
    cleaned = svc._sanitize("check this https://example.com now")
    assert "http" not in cleaned
