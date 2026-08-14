/**
 * Server-side origin for the FastAPI app (no path suffix). Used to proxy legacy links
 * that point at the marketing site (e.g. /api/lifecycle/unsubscribe/...) to the API.
 *
 * `NEXT_PUBLIC_API_URL` is usually the API root including `/api` (e.g. http://localhost:8001/api)
 * because client calls are `${NEXT_PUBLIC_API_URL}/domains/...`. Proxies must append `/api/...`
 * once, so we strip a trailing `/api` to avoid `/api/api/...` and FastAPI 404.
 */
export function getBackendBaseUrl(): string | null {
  let raw =
    process.env.BACKEND_PROXY_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    "";
  if (!raw) return null;
  raw = raw.replace(/\/+$/, "");
  if (raw.endsWith("/api")) {
    raw = raw.slice(0, -4);
  }
  return raw;
}
