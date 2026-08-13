#!/usr/bin/env python3
"""
Fetch blog content (markdown) from the database for a list of blog URLs/slugs.

Reads from admin_db.blogs. Writes a JSON file and a single combined markdown
file so the content can be reviewed easily.

Usage (from backend root with .env set):

  python scripts/fetch_blogs_by_urls.py
  python scripts/fetch_blogs_by_urls.py --out-dir /tmp/blogs_dump
  python scripts/fetch_blogs_by_urls.py --print            # also dump to stdout
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

_SCRIPT_DIR = Path(__file__).resolve().parent
_BACKEND_ROOT = _SCRIPT_DIR.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))


def _load_dotenv():
    try:
        env_file = _BACKEND_ROOT / ".env"
        if env_file.is_file():
            from dotenv import load_dotenv
            load_dotenv(env_file)
    except Exception:
        try:
            from dotenv import load_dotenv
            load_dotenv()
        except Exception:
            pass


_load_dotenv()


BLOG_URLS = [
    "https://www.pigeon.com/blog/best-ai-powered-domain-warm-up-tools-for-sales",
    "https://www.pigeon.com/blog/best-domain-warm-up-tools-for-b2b-agencies",
    "https://www.pigeon.com/blog/top-ai-tools-for-email-warm-up-and-deliverability",
    "https://www.pigeon.com/blog/warm-up-gmail-for-cold-email-tools-that-support-multiple-inboxes",
    "https://www.pigeon.com/blog/domain-warm-up-tools-every-sdr-manager-should-know",
    "https://www.pigeon.com/blog/top-ai-domain-warm-up-tools-for-lead-gen-agencies",
    "https://www.pigeon.com/blog/best-domain-warm-up-tools-to-maximize-inbox-placement",
    "https://www.pigeon.com/blog/best-ai-tools-for-cold-email-outreach-with-deliverability-boosts",
    "https://www.pigeon.com/blog/best-automated-email-warm-up-tools-for-enterprises",
    "https://www.pigeon.com/blog/best-email-warm-up-software-to-protect-your-domain",
    "https://www.pigeon.com/blog/best-deliverability-testers-cold-email",
    "https://www.pigeon.com/blog/evaluating-the-best-ai-email-warm-up-tools",
    "https://www.pigeon.com/blog/top-email-warm-up-software-compared-for-b2b-sales",
    "https://www.pigeon.com/blog/gmail-cold-email-warm-up-tools-top-picks",
    "https://www.pigeon.com/blog/gmail-cold-email-warmup-tools-compared-which-one-wins",
]


def url_to_slug(url: str) -> str:
    """Extract trailing slug from a /blog/<slug> URL."""
    path = urlparse(url).path.rstrip("/")
    return path.rsplit("/", 1)[-1]


async def fetch_blogs(slugs: list[str]) -> list[dict]:
    from database import admin_db

    cursor = admin_db.blogs.find(
        {"slug": {"$in": slugs}},
        {
            "_id": 0,
            "slug": 1,
            "title": 1,
            "excerpt": 1,
            "author": 1,
            "status": 1,
            "published_at": 1,
            "content": 1,
        },
    )
    docs = await cursor.to_list(None)
    by_slug = {d["slug"]: d for d in docs}
    ordered = []
    for s in slugs:
        if s in by_slug:
            ordered.append(by_slug[s])
        else:
            ordered.append({"slug": s, "missing": True})
    return ordered


def main():
    parser = argparse.ArgumentParser(
        description="Fetch blog markdown content from admin_db.blogs by URL/slug."
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=_BACKEND_ROOT.parent / "scripts" / "blog_dump",
        help="Directory to write JSON and combined markdown into.",
    )
    parser.add_argument(
        "--print",
        action="store_true",
        help="Also print combined markdown to stdout.",
    )
    args = parser.parse_args()

    slugs = [url_to_slug(u) for u in BLOG_URLS]
    docs = asyncio.run(fetch_blogs(slugs))

    args.out_dir.mkdir(parents=True, exist_ok=True)

    json_path = args.out_dir / "blogs.json"
    md_path = args.out_dir / "blogs_combined.md"

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(docs, f, indent=2, default=str, ensure_ascii=False)

    md_parts = []
    found = 0
    missing = []
    for d in docs:
        if d.get("missing"):
            missing.append(d["slug"])
            continue
        found += 1
        md_parts.append(
            "\n\n" + "=" * 100 + "\n"
            f"# {d.get('title', '')}\n\n"
            f"- slug: `{d.get('slug')}`\n"
            f"- status: {d.get('status')}\n"
            f"- published_at: {d.get('published_at')}\n"
            f"- author: {d.get('author')}\n"
            f"- excerpt: {d.get('excerpt')}\n\n"
            + "=" * 100 + "\n\n"
            + (d.get("content") or "")
        )

    combined_md = "\n".join(md_parts)
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(combined_md)

    print(f"Requested: {len(slugs)} slugs")
    print(f"Found:     {found}")
    print(f"Missing:   {len(missing)}")
    for s in missing:
        print(f"  - missing slug: {s}")
    print(f"\nWrote: {json_path}")
    print(f"Wrote: {md_path}")

    if args.print:
        print("\n\n========== COMBINED MARKDOWN ==========\n")
        print(combined_md)

    return 0


if __name__ == "__main__":
    sys.exit(main())
