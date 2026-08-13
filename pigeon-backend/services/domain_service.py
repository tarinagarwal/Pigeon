import dns.resolver
import dns.exception
from cryptography.fernet import Fernet
import os
import asyncio
from datetime import datetime, timezone
from typing import Dict, List, Optional
import base64
import uuid
import logging

from services.sendgrid_service import SendGridService, SendGridRateLimitError
from services.email_infra_service import EmailInfraService

class DomainService:
    def __init__(self, db, admin_db=None):
        self.db = db
        self.admin_db = admin_db if admin_db is not None else db  # Fall back to main db if admin_db not provided
        encryption_key = os.getenv("ENCRYPTION_KEY")
        if not encryption_key:
            raise ValueError("ENCRYPTION_KEY environment variable is required. Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"")
        self.encryption_key = encryption_key
        self.fernet = Fernet(self.encryption_key.encode() if isinstance(self.encryption_key, str) else self.encryption_key)
        self.dkim_selector = "sendgrid"
        self.sendgrid_service = SendGridService()
        self.email_infra_service = EmailInfraService()
    
    async def _get_email_provider(self) -> str:
        """Return the single supported provider."""
        return "sendgrid"
    
    async def _get_spf_include_for_provider(self, provider: str) -> Optional[str]:
        """Get the SPF include domain for a given email provider"""
        if provider == "sendgrid":
            return "sendgrid.net"
        return None
    
    async def _get_provider_specific_records(
        self, domain: str, provider: str, allow_create: bool = True
    ) -> Dict:
        """Get provider-specific DNS records (MX, CNAME) required for email sending
        
        Fetches REAL DNS records from SendGrid API automatically.
        No manual dashboard checking needed - fully automated SaaS experience.
        """
        records = {}
        
        if provider == "sendgrid":
            # Fetch REAL DNS records from SendGrid API
            try:
                sendgrid_records = await self.sendgrid_service.get_dns_records_for_domain(
                    domain,
                    allow_create=allow_create,
                )
                # print('sendgrid_records', sendgrid_records);
                if sendgrid_records.get("error"):
                    # API call failed - show error message
                    records["sendgrid_info"] = sendgrid_records.get("info", {
                        "note": "Failed to fetch SendGrid DNS records. Please configure SENDGRID_API_KEY in environment variables.",
                        "documentation": "https://docs.sendgrid.com/ui/account-and-settings/how-to-set-up-domain-authentication"
                    })
                else:
                    # Successfully fetched real records from SendGrid API
                    records["sendgrid_info"] = sendgrid_records.get("sendgrid_info")
                    records["cname_records"] = sendgrid_records.get("cname_records", [])
                    records["txt_records"] = sendgrid_records.get("txt_records", [])
                    records["mx_records"] = sendgrid_records.get("mx_records", [])
                    logging.info(f"Fetched {len(records['cname_records'])} CNAME, {len(records.get('txt_records', []))} TXT, {len(records.get('mx_records', []))} MX records from SendGrid for {domain}")
            except SendGridRateLimitError:
                raise
            except Exception as e:
                logging.error(f"Error fetching SendGrid DNS records: {e}")
                records["sendgrid_info"] = {
                    "note": f"Error connecting to SendGrid API: {str(e)}. Please check your API key configuration.",
                    "documentation": "https://docs.sendgrid.com/ui/account-and-settings/how-to-set-up-domain-authentication"
                }
        else:
            records["sendgrid_info"] = {
                "note": "Only SendGrid is supported as the email provider.",
                "documentation": "https://docs.sendgrid.com/ui/account-and-settings/how-to-set-up-domain-authentication"
            }
        
        return records
    
    @staticmethod
    def _txt_query_fqdn(
        record_name_from_provider: str,
        *,
        apex_domain: str,
        provider_lookup_domain: str,
    ) -> str:
        """
        Build the FQDN for public DNS TXT lookups (SPF/DKIM).

        SendGrid may return a short label (``em1234``), a host under the apex
        (``m1._domainkey.example.com``), or the full mail-host FQDN. If we append
        ``provider_lookup_domain`` when the name is already a full hostname, the
        query becomes invalid (e.g. ``em1234.example.com.em1234.example.com``).
        """
        n = (record_name_from_provider or "").strip().lower().rstrip(".")
        apex = (apex_domain or "").strip().lower().rstrip(".")
        pl = (provider_lookup_domain or "").strip().lower().rstrip(".") or apex
        if not n or n == "@":
            return pl
        if n == pl:
            return n
        if pl and n.endswith(f".{pl}"):
            return n
        if apex and n.endswith(f".{apex}"):
            return n
        if "." not in n:
            return f"{n}.{apex}" if apex else n
        if apex and not n.endswith(f".{apex}"):
            return f"{n}.{apex}"
        return n

    async def _query_dns_txt(self, record_name: str) -> list:
        """Query DNS TXT records with public-resolver fallback."""
        host = (record_name or "").strip().lower().rstrip(".")
        if not host:
            return []

        def _resolve_with_resolver(resolver: dns.resolver.Resolver) -> Optional[list]:
            try:
                answers = resolver.resolve(host, "TXT")
                return [str(rdata).strip('"') for rdata in answers]
            except dns.resolver.NXDOMAIN:
                return []
            except dns.resolver.NoAnswer:
                return []
            except dns.exception.DNSException:
                return None  # None signals "try next resolver"

        # Try system resolver first.
        system_resolver = dns.resolver.Resolver()
        system_resolver.timeout = 4
        system_resolver.lifetime = 6
        result = _resolve_with_resolver(system_resolver)
        if result is not None:
            logging.debug(f"DNS TXT Query: {host} -> {len(result)} record(s) via system resolver")
            return result

        # Fallback: public resolvers (helps in restricted/container environments).
        public_resolver = dns.resolver.Resolver(configure=False)
        public_resolver.nameservers = ["1.1.1.1", "8.8.8.8"]
        public_resolver.timeout = 4
        public_resolver.lifetime = 6
        result = _resolve_with_resolver(public_resolver)
        if result is not None:
            logging.debug(f"DNS TXT Query: {host} -> {len(result)} record(s) via public resolver")
            return result
        logging.debug(f"DNS TXT Query: {host} -> DNSException on both resolvers")
        return []

    async def _query_dns_cname(self, record_name: str) -> Optional[str]:
        """Query DNS CNAME target for a hostname."""
        host = (record_name or "").strip().lower().rstrip(".")
        if not host:
            return None

        def _resolve_with_resolver(resolver: dns.resolver.Resolver) -> Optional[str]:
            try:
                answers = resolver.resolve(host, "CNAME")
                for rdata in answers:
                    return str(rdata.target).rstrip(".").lower()
                return None
            except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer, dns.exception.DNSException):
                return None

        # First try system resolver config.
        system_resolver = dns.resolver.Resolver()
        system_resolver.timeout = 4
        system_resolver.lifetime = 6
        direct = _resolve_with_resolver(system_resolver)
        if direct:
            return direct

        # Fallback: common public resolvers (helps in restricted/container environments).
        public_resolver = dns.resolver.Resolver(configure=False)
        public_resolver.nameservers = ["1.1.1.1", "8.8.8.8"]
        public_resolver.timeout = 4
        public_resolver.lifetime = 6
        return _resolve_with_resolver(public_resolver)

    async def verify_tracking_domain_cname(self, tracking_domain: str, expected_target: str) -> Dict:
        """
        Verify tracking domain CNAME points to expected target.
        Accepts direct target match or a one-hop chain (tracking -> api -> expected).
        """
        host = (tracking_domain or "").strip().lower().rstrip(".")
        expected = (expected_target or "").strip().lower().rstrip(".")
        if not host:
            raise Exception("Tracking domain is required")
        if not expected:
            raise Exception("Expected CNAME target is required")

        direct_target = await self._query_dns_cname(host)
        if not direct_target:
            return {
                "valid": False,
                "tracking_domain": host,
                "expected_target": expected,
                "resolved_target": None,
                "message": "No CNAME record found for tracking domain.",
            }

        # Allow either exact match or one extra CNAME hop.
        if direct_target == expected:
            return {
                "valid": True,
                "tracking_domain": host,
                "expected_target": expected,
                "resolved_target": direct_target,
                "message": "Tracking domain CNAME is correctly configured.",
            }

        chained_target = await self._query_dns_cname(direct_target)
        if chained_target == expected:
            return {
                "valid": True,
                "tracking_domain": host,
                "expected_target": expected,
                "resolved_target": direct_target,
                "message": "Tracking domain CNAME resolves correctly via one intermediate CNAME.",
            }

        return {
            "valid": False,
            "tracking_domain": host,
            "expected_target": expected,
            "resolved_target": direct_target,
            "message": f"CNAME target mismatch. Expected {expected}, found {direct_target}.",
        }

    @staticmethod
    def _receiving_mx_dns_name_hint(fqdn: str) -> str:
        """Host/name for the MX record at the registrable zone: @ for apex, else the left labels (e.g. cloud for cloud.example.com)."""
        labels: List[str] = [p for p in fqdn.lower().strip().rstrip(".").split(".") if p]
        if len(labels) <= 2:
            return "@"
        return ".".join(labels[:-2])

    async def verify_receiving_mx(self, domain_id: str) -> Dict:
        """Verify that the receiving MX record (mx.sendgrid.net) is present for the domain.
        Used before enabling Inbound Parse so we only enable when DNS is ready."""
        domain = await self.db.domains.find_one({"id": domain_id})
        if not domain:
            raise Exception("Domain not found")
        domain_name = domain["domain"].rstrip(".").lower()
        mx_name_hint = self._receiving_mx_dns_name_hint(domain_name)
        expected_host = "mx.sendgrid.net"
        expected_priority = 10

        def _query_mx():
            def _resolve(resolver: dns.resolver.Resolver) -> Optional[list]:
                try:
                    answers = resolver.resolve(domain_name, "MX")
                    return [
                        {
                            "host": str(r.exchange).lower().rstrip("."),
                            "priority": int(r.preference),
                        }
                        for r in answers
                    ]
                except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
                    return []
                except dns.exception.DNSException:
                    return None  # signals "try next resolver"

            sys_r = dns.resolver.Resolver()
            sys_r.timeout = 4
            sys_r.lifetime = 6
            result = _resolve(sys_r)
            if result is not None:
                return result
            pub_r = dns.resolver.Resolver(configure=False)
            pub_r.nameservers = ["1.1.1.1", "8.8.8.8"]
            pub_r.timeout = 4
            pub_r.lifetime = 6
            return _resolve(pub_r) or []

        loop = asyncio.get_running_loop()
        mx_records = await loop.run_in_executor(None, _query_mx)
        mx_hosts = [rec["host"] for rec in mx_records]
        expected_records = [rec for rec in mx_records if rec["host"] == expected_host]
        other_records = [rec for rec in mx_records if rec["host"] != expected_host]

        if expected_records and not other_records:
            expected_priority_found = any(rec["priority"] == expected_priority for rec in expected_records)
            if expected_priority_found:
                return {"valid": True, "message": "Receiving MX record is set correctly."}
            priorities = ", ".join(str(rec["priority"]) for rec in expected_records)
            return {
                "valid": False,
                "message": (
                    f"MX host is correct for {domain_name}, but priority must be {expected_priority}. "
                    f"Current priority for {expected_host}: {priorities}."
                ),
            }

        name_part = f"Name: {mx_name_hint}" if mx_name_hint != "@" else "Name: @ (or your apex hostname)"
        if not mx_hosts:
            return {
                "valid": False,
                "message": (
                    f"No MX record found for {domain_name}. Add an MX record ({name_part}, "
                    "Value: mx.sendgrid.net, priority 10) at the DNS zone that serves this host, then try again after DNS propagates."
                ),
            }
        if other_records:
            other_hosts = ", ".join(
                f"{rec['host']} (priority {rec['priority']})"
                for rec in other_records
            )
            expected_hint = f"{expected_host} (priority {expected_priority})"
            return {
                "valid": False,
                "message": (
                    f"Receiving MX for {domain_name} is not exclusive. Keep only {expected_hint} for this host. "
                    f"Remove other MX record(s): {other_hosts}."
                ),
            }
        return {
            "valid": False,
            "message": (
                f"Receiving MX record not found for {domain_name}. Current MX: {', '.join(mx_hosts)}. "
                f"Expected mx.sendgrid.net. Add MX ({name_part}, Value: mx.sendgrid.net) and try again after DNS propagates."
            ),
        }

    async def verify_dns_records(self, domain_id: str) -> Dict:
        """Verify DNS records for a domain (SendGrid: SPF, DKIM, DMARC, CNAME, MX).

        This method is used for the interactive "Verify" button in the domain UI.
        It is allowed to call the provider API (SendGrid) via
        `_get_provider_specific_records` for richer feedback.
        """
        domain = await self.db.domains.find_one({"id": domain_id})
        if not domain:
            raise Exception("Domain not found")
        
        domain_name = domain["domain"]
        provider_sync_meta = domain.get("provider_sync") or {}
        preferred_lookup_domain = (provider_sync_meta.get("matched_domain") or "").strip().lower().rstrip(".")
        provider_lookup_domain = preferred_lookup_domain or domain_name
        verification_results = {
            "spf_verified": False,
            "dkim_verified": False,
            "dmarc_verified": False,
            "spf_record_found": None,
            "dkim_record_found": None,
            "dmarc_record_found": None,
            "cname_verified": False,
            "mx_verified": False,
        }

        # Get current email provider + (optionally) provider-specific DNS records
        try:
            current_provider = await self._get_email_provider()
        except Exception as e:
            logging.warning(f"[DNS] Failed to get current email provider for {domain_name}: {e}")
            current_provider = "sendgrid"

        provider_records = None
        if current_provider == "sendgrid":
            try:
                logging.warning(
                    f"[DNS-PROVIDER] Fetching provider records for DKIM/SPF/MX verification "
                    f"({current_provider}) for {provider_lookup_domain} (stored domain: {domain_name})"
                )
                provider_records = await self._get_provider_specific_records(
                    provider_lookup_domain,
                    current_provider,
                    allow_create=False,
                )
            except Exception as e:
                logging.error(f"[DNS-PROVIDER] Error fetching provider records for {domain_name}: {e}")
                provider_records = None
        
        # Verify SPF record
        try:
            # Get CURRENT email provider SPF include (not from domain record)
            current_spf_include = await self._get_spf_include_for_provider(current_provider)
            
            logging.warning(f"[DNS-SPF] Starting verification for {domain_name}")
            logging.warning(f"[DNS-SPF] Current provider: {current_provider}, SPF include: {current_spf_include}")
            
            # For SendGrid, SPF is on the subdomain, not root domain
            # Get the subdomain from provider-specific records
            spf_query_domain = provider_lookup_domain  # Default to provider lookup domain
            
            if current_provider == "sendgrid":
                # Reuse provider_records already fetched at start of verify_dns_records (one API call per domain)
                txt_records_from_provider = (provider_records or {}).get("txt_records", [])
                logging.warning(f"[DNS-SPF] Provider returned {len(txt_records_from_provider)} TXT records")
                
                for idx, txt_rec in enumerate(txt_records_from_provider):
                    logging.warning(f"[DNS-SPF] TXT Record {idx}: Name={txt_rec.get('name')}, Value={txt_rec.get('value', '')[:80]}...")
                    if "v=spf1" in txt_rec.get("value", ""):
                        spf_subdomain = txt_rec.get("name")  # short label or full FQDN from SendGrid
                        logging.warning(f"[DNS-SPF] Found SPF host from provider: {spf_subdomain}")
                        if spf_subdomain and spf_subdomain != "@":
                            spf_query_domain = self._txt_query_fqdn(
                                spf_subdomain,
                                apex_domain=domain_name,
                                provider_lookup_domain=provider_lookup_domain,
                            )
                            logging.warning(f"[DNS-SPF] Will use TXT query host: {spf_query_domain}")
                        break
            
            # Query DNS for SPF record
            txt_records = await self._query_dns_txt(spf_query_domain)
            logging.warning(f"[DNS-SPF] Queried {spf_query_domain}, found {len(txt_records)} TXT records")
            
            expected_spf = domain.get("spf_record", "")
            logging.warning(f"[DNS-SPF] Expected (from DB): {expected_spf}")
            
            for record in txt_records:
                if record.startswith("v=spf1"):
                    verification_results["spf_record_found"] = record
                    logging.warning(f"[DNS-SPF] Found in DNS: {record}")
                    
                    # Normalize both records for comparison (remove quotes, normalize whitespace)
                    normalized_found = " ".join(record.split())
                    
                    # Verify against CURRENT provider's SPF include (not old domain config)
                    if current_spf_include:
                        if f"include:{current_spf_include}" in normalized_found:
                            verification_results["spf_verified"] = True
                            logging.warning(f"[DNS-SPF] ✓ VERIFIED - Found include:{current_spf_include}")
                        else:
                            logging.warning(f"[DNS-SPF] ✗ MISMATCH - Expected include:{current_spf_include}, but not found in: {normalized_found}")
                    else:
                        # If no include configured, just verify it's a valid SPF record
                        if normalized_found.startswith("v=spf1"):
                            verification_results["spf_verified"] = True
                            logging.warning(f"[DNS-SPF] ✓ VERIFIED (no include check)")
                    break
            
            if not verification_results.get("spf_record_found"):
                logging.warning(f"[DNS-SPF] ✗ NOT FOUND - No SPF record at {spf_query_domain}")
        except Exception as e:
            logging.error(f"[DNS-SPF] ✗ ERROR: {e}")
            pass
        
        # Verify DKIM record
        try:
            # Prefer provider-specific DKIM host (e.g., m1._domainkey from SendGrid)
            dkim_record_name = None
            provider_dkim_host = None

            if provider_records:
                txt_records = provider_records.get("txt_records", [])
                for rec in txt_records:
                    value = (rec.get("value") or "").lower()
                    name = rec.get("name") or ""
                    lower_name = name.lower()
                    if (
                        "v=dkim1" in value
                        or "k=rsa" in value
                        or ("p=" in value and "_domainkey" in lower_name)
                    ):
                        provider_dkim_host = name
                        break

            if provider_dkim_host:
                dkim_record_name = self._txt_query_fqdn(
                    provider_dkim_host,
                    apex_domain=domain_name,
                    provider_lookup_domain=provider_lookup_domain,
                )
            else:
                # No DKIM host from provider — leave dkim_verified=False rather than hard-failing.
                logging.warning(
                    f"[DNS-DKIM] Provider DKIM host not found for {domain_name}; "
                    "DKIM will remain unverified until provider records are available."
                )
                dkim_record_name = None

            logging.warning(f"[DNS-DKIM] Starting verification for {domain_name}")
            logging.warning(f"[DNS-DKIM] Querying: {dkim_record_name}")

            if dkim_record_name:
                txt_records = await self._query_dns_txt(dkim_record_name)
                logging.warning(f"[DNS-DKIM] Found {len(txt_records)} TXT records")

                for record in txt_records:
                    lower_record = record.lower()
                    has_version = "v=dkim1" in lower_record
                    has_key_type = "k=rsa" in lower_record
                    has_public_key = "p=" in lower_record

                    if (has_version and has_key_type) or (has_key_type and has_public_key):
                        verification_results["dkim_record_found"] = record
                        verification_results["dkim_verified"] = True
                        logging.warning(f"[DNS-DKIM] ✓ VERIFIED - Found valid DKIM record")
                        logging.warning(f"[DNS-DKIM] Record: {record[:100]}...")
                        break

                if not verification_results.get("dkim_record_found"):
                    logging.warning(f"[DNS-DKIM] ✗ NOT FOUND - No DKIM record at {dkim_record_name}")
        except Exception as e:
            # Log and continue — DKIM stays unverified; do not bubble as a hard error.
            logging.error(f"[DNS-DKIM] ✗ ERROR: {e}")
        
        # Verify DMARC record
        try:
            apex = (domain_name or "").strip().lower().rstrip(".")
            dmarc_record_name = f"_dmarc.{apex}"
            logging.warning(f"[DNS-DMARC] Starting verification for {domain_name}")
            logging.warning(f"[DNS-DMARC] Querying: {dmarc_record_name}")
            
            txt_records = await self._query_dns_txt(dmarc_record_name)
            logging.warning(f"[DNS-DMARC] Found {len(txt_records)} TXT records")
            
            for record in txt_records:
                if record.lower().startswith("v=dmarc1"):
                    verification_results["dmarc_record_found"] = record
                    verification_results["dmarc_verified"] = True
                    logging.warning(f"[DNS-DMARC] ✓ VERIFIED")
                    logging.warning(f"[DNS-DMARC] Record: {record}")
                    break
            
            if not verification_results.get("dmarc_record_found"):
                logging.warning(f"[DNS-DMARC] ✗ NOT FOUND - No DMARC record at {dmarc_record_name}")
        except Exception as e:
            logging.error(f"[DNS-DMARC] ✗ ERROR: {e}")
            pass
        
        # Provider-specific DNS verification (CNAME / MX) for SendGrid
        try:
            if current_provider == "sendgrid":
                # Reuse provider_records if we already fetched above, otherwise fetch now.
                if not provider_records:
                    provider_records = await self._get_provider_specific_records(
                        provider_lookup_domain,
                        current_provider,
                        allow_create=False,
                    )
                cname_records = provider_records.get("cname_records", []) if provider_records else []
                mx_records = provider_records.get("mx_records", []) if provider_records else []

                # Treat records as verified only when all of them are marked valid (if valid is present).
                if cname_records:
                    verification_results["cname_verified"] = all(
                        rec.get("valid", True) for rec in cname_records
                    )
                    logging.warning(
                        f"[DNS-PROVIDER] CNAME verified for {domain_name}: {verification_results['cname_verified']}"
                    )

                if mx_records:
                    # Use only the provider's valid flag (e.g. SendGrid) - show verified only when provider says True
                    verification_results["mx_verified"] = all(
                        rec.get("valid", True) for rec in mx_records
                    )
                    logging.warning(
                        f"[DNS-PROVIDER] MX verified for {domain_name}: {verification_results['mx_verified']}"
                    )

                # Dynamic: only require MX/CNAME when provider actually returned those record types
                verification_results["provider_returned_mx"] = bool(mx_records)
                verification_results["provider_returned_cname"] = bool(cname_records)

                # When provider says SPF/DKIM valid (e.g. SendGrid mail_server + dkim all true), treat as verified
                txt_from_provider = provider_records.get("txt_records", []) if provider_records else []
                for rec in txt_from_provider:
                    if not rec.get("valid", False):
                        continue
                    val = (rec.get("value") or "").lower()
                    if "v=spf1" in val or "include:sendgrid.net" in val:
                        verification_results["spf_verified"] = True
                    if "k=rsa" in val or "v=dkim1" in val or ("p=" in val and "_domainkey" in (rec.get("name") or "").lower()):
                        verification_results["dkim_verified"] = True
                    if "v=dmarc1" in val:
                        verification_results["dmarc_verified"] = True
        except Exception as e:
            logging.error(f"[DNS-PROVIDER] ✗ ERROR while checking provider CNAME/MX for {domain_name}: {e}")
        
        # Update domain with verification results.
        # Keep verification flags monotonic: once verified, do not flip back to False
        # due to transient DNS/provider resolution issues.
        update_data = {"updated_at": datetime.now(timezone.utc)}
        sticky_flags = ("spf_verified", "dkim_verified", "dmarc_verified", "cname_verified", "mx_verified")
        for flag in sticky_flags:
            if verification_results.get(flag):
                update_data[flag] = True
        effective_spf = bool(domain.get("spf_verified")) or bool(verification_results.get("spf_verified"))
        effective_dkim = bool(domain.get("dkim_verified")) or bool(verification_results.get("dkim_verified"))
        effective_dmarc = bool(domain.get("dmarc_verified")) or bool(verification_results.get("dmarc_verified"))
        effective_mx = bool(domain.get("mx_verified")) or bool(verification_results.get("mx_verified"))
        effective_cname = bool(domain.get("cname_verified")) or bool(verification_results.get("cname_verified"))
        
        required_checks = [
            verification_results["spf_verified"],
            verification_results["dkim_verified"],
            verification_results["dmarc_verified"],
        ]
        if verification_results.get("provider_returned_mx", False):
            required_checks.append(verification_results.get("mx_verified", False))
        if verification_results.get("provider_returned_cname", False):
            required_checks.append(verification_results.get("cname_verified", False))

        if all(required_checks):
            update_data["status"] = "verified"
            update_data["verified_at"] = datetime.now(timezone.utc)
        else:
            need_mx = verification_results.get("provider_returned_mx", False)
            need_cname = verification_results.get("provider_returned_cname", False)
            if (
                effective_spf
                and effective_dkim
                and effective_dmarc
                and (not need_mx or effective_mx)
                and (not need_cname or effective_cname)
            ):
                update_data["status"] = "verified"
                update_data["verified_at"] = datetime.now(timezone.utc)
            elif domain.get("status") == "pending":
                update_data["status"] = "pending"
        
        await self.db.domains.update_one(
            {"id": domain_id},
            {"$set": update_data}
        )
        
        # Expose SendGrid rate limit headers for 24h background loop (when remaining=0, schedule next at reset)
        if current_provider == "sendgrid":
            verification_results["rate_limit_sendgrid"] = self.sendgrid_service.get_last_rate_limit()
        return verification_results

    async def verify_dns_records_dns_only(self, domain_id: str) -> Dict:
        """Verify DNS records for a domain using ONLY DNS + stored expectations.

        Intended for background cron use:
        - SPF: TXT at root domain containing include:sendgrid.net
        - DKIM: TXT at <selector>._domainkey.<domain>
        - DMARC: TXT at _dmarc.<domain>
        - MX: MX record containing mx.sendgrid.net
        """
        logging.warning(f"[DNS-ONLY] Starting DNS-only verification for domain_id={domain_id}")
        domain = await self.db.domains.find_one({"id": domain_id})
        if not domain:
            logging.error(f"[DNS-ONLY] Domain not found for id={domain_id}")
            raise Exception("Domain not found")

        domain_name = domain["domain"].rstrip(".").lower()
        verification_results: Dict[str, object] = {
            "spf_verified": False,
            "dkim_verified": False,
            "dmarc_verified": False,
            "spf_record_found": None,
            "dkim_record_found": None,
            "dmarc_record_found": None,
            "cname_verified": False,
            "mx_verified": False,
        }

        # Resolve SPF/DKIM DNS hosts from stored dns_records (set at sync time by SendGrid API).
        # This avoids hardcoded apex/selector checks that don't match provider subdomains like
        # em1234.example.com (SPF) or m1._domainkey.em1234.example.com (DKIM).
        stored_dns = domain.get("dns_records") or {}
        stored_spf_name = (stored_dns.get("spf") or {}).get("name") or ""
        stored_dkim_name = (stored_dns.get("dkim") or {}).get("name") or ""

        # SPF: prefer stored provider host; fall back to apex.
        try:
            spf_include = await self._get_spf_include_for_provider("sendgrid")
            spf_host = self._txt_query_fqdn(
                stored_spf_name, apex_domain=domain_name, provider_lookup_domain=domain_name
            ) if stored_spf_name else domain_name
            # Always also check the apex in case SPF lives there.
            hosts_to_check = [spf_host]
            if spf_host != domain_name:
                hosts_to_check.append(domain_name)
            for check_host in hosts_to_check:
                txt_records = await self._query_dns_txt(check_host)
                logging.warning(f"[DNS-ONLY-SPF] TXT records at {check_host}: {len(txt_records)} found")
                for record in txt_records:
                    if record.startswith("v=spf1"):
                        verification_results["spf_record_found"] = record
                        normalized = " ".join(record.split()).lower()
                        if spf_include and f"include:{spf_include}".lower() in normalized:
                            verification_results["spf_verified"] = True
                            logging.warning(f"[DNS-ONLY-SPF] SPF verified at {check_host} via include:{spf_include}")
                        break
                if verification_results["spf_verified"]:
                    break
        except Exception as e:
            logging.error(f"[DNS-ONLY-SPF] Error verifying SPF for {domain_name}: {e}")

        # DKIM: prefer stored provider host; fall back to <selector>._domainkey.<domain>.
        try:
            dkim_selector = domain.get("dkim_selector", self.dkim_selector)
            fallback_dkim_host = f"{dkim_selector}._domainkey.{domain_name}"
            dkim_host = self._txt_query_fqdn(
                stored_dkim_name, apex_domain=domain_name, provider_lookup_domain=domain_name
            ) if stored_dkim_name else fallback_dkim_host
            # Check stored host and, if different, the classic selector host too.
            dkim_hosts_to_check = [dkim_host]
            if dkim_host != fallback_dkim_host:
                dkim_hosts_to_check.append(fallback_dkim_host)
            for check_host in dkim_hosts_to_check:
                txt_records = await self._query_dns_txt(check_host)
                logging.warning(f"[DNS-ONLY-DKIM] TXT records at {check_host}: {len(txt_records)} found")
                for record in txt_records:
                    lower_record = record.lower()
                    has_version = "v=dkim1" in lower_record
                    has_key_type = "k=rsa" in lower_record
                    has_public_key = "p=" in lower_record
                    if (has_version and has_key_type) or (has_key_type and has_public_key):
                        verification_results["dkim_record_found"] = record
                        verification_results["dkim_verified"] = True
                        logging.warning(f"[DNS-ONLY-DKIM] DKIM verified at {check_host}")
                        break
                if verification_results["dkim_verified"]:
                    break
        except Exception as e:
            logging.error(f"[DNS-ONLY-DKIM] Error verifying DKIM for {domain_name}: {e}")

        # Pigeon / Email Infra SPF: TXT at root matching stored TXT value
        try:
            email_infra = domain.get("email_infra") or {}
            infra_spf_txt = email_infra.get("spf")
            if infra_spf_txt:
                ema_spf_host = domain_name  # root
                txt_records = await self._query_dns_txt(ema_spf_host)
                logging.warning(
                    f"[DNS-ONLY-PIGEON-SPF] TXT records at {ema_spf_host}: {len(txt_records)} found"
                )
                for record in txt_records:
                    if record.strip() == infra_spf_txt.strip():
                        verification_results["email_infra_spf_record_found"] = record
                        verification_results["email_infra_spf_verified"] = True
                        logging.warning("[DNS-ONLY-PIGEON-SPF] Pigeon SPF verified at root")
                        break
        except Exception as e:
            logging.error(f"[DNS-ONLY-PIGEON-SPF] Error verifying Pigeon SPF for {domain_name}: {e}")

        # Pigeon / Email Infra DKIM: TXT at mail._domainkey.<domain> matching stored TXT value
        try:
            email_infra = domain.get("email_infra") or {}
            infra_dkim_txt = email_infra.get("dkim")
            if infra_dkim_txt:
                ema_dkim_host = f"mail._domainkey.{domain_name}"
                txt_records = await self._query_dns_txt(ema_dkim_host)
                logging.warning(
                    f"[DNS-ONLY-PIGEON-DKIM] TXT records at {ema_dkim_host}: {len(txt_records)} found"
                )
                for record in txt_records:
                    if record.strip() == infra_dkim_txt.strip():
                        verification_results["email_infra_dkim_record_found"] = record
                        verification_results["email_infra_dkim_verified"] = True
                        logging.warning("[DNS-ONLY-PIGEON-DKIM] Pigeon DKIM verified via mail._domainkey")
                        break
        except Exception as e:
            logging.error(f"[DNS-ONLY-PIGEON-DKIM] Error verifying Pigeon DKIM for {domain_name}: {e}")

        # Pigeon / Email Infra DMARC: TXT at _dmarc.<domain> matching stored TXT value
        try:
            email_infra = domain.get("email_infra") or {}
            infra_dmarc_txt = email_infra.get("dmarc")
            if infra_dmarc_txt:
                ema_dmarc_host = f"_dmarc.{domain_name}"
                txt_records = await self._query_dns_txt(ema_dmarc_host)
                logging.warning(
                    f"[DNS-ONLY-PIGEON-DMARC] TXT records at {ema_dmarc_host}: {len(txt_records)} found"
                )
                for record in txt_records:
                    if record.strip() == infra_dmarc_txt.strip():
                        verification_results["email_infra_dmarc_record_found"] = record
                        verification_results["email_infra_dmarc_verified"] = True
                        logging.warning("[DNS-ONLY-PIGEON-DMARC] Pigeon DMARC verified at _dmarc")
                        break
        except Exception as e:
            logging.error(f"[DNS-ONLY-PIGEON-DMARC] Error verifying Pigeon DMARC for {domain_name}: {e}")

        # DMARC: TXT at _dmarc.<domain>
        try:
            dmarc_host = f"_dmarc.{domain_name}"
            txt_records = await self._query_dns_txt(dmarc_host)
            logging.warning(f"[DNS-ONLY-DMARC] TXT records at {dmarc_host}: {len(txt_records)} found")
            for record in txt_records:
                if record.lower().startswith("v=dmarc1"):
                    verification_results["dmarc_record_found"] = record
                    verification_results["dmarc_verified"] = True
                    logging.warning("[DNS-ONLY-DMARC] DMARC verified")
                    break
        except Exception as e:
            logging.error(f"[DNS-ONLY-DMARC] Error verifying DMARC for {domain_name}: {e}")

        # MX: must include mx.sendgrid.net (system resolver + public fallback)
        try:
            def _resolve_mx_with(resolver: dns.resolver.Resolver) -> Optional[list]:
                try:
                    answers = resolver.resolve(domain_name, "MX")
                    return [str(r.exchange).lower().rstrip(".") for r in answers]
                except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
                    return []
                except dns.exception.DNSException:
                    return None  # signals "try next resolver"

            def _query_mx() -> list:
                sys_r = dns.resolver.Resolver()
                sys_r.timeout = 4
                sys_r.lifetime = 6
                result = _resolve_mx_with(sys_r)
                if result is not None:
                    return result
                pub_r = dns.resolver.Resolver(configure=False)
                pub_r.nameservers = ["1.1.1.1", "8.8.8.8"]
                pub_r.timeout = 4
                pub_r.lifetime = 6
                return _resolve_mx_with(pub_r) or []

            loop = asyncio.get_running_loop()
            mx_hosts = await loop.run_in_executor(None, _query_mx)
            logging.warning(f"[DNS-ONLY-MX] MX hosts for {domain_name}: {mx_hosts}")
            for host in mx_hosts:
                if host == "mx.sendgrid.net":
                    verification_results["mx_verified"] = True
                    logging.warning("[DNS-ONLY-MX] MX mx.sendgrid.net verified")
                    break
        except Exception as e:
            logging.error(f"[DNS-ONLY-MX] Error verifying MX for {domain_name}: {e}")

        # Update stored flags and status.
        # Only write True — never flip a verified flag back to False on a transient DNS failure.
        # A domain that was verified stays verified until explicitly re-provisioned.
        update_data: Dict[str, object] = {"updated_at": datetime.now(timezone.utc)}
        for flag in ("spf_verified", "dkim_verified", "dmarc_verified", "mx_verified"):
            if verification_results.get(flag):
                update_data[flag] = True

        core_checks = [
            verification_results["spf_verified"],
            verification_results["dkim_verified"],
            verification_results["dmarc_verified"],
        ]
        if all(core_checks):
            update_data["status"] = "verified"
            update_data["verified_at"] = datetime.now(timezone.utc)

        await self.db.domains.update_one({"id": domain_id}, {"$set": update_data})

        logging.warning(
            f"[DNS-ONLY] Finished DNS-only verification for domain_id={domain_id} "
            f"spf={verification_results['spf_verified']} "
            f"dkim={verification_results['dkim_verified']} "
            f"dmarc={verification_results['dmarc_verified']} "
            f"mx={verification_results['mx_verified']}"
        )

        return verification_results
    
    async def calculate_health_score(self, domain_id: str) -> int:
        """Calculate domain health score (0-100) based on current email provider.
        Only checks applicable to the provider are counted so 100% = all required checks verified."""
        domain = await self.db.domains.find_one({"id": domain_id})
        if not domain:
            return 0

        try:
            provider = await self._get_email_provider()
        except Exception as e:
            logging.warning(f"Health score: failed to get provider for domain {domain_id}: {e}")
            provider = "sendgrid"

        earned = 0
        max_possible = 0

        # Common checks for all providers (SPF, DKIM, DMARC)
        for check, weight in [
            ("spf_verified", 25),
            ("dkim_verified", 25),
            ("dmarc_verified", 25),
        ]:
            max_possible += weight
            if domain.get(check):
                earned += weight

        if provider == "sendgrid":
            # Provider-specific: CNAME and MX matter for SendGrid
            max_possible += 12  # CNAME
            max_possible += 13  # MX
            # When status is verified, treat provider checks as satisfied (avoids 98% when one flag lags)
            provider_checks_ok = (
                domain.get("status") == "verified"
                or (domain.get("cname_verified") and domain.get("mx_verified"))
            )
            if provider_checks_ok:
                earned += 25  # full CNAME + MX
            else:
                if domain.get("cname_verified"):
                    earned += 12
                if domain.get("mx_verified"):
                    earned += 13
        # Base score 0–100 from checks; recency adds up to 10% (total capped at 100)
        base_score = round((earned / max_possible * 100) if max_possible else 0)
        recency_bonus = 0
        if domain.get("verified_at"):
            verified_at = domain["verified_at"]
            if isinstance(verified_at, str):
                from dateutil import parser
                verified_at = parser.parse(verified_at)
            if verified_at.tzinfo is None:
                verified_at = verified_at.replace(tzinfo=timezone.utc)
            days_since = (datetime.now(timezone.utc) - verified_at).days
            if days_since < 30:
                recency_bonus = 10
        score = min(100, base_score + recency_bonus)

        # Update health score
        await self.db.domains.update_one(
            {"id": domain_id},
            {"$set": {"health_score": score}}
        )

        return score
    
    async def create_subdomain(self, domain_id: str, subdomain: str) -> Dict:
        """Create a subdomain"""
        domain = await self.db.domains.find_one({"id": domain_id})
        if not domain:
            raise Exception("Domain not found")
        
        domain_name = domain["domain"]
        full_domain = f"{subdomain}.{domain_name}"
        
        # Check if subdomain already exists
        existing = await self.db.subdomains.find_one({
            "domain_id": domain_id,
            "subdomain": subdomain
        })
        if existing:
            raise Exception(f"Subdomain {subdomain} already exists")
        
        subdomain_doc = {
            "id": str(uuid.uuid4()),
            "domain_id": domain_id,
            "subdomain": subdomain,
            "full_domain": full_domain,
            "status": "pending",
            "created_at": datetime.now(timezone.utc)
        }
        
        await self.db.subdomains.insert_one(subdomain_doc)
        subdomain_doc.pop("_id", None)
        
        return subdomain_doc
    
    async def verify_subdomain_dns(self, subdomain_id: str) -> bool:
        """Verify subdomain DNS (same as parent domain verification)"""
        subdomain = await self.db.subdomains.find_one({"id": subdomain_id})
        if not subdomain:
            return False
        
        domain_id = subdomain["domain_id"]
        # Verify parent domain DNS (subdomains inherit DNS records)
        verification_results = await self.verify_dns_records(domain_id)
        
        # If parent domain is verified, subdomain is verified
        if all([verification_results["spf_verified"],
                verification_results["dkim_verified"],
                verification_results["dmarc_verified"]]):
            await self.db.subdomains.update_one(
                {"id": subdomain_id},
                {"$set": {"status": "verified"}}
            )
            return True
        
        return False
