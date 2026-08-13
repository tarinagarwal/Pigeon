#!/usr/bin/env python3
"""
Email validation: syntax, MX, StopForumSpam, optional ZeroBounce v2/validate.

ZeroBounce runs when the caller passes zerobounce_api_key.
"""

from __future__ import annotations

import json
import logging
import re
import random
import smtplib
import socket
import time
from typing import Any, Dict, List
from urllib.parse import urlencode
from urllib.request import urlopen
from urllib.error import HTTPError, URLError

import httpx

try:
    from email_validator import validate_email, EmailNotValidError
except ImportError:  # pragma: no cover - should be installed via requirements
    validate_email = None
    EmailNotValidError = Exception  # type: ignore[assignment]

try:
    import dns.resolver  # type: ignore[import]
except ImportError:  # pragma: no cover - should be installed via requirements
    dns = None  # type: ignore[assignment]
else:
    dns = dns  # type: ignore[assignment]


def is_valid_syntax_regex(email: str) -> bool:
    """Basic syntax validation using regex."""
    pattern = r"^[\w\.-]+@[\w\.-]+\.\w+$"
    return re.match(pattern, email) is not None


def is_valid_syntax(email: str) -> tuple[bool, str | None]:
    """
    Syntax validation using email_validator if available, else regex.
    Returns (is_valid, normalized_email or error_message).
    """
    if validate_email is None:
        if is_valid_syntax_regex(email):
            return True, email.strip().lower()
        return False, "Invalid syntax (regex check)"
    try:
        result = validate_email(email, check_deliverability=False)
        return True, result.normalized
    except EmailNotValidError as e:  # type: ignore[misc]
        return False, str(e)


def has_mx_record(domain: str) -> tuple[bool, str | None]:
    """
    Check whether the domain has MX records (can receive mail).
    Returns (has_mx, error_message or None).
    """
    if dns is None:  # type: ignore[truthy-function]
        return False, "dnspython not installed (pip install dnspython)"
    try:
        records = dns.resolver.resolve(domain, "MX")  # type: ignore[union-attr]
        return len(records) > 0, None
    except dns.resolver.NXDOMAIN:  # type: ignore[union-attr]
        return False, "Domain does not exist"
    except dns.resolver.NoAnswer:  # type: ignore[union-attr]
        return False, "No MX records found"
    except dns.resolver.NoNameservers:  # type: ignore[union-attr]
        return False, "No nameservers responded"
    except Exception as e:  # pragma: no cover - defensive
        return False, str(e)


def get_mx_records(domain: str) -> List[str]:
    """Return MX hosts sorted by priority for a domain."""
    if dns is None:  # type: ignore[truthy-function]
        return []
    try:
        records = dns.resolver.resolve(domain, "MX")  # type: ignore[union-attr]
        # Keep deterministic order by MX preference, then hostname.
        rows = sorted(records, key=lambda r: (int(getattr(r, "preference", 0)), str(r.exchange).lower()))
        return [str(r.exchange).rstrip(".") for r in rows]
    except Exception:
        return []


# RYN listing provider: strict allowlist only (no "custom", no "other" catch-all).
RYN_KNOWN_EMAIL_PROVIDERS: tuple[str, ...] = (
    "gmail",
    "outlook",
    "yahoo",
    "icloud",
    "zoho",
    "protonmail",
    "fastmail",
    "aol",
    "gmx",
    "yandex",
    "mailru",
    "tutanota",
    "hey",
)
RYN_KNOWN_EMAIL_PROVIDER_SET = frozenset(RYN_KNOWN_EMAIL_PROVIDERS)


class UnsupportedRynEmailProviderError(ValueError):
    """MX records do not match any supported RYN provider."""


def normalize_ryn_email_provider(value: str | None) -> str | None:
    """Return a canonical provider if allowed; otherwise None (legacy / invalid rows)."""
    if not value:
        return None
    v = str(value).strip().lower()
    if v in ("custom", "other"):
        return None
    if v in RYN_KNOWN_EMAIL_PROVIDER_SET:
        return v
    return None


