"""Tests for campaign web enrichment helpers."""

from services.campaign_enrichment_service import (
    _extract_phone_numbers,
    _merge_organic_rows,
    _read_more_urls_from_llm,
)


def test_merge_organic_rows_dedupes_by_link():
    serp = [
        {
            "organic": [
                {"title": "A", "link": "https://example.com/a", "snippet": "s1"},
                {"title": "B", "link": "https://example.com/a", "snippet": "s2"},
                {"title": "C", "link": "https://example.com/c", "snippet": "s3"},
            ]
        }
    ]
    out = _merge_organic_rows(serp, max_rows=10)
    assert len(out) == 2
    links = [r["link"] for r in out]
    assert "https://example.com/a" in links
    assert "https://example.com/c" in links


def test_merge_organic_rows_respects_max():
    rows = [{"title": f"T{i}", "link": f"https://x.com/{i}", "snippet": "s"} for i in range(30)]
    serp = [{"organic": rows}]
    out = _merge_organic_rows(serp, max_rows=5)
    assert len(out) == 5


def test_merge_organic_rows_empty():
    assert _merge_organic_rows([], max_rows=10) == []
    assert _merge_organic_rows([{}], max_rows=10) == []


def test_read_more_urls_from_llm_filters_to_allowed():
    allowed = {"https://a.com/1", "https://b.com/2"}
    assert _read_more_urls_from_llm(
        {"read_more_urls": ["https://a.com/1", "https://evil.com", "https://b.com/2"]},
        allowed,
        max_n=2,
    ) == ["https://a.com/1", "https://b.com/2"]


def test_read_more_urls_from_llm_empty_when_invalid():
    assert _read_more_urls_from_llm({"read_more_urls": "bad"}, {"https://x.com"}) == []
    assert _read_more_urls_from_llm(None, {"https://x.com"}) == []


def test_extract_phone_numbers_parses_and_limits():
    texts = [
        "Call us at +1 (415) 555-0188 for sales.",
        "HQ: 020 7946 0958 | support number: 020 7946 0958",
    ]
    out = _extract_phone_numbers(texts, max_n=2)
    assert len(out) == 2
    assert "+1 (415) 555-0188" in out


def test_extract_phone_numbers_filters_short_noise():
    texts = ["Order id 12345, code 999999, extension 123"]
    assert _extract_phone_numbers(texts) == []
