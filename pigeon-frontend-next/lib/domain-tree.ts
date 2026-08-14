import type { Domain } from "@/types/api";

export function normalizeFqdn(value: string) {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * Same parent resolution as the Domains page: finds a registered parent domain
 * by walking labels (e.g. a.b.example.com → b.example.com if registered, else example.com).
 */
export function createDomainTreeHelpers(domains: Domain[]) {
  const byName = new Map<string, Domain>();
  domains.forEach((d) => {
    byName.set(normalizeFqdn(d.domain), d);
  });

  const resolveParent = (domainName: string): Domain | null => {
    const parts = normalizeFqdn(domainName).split(".");
    if (parts.length < 3) return null;
    for (let i = 1; i < parts.length - 1; i += 1) {
      const candidate = parts.slice(i).join(".");
      const found = byName.get(candidate);
      if (found) return found;
    }
    return null;
  };

  const getRootDomain = (d: Domain): Domain => {
    let current: Domain = d;
    for (let guard = 0; guard < 64; guard += 1) {
      const parent = resolveParent(current.domain);
      if (!parent) return current;
      current = parent;
    }
    return current;
  };

  return { resolveParent, getRootDomain, byName, normalizeFqdn };
}

/** Verified domains with no registered parent (apex / “main” domains in our tree). */
export function getVerifiedRootDomains(domains: Domain[]): Domain[] {
  const { resolveParent } = createDomainTreeHelpers(domains);
  return domains.filter((d) => d.status === "verified" && !resolveParent(d.domain));
}

/**
 * Verified root + every verified domain whose chain resolves to this root
 * (subdomains under the root). Sorted: root first, then alphabetically.
 */
export function getVerifiedBulkDistributionPool(rootId: string, domains: Domain[]): Domain[] {
  const { getRootDomain } = createDomainTreeHelpers(domains);
  const root = domains.find((d) => d.id === rootId);
  if (!root) return [];

  const pool = domains.filter((d) => {
    if (d.status !== "verified") return false;
    return getRootDomain(d).id === rootId;
  });

  return pool.sort((a, b) => {
    if (a.id === rootId) return -1;
    if (b.id === rootId) return 1;
    return a.domain.localeCompare(b.domain);
  });
}
