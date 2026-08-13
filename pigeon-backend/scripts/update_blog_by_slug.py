#!/usr/bin/env python3
"""
Update the markdown content of a single blog (admin_db.blogs) identified by slug.

  python scripts/update_blog_by_slug.py <slug> <path-to-new-content.md>

Also bumps `updated_at` to now (UTC).
"""
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

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


async def run(slug: str, content_path: Path) -> int:
    from database import admin_db

    content = content_path.read_text(encoding="utf-8")
    result = await admin_db.blogs.update_one(
        {"slug": slug},
        {"$set": {"content": content, "updated_at": datetime.now(timezone.utc)}},
    )
    if result.matched_count == 0:
        print(f"ERROR: no blog found with slug {slug!r}", file=sys.stderr)
        return 2
    print(
        f"OK slug={slug!r} matched={result.matched_count} modified={result.modified_count} "
        f"bytes={len(content)}"
    )
    return 0


def main():
    if len(sys.argv) != 3:
        print(
            "usage: python scripts/update_blog_by_slug.py <slug> <path-to-new-content.md>",
            file=sys.stderr,
        )
        sys.exit(64)
    slug = sys.argv[1]
    content_path = Path(sys.argv[2])
    if not content_path.is_file():
        print(f"ERROR: content file not found: {content_path}", file=sys.stderr)
        sys.exit(1)
    sys.exit(asyncio.run(run(slug, content_path)))


if __name__ == "__main__":
    main()
