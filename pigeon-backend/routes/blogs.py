"""Public blogs API (no auth) for blog list and detail pages."""
import os
import re
import html

from fastapi import APIRouter, HTTPException, Query
from starlette.responses import Response

from database import admin_db

router = APIRouter()

SITE_URL = os.environ.get("SITE_URL", "http://localhost:8080").rstrip("/")

# Stop words for keyword extraction (tokenization-based, no NER dependency)
_STOP_WORDS = frozenset({
    "", "the", "and", "for", "with", "your", "you", "to", "of", "in", "on",
    "a", "an", "how", "why", "what", "is", "are", "it", "its", "this", "that",
    "from", "by", "at", "as", "be", "been", "have", "has", "had", "do", "does",
    "will", "would", "can", "could", "about", "into", "than", "when", "which",
    "their", "there", "them", "these", "those", "our", "out", "or", "but", "not",
    "just", "more", "some", "any", "only", "other", "such", "than", "then",
    "so", "if", "we", "he", "she", "they", "my", "was", "were", "been", "being",
})


def _extract_keywords(title: str | None, excerpt: str | None, max_keywords: int = 6) -> list[str]:
    """Keyword extractor from title + excerpt (used for related-posts search)."""
    text = " ".join([t for t in [title or "", excerpt or ""] if t]).lower()
    words = re.split(r"\W+", text)
    uniq: list[str] = []
    for w in words:
        if len(w) < 3 or w in _STOP_WORDS:
            continue
        if w not in uniq:
            uniq.append(w)
        if len(uniq) >= max_keywords:
            break
    return uniq


def extract_seo_keywords(
    title: str | None,
    excerpt: str | None,
    content: str | None = None,
    max_keywords: int = 12,
) -> list[str]:
    """
    Extract SEO keywords from title, excerpt, and optionally content using
    tokenization: split on non-word chars, drop stop words and short tokens,
    preserve order and uniqueness. Used when creating/updating blogs (single & bulk).
    """
    parts = [title or "", excerpt or ""]
    if content:
        # Use first ~600 chars of content to avoid noise and keep it fast
        parts.append((content.strip() or "")[:600])
    text = " ".join(parts).lower()
    words = re.split(r"\W+", text)
    uniq: list[str] = []
    for w in words:
        if len(w) < 3 or w in _STOP_WORDS:
            continue
        if w not in uniq:
            uniq.append(w)
        if len(uniq) >= max_keywords:
            break
    return uniq


@router.get("/blogs/version")
async def blogs_version():
    """Lightweight check: has any published blog changed? Returns a version string (no payload).
    Frontend can call this often; only fetch full list/detail when version changes (cache by _v=version)."""
    doc = await admin_db.blogs.find_one(
        {"status": "published"},
        {"updated_at": 1},
        sort=[("updated_at", -1)],
    )
    if not doc or not doc.get("updated_at"):
        return {"version": "0"}
    ut = doc["updated_at"]
    version = ut.isoformat() if hasattr(ut, "isoformat") else str(ut)
    return {"version": version}


