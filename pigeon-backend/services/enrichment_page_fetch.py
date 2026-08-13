"""
Safe HTTP fetch for campaign web enrichment: SSRF guards, optional robots.txt,
and lightweight HTML-to-text extraction. URLs must be pre-approved by caller
(e.g. exact Serper organic links only).
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import re
import socket
from html import unescape
from typing import Dict, List, Optional, Set
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx

# Identical User-Agent for robots.txt and page GET (robots rules apply to this token).
ENRICHMENT_FETCH_USER_AGENT = "PigeonEnrichmentBot/1.0"

_MAX_REDIRECTS = 5
_MAX_PAGE_BYTES = 600_000
_MAX_EXTRACT_CHARS = 14_000
_ROBOTS_TIMEOUT_SEC = 8.0
_PAGE_TIMEOUT_SEC = 18.0

_BLOCKED_HOSTNAMES = frozenset(
    {
        "localhost",
        "127.0.0.1",
        "::1",
        "0.0.0.0",
        "metadata.google.internal",
        "metadata.goog",
        "kubernetes.default",
        "kubernetes.default.svc",
    }
)


def _strip_html_to_text(html: str) -> str:
    if not html:
        return ""
    text = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.IGNORECASE)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<noscript[\s\S]*?</noscript>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:_MAX_EXTRACT_CHARS]


def _origin_from_parsed(parsed) -> str:
    if not parsed.scheme or not parsed.netloc:
        return ""
    return f"{parsed.scheme}://{parsed.netloc}"


def _url_is_safe_sync(url: str) -> bool:
    """Scheme/host sanity and literal-IP private checks (no DNS)."""
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").lower().strip()
    if not host or host in _BLOCKED_HOSTNAMES:
        return False
    try:
        ip = ipaddress.ip_address(host)
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
        ):
            return False
    except ValueError:
        pass
    return True


async def _resolved_addresses_are_public(hostname: str) -> bool:
    """Reject hostnames that resolve only to non-public IPs (SSRF mitigation)."""

    def resolve() -> bool:
        try:
            infos = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
        except socket.gaierror:
            return False
        if not infos:
            return False
        for _fam, _type, _proto, _canon, sockaddr in infos:
            ip_str = sockaddr[0]
            try:
                ip = ipaddress.ip_address(ip_str)
            except ValueError:
                continue
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                return False
        return True

    return await asyncio.to_thread(resolve)


async def url_passes_ssrf_checks(url: str) -> bool:
    if not _url_is_safe_sync(url):
        return False
    host = urlparse(url).hostname
    if not host:
        return False
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return await _resolved_addresses_are_public(host)


async def _load_robots_parser(
    client: httpx.AsyncClient,
    origin: str,
    cache: Dict[str, RobotFileParser],
) -> RobotFileParser:
    if origin in cache:
        return cache[origin]
    rp = RobotFileParser()
    robots_url = f"{origin}/robots.txt"
    rp.set_url(robots_url)
    current = robots_url
    try:
        for _ in range(4):
            if not await url_passes_ssrf_checks(current):
                rp.parse([])
                break
            resp = await client.get(
                current,
                headers={"User-Agent": ENRICHMENT_FETCH_USER_AGENT},
                follow_redirects=False,
                timeout=_ROBOTS_TIMEOUT_SEC,
            )
            if resp.status_code in (301, 302, 303, 307, 308):
                loc = resp.headers.get("location")
                if not loc:
                    rp.parse([])
                    break
                current = urljoin(current, loc)
                continue
            if resp.status_code == 200 and resp.content:
                text = resp.content.decode("utf-8", errors="replace")
                rp.parse(text.splitlines())
            else:
                rp.parse([])
            break
        else:
            rp.parse([])
    except Exception as e:
        logging.debug("enrichment robots.txt fetch failed for %s: %s", origin, e)
        rp.parse([])
    cache[origin] = rp
    return rp


def _robots_allows(rp: RobotFileParser, url: str) -> bool:
    try:
        return rp.can_fetch(ENRICHMENT_FETCH_USER_AGENT, url)
    except Exception:
        return False


async def fetch_page_text_if_allowed(
    client: httpx.AsyncClient,
    url: str,
    *,
    allowed_urls: Set[str],
    robots_cache: Dict[str, RobotFileParser],
) -> Optional[str]:
    """
    Fetch a single page if url is in allowed_urls, passes SSRF, and robots.txt allows.
    Returns extracted plain text or None.
    """
    u = (url or "").strip()
    if not u or u not in allowed_urls:
        return None
    if not await url_passes_ssrf_checks(u):
        logging.info("enrichment fetch skipped (SSRF): %s", u[:120])
        return None

    current = u
    for _ in range(_MAX_REDIRECTS + 1):
        if not await url_passes_ssrf_checks(current):
            return None
        parsed = urlparse(current)
        origin = _origin_from_parsed(parsed)
        if not origin:
            return None
        rp = await _load_robots_parser(client, origin, robots_cache)
        if not _robots_allows(rp, current):
            logging.info("enrichment fetch blocked by robots.txt: %s", current[:120])
            return None
        try:
            resp = await client.get(
                current,
                headers={
                    "User-Agent": ENRICHMENT_FETCH_USER_AGENT,
                    "Accept": "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
                },
                follow_redirects=False,
                timeout=_PAGE_TIMEOUT_SEC,
            )
        except Exception as e:
            logging.warning("enrichment page fetch failed for %s: %s", current[:120], e)
            return None

        if resp.status_code in (301, 302, 303, 307, 308):
            loc = resp.headers.get("location")
            if not loc:
                return None
            current = urljoin(current, loc)
            continue

        if resp.status_code != 200:
            logging.debug("enrichment page non-200 %s for %s", resp.status_code, current[:120])
            return None

        ctype = (resp.headers.get("content-type") or "").lower()
        if "text/html" not in ctype and "text/plain" not in ctype:
            logging.debug("enrichment skip non-text content-type for %s: %s", current[:120], ctype)
            return None

        raw = resp.content
        if len(raw) > _MAX_PAGE_BYTES:
            raw = raw[:_MAX_PAGE_BYTES]
        text = raw.decode("utf-8", errors="replace")
        return _strip_html_to_text(text)

    return None


async def fetch_enrichment_pages(
    urls: List[str],
    *,
    allowed_urls: Set[str],
) -> List[Dict[str, str]]:
    """
    Fetch up to len(urls) pages in parallel. Each url must be in allowed_urls.
    Returns [{"url": str, "text": str}, ...] for successful fetches only.
    """
    if not urls:
        return []
    robots_cache: Dict[str, RobotFileParser] = {}
    limits = httpx.Limits(max_keepalive_connections=5, max_connections=8)
    async with httpx.AsyncClient(limits=limits) as client:
        tasks = [
            fetch_page_text_if_allowed(client, u, allowed_urls=allowed_urls, robots_cache=robots_cache)
            for u in urls
        ]
        texts = await asyncio.gather(*tasks)
    out: List[Dict[str, str]] = []
    for u, t in zip(urls, texts):
        if t and t.strip():
            out.append({"url": u, "text": t.strip()})
    return out