def detect_ryn_listing_provider(mx_records: List[str], domain: str | None = None) -> str:
    """Map MX hostnames (and optionally the email domain) to a supported RYN provider, or raise.

    HEY.com shares infrastructure with Fastmail; we classify by domain when it is hey.com.
    """
    if domain and domain.lower().strip() == "hey.com":
        return "hey"

    if not mx_records:
        raise UnsupportedRynEmailProviderError(
            "No MX records found for this domain; cannot determine a supported email provider."
        )
    combined = " ".join(mx.lower() for mx in mx_records)
    patterns: list[tuple[str, list[str]]] = [
        ("gmail", ["google.com", "googlemail.com", "aspmx.l.google"]),
        (
            "outlook",
            [
                "outlook.com",
                "hotmail.com",
                "live.com",
                "microsoft.com",
                "protection.outlook.com",
                "office365",
                "exchange",
                "outlook.office365",
            ],
        ),
        ("yahoo", ["yahoo.com", "yahoodns.net"]),
        ("icloud", ["icloud.com", "me.com", "mac.com"]),
        ("zoho", ["zoho.com", "zohomail.com"]),
        ("protonmail", ["protonmail.ch", "proton.me", "pm.me"]),
        ("fastmail", ["fastmail.com", "messagingengine.com"]),
        ("aol", ["aol.com", "mail.aol.com"]),
        ("gmx", ["gmx.net", "gmx.com", "gmx.de", "gmx.us"]),
        ("yandex", ["yandex.ru", "yandex.net", "yandex.com"]),
        ("mailru", ["mail.ru", "mxs.mail.ru"]),
        ("tutanota", ["tutanota.com", "tutanota.de", "tutamail.com", "tuta.io"]),
    ]
    for name, keywords in patterns:
        if any(kw in combined for kw in keywords):
            if name not in RYN_KNOWN_EMAIL_PROVIDER_SET:
                raise RuntimeError(f"RYN provider pattern bug: {name!r} not in RYN_KNOWN_EMAIL_PROVIDERS")
            return name
    raise UnsupportedRynEmailProviderError(
        "This email domain is not from a supported provider for Rent Your Network "
        "(e.g. Gmail, Outlook, Yahoo, iCloud, Zoho, Proton, Fastmail, AOL, GMX, Yandex, Mail.ru, Tutanota, HEY)."
    )


def smtp_check(
    email: str,
    mx_records: List[str],
    from_email: str = "probe@example.com",
    retries: int = 1,
    timeout_sec: float = 8.0,
) -> str:
    """
    SMTP RCPT TO probe for one specific address (mailbox signal). Separate from
    catch-all detection (`is_catch_all`), which uses a second RCPT to a random local part.

    Good default when you are not sending real mail: lightweight and mailbox-agnostic,
    but imperfect — many hosts (notably large M365 / Google Workspace configurations)
    tarpit, greylist, or return ambiguous codes, so results can be "unknown" even
    for real addresses.

    Keep timeouts short and avoid aggressive parallel probing; this path is not a
    substitute for real delivery signals from production sends.

    Returns: valid | invalid | greylisted | unknown
    """
    for mx in mx_records:
        try:
            server = smtplib.SMTP(timeout=timeout_sec)
            server.connect(mx)
            server.helo("example.com")
            server.mail(from_email)
            code, _ = server.rcpt(email)
            server.quit()
            if code == 250:
                return "valid"
            if code in (550, 551, 553):
                return "invalid"
            if code in (450, 451, 452):
                if retries > 0:
                    time.sleep(2.0)
                    return smtp_check(
                        email,
                        mx_records,
                        from_email=from_email,
                        retries=retries - 1,
                        timeout_sec=timeout_sec,
                    )
                return "greylisted"
        except (smtplib.SMTPServerDisconnected, socket.error, smtplib.SMTPException, TimeoutError):
            continue
        except Exception:
            continue
    return "unknown"


def is_catch_all(domain: str, mx_records: List[str]) -> bool:
    """
    Catch-all probe: RCPT TO a random local part (not the real mailbox). Separate
    from `smtp_check` on the actual address; both are SMTP but answer different questions.
    If random RCPT is accepted, mailbox existence cannot be inferred from RCPT alone.
    """
    fake_email = f"pigeon_{random.randint(100000, 999999)}_{random.randint(10000, 99999)}@{domain}"
    return smtp_check(fake_email, mx_records, retries=0) == "valid"


def risk_score(email: str, smtp_result: str, catch_all: bool) -> int:
    """0 (best) to 100 (worst) deliverability risk score."""
    if not is_valid_syntax_regex(email):
        return 100
    score = 0
    if smtp_result == "invalid":
        score += 70
    elif smtp_result == "greylisted":
        score += 30
    elif smtp_result == "unknown":
        score += 40
    if catch_all:
        if smtp_result == "valid":
            score += 45
        else:
            score += 20
    role_prefixes = {"admin", "info", "support", "sales"}
    try:
        local = email.split("@", 1)[0].lower()
        if local in role_prefixes:
            score += 10
    except Exception:
        pass
    return min(score, 100)


