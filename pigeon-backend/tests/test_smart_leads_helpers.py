"""Unit tests for Smart Leads JSON parsing helpers."""

from services.smart_leads_helpers import (
    looks_like_placeholder_name_email,
    looks_like_scraping_style_query,
    parse_ai_json,
    queries_from_llm,
    sanitize_query_list,
    sanitize_serper_search_query,
)


def test_parse_ai_json_plain_object():
    raw = '{"queries": ["a", "b"]}'
    assert parse_ai_json(raw) == {"queries": ["a", "b"]}


def test_parse_ai_json_fenced():
    raw = '```json\n{"queries": ["x"]}\n```'
    assert parse_ai_json(raw) == {"queries": ["x"]}


def test_parse_ai_json_embedded():
    raw = 'Here is JSON:\n{"queries": ["z"]}\nThanks'
    assert parse_ai_json(raw) == {"queries": ["z"]}


def test_queries_from_llm_list():
    assert queries_from_llm({"queries": ["one", "two", "three", "four"]}, "fb", 3) == ["one", "two", "three"]


def test_queries_from_llm_fallback():
    assert queries_from_llm(None, "fallback", 3) == ["fallback"]


def test_queries_from_llm_single_query_key():
    assert queries_from_llm({"query": "only"}, "fb", 3) == ["only"]


def test_looks_like_scraping_style_query():
    assert looks_like_scraping_style_query("list of companies in india with emails") is True
    assert looks_like_scraping_style_query("startup database download") is True
    assert looks_like_scraping_style_query("top SaaS companies in India") is False


def test_sanitize_serper_search_query():
    fb = "top SaaS companies India"
    assert sanitize_serper_search_query("email database B2B", fb) == fb
    assert sanitize_serper_search_query("  SaaS companies Bangalore  ", fb) == "SaaS companies Bangalore"


def test_sanitize_query_list():
    fb = "fallback"
    assert sanitize_query_list(["ok one", "email database"], fb) == ["ok one", fb]


def test_detects_placeholder_name_emails():
    assert looks_like_placeholder_name_email("firstname@example-agency.net") is True
    assert looks_like_placeholder_name_email("lastname@example-agency.net") is True
    assert looks_like_placeholder_name_email("firstname.lastname@example-agency.net") is True


def test_allows_real_name_patterns():
    assert looks_like_placeholder_name_email("arjun.sharma@example-agency.net") is False
    assert looks_like_placeholder_name_email("john.smith@acme.com") is False
