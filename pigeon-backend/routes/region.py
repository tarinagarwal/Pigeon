"""Region/country detection from request (e.g. for India vs rest).

Detection order:
1. Proxy headers (Cloudflare CF-IPCountry, Vercel X-Vercel-IP-Country)
2. IP-based geolocation (X-Forwarded-For / X-Real-IP / CF-Connecting-IP / client, then ipgeolocation.io, ipapi.co, ip-api.com)
3. Timezone from frontend (query timezone or header x-timezone) mapped to country
4. Accept-Language (e.g. en-IN → IN)
5. Fallback: US
"""
import asyncio
import ipaddress
import os
import re
import time
from typing import Optional

import httpx
from fastapi import APIRouter, Request

router = APIRouter()

# ---------------------------------------------------------------------------
# 1. Client IP and IP-based geolocation
# ---------------------------------------------------------------------------

def get_client_ip(request: Request) -> Optional[str]:
    """Get client IP in order: X-Forwarded-For (first), X-Real-IP, CF-Connecting-IP, then request.client."""
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        # First IP in the list is the client (last is original client when multiple proxies)
        first = xff.strip().split(",")[0].strip()
        if first:
            return first
    real = request.headers.get("X-Real-IP")
    if real and real.strip():
        return real.strip()
    cf = request.headers.get("CF-Connecting-IP")
    if cf and cf.strip():
        return cf.strip()
    if request.client and request.client.host:
        return request.client.host
    return None


def is_private_or_local_ip(ip_str: Optional[str]) -> bool:
    """Return True if IP is private, loopback, or invalid (skip geo lookup)."""
    if not ip_str or not ip_str.strip():
        return True
    ip_str = ip_str.strip()
    if ip_str.lower() in ("unknown", "localhost", "::1", "127.0.0.1"):
        return True
    try:
        ip = ipaddress.ip_address(ip_str)
        return ip.is_private or ip.is_loopback or ip.is_reserved or ip.is_link_local
    except ValueError:
        return True


# In-memory cache: ip -> (country_code, expiry_timestamp). 24h TTL.
_ip_country_cache: dict[str, tuple[str, float]] = {}
_cache_lock = asyncio.Lock()
_CACHE_TTL_SEC = 24 * 3600


def _cache_get(ip: str) -> Optional[str]:
    now = time.time()
    entry = _ip_country_cache.get(ip)
    if not entry:
        return None
    country, expiry = entry
    if now >= expiry:
        _ip_country_cache.pop(ip, None)
        return None
    return country


def _cache_set(ip: str, country: str) -> None:
    now = time.time()
    _ip_country_cache[ip] = (country.upper(), now + _CACHE_TTL_SEC)
    # Prune expired entries if cache grows (simple: limit size)
    if len(_ip_country_cache) > 10000:
        expired = [k for k, (_, e) in _ip_country_cache.items() if time.time() >= e]
        for k in expired[:1000]:
            _ip_country_cache.pop(k, None)


async def _fetch_country_ipgeolocation(ip: str) -> Optional[str]:
    """ipgeolocation.io - returns country_code2. Requires IPGEOLOCATION_API_KEY."""
    key = os.environ.get("IPGEOLOCATION_API_KEY", "").strip()
    if not key:
        return None
    url = f"https://api.ipgeolocation.io/ipgeo?apiKey={key}&ip={ip}"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url)
            if r.status_code != 200:
                return None
            data = r.json()
            # API returns location.country_code2 or top-level country_code2
            loc = data.get("location") or {}
            code = (loc.get("country_code2") or data.get("country_code2") or "").strip().upper()
            return code if len(code) == 2 else None
    except Exception:
        return None


async def _fetch_country_ipapi_co(ip: str) -> Optional[str]:
    """ipapi.co - returns country_code."""
    url = f"https://ipapi.co/{ip}/json/"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url)
            if r.status_code != 200:
                return None
            data = r.json()
            if data.get("error") is True:
                return None
            code = (data.get("country_code") or "").strip().upper()
            return code if len(code) == 2 else None
    except Exception:
        return None


async def _fetch_country_ip_api_com(ip: str) -> Optional[str]:
    """ip-api.com - returns countryCode. Free tier is HTTP."""
    url = f"http://ip-api.com/json/{ip}?fields=countryCode"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url)
            if r.status_code != 200:
                return None
            data = r.json()
            if data.get("status") == "fail":
                return None
            code = (data.get("countryCode") or "").strip().upper()
            return code if len(code) == 2 else None
    except Exception:
        return None


async def fetch_country_from_ip(ip: str) -> Optional[str]:
    """Call external APIs in order; return first 2-letter country code. Uses cache with 24h TTL."""
    async with _cache_lock:
        cached = _cache_get(ip)
        if cached is not None:
            return cached

    # Order: ipgeolocation.io (primary), ipapi.co, ip-api.com
    for fetcher in (_fetch_country_ipgeolocation, _fetch_country_ipapi_co, _fetch_country_ip_api_com):
        code = await fetcher(ip)
        if code and len(code) == 2:
            async with _cache_lock:
                _cache_set(ip, code)
            return code
    return None


# ---------------------------------------------------------------------------
# 2. Timezone → country map (IANA timezone to ISO 3166-1 alpha-2)
# ---------------------------------------------------------------------------