def check_stop_forum_spam(
    email: str,
    ip: str | None = None,
    threshold: int = 50,
) -> tuple[bool, str]:
    """
    Check StopForumSpam for email/IP reputation.

    Block rule: if email OR IP has frequency >= threshold, treat as blocked.
    Returns (is_allowed, message).
    """
    params: dict[str, str] = {"email": email}
    if ip:
        params["ip"] = ip

    url = "https://api.stopforumspam.org/api?" + urlencode(params) + "&json"

    try:
        with urlopen(url, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError) as e:
        # Fail-open: if the reputation service is unavailable, do not block,
        # but surface the reason.
        return True, f"StopForumSpam check skipped ({e})"
    except Exception as e:  # pragma: no cover - defensive
        return True, f"StopForumSpam check error ({e})"

    if not data or not data.get("success"):
        return True, "StopForumSpam API reported failure; not blocking"

    blocked_reasons: List[str] = []

    email_info: Dict[str, Any] = data.get("email") or {}
    ip_info: Dict[str, Any] = data.get("ip") or {}

    try:
        if email_info.get("appears") and int(email_info.get("frequency", 0)) >= threshold:
            blocked_reasons.append(
                f"email frequency {email_info.get('frequency')} >= {threshold}"
            )
    except (TypeError, ValueError):
        pass

    if ip:
        try:
            if ip_info.get("appears") and int(ip_info.get("frequency", 0)) >= threshold:
                blocked_reasons.append(
                    f"ip frequency {ip_info.get('frequency')} >= {threshold}"
                )
        except (TypeError, ValueError):
            pass

    if blocked_reasons:
        return False, "; ".join(blocked_reasons)

    return True, "StopForumSpam: OK"


def zerobounce_validate_sync(
    email: str,
    ip_address: str | None,
    api_key: str,
    *,
    timeout: int | None = None,
    activity_data: bool | None = None,
    verify_plus: bool | None = None,
) -> tuple[Dict[str, Any] | None, str | None]:
    """
    ZeroBounce GET /v2/validate. Caller supplies api_key (e.g. from user integrations).

    Uses httpx for reliable TLS handling. Logs all failures at WARNING level so
    server logs surface the real error (network, SSL, bad key, quota, etc.).
    """
    key = (api_key or "").strip()
    if not key:
        return None, None

    zb_timeout = max(3, min(60, int(timeout))) if timeout is not None else 15
    params: dict[str, str] = {"api_key": key, "email": email}
    ip_s = (ip_address or "").strip()
    if ip_s:
        params["ip_address"] = ip_s
    if timeout is not None:
        params["timeout"] = str(max(3, min(60, int(timeout))))
    if activity_data is not None:
        params["activity_data"] = "true" if activity_data else "false"
    if verify_plus is not None:
        params["verify_plus"] = "true" if verify_plus else "false"

    url = "https://api.zerobounce.net/v2/validate"
    logging.debug("ZeroBounce: calling /v2/validate for %s", email)
    try:
        with httpx.Client(timeout=float(zb_timeout)) as client:
            resp = client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as e:
        msg = f"ZeroBounce HTTP {e.response.status_code}: {e.response.text[:200]}"
        logging.warning("ZeroBounce request failed for %s: %s", email, msg)
        return None, msg
    except httpx.RequestError as e:
        msg = f"ZeroBounce network error: {e}"
        logging.warning("ZeroBounce request failed for %s: %s", email, msg)
        return None, msg
    except Exception as e:
        msg = f"ZeroBounce error: {e}"
        logging.warning("ZeroBounce unexpected error for %s: %s", email, msg)
        return None, msg

    if not isinstance(data, dict):
        msg = f"ZeroBounce unexpected response shape: {str(data)[:100]}"
        logging.warning("ZeroBounce bad response for %s: %s", email, msg)
        return None, msg
    err = data.get("error")
    if err:
        logging.warning("ZeroBounce API error for %s: %s", email, err)
        return None, str(err)

    logging.debug("ZeroBounce: %s → status=%s sub_status=%s", email, data.get("status"), data.get("sub_status"))
    return data, None


def smart_leads_email_qualifies(validation: Dict[str, Any]) -> bool:
    """
    True when a candidate should be persisted for Smart Leads: basic checks pass,
    not catch-all, and if ZeroBounce was used its status must be valid.
    """
    if not validation.get("mailbox_verified_strong"):
        return False
    if validation.get("zerobounce_error"):
        return False
    zb = str(validation.get("zerobounce_status") or "").strip().lower()
    if zb:
        return zb == "valid"
    return True


