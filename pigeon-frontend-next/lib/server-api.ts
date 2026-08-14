/**
 * Server-side API fetchers for SSR. Use in Server Components only.
 * No auth/cookies required for public endpoints (plans, blogs, region).
 * Blog data: FastAPI backend first, then Next.js /api/blogs*, then direct MongoDB.
 * Plans: direct MongoDB (SSR) to avoid Vercel self-request failures; /api/plans remains for client fetches.
 * Region: backend.
 */

import {
  getBlogsVersion,
  listBlogs,
  getBlogBySlug,
  getRelatedBlogs,
} from "@/lib/blog-data";
import { listActivePlans, getPlanById as getPlanByIdFromDb } from "@/lib/plan-data";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

/** Base URL for this Next.js app (used for /api/plans). Server fetch needs absolute URL. */
function appApiBase(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site) return site.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

/** Server fetch requires absolute URLs; relative path would throw in Node. */
function absoluteUrl(path: string): string | null {
  if (!API_BASE) return null;
  const base = API_BASE.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Fetch active plans from MongoDB. Direct read avoids Vercel SSR self-request to /api/plans. */
export async function fetchPlans(): Promise<{ plans: Record<string, unknown>[] }> {
  const plans = await listActivePlans();
  return { plans };
}

/**
 * Fetch a single plan by id (for /pricing/[planId]). Includes inactive plans.
 * Uses direct MongoDB to avoid Vercel self-request failures (same as blog data).
 */
export async function fetchPlanById(
  planId: string
): Promise<{ plan: Record<string, unknown> | null }> {
  const plan = await getPlanByIdFromDb(planId);
  return { plan };
}

/** Geo headers from the incoming user request to forward to the backend for region detection. */
export type RegionRequestHeaders = {
  "x-vercel-ip-country"?: string | null;
  "cf-ipcountry"?: string | null;
  "x-forwarded-for"?: string | null;
  "x-real-ip"?: string | null;
  "cf-connecting-ip"?: string | null;
};

export async function fetchRegion(
  options?: { cookieHeader?: string; requestHeaders?: RegionRequestHeaders }
): Promise<{ is_india: boolean | null }> {
  const url = absoluteUrl("/region");
  if (!url) return { is_india: null };
  try {
    const headers: HeadersInit = {};
    if (options?.cookieHeader) headers["Cookie"] = options.cookieHeader;
    const rh = options?.requestHeaders;
    if (rh) {
      if (rh["x-vercel-ip-country"]) headers["X-Vercel-IP-Country"] = rh["x-vercel-ip-country"];
      if (rh["cf-ipcountry"]) headers["CF-IPCountry"] = rh["cf-ipcountry"];
      if (rh["x-forwarded-for"]) headers["X-Forwarded-For"] = rh["x-forwarded-for"];
      if (rh["x-real-ip"]) headers["X-Real-IP"] = rh["x-real-ip"];
      if (rh["cf-connecting-ip"]) headers["CF-Connecting-IP"] = rh["cf-connecting-ip"];
    }
    const res = await fetch(url, {
      headers,
      next: { revalidate: 86400 },
    });
    if (!res.ok) return { is_india: null };
    return res.json();
  } catch {
    return { is_india: null };
  }
}

const BLOG_FETCH_CACHE = { next: { revalidate: 86400, tags: ["blogs"] } };

function blogListQuery(page: number, limit: number, tag?: string | null): string {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", String(limit));
  if (tag?.trim()) params.set("tag", tag.trim());
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Try FastAPI, then Next.js /api route. Returns parsed JSON or null. */
async function fetchBlogJson<T>(backendPath: string, nextApiPath: string): Promise<T | null> {
  const backendUrl = absoluteUrl(backendPath);
  if (backendUrl) {
    try {
      const res = await fetch(backendUrl, BLOG_FETCH_CACHE);
      if (res.ok) return (await res.json()) as T;
    } catch {
      /* try Next.js API */
    }
  }
  try {
    const res = await fetch(`${appApiBase()}${nextApiPath}`, BLOG_FETCH_CACHE);
    if (res.ok) return (await res.json()) as T;
  } catch {
    /* fall through to direct MongoDB */
  }
  return null;
}

/** Blog version for cache invalidation. Backend → Next.js API → MongoDB. */
export async function fetchBlogsVersion(): Promise<string> {
  const data = await fetchBlogJson<{ version: string }>("/blogs/version", "/api/blogs/version");
  if (data?.version) return data.version;
  const { version } = await getBlogsVersion();
  return version;
}

/** Blog list. Backend → Next.js API → MongoDB. */
export async function fetchBlogs(
  page = 1,
  limit = 10,
  tag?: string | null
): Promise<{ blogs: Array<Record<string, unknown>>; total: number; page: number; limit: number }> {
  const qs = blogListQuery(page, limit, tag);
  const data = await fetchBlogJson<{
    blogs: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
  }>(`/blogs${qs}`, `/api/blogs${qs}`);
  if (data) return data;
  return listBlogs(page, limit, tag);
}

/** Single blog by slug. Backend → Next.js API → MongoDB. */
export async function fetchBlogBySlug(slug: string): Promise<Record<string, unknown> | null> {
  const encoded = encodeURIComponent(slug);
  const blog = await fetchBlogJson<Record<string, unknown>>(
    `/blogs/${encoded}`,
    `/api/blogs/${encoded}`
  );
  if (blog) return blog;
  return getBlogBySlug(slug);
}

/** Related blogs. Backend → Next.js API → MongoDB. */
export async function fetchRelatedBlogs(
  slug: string,
  limit = 5
): Promise<{ blogs: Array<Record<string, unknown>> }> {
  const encoded = encodeURIComponent(slug);
  const qs = `?limit=${limit}`;
  const data = await fetchBlogJson<{ blogs: Array<Record<string, unknown>> }>(
    `/blogs/${encoded}/related${qs}`,
    `/api/blogs/${encoded}/related${qs}`
  );
  if (data) return data;
  return getRelatedBlogs(slug, limit);
}