TIMEZONE_TO_COUNTRY: dict[str, str] = {
    "Asia/Kolkata": "IN",
    "America/New_York": "US",
    "America/Los_Angeles": "US",
    "America/Chicago": "US",
    "America/Denver": "US",
    "America/Phoenix": "US",
    "America/Anchorage": "US",
    "Pacific/Honolulu": "US",
    "America/Toronto": "CA",
    "America/Vancouver": "CA",
    "America/Montreal": "CA",
    "Europe/London": "GB",
    "Europe/Paris": "FR",
    "Europe/Berlin": "DE",
    "Europe/Madrid": "ES",
    "Europe/Rome": "IT",
    "Europe/Amsterdam": "NL",
    "Europe/Brussels": "BE",
    "Europe/Vienna": "AT",
    "Europe/Zurich": "CH",
    "Europe/Stockholm": "SE",
    "Europe/Oslo": "NO",
    "Europe/Copenhagen": "DK",
    "Europe/Helsinki": "FI",
    "Europe/Dublin": "IE",
    "Europe/Warsaw": "PL",
    "Europe/Prague": "CZ",
    "Europe/Budapest": "HU",
    "Europe/Bucharest": "RO",
    "Europe/Athens": "GR",
    "Europe/Istanbul": "TR",
    "Europe/Moscow": "RU",
    "Asia/Dubai": "AE",
    "Asia/Riyadh": "SA",
    "Asia/Singapore": "SG",
    "Asia/Hong_Kong": "HK",
    "Asia/Shanghai": "CN",
    "Asia/Tokyo": "JP",
    "Asia/Seoul": "KR",
    "Asia/Bangkok": "TH",
    "Asia/Jakarta": "ID",
    "Asia/Kuala_Lumpur": "MY",
    "Asia/Manila": "PH",
    "Asia/Ho_Chi_Minh": "VN",
    "Australia/Sydney": "AU",
    "Australia/Melbourne": "AU",
    "Australia/Perth": "AU",
    "Pacific/Auckland": "NZ",
    "Africa/Cairo": "EG",
    "Africa/Johannesburg": "ZA",
    "Africa/Lagos": "NG",
    "America/Sao_Paulo": "BR",
    "America/Mexico_City": "MX",
    "America/Buenos_Aires": "AR",
    "America/Bogota": "CO",
    "America/Lima": "PE",
    "America/Santiago": "CL",
    "America/Caracas": "VE",
}


def country_from_timezone(tz: Optional[str]) -> Optional[str]:
    """Map IANA timezone (e.g. Asia/Kolkata) to 2-letter country code."""
    if not tz or not isinstance(tz, str):
        return None
    tz = tz.strip()
    if not tz:
        return None
    return TIMEZONE_TO_COUNTRY.get(tz)


# ---------------------------------------------------------------------------
# 3. Accept-Language parsing (e.g. en-IN → IN)
# ---------------------------------------------------------------------------

# Region subtag in Accept-Language (e.g. en-IN, hi-IN). Extract first valid 2-letter region.
_accept_language_region_re = re.compile(r"[a-z]{2}-([A-Z]{2})\b", re.IGNORECASE)


def country_from_accept_language(header: Optional[str]) -> Optional[str]:
    """Parse Accept-Language and return first 2-letter region code (e.g. en-IN → IN)."""
    if not header or not header.strip():
        return None
    for m in _accept_language_region_re.finditer(header):
        region = m.group(1).upper()
        if len(region) == 2 and region != "XX":
            return region
    return None


# ---------------------------------------------------------------------------
# Main: get_region_from_request (async, all 4 methods + fallback)
# ---------------------------------------------------------------------------

async def get_region_from_request(
    request: Request,
    timezone_override: Optional[str] = None,
) -> dict:
    """
    Derive country using, in order:
    0. Proxy headers (CF-IPCountry, X-Vercel-IP-Country)
    1. IP-based geolocation (client IP → cache → ipgeolocation.io, ipapi.co, ip-api.com)
    2. Timezone from query/header (or timezone_override) mapped to country
    3. Accept-Language (e.g. en-IN → IN)
    4. Fallback: US

    Returns dict with country_code (2-letter) and is_india (bool).
    """
    country_code: Optional[str] = None

    # 0. Proxy headers (no network, fast)
    cf_country = request.headers.get("CF-IPCountry")
    vercel_country = request.headers.get("X-Vercel-IP-Country")
    for raw in (cf_country, vercel_country):
        if raw and len((raw := raw.strip().upper())) == 2:
            country_code = raw
            break
    if country_code:
        return {"country_code": country_code, "is_india": country_code == "IN"}

    # 1. IP-based geolocation
    client_ip = get_client_ip(request)
    if client_ip and not is_private_or_local_ip(client_ip):
        country_code = await fetch_country_from_ip(client_ip)
    if country_code:
        return {"country_code": country_code, "is_india": country_code == "IN"}

    # 2. Timezone from frontend (query param or header or override)
    tz = timezone_override or request.query_params.get("timezone") or request.headers.get("x-timezone")
    if tz:
        country_code = country_from_timezone(tz)
    if country_code:
        return {"country_code": country_code, "is_india": country_code == "IN"}

    # 3. Accept-Language
    accept_lang = request.headers.get("Accept-Language")
    country_code = country_from_accept_language(accept_lang)
    if country_code:
        return {"country_code": country_code, "is_india": country_code == "IN"}

    # 4. Fallback
    return {"country_code": "US", "is_india": False}


@router.get("/region")
async def get_region(request: Request):
    """
    Return region for the request (country from proxy headers, IP geo, timezone, Accept-Language, or US).
    Optional: ?timezone=Asia/Kolkata or header X-Timezone for method 2.
    """
    return await get_region_from_request(request)
