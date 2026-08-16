import { GITHUB_OWNER, GITHUB_REPO } from "@/lib/site";

/**
 * Star count for the public repo, or null when GitHub is unreachable or
 * rate-limited — callers render the icon without a number in that case.
 *
 * Cached for an hour, so the site makes one upstream request per hour no
 * matter how much traffic it gets. Unauthenticated GitHub allows 60 requests
 * an hour per IP; set GITHUB_TOKEN to raise that if the cache is ever bypassed.
 */
export async function getGitHubStars(): Promise<number | null> {
  const token = process.env.GITHUB_TOKEN?.trim();

  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        next: { revalidate: 3600 },
      },
    );

    if (!res.ok) return null;

    const data: unknown = await res.json();
    const count = (data as { stargazers_count?: unknown })?.stargazers_count;
    return typeof count === "number" ? count : null;
  } catch {
    // Never let a GitHub outage break a page render.
    return null;
  }
}
