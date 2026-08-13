"""SendGrid API Integration Service

This service integrates with SendGrid's API to:
1. Fetch domain authentication DNS records automatically
2. Verify domain authentication status
3. Manage domain settings programmatically
"""

import os
import asyncio
import logging
import urllib.parse
import aiohttp
import ssl
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
from services.error_logging_service import error_logger


class SendGridRateLimitError(Exception):
    """Raised when SendGrid returns 429 or when rate limit remaining is 0."""
    def __init__(self, message: str, rate_limit_reset_utc: Optional[str] = None, rate_limit_limit: Optional[str] = None, rate_limit_remaining: Optional[str] = None):
        super().__init__(message)
        self.rate_limit_reset_utc = rate_limit_reset_utc
        self.rate_limit_limit = rate_limit_limit
        self.rate_limit_remaining = rate_limit_remaining


def normalize_sendgrid_dkim_txt_value(value: str) -> str:
    """Normalize formatting only; preserve SendGrid DKIM payload exactly."""
    v = (value or "").strip()
    if not v:
        return v
    # DNS providers can split/quote TXT chunks; keep semantics unchanged while
    # making value stable for storage/comparison.
    return " ".join(v.replace('"', "").split())


class SendGridService:
    def __init__(self):
        """Initialize SendGrid service"""
        api_key_raw = os.getenv("SENDGRID_API_KEY")
        # Strip quotes if present in .env file
        self.api_key = api_key_raw.strip('"').strip("'") if api_key_raw else None
        self.base_url = "https://api.sendgrid.com/v3"
        self._last_rate_limit: Optional[Dict[str, Any]] = None
        # Prevent duplicate concurrent SendGrid domain-authentication creations.
        # When the UI requests DNS records for a newly-created domain quickly (e.g. in bulk),
        # multiple overlapping requests can cause multiple `POST /whitelabel/domains` calls.
        self._domain_auth_locks: Dict[str, asyncio.Lock] = {}
        # Prevent duplicates caused by SendGrid eventual consistency between POST and subsequent GET.
        # This cache is process-local and short-lived.
        self._domain_auth_cache_ttl_seconds: int = int(
            os.getenv("SENDGRID_DOMAIN_AUTH_CACHE_TTL_SECONDS", "60")
        )
        self._domain_auth_cache: Dict[str, tuple[Dict[str, Any], float]] = {}

    def _get_domain_auth_lock(self, domain: str) -> asyncio.Lock:
        """Return a per-domain asyncio lock (normalized by SendGrid domain rules)."""
        key = (domain or "").strip().lower().rstrip(".")
        if not key:
            # Fallback to a dummy lock key; get_dns_records_for_domain already validates.
            key = "__invalid__"
        if key not in self._domain_auth_locks:
            self._domain_auth_locks[key] = asyncio.Lock()
        return self._domain_auth_locks[key]

    def _get_cached_domain_auth(self, domain: str) -> Optional[Dict[str, Any]]:
        """Return cached SendGrid whitelabel-domain-auth response if still valid."""
        key = (domain or "").strip().lower().rstrip(".")
        if not key:
            return None
        entry = self._domain_auth_cache.get(key)
        if not entry:
            return None
        value, expires_at = entry
        if expires_at > datetime.now(timezone.utc).timestamp():
            return value
        # Expired
        try:
            del self._domain_auth_cache[key]
        except Exception:
            pass
        return None

    def _set_cached_domain_auth(self, domain: str, auth_domain: Dict[str, Any]) -> None:
        key = (domain or "").strip().lower().rstrip(".")
        if not key:
            return
        expires_at = datetime.now(timezone.utc).timestamp() + float(self._domain_auth_cache_ttl_seconds)
        self._domain_auth_cache[key] = (auth_domain, expires_at)

    @staticmethod
    def _normalize_domain(domain: str) -> str:
        return (domain or "").strip().lower().rstrip(".")

    @staticmethod
    def _domain_auth_sort_key(auth_domain: Dict[str, Any]) -> tuple:
        """Prefer verified auths; then highest numeric id."""
        domain_id = auth_domain.get("id")
        try:
            numeric_id = int(domain_id)
        except (TypeError, ValueError):
            numeric_id = -1
        return (1 if auth_domain.get("valid", False) else 0, numeric_id)

    @staticmethod
    def _auth_domain_fqdn(auth_domain: Dict[str, Any]) -> str:
        """
        Build the effective auth hostname from SendGrid response.
        SendGrid may return:
        - domain='example.com', subdomain='em1234'
        - or domain='em1234.example.com'
        """
        domain = (auth_domain.get("domain") or "").strip().lower().rstrip(".")
        subdomain = (auth_domain.get("subdomain") or "").strip().lower().rstrip(".")
        if subdomain and domain and not domain.startswith(f"{subdomain}."):
            return f"{subdomain}.{domain}"
        return domain

    async def _get_matching_domain_authentications(
        self, domain: str, api_key: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Return all SendGrid auth rows matching the requested domain."""
        normalized = self._normalize_domain(domain)
        if not normalized:
            return []
        result = await self._list_all_domain_authentications(api_key)
        if not result:
            return []
        matches: List[Dict[str, Any]] = []
        for auth_domain in result:
            candidate = self._normalize_domain(self._auth_domain_fqdn(auth_domain))
            if not candidate:
                continue
            # Strict exact match so parent/root domains never pick a child/subdomain auth
            # and subdomains never pick parent/root auth.
            if candidate == normalized:
                matches.append(auth_domain)
        return matches

    async def _get_related_domain_authentications(
        self, domain: str, api_key: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Return SendGrid auth rows that are related to the requested domain by suffix.
        Used only as a sync fallback (allow_create=True) to avoid creating a duplicate
        when SendGrid already has an auth like `em1234.<label>.<domain>`.
        """
        normalized = self._normalize_domain(domain)
        if not normalized:
            return []
        result = await self._list_all_domain_authentications(api_key)
        if not result:
            return []
        matches: List[Dict[str, Any]] = []
        suffix = f".{normalized}"
        for auth_domain in result:
            candidate = self._normalize_domain(self._auth_domain_fqdn(auth_domain))
            if not candidate:
                continue
            if candidate == normalized or candidate.endswith(suffix):
                matches.append(auth_domain)
        return matches

    async def _list_all_domain_authentications(
        self, api_key: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Fetch all SendGrid domain-auth rows across pages.
        SendGrid list API is paginated; relying on a single page can miss matches.
        """
        all_rows: List[Dict[str, Any]] = []
        offset = 0
        page_size = 500

        while True:
            endpoint = f"/whitelabel/domains?limit={page_size}&offset={offset}"
            page = await self._make_request("GET", endpoint, api_key)
            if not page or not isinstance(page, list):
                break
            all_rows.extend(page)
            if len(page) < page_size:
                break
            offset += page_size

        return all_rows

    @staticmethod
    def _extra_labels_for_related(auth_domain_value: str, requested_domain: str) -> int:
        requested = (requested_domain or "").strip().lower().rstrip(".")
        candidate = (auth_domain_value or "").strip().lower().rstrip(".")
        if not requested or not candidate:
            return 999
        if candidate == requested:
            return 0
        suffix = f".{requested}"
        if not candidate.endswith(suffix):
            return 999
        prefix = candidate[: -len(suffix)]
        if prefix.startswith("."):
            prefix = prefix[1:]
        if not prefix:
            return 0
        return len([p for p in prefix.split(".") if p])

    async def cleanup_duplicate_domain_authentications(
        self, domain: str, api_key: Optional[str] = None, keep_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Delete duplicate NON-verified SendGrid domain-auth rows for a domain.
        If only one matching row exists, no-op.
        """
        normalized = self._normalize_domain(domain)
        if not normalized:
            return {"deleted_count": 0, "kept_id": None, "total_matches": 0}

        matches = await self._get_matching_domain_authentications(normalized, api_key)
        if len(matches) <= 1:
            return {"deleted_count": 0, "kept_id": matches[0].get("id") if matches else None, "total_matches": len(matches)}

        sorted_matches = sorted(matches, key=self._domain_auth_sort_key, reverse=True)
        keep_auth = None
        if keep_id is not None:
            candidate = next((m for m in sorted_matches if m.get("id") == keep_id), None)
            # Do not force-keep a non-verified entry when a verified one exists.
            if candidate and (
                candidate.get("valid", False)
                or not any(m.get("valid", False) for m in sorted_matches)
            ):
                keep_auth = candidate
        if keep_auth is None:
            keep_auth = sorted_matches[0]
        keep_auth_id = keep_auth.get("id")

        delete_candidates = [
            m for m in sorted_matches
            if m.get("id") != keep_auth_id and not m.get("valid", False)
        ]

        deleted_count = 0
        for candidate in delete_candidates:
            candidate_id = candidate.get("id")
            if not candidate_id:
                continue
            try:
                await self._make_request("DELETE", f"/whitelabel/domains/{candidate_id}", api_key)
                deleted_count += 1
                logging.warning(
                    "[SENDGRID-DEDUPE] Deleted duplicate non-verified domain-auth for %s (id=%s, keep_id=%s)",
                    normalized,
                    candidate_id,
                    keep_auth_id,
                )
            except Exception as exc:
                logging.error(
                    "[SENDGRID-DEDUPE] Failed deleting duplicate domain-auth for %s (id=%s): %s",
                    normalized,
                    candidate_id,
                    exc,
                )

        return {
            "deleted_count": deleted_count,
            "kept_id": keep_auth_id,
            "total_matches": len(matches),
        }
    async def _make_request(self, method: str, endpoint: str, api_key: Optional[str] = None, data: Optional[Dict] = None, user_id: Optional[str] = None, resource_type: Optional[str] = None, resource_id: Optional[str] = None) -> Dict:
        """Make HTTP request to SendGrid API
        
        Args:
            method: HTTP method (GET, POST, etc.)
            endpoint: API endpoint path
            api_key: SendGrid API key (uses env var if not provided)
            data: Request payload for POST/PUT requests
            user_id: User ID for error logging (optional)
            resource_type: Resource type for error logging (optional)
            resource_id: Resource ID for error logging (optional)
        """
        key = api_key or self.api_key
        if not key:
            error_msg = "SendGrid API key not configured"
            await error_logger.log_error(
                service="sendgrid",
                error_type="auth_error",
                error_message=error_msg,
                user_id=user_id,
                resource_type=resource_type,
                resource_id=resource_id,
                severity="error"
            )
            raise Exception(error_msg)
        
        # Strip quotes from API key if present
        key = key.strip('"').strip("'") if isinstance(key, str) else key
            
        url = f"{self.base_url}{endpoint}"
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": "Pigeon/1.0"
        }
        
        # Create SSL context with proper certificate verification
        ssl_context = ssl.create_default_context()
        connector = aiohttp.TCPConnector(ssl=ssl_context)
        
        try:
            async with aiohttp.ClientSession(connector=connector) as session:
                async with session.request(method, url, headers=headers, json=data) as response:
                    if response.status >= 400:
                        error_text = await response.text()
                        
                        # Handle rate limiting (429) with Retry-After and X-RateLimit-* headers
                        if response.status == 429:
                            retry_after = response.headers.get('Retry-After', 'unknown')
                            rate_limit_limit = response.headers.get('X-RateLimit-Limit')
                            rate_limit_remaining = response.headers.get('X-RateLimit-Remaining')
                            rate_limit_reset_raw = response.headers.get('X-RateLimit-Reset')
                            rate_limit_reset_utc = None
                            if rate_limit_reset_raw:
                                try:
                                    reset_utc = datetime.fromtimestamp(int(rate_limit_reset_raw), tz=timezone.utc)
                                    rate_limit_reset_utc = reset_utc.isoformat()
                                except (ValueError, TypeError):
                                    pass
                            error_msg = f"Rate limit exceeded. Please try again in {retry_after} seconds."
                            logging.error(f"SendGrid rate limit exceeded. Retry after: {retry_after} seconds")
                            metadata = {
                                "retry_after": retry_after,
                                "endpoint": endpoint,
                                "method": method,
                            }
                            if rate_limit_limit is not None:
                                metadata["rate_limit_limit"] = rate_limit_limit
                            if rate_limit_remaining is not None:
                                metadata["rate_limit_remaining"] = rate_limit_remaining
                            if rate_limit_reset_utc is not None:
                                metadata["rate_limit_reset_utc"] = rate_limit_reset_utc
                            await error_logger.log_error(
                                service="sendgrid",
                                error_type="rate_limit",
                                error_message=error_msg,
                                error_code="429",
                                user_id=user_id,
                                resource_type=resource_type,
                                resource_id=resource_id,
                                metadata=metadata,
                                severity="warning"
                            )
                            raise SendGridRateLimitError(
                                error_msg,
                                rate_limit_reset_utc=rate_limit_reset_utc,
                                rate_limit_limit=rate_limit_limit,
                                rate_limit_remaining=rate_limit_remaining,
                            )
                        
                        logging.error(f"SendGrid API error: {response.status} - {error_text}")
                        error_msg = f"SendGrid API error: {response.status}"
                        
                        await error_logger.log_error(
                            service="sendgrid",
                            error_type="api_error",
                            error_message=f"{error_msg} - {error_text}",
                            error_code=str(response.status),
                            user_id=user_id,
                            resource_type=resource_type,
                            resource_id=resource_id,
                            metadata={
                                "endpoint": endpoint,
                                "method": method,
                                "response_text": error_text[:500]  # Limit to first 500 chars
                            },
                            severity="error"
                        )
                        raise Exception(error_msg)
                    
                    # Store rate limit headers on success (for 24h loop to check remaining)
                    try:
                        limit = response.headers.get("X-RateLimit-Limit")
                        remaining = response.headers.get("X-RateLimit-Remaining")
                        reset_raw = response.headers.get("X-RateLimit-Reset")
                        reset_utc = None
                        if reset_raw:
                            try:
                                reset_dt = datetime.fromtimestamp(int(reset_raw), tz=timezone.utc)
                                reset_utc = reset_dt.isoformat()
                            except (ValueError, TypeError):
                                pass
                        self._last_rate_limit = {
                            "limit": limit,
                            "remaining": remaining,
                            "reset_utc": reset_utc,
                        }
                    except Exception:
                        self._last_rate_limit = None
                    return await response.json() if response.status != 204 else {}
        except aiohttp.ClientError as e:
            error_msg = f"Failed to connect to SendGrid API: {str(e)}"
            logging.error(error_msg)
            
            await error_logger.log_exception(
                service="sendgrid",
                exception=e,
                error_type="network_error",
                user_id=user_id,
                resource_type=resource_type,
                resource_id=resource_id,
                metadata={
                    "endpoint": endpoint,
                    "method": method
                },
                severity="error"
            )
            raise Exception(error_msg)
    
    def get_last_rate_limit(self) -> Optional[Dict[str, Any]]:
        """Return last X-RateLimit-* headers from a successful SendGrid response (for 24h loop)."""
        return self._last_rate_limit
    
    async def create_domain_authentication(self, domain: str, api_key: Optional[str] = None) -> Dict:
        """Create domain authentication in SendGrid and get DNS records
        
        Args:
            domain: Domain name to authenticate
            api_key: SendGrid API key (optional, uses env var if not provided)
            
        Returns:
            Dict with DNS records including CNAME records for DKIM
        """
        payload = {
            "domain": domain,
            "subdomain": None,  # Use root domain
            "automatic_security": False,  # Manual DKIM record management
            "default": False,
            "custom_spf": False  # Use SendGrid's SPF
        }
        
        try:
            result = await self._make_request("POST", "/whitelabel/domains", api_key, payload)
            logging.info(f"SendGrid domain authentication created for {domain}")
            return result
        except Exception as e:
            logging.warning(f"Failed to create SendGrid domain authentication: {e}")
            return None
    
    async def get_domain_authentication(self, domain: str, api_key: Optional[str] = None) -> Optional[Dict]:
        """Get existing domain authentication records
        
        Args:
            domain: Domain name to look up
            api_key: SendGrid API key
            
        Returns:
            Domain authentication data with DNS records
        """
        normalized = self._normalize_domain(domain)
        try:
            matches = await self._get_matching_domain_authentications(normalized, api_key)
            if not matches:
                return None

            # If duplicates exist, remove non-verified duplicates first, then refresh.
            if len(matches) > 1:
                await self.cleanup_duplicate_domain_authentications(normalized, api_key)
                matches = await self._get_matching_domain_authentications(normalized, api_key)
                if not matches:
                    return None

            # If any verified options exist, use only verified entries.
            verified_matches = [m for m in matches if m.get("valid", False)]
            candidate_pool = verified_matches if verified_matches else matches

            # Prefer highest numeric id within chosen pool.
            return sorted(candidate_pool, key=self._domain_auth_sort_key, reverse=True)[0]
        except Exception as e:
            logging.warning(f"Failed to fetch SendGrid domains: {e}")
            return None
    
    async def get_dns_records_for_domain(
        self,
        domain: str,
        api_key: Optional[str] = None,
        allow_create: bool = True,
    ) -> Dict:
        """Get DNS records needed for SendGrid domain authentication.
        
        This helper will:
        - Look for existing domain authentication in SendGrid
        - Optionally create it (allow_create=True only)
        - Return provider records as reported by SendGrid
        
        Args:
            domain: Domain name
            api_key: SendGrid API key
            
        Returns:
            Dict with cname_records / txt_records / mx_records and info
        """
        domain = (domain or "").strip().lower().rstrip(".")
        if not domain:
            return {
                "error": "Invalid domain provided to SendGrid DNS record lookup.",
                "cname_records": [],
                "info": {},
            }

        # Check if API key is configured
        key = api_key or self.api_key
        if not key:
            return {
                "error": "SendGrid API key not configured. Please set SENDGRID_API_KEY in your backend environment variables.",
                "cname_records": [],
                "info": {
                    "note": "SendGrid API key is missing. Add SENDGRID_API_KEY to your backend .env file.",
                    "documentation": "https://docs.sendgrid.com/ui/account-and-settings/api-keys"
                }
            }
        
        try:
            # Serialize creation/refresh/validate per domain.
            # This makes bulk UI operations safe when they trigger multiple overlapping DNS-record fetches.
            async with self._get_domain_auth_lock(domain):
                # First, try to find existing authentication for this domain
                auth_domain = self._get_cached_domain_auth(domain)
                if not auth_domain:
                    auth_domain = await self.get_domain_authentication(domain, api_key)
                
                # If it doesn't exist yet, optionally create it.
                if not auth_domain:
                    if not allow_create:
                        return {
                            "error": f"No existing SendGrid domain authentication found for '{domain}'.",
                            "cname_records": [],
                            "txt_records": [],
                            "mx_records": [],
                            "info": {
                                "note": "Domain-auth creation is disabled for this operation. Create/authenticate it in SendGrid first.",
                                "documentation": "https://docs.sendgrid.com/ui/account-and-settings/how-to-set-up-domain-authentication",
                            },
                        }
                    # Sync path fallback: if exact match is missing, try related suffix matches
                    # to avoid creating a duplicate SendGrid auth for the same base domain.
                    related_matches = await self._get_related_domain_authentications(domain, api_key)
                    if related_matches:
                        # Simple domain-scope rule:
                        # - For `scholarscenter.org`, use only `*.scholarscenter.org` direct entries.
                        # - For `cloud.scholarscenter.org`, use only `*.cloud.scholarscenter.org` direct entries.
                        scoped_matches = [
                            item
                            for item in related_matches
                            if self._extra_labels_for_related(self._auth_domain_fqdn(item), domain) == 1
                        ]
                        auth_domain = (
                            sorted(
                                scoped_matches,
                                key=self._domain_auth_sort_key,
                                reverse=True,
                            )[0]
                            if scoped_matches
                            else None
                        )
                        if auth_domain:
                            logging.info(
                                "[SENDGRID-SYNC] Reusing existing related SendGrid domain auth for %s: %s (id=%s)",
                                domain,
                                self._auth_domain_fqdn(auth_domain),
                                auth_domain.get("id"),
                            )
                        else:
                            # Nothing matched this exact domain scope; create a new auth for this domain.
                            logging.info(
                                "No scoped related SendGrid auth found for %s. Creating automatically...",
                                domain,
                            )
                            created = await self.create_domain_authentication(domain, api_key)
                            if not created:
                                auth_domain = await self.get_domain_authentication(domain, api_key)
                                if not auth_domain:
                                    return {
                                        "error": f"Failed to create domain authentication in SendGrid for '{domain}'. Please check your SendGrid API key and account limits.",
                                        "cname_records": [],
                                        "info": {
                                            "note": "We could not automatically create the SendGrid domain authentication. You may need to create it manually in the SendGrid dashboard.",
                                            "documentation": "https://docs.sendgrid.com/ui/account-and-settings/how-to-set-up-domain-authentication"
                                        }
                                    }
                            else:
                                auth_domain = created
                    else:
                        logging.info(
                            f"SendGrid domain authentication not found for {domain}. Creating automatically..."
                        )
                        created = await self.create_domain_authentication(domain, api_key)
                    
                        if not created:
                            # Another request may have created it just now (or SendGrid returns
                            # an "already exists" style response). Re-check and reuse if it exists.
                            auth_domain = await self.get_domain_authentication(domain, api_key)
                            if not auth_domain:
                                # create_domain_authentication already logged details; return a helpful error
                                return {
                                    "error": f"Failed to create domain authentication in SendGrid for '{domain}'. Please check your SendGrid API key and account limits.",
                                    "cname_records": [],
                                    "info": {
                                        "note": "We could not automatically create the SendGrid domain authentication. You may need to create it manually in the SendGrid dashboard.",
                                        "documentation": "https://docs.sendgrid.com/ui/account-and-settings/how-to-set-up-domain-authentication"
                                    }
                                }
                        
                        # After creation, use the returned auth domain as our source
                        if created:
                            auth_domain = created
                self._set_cached_domain_auth(domain, auth_domain)

                # If duplicates still exist, clean non-verified duplicates and use the kept row.
                duplicate_cleanup = await self.cleanup_duplicate_domain_authentications(
                    domain, api_key, keep_id=auth_domain.get("id")
                )
                # Always re-select best auth after cleanup/no-op so we don't stay pinned to stale cache.
                refreshed_after_cleanup = await self.get_domain_authentication(domain, api_key)
                if refreshed_after_cleanup:
                    auth_domain = refreshed_after_cleanup
                    self._set_cached_domain_auth(domain, auth_domain)

                # If status is Pending (not verified), call SendGrid validate so valid flags are up to date
                domain_id = auth_domain.get("id")
                if domain_id and not auth_domain.get("valid", False):
                    logging.info(
                        f"SendGrid domain {domain} is Pending; calling validate to refresh verification status"
                    )
                    await self.validate_domain(domain_id, api_key)
                    refreshed = await self.get_domain_authentication(domain, api_key)
                    if refreshed:
                        auth_domain = refreshed
                        self._set_cached_domain_auth(domain, auth_domain)
        except Exception as e:
            error_msg = str(e)
            logging.error(f"SendGrid DNS records error: {error_msg}")
            return {
                "error": f"SendGrid API error: {error_msg}",
                "cname_records": [],
                "info": {
                    "note": f"Error: {error_msg}",
                    "documentation": "https://docs.sendgrid.com/ui/account-and-settings/api-keys"
                }
            }

        # Log the full response for debugging
        logging.info(f"SendGrid auth_domain response: {auth_domain}")
        
        # Extract DNS records
        cname_records = []
        txt_records = []
        mx_records = []
        
        # SendGrid returns DNS records in the 'dns' field
        dns_records = auth_domain.get("dns", {})
        logging.info(f"SendGrid DNS records: {dns_records}")
        # Helper function to clean host/name field
        def clean_host_name(host: str, domain: str) -> str:
            """Normalize host/name for DNS rows.

            SendGrid often returns FQDNs (e.g. em5366.example.com). For hosts that
            map to the authenticated hostname apex, we keep the full FQDN (``domain``)
            instead of ``@`` so UIs and copy-paste show the exact record name.
            """
            if not host:
                return domain if domain else "@"

            # If host ends with the domain, remove it
            if host.endswith(f".{domain}"):
                return host[: -len(f".{domain}")]

            # Same hostname as the SendGrid auth domain: use full FQDN, not @
            if host == domain:
                return domain

            return host
        
        def is_dkim_txt_value(value: str) -> bool:
            """Heuristically detect if a DKIM record from SendGrid is a TXT body or a CNAME target.
            
            - TXT-style DKIM values usually contain key params like 'k=rsa', 'v=DKIM1', 'p='.
            - CNAME targets usually look like hostnames (e.g., s1.domainkey.u12345.wl.sendgrid.net).
            """
            if not value:
                return False
            v = value.lower()
            return "k=rsa" in v or "v=dkim1" in v or " p=" in v

        def dkim_record_host(raw_host: str) -> str:
            """Keep DKIM host as SendGrid returns it (full FQDN), not zone-stripped like other rows."""
            h = (raw_host or "").strip().lower().rstrip(".")
            return h

        # Extract subdomain from mail_cname for DNS record naming
        subdomain_host = None
        
        # Mail CNAME (for mail send domain)
        if dns_records.get("mail_cname"):
            mail_cname = dns_records["mail_cname"]
            subdomain_host = mail_cname.get("host", "")  # e.g., "em1234.example.com"
            cname_records.append({
                "type": "CNAME",
                "name": clean_host_name(subdomain_host, domain),
                "value": mail_cname.get("data", ""),
                "note": "Required for email sending domain",
                "valid": mail_cname.get("valid", False)
            })
        
        # MX and SPF TXT Records (SendGrid API structure)
        # For "Manual Install" mode, SendGrid provides mail_server record
        mail_server = dns_records.get("mail_server")
        
        if mail_server and isinstance(mail_server, dict):
            # SendGrid provides both MX and TXT (SPF) via mail_server
            mx_host = mail_server.get("host", "")
            mx_data = mail_server.get("data", "")
            
            # MX Record
            mx_records.append({
                "type": "MX",
                "name": clean_host_name(mx_host, domain),
                "value": mx_data,
                "priority": 10,
                "note": "Required for bounce handling",
                "valid": mail_server.get("valid", False)
            })
            
            # SPF TXT Record (same host as MX)
            txt_records.append({
                "type": "TXT",
                "name": clean_host_name(mx_host, domain),
                "value": "v=spf1 include:sendgrid.net ~all",
                "note": "SPF record for SendGrid authentication",
                "valid": mail_server.get("valid", False)
            })
            
            logging.info(f"Extracted MX and SPF from mail_server: host={mx_host}, cleaned={clean_host_name(mx_host, domain)}")
        elif subdomain_host:
            # Keep this explicit to avoid synthetic fallback records that can
            # create duplicate/confusing verification paths.
            logging.info(
                "SendGrid mail_server is missing for %s. Skipping synthetic MX/SPF fallback records.",
                domain,
            )
        
        # DKIM records - SendGrid v3 API structure
        # Try different structures for DKIM records. Depending on account/settings,
        # SendGrid may return DKIM as CNAME targets or as TXT-style key bodies.
        dkim_records = dns_records.get("dkim", {})
        
        # Method 1: Check for dkim1 and dkim2 keys
        if isinstance(dkim_records, dict):
            if "dkim1" in dkim_records and isinstance(dkim_records["dkim1"], dict):
                dkim1 = dkim_records["dkim1"]
                dkim1_value = dkim1.get("data", "")
                dkim1_host = dkim_record_host(dkim1.get("host", ""))
                if is_dkim_txt_value(dkim1_value):
                    # TXT-style DKIM key (what most DNS providers expect for m1._domainkey)
                    txt_records.append({
                        "type": "TXT",
                        "name": dkim1_host,
                        "value": normalize_sendgrid_dkim_txt_value(dkim1_value),
                        "note": "DKIM public key (key 1)",
                        "valid": dkim1.get("valid", False)
                    })
                else:
                    # CNAME-style DKIM (older / different SendGrid setups)
                    cname_records.append({
                        "type": "CNAME",
                        "name": dkim1_host,
                        "value": dkim1_value,
                        "note": "Required for DKIM (key 1)",
                        "valid": dkim1.get("valid", False)
                    })
            
            if "dkim2" in dkim_records and isinstance(dkim_records["dkim2"], dict):
                dkim2 = dkim_records["dkim2"]
                dkim2_value = dkim2.get("data", "")
                dkim2_host = dkim_record_host(dkim2.get("host", ""))
                if is_dkim_txt_value(dkim2_value):
                    txt_records.append({
                        "type": "TXT",
                        "name": dkim2_host,
                        "value": normalize_sendgrid_dkim_txt_value(dkim2_value),
                        "note": "DKIM public key (key 2)",
                        "valid": dkim2.get("valid", False)
                    })
                else:
                    cname_records.append({
                        "type": "CNAME",
                        "name": dkim2_host,
                        "value": dkim2_value,
                        "note": "Required for DKIM (key 2)",
                        "valid": dkim2.get("valid", False)
                    })
            
            # Method 2: Check for direct host/data keys (alternative structure)
            elif "host" in dkim_records and "data" in dkim_records:
                dkim_value = dkim_records.get("data", "")
                dkim_host = dkim_record_host(dkim_records.get("host", ""))
                if is_dkim_txt_value(dkim_value):
                    txt_records.append({
                        "type": "TXT",
                        "name": dkim_host,
                        "value": normalize_sendgrid_dkim_txt_value(dkim_value),
                        "note": "DKIM public key",
                        "valid": dkim_records.get("valid", False)
                    })
                else:
                    cname_records.append({
                        "type": "CNAME",
                        "name": dkim_host,
                        "value": dkim_value,
                        "note": "Required for DKIM",
                        "valid": dkim_records.get("valid", False)
                    })
        
        # Method 3: Check if dkim is a list
        elif isinstance(dkim_records, list):
            for idx, dkim_record in enumerate(dkim_records, 1):
                if isinstance(dkim_record, dict):
                    dkim_value = dkim_record.get("data", "")
                    dkim_host = dkim_record_host(dkim_record.get("host", ""))
                    if is_dkim_txt_value(dkim_value):
                        txt_records.append({
                            "type": "TXT",
                            "name": dkim_host,
                            "value": normalize_sendgrid_dkim_txt_value(dkim_value),
                            "note": f"DKIM public key (key {idx})",
                            "valid": dkim_record.get("valid", False)
                        })
                    else:
                        cname_records.append({
                            "type": "CNAME",
                            "name": dkim_host,
                            "value": dkim_value,
                            "note": f"Required for DKIM (key {idx})",
                            "valid": dkim_record.get("valid", False)
                        })
        
        logging.info(f"Extracted {len(cname_records)} CNAME, {len(txt_records)} TXT, {len(mx_records)} MX records from SendGrid for {domain}")
        
        # Log the actual records for debugging
        for txt_rec in txt_records:
            logging.info(f"  TXT: Name={txt_rec.get('name')}, Value={txt_rec.get('value')[:50]}...")
        for mx_rec in mx_records:
            logging.info(f"  MX: Name={mx_rec.get('name')}, Value={mx_rec.get('value')}")
        
        return {
            "cname_records": cname_records,
            "txt_records": txt_records,
            "mx_records": mx_records,
            "sendgrid_info": {
                "note": f"SendGrid domain authentication configured. {'Verified' if auth_domain.get('valid') else 'Pending verification - add DNS records below'}",
                "documentation": "https://docs.sendgrid.com/ui/account-and-settings/how-to-set-up-domain-authentication",
                "domain_id": auth_domain.get("id"),
                "verified": auth_domain.get("valid", False),
                "matched_domain": self._auth_domain_fqdn(auth_domain),
                "subdomain": clean_host_name(subdomain_host, domain) if subdomain_host else None,
                "raw_subdomain_host": subdomain_host,  # For debugging
                "duplicate_cleanup": duplicate_cleanup,
            }
        }
    
    async def validate_domain(self, domain_id: int, api_key: Optional[str] = None) -> Dict:
        """Validate domain authentication in SendGrid
        
        Args:
            domain_id: SendGrid domain ID
            api_key: SendGrid API key
            
        Returns:
            Validation result
        """
        try:
            result = await self._make_request("POST", f"/whitelabel/domains/{domain_id}/validate", api_key)
            logging.info(f"SendGrid domain validation result: {result}")
            return result
        except Exception as e:
            logging.error(f"SendGrid domain validation failed: {e}")
            return {"valid": False, "error": str(e)}
    
    async def delete_domain_authentication(self, domain: str, api_key: Optional[str] = None) -> Dict:
        """Delete domain authentication from SendGrid
        
        Args:
            domain: Domain name to delete
            api_key: SendGrid API key
            
        Returns:
            Dict with success status
        """
        try:
            # First get the domain authentication to find its ID
            auth_domain = await self.get_domain_authentication(domain, api_key)
            
            if not auth_domain:
                logging.info(f"[SENDGRID-DELETE] Domain {domain} not found in SendGrid, nothing to delete")
                return {"success": True, "message": "Domain not found in SendGrid (already deleted or never created)"}
            
            domain_id = auth_domain.get("id")
            if not domain_id:
                logging.error(f"[SENDGRID-DELETE] No domain ID found for {domain}")
                return {"success": False, "error": "Could not find SendGrid domain ID"}
            
            logging.warning(f"[SENDGRID-DELETE] Deleting domain authentication {domain} (ID: {domain_id}) from SendGrid")
            
            # Delete the domain authentication
            await self._make_request("DELETE", f"/whitelabel/domains/{domain_id}", api_key)
            
            logging.warning(f"[SENDGRID-DELETE] Successfully deleted {domain} from SendGrid")
            return {"success": True, "message": f"Domain authentication deleted from SendGrid"}
            
        except Exception as e:
            logging.error(f"[SENDGRID-DELETE] Failed to delete domain {domain} from SendGrid: {e}")
            return {"success": False, "error": str(e)}

    async def delete_domain_authentication_by_id(
        self,
        domain_id: int,
        api_key: Optional[str] = None,
    ) -> Dict:
        """Delete SendGrid domain authentication by SendGrid domain ID."""
        try:
            if not domain_id:
                return {"success": False, "error": "Missing SendGrid domain ID"}

            logging.warning(
                "[SENDGRID-DELETE] Deleting SendGrid domain authentication by id=%s",
                domain_id,
            )
            await self._make_request("DELETE", f"/whitelabel/domains/{domain_id}", api_key)
            logging.warning(
                "[SENDGRID-DELETE] Successfully deleted SendGrid domain authentication id=%s",
                domain_id,
            )
            return {"success": True, "message": "Domain authentication deleted from SendGrid"}
        except Exception as e:
            logging.error(
                "[SENDGRID-DELETE] Failed to delete SendGrid domain authentication id=%s: %s",
                domain_id,
                e,
            )
            return {"success": False, "error": str(e)}

    async def delete_domain_authentications_for_scope(
        self,
        domain: str,
        api_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Delete all SendGrid domain-auth rows for a domain scope.
        Scope match rules:
        - exact auth hostname == requested domain
        - exactly one extra left label before requested domain
          (e.g. em1234.example.com for example.com, em567.engine.example.com for engine.example.com)
        """
        normalized = self._normalize_domain(domain)
        if not normalized:
            return {"success": False, "error": "Invalid domain scope", "deleted_count": 0}

        try:
            related = await self._get_related_domain_authentications(normalized, api_key)
            scoped = []
            for item in related:
                candidate = self._normalize_domain(self._auth_domain_fqdn(item))
                extra = self._extra_labels_for_related(candidate, normalized)
                if extra in (0, 1):
                    scoped.append(item)

            if not scoped:
                logging.warning(
                    "[SENDGRID-DELETE] No scoped SendGrid domain-auth rows found for %s",
                    normalized,
                )
                return {
                    "success": True,
                    "message": "No scoped SendGrid domain authentication rows found",
                    "deleted_count": 0,
                    "matched_count": 0,
                }

            deleted_count = 0
            errors: List[str] = []
            for auth_domain in scoped:
                auth_id = auth_domain.get("id")
                candidate = self._auth_domain_fqdn(auth_domain)
                if not auth_id:
                    continue
                try:
                    await self._make_request("DELETE", f"/whitelabel/domains/{auth_id}", api_key)
                    deleted_count += 1
                    logging.warning(
                        "[SENDGRID-DELETE] Deleted scoped domain-auth %s (id=%s) for requested scope %s",
                        candidate,
                        auth_id,
                        normalized,
                    )
                except Exception as exc:
                    msg = f"id={auth_id} domain={candidate} error={exc}"
                    errors.append(msg)
                    logging.error(
                        "[SENDGRID-DELETE] Failed deleting scoped domain-auth %s for %s: %s",
                        candidate,
                        normalized,
                        exc,
                    )

            return {
                "success": len(errors) == 0,
                "message": (
                    "Deleted all scoped SendGrid domain authentication rows"
                    if len(errors) == 0
                    else "Partially deleted scoped SendGrid domain authentication rows"
                ),
                "deleted_count": deleted_count,
                "matched_count": len(scoped),
                "errors": errors,
            }
        except Exception as e:
            logging.error(
                "[SENDGRID-DELETE] Failed deleting scoped domain-auth rows for %s: %s",
                normalized,
                e,
            )
            return {"success": False, "error": str(e), "deleted_count": 0}

    async def create_inbound_parse_setting(
        self,
        hostname: str,
        url: str,
        *,
        send_raw: bool = False,
        spam_check: bool = True,
        api_key: Optional[str] = None,
    ) -> Dict:
        """Create Inbound Parse setting so SendGrid POSTs received emails to the given URL.

        Args:
            hostname: Receiving domain (e.g. example.com). Must be authenticated in SendGrid.
            url: Public URL where SendGrid will POST parsed email data.
            send_raw: Whether to post raw MIME.
            spam_check: Whether to check incoming emails for spam (sends spam_score and spam_report in webhook).
            api_key: SendGrid API key (optional).

        Returns:
            Dict from SendGrid (or empty on success).
        """
        try:
            data = {
                "url": url,
                "hostname": hostname,
                "send_raw": send_raw,
                "spam_check": spam_check,
            }
            result = await self._make_request(
                "POST", "/user/webhooks/parse/settings", api_key=api_key, data=data
            )
            logging.info(f"SendGrid Inbound Parse created for hostname={hostname}")
            return result
        except Exception as e:
            logging.error(f"Failed to create Inbound Parse for {hostname}: {e}")
            raise

    async def delete_inbound_parse_setting(
        self, hostname: str, api_key: Optional[str] = None
    ) -> Dict:
        """Delete Inbound Parse setting for the given hostname.

        Args:
            hostname: The hostname to remove from Inbound Parse.
            api_key: SendGrid API key (optional).

        Returns:
            Dict with success=True on 204.
        """
        try:
            # URL-encode hostname for path (e.g. example.com)
            encoded_hostname = urllib.parse.quote(hostname, safe="")
            await self._make_request(
                "DELETE",
                f"/user/webhooks/parse/settings/{encoded_hostname}",
                api_key=api_key,
            )
            logging.info(f"SendGrid Inbound Parse deleted for hostname={hostname}")
            return {"success": True}
        except Exception as e:
            logging.error(f"Failed to delete Inbound Parse for {hostname}: {e}")
            return {"success": False, "error": str(e)}
