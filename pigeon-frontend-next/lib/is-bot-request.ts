import { headers } from "next/headers";

/**
 * Major search-engine crawlers only. Everyone else (users, SEO tools, curl, etc.)
 * receives dofollow external links.
 */
const SEARCH_CRAWLER_UA_PATTERNS = [
  /googlebot/i,
  /google-inspectiontool/i,
  /storebot-google/i,
  /bingbot/i,
  /msnbot/i,
  /adidxbot/i,
  /slurp/i,
  /duckduckbot/i,
  /baiduspider/i,
  /yandexbot/i,
  /applebot/i,
  /petalbot/i,
  /sogou/i,
  /naverbot/i,
  /yeti/i,
  /seznambot/i,
  /mojeekbot/i,
  /amazonbot/i,
];

export function isSearchCrawlerUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent || !userAgent.trim()) return false;
  return SEARCH_CRAWLER_UA_PATTERNS.some((pattern) => pattern.test(userAgent));
}

/** True only for Google, Bing, and other major search crawlers. */
export async function isBotRequest(): Promise<boolean> {
  const headerList = await headers();
  return isSearchCrawlerUserAgent(headerList.get("user-agent"));
}

/** @deprecated Use isSearchCrawlerUserAgent */
export const isBotUserAgent = isSearchCrawlerUserAgent;