def validate_email_full(
    email: str,
    ip: str | None = None,
    *,
    zerobounce_api_key: str | None = None,
    zerobounce_timeout: int | None = None,
    zerobounce_activity_data: bool | None = None,
    zerobounce_verify_plus: bool | None = None,
) -> Dict[str, Any]:
    """
    Full validation: syntax + MX record check + StopForumSpam + optional ZeroBounce.

    No outbound SMTP probes are made from this system. Catch-all detection is via
    ZeroBounce only (status == "catch-all"). ZeroBounce runs when zerobounce_api_key
    is supplied; without it only basic checks are performed.

    Returns a dict with keys including:
      - valid: bool — true when mailbox_verified_strong
      - mailbox_verified_strong: bool — basic checks pass; if ZeroBounce was used, ZB status == "valid"
      - catch_all: bool — ZeroBounce reports this as a catch-all address
      - smtp_status: always "skipped"
      - risk_score, messages, zerobounce_status, ...
    """
    result: Dict[str, Any] = {
        "valid": False,
        "syntax_ok": False,
        "mx_ok": False,
        "stop_forum_spam_ok": True,
        "normalized": None,
        "mx_records": [],
        "smtp_status": "skipped",
        "catch_all": False,
        "mailbox_verified_strong": False,
        "risk_score": 100,
        "zerobounce": None,
        "zerobounce_status": None,
        "zerobounce_sub_status": None,
        "zerobounce_error": None,
        "messages": [],
    }
    if not email or not isinstance(email, str):
        result["messages"].append("No email provided")
        return result

    email = email.strip()

    # Syntax
    syntax_ok, syntax_result = is_valid_syntax(email)
    result["syntax_ok"] = syntax_ok
    if syntax_ok:
        result["normalized"] = syntax_result
        result["messages"].append("Syntax: OK")
    else:
        result["messages"].append(f"Syntax: {syntax_result}")
        result["valid"] = False
        return result

    # MX check
    domain = ""
    if "@" in email:
        domain = email.split("@")[-1].strip().lower()
        mx_ok, mx_error = has_mx_record(domain)
        result["mx_ok"] = mx_ok
        if mx_ok:
            result["messages"].append("MX record: OK")
        else:
            result["messages"].append(f"MX record: {mx_error or 'none'}")
    else:
        result["messages"].append("MX record: skipped (no domain)")

    # StopForumSpam reputation check
    sfs_ok, sfs_message = check_stop_forum_spam(email, ip=ip)
    result["stop_forum_spam_ok"] = sfs_ok
    if sfs_ok:
        result["messages"].append(sfs_message)
    else:
        result["messages"].append(f"StopForumSpam: BLOCKED ({sfs_message})")

    mx_records: List[str] = get_mx_records(domain) if domain else []
    result["mx_records"] = mx_records
    result["messages"].append("SMTP: skipped (no outbound probes from this system)")

    # Optional ZeroBounce validation — provides catch-all detection and mailbox status.
    zb_key = (zerobounce_api_key or "").strip()
    if zb_key:
        zb, zb_err = zerobounce_validate_sync(
            result["normalized"] or email,
            ip,
            zb_key,
            timeout=zerobounce_timeout,
            activity_data=zerobounce_activity_data,
            verify_plus=zerobounce_verify_plus,
        )
        if zb_err:
            logging.warning("ZeroBounce validation failed for %s: %s", email, zb_err)
    else:
        zb, zb_err = None, None

    if zb_err:
        result["zerobounce_error"] = zb_err
        result["messages"].append(f"ZeroBounce: {zb_err}")
    elif zb is not None:
        result["zerobounce"] = zb
        result["zerobounce_status"] = zb.get("status")
        result["zerobounce_sub_status"] = zb.get("sub_status")
        st = str(zb.get("status") or "").strip().lower()
        result["messages"].append(f"ZeroBounce status: {st or 'n/a'}")
        if st == "catch-all":
            result["catch_all"] = True
            result["messages"].append("Catch-all: ZeroBounce reports catch-all domain")
        if st in {"invalid", "spamtrap", "abuse", "do_not_mail"}:
            result["messages"].append("ZeroBounce: elevated risk for high-risk status")

    result["risk_score"] = risk_score(
        result["normalized"] or email, result["smtp_status"], bool(result["catch_all"])
    )
    result["messages"].append(f"Risk score: {result['risk_score']}")

    # mailbox_verified_strong: basic checks pass; if ZeroBounce was used, ZB must confirm valid.
    zb_status = str(result.get("zerobounce_status") or "").strip().lower()
    zb_used = result.get("zerobounce") is not None
    result["mailbox_verified_strong"] = bool(
        result["syntax_ok"]
        and result["mx_ok"]
        and result["stop_forum_spam_ok"]
        and (not zb_used or zb_status == "valid")
        and not result["catch_all"]
    )
    result["valid"] = bool(result["mailbox_verified_strong"])

    return result

