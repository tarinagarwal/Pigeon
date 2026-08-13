from datetime import datetime, timedelta, timezone

from services import warmup_sender_service as wss
from services.warmup_sender_service import WarmupSenderService


class _DummyDb:
    pass


def _service() -> WarmupSenderService:
    return WarmupSenderService(
        db=_DummyDb(),
        admin_db=None,
        smtp_service=None,
        gmail_service=None,
        warmup_llm_service=None,
        email_service=None,
    )


def test_root_domain_from_email_handles_subdomains():
    assert wss._root_domain_from_email("grace@cloud.pigeon.com") == "pigeon.com"
    assert wss._root_domain_from_email("test@foo.co.uk") == "foo.co.uk"


def test_provider_from_domain_or_email_normalizes_major_providers():
    assert wss._provider_from_domain_or_email("alice@gmail.com") == "gmail"
    assert wss._provider_from_domain_or_email("hotmail.com") == "outlook"
    assert wss._provider_from_domain_or_email("custom-domain.io") == "other"


def test_stable_pair_key_is_deterministic():
    one = wss._stable_pair_key("A@Example.com", "b@example.com")
    two = wss._stable_pair_key("a@example.com", "B@example.com")
    assert one == two


def test_score_close_network_candidate_blocks_pair_in_high_confidence(monkeypatch):
    monkeypatch.setattr(wss, "WARMUP_CLOSE_NETWORK_MODE", "high_confidence")
    svc = _service()
    now = datetime.now(timezone.utc)
    key = wss._stable_pair_key("sender@example.com", "target@example.com")
    state = {
        "sender_email": "sender@example.com",
        "now_utc": now,
        "pair_last_sent_at": {key: now - timedelta(days=1)},
        "reciprocity_counts": {key: 1},
        "provider_counts_24h": {"gmail": 1},
        "domain_counts_24h": {"example.com": 1},
    }
    out = svc._score_close_network_candidate(
        state,
        receiver_email="target@example.com",
        receiver_provider="gmail",
        receiver_domain_root="example.com",
    )
    assert out["allowed"] is False
    assert "pair_cooldown" in out["reasons"]


def test_score_close_network_candidate_shadow_never_blocks(monkeypatch):
    monkeypatch.setattr(wss, "WARMUP_CLOSE_NETWORK_MODE", "shadow")
    monkeypatch.setattr(wss, "WARMUP_CLOSE_NETWORK_RISK_THRESHOLD", 0.1)
    svc = _service()
    now = datetime.now(timezone.utc)
    key = wss._stable_pair_key("sender@example.com", "target@example.com")
    state = {
        "sender_email": "sender@example.com",
        "now_utc": now,
        "pair_last_sent_at": {key: now - timedelta(hours=2)},
        "reciprocity_counts": {key: 5},
        "provider_counts_24h": {"gmail": 50},
        "domain_counts_24h": {"example.com": 50},
    }
    out = svc._score_close_network_candidate(
        state,
        receiver_email="target@example.com",
        receiver_provider="gmail",
        receiver_domain_root="example.com",
    )
    assert out["allowed"] is True
    assert out.get("shadow_block") is True
