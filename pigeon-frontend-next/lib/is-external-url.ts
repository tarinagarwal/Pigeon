import { SITE_URL } from "@/lib/seo";

const INTERNAL_HOSTS = new Set(
  [SITE_URL, "https://pigeon.com", "https://www.pigeon.com", "http://localhost:3000", "http://localhost:3001"]
    .map((url) => {
      try {
        return new URL(url).hostname.replace(/^www\./, "");
      } catch {
        return null;
      }
    })
    .filter((host): host is string => Boolean(host))
);

/** True when href points outside this site (http/https only). */
export function isExternalUrl(href: string | null | undefined): boolean {
  if (!href) return false;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("mailto:") || trimmed.startsWith("tel:")) {
    return false;
  }
  if (trimmed.startsWith("/")) return false;

  try {
    const { hostname, protocol } = new URL(trimmed);
    if (protocol !== "http:" && protocol !== "https:") return false;
    const normalized = hostname.replace(/^www\./, "");
    return !INTERNAL_HOSTS.has(normalized);
  } catch {
    return false;
  }
}
