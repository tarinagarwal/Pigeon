/**
 * Server-only blog data from MongoDB. Used by Server Components (no self-fetch)
 * and by API routes. Do not import from client code.
 */

import { getAdminDb } from "@/lib/mongodb";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const STOP_WORDS = new Set([
  "",
  "the",
  "and",
  "for",
  "with",
  "your",
  "you",
  "to",
  "of",
  "in",
  "on",
  "a",
  "an",
  "how",
  "why",
  "what",
  "is",
  "are",
  "it",
  "its",
  "this",
  "that",
  "from",
  "by",
  "at",
  "as",
  "be",
  "been",
  "have",
  "has",
  "had",
  "do",
  "does",
  "will",
  "would",
  "can",
  "could",
  "about",
  "into",
  "than",
  "when",
  "which",
  "their",
  "there",
  "them",
  "these",
  "those",
  "our",
  "out",
  "or",
  "but",
  "not",
  "just",
  "more",
  "some",
  "any",
  "only",
  "other",
  "such",
  "than",
  "then",
  "so",
  "if",
  "we",
  "he",
  "she",
  "they",
  "my",
  "was",
  "were",
  "been",
  "being",
]);

function extractKeywords(
  title: string | null | undefined,
  excerpt: string | null | undefined,
  maxKeywords = 6
): string[] {
  const text = [title ?? "", excerpt ?? ""].join(" ").toLowerCase();
  const words = text.split(/\W+/);
  const uniq: string[] = [];
  for (const w of words) {
    if (w.length < 3 || STOP_WORDS.has(w)) continue;
    if (!uniq.includes(w)) uniq.push(w);
    if (uniq.length >= maxKeywords) break;
  }
  return uniq;
}

export async function getBlogsVersion(): Promise<{ version: string }> {
  try {
    const adminDb = getAdminDb();
    const doc = await adminDb.collection("blogs").findOne(
      { status: "published" },
      { projection: { updated_at: 1 }, sort: { updated_at: -1 } }
    );
    if (!doc?.updated_at) return { version: "0" };
    const ut = doc.updated_at as Date;
    const version =
      typeof ut === "object" && "toISOString" in ut ? (ut as Date).toISOString() : String(ut);
    return { version };
  } catch {
    return { version: "0" };
  }
}

export async function listBlogs(
  page = 1,
  limit = 10,
  tag?: string | null
): Promise<{ blogs: Record<string, unknown>[]; total: number; page: number; limit: number }> {
  try {
    const adminDb = getAdminDb();
    const query: Record<string, unknown> = { status: "published" };
    if (tag?.trim()) {
      query.tags = {
        $elemMatch: { $regex: `^${escapeRegex(tag.trim())}$`, $options: "i" },
      };
    }
    const cursor = adminDb
      .collection("blogs")
      .find(query, { projection: { _id: 0, content: 0 } })
      .sort({ published_at: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
    const blogs = (await cursor.toArray()) as Record<string, unknown>[];
    const total = await adminDb.collection("blogs").countDocuments(query);
    return { blogs, total, page, limit };
  } catch {
    return { blogs: [], total: 0, page: 1, limit: 10 };
  }
}

export async function getBlogBySlug(slug: string): Promise<Record<string, unknown> | null> {
  try {
    const adminDb = getAdminDb();
    const blog = await adminDb.collection("blogs").findOne(
      { slug, status: "published" },
      { projection: { _id: 0 } }
    );
    return blog as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

export async function getRelatedBlogs(
  slug: string,
  limit = 5
): Promise<{ blogs: Record<string, unknown>[] }> {
  try {
    const adminDb = getAdminDb();
    const base = await adminDb.collection("blogs").findOne(
      { slug, status: "published" },
      { projection: { title: 1, excerpt: 1, slug: 1 } }
    );
    if (!base) return { blogs: [] };
    const keywords = extractKeywords(base.title, base.excerpt);
    const listLimit = Math.min(12, Math.max(1, limit));
    if (keywords.length === 0) {
      const blogs = await adminDb
        .collection("blogs")
        .find(
          { status: "published", slug: { $ne: slug } },
          { projection: { _id: 0, content: 0 } }
        )
        .sort({ published_at: -1 })
        .limit(listLimit)
        .toArray();
      return { blogs: blogs as Record<string, unknown>[] };
    }
    const orClauses: Array<{
      title?: { $regex: string; $options: string };
      excerpt?: { $regex: string; $options: string };
    }> = [
      ...keywords.map((kw) => ({ title: { $regex: kw, $options: "i" } })),
      ...keywords.map((kw) => ({ excerpt: { $regex: kw, $options: "i" } })),
    ];
    const blogs = await adminDb
      .collection("blogs")
      .find(
        { status: "published", slug: { $ne: slug }, $or: orClauses },
        { projection: { _id: 0, content: 0 } }
      )
      .sort({ published_at: -1 })
      .limit(listLimit)
      .toArray();
    return { blogs: blogs as Record<string, unknown>[] };
  } catch {
    return { blogs: [] };
  }
}