@router.get("/blogs")
async def list_blogs(
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    tag: str | None = Query(None, description="Filter by tag/category (case-insensitive)"),
):
    """Return published blogs sorted by published_at desc with simple pagination. No authentication required."""
    query = {"status": "published"}
    if tag and tag.strip():
        # Case-insensitive match on any element in tags array
        query["tags"] = {"$elemMatch": {"$regex": f"^{re.escape(tag.strip())}$", "$options": "i"}}
    cursor = (
        admin_db.blogs.find(
            query,
            {"_id": 0, "content": 0},
        )
        .sort("published_at", -1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    blogs = await cursor.to_list(None)
    total = await admin_db.blogs.count_documents(query)
    return {"blogs": blogs, "total": total, "page": page, "limit": limit}


@router.get("/blogs/{slug}")
async def get_blog_by_slug(slug: str):
    """Return a single published blog by slug. 404 if not found or not published."""
    blog = await admin_db.blogs.find_one(
        {"slug": slug, "status": "published"},
        {"_id": 0},
    )
    if not blog:
        raise HTTPException(status_code=404, detail="Blog not found")
    return blog


@router.get("/blogs/{slug}/related")
async def get_related_blogs(
    slug: str,
    limit: int = Query(3, ge=1, le=12),
):
    """Return related published blogs based on simple keyword search in title/excerpt."""
    base = await admin_db.blogs.find_one(
        {"slug": slug, "status": "published"},
        {"_id": 0, "title": 1, "excerpt": 1, "slug": 1},
    )
    if not base:
        raise HTTPException(status_code=404, detail="Blog not found")

    keywords = _extract_keywords(base.get("title"), base.get("excerpt"))
    if not keywords:
        # Fallback: just return most recent other posts
        cursor = (
            admin_db.blogs.find(
                {"status": "published", "slug": {"$ne": slug}},
                {"_id": 0, "content": 0},
            )
            .sort("published_at", -1)
            .limit(limit)
        )
        blogs = await cursor.to_list(None)
        return {"blogs": blogs}

    # Build OR query on title/excerpt using case-insensitive regex for each keyword
    or_clauses = [
        {"title": {"$regex": kw, "$options": "i"}} for kw in keywords
    ] + [
        {"excerpt": {"$regex": kw, "$options": "i"}} for kw in keywords
    ]

    cursor = (
        admin_db.blogs.find(
            {
                "status": "published",
                "slug": {"$ne": slug},
                "$or": or_clauses,
            },
            {"_id": 0, "content": 0},
        )
        .sort("published_at", -1)
        .limit(limit)
    )
    blogs = await cursor.to_list(None)
    return {"blogs": blogs}


# Static URLs for sitemap (path, changefreq, priority)
_SITEMAP_STATIC = [
    ("/", "weekly", "1.0"),
    ("/why-us", "monthly", "0.8"),
    ("/features", "monthly", "0.9"),
    ("/how-it-works", "monthly", "0.9"),
    ("/testimonials", "monthly", "0.8"),
    ("/blog", "weekly", "0.9"),
    ("/pricing", "weekly", "0.9"),
    ("/contact", "monthly", "0.8"),
    ("/login", "monthly", "0.6"),
    ("/signup", "monthly", "0.8"),
    ("/forgot-password", "yearly", "0.4"),
    ("/terms", "yearly", "0.5"),
    ("/privacy", "yearly", "0.5"),
    ("/refund", "yearly", "0.5"),
    ("/campaign-replies", "monthly", "0.6"),
]


def _sitemap_lastmod(d):
    """Format date for sitemap lastmod (YYYY-MM-DD)."""
    if not d:
        return None
    try:
        return d.strftime("%Y-%m-%d") if hasattr(d, "strftime") else d[:10]
    except Exception:
        return None


def _escape(s):
    return html.escape(str(s), quote=True)


@router.get("/sitemap.xml")
async def sitemap_xml():
    """Serve sitemap XML: static pages + published blog posts. No auth. Updates when blogs change."""
    from datetime import datetime, timezone

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'
        ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
        ' xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9'
        ' http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">',
    ]
    for path, changefreq, priority in _SITEMAP_STATIC:
        loc = f"{SITE_URL}{path}"
        lines.append("  <url>")
        lines.append(f"    <loc>{_escape(loc)}</loc>")
        lines.append(f"    <lastmod>{today}</lastmod>")
        lines.append(f"    <changefreq>{changefreq}</changefreq>")
        lines.append(f"    <priority>{priority}</priority>")
        lines.append("  </url>")

    cursor = admin_db.blogs.find(
        {"status": "published"},
        {"slug": 1, "published_at": 1},
    ).sort("published_at", -1)
    async for blog in cursor:
        slug = blog.get("slug")
        if not slug:
            continue
        loc = f"{SITE_URL}/blog/{slug}"
        lastmod = _sitemap_lastmod(blog.get("published_at")) or today
        lines.append("  <url>")
        lines.append(f"    <loc>{_escape(loc)}</loc>")
        lines.append(f"    <lastmod>{lastmod}</lastmod>")
        lines.append("    <changefreq>monthly</changefreq>")
        lines.append("    <priority>0.8</priority>")
        lines.append("  </url>")

    lines.append("</urlset>")
    xml_bytes = "\n".join(lines).encode("utf-8")
    return Response(content=xml_bytes, media_type="application/xml")
