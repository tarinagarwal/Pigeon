import type { Domain, Inbox } from "@/types/api";
import { normalizeFqdn } from "@/lib/domain-tree";

/**
 * Count existing inboxes tied to each domain in the pool.
 * Uses `domain_id` when present; otherwise matches email host to a pool domain.
 */
export function countInboxesForDomainPool(inboxes: Inbox[], pool: Domain[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of pool) counts.set(d.id, 0);

  const poolByHost = new Map(pool.map((d) => [normalizeFqdn(d.domain), d]));

  for (const inv of inboxes) {
    if (inv.domain_id && counts.has(inv.domain_id)) {
      counts.set(inv.domain_id, (counts.get(inv.domain_id) ?? 0) + 1);
      continue;
    }
    if (inv.subdomain_id && counts.has(inv.subdomain_id)) {
      counts.set(inv.subdomain_id, (counts.get(inv.subdomain_id) ?? 0) + 1);
      continue;
    }
    const hostPart = inv.email?.includes("@") ? inv.email.split("@").pop() : "";
    if (!hostPart) continue;
    const d = poolByHost.get(normalizeFqdn(hostPart));
    if (d) {
      counts.set(d.id, (counts.get(d.id) ?? 0) + 1);
    }
  }
  return counts;
}

/** Choose the pool domain with the fewest assigned inboxes (tie-break: alphabetical FQDN). */
export function pickLeastLoadedDomain(pool: Domain[], counts: Map<string, number>): Domain {
  const first = pool[0];
  if (!first) {
    throw new Error("pickLeastLoadedDomain: empty pool");
  }
  let best = first;
  let bestCount = counts.get(best.id) ?? 0;
  for (let i = 1; i < pool.length; i += 1) {
    const d = pool[i]!;
    const c = counts.get(d.id) ?? 0;
    if (c < bestCount || (c === bestCount && d.domain.localeCompare(best.domain) < 0)) {
      best = d;
      bestCount = c;
    }
  }
  return best;
}
