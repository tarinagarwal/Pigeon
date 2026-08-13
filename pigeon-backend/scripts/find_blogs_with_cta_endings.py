#!/usr/bin/env python3
"""
Find and optionally remove CTA-style ending paragraphs from blog posts, e.g.:
- "Would you like me to help you draft a specific AI-powered outreach sequence for one of your agency's target niches?"
- Similar variations (multiple different texts after the conclusion).

Searches in the last portion of each blog's content (after-conclusion area).
Uses admin_db.blogs. Run from backend root with .env set:

  python scripts/find_blogs_with_cta_endings.py                    # list matches only
  python scripts/find_blogs_with_cta_endings.py --remove           # remove CTA from all matching blogs
  python scripts/find_blogs_with_cta_endings.py --remove --dry-run  # show what would be removed, no DB update
  python scripts/find_blogs_with_cta_endings.py --tail 2000
  python scripts/find_blogs_with_cta_endings.py --anywhere
"""
import asyncio
import re
import sys
from pathlib import Path

# Backend root on path and load .env
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

# Characters from the end of content to search (conclusion + CTA paragraphs)
DEFAULT_TAIL_CHARS = 1500

# Patterns that indicate CTA-style ending text (after conclusion).
# Add more strings or regex patterns here as you discover variations.
CTA_PATTERNS = [
    re.compile(
        r"Would you like me to help you (?:draft|create|write).*?\?",
        re.IGNORECASE | re.DOTALL,
    ),
    re.compile(
        r"Would you like (?:me to )?help (?:you )?(?:draft|create|write).*?\?",
        re.IGNORECASE | re.DOTALL,
    ),
    re.compile(
        r"Would you like me to .*? (?:draft|sequence|outreach).*?\?",
        re.IGNORECASE | re.DOTALL,
    ),
    # Catch "Would you like me to help you draft ... ?" as plain substring if regex misses
    "Would you like me to help you draft",
    "Would you like me to help you create",
    "Would you like me to help you write",
]


def _strip_markdown_for_display(text: str, max_len: int = 400) -> str:
    """Reduce markdown to a short plain-text snippet for display."""
    if not text or not text.strip():
        return ""
    # Remove markdown headers, bold, links (keep text)
    t = re.sub(r"#{1,6}\s*", "", text)
    t = re.sub(r"\*\*([^*]+)\*\*", r"\1", t)
    t = re.sub(r"\*([^*]+)\*", r"\1", t)
    t = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t)
    t = re.sub(r"\s+", " ", t).strip()
    if len(t) > max_len:
        t = t[: max_len - 3].rsplit(" ", 1)[0] + "..."
    return t


def _find_cta_start_in_region(search_region: str) -> tuple[int, int, str] | None:
    """
    Find the first CTA match in search_region. Returns (start, end, snippet) or None.
    start/end are indices within search_region.
    """
    best_start = len(search_region)
    best_end = len(search_region)
    snippet = ""
    for p in CTA_PATTERNS:
        if isinstance(p, str):
            idx = search_region.find(p)
            if idx == -1:
                continue
            # Include to end of paragraph (next double newline or end of region)
            chunk = search_region[idx:]
            end_in_chunk = chunk.find("\n\n")
            if end_in_chunk != -1:
                chunk = chunk[: end_in_chunk + 2]
            end = idx + len(chunk)
            if idx < best_start:
                best_start = idx
                best_end = end
                snippet = _strip_markdown_for_display(chunk) or chunk[:300]
        else:
            m = p.search(search_region)
            if m:
                s, e = m.start(), m.end()
                # Extend to end of paragraph
                tail = search_region[e:]
                para_end = tail.find("\n\n")
                if para_end != -1:
                    e = e + para_end + 2
                else:
                    e = len(search_region)
                if s < best_start:
                    best_start = s
                    best_end = e
                    snippet = _strip_markdown_for_display(search_region[best_start:best_end]) or search_region[best_start:best_end][:300]
    if best_start >= len(search_region):
        return None
    return (best_start, best_end, snippet)


def _content_has_cta_ending(content: str, tail_chars: int, search_anywhere: bool) -> tuple[bool, str]:
    """
    Check if content has CTA-style ending text. Returns (matched: bool, snippet: str).
    """
    if not content or not content.strip():
        return False, ""

    text = content.strip()
    if search_anywhere:
        search_region = text
    else:
        search_region = text[-tail_chars:] if len(text) > tail_chars else text

    found = _find_cta_start_in_region(search_region)
    if found is None:
        return False, ""
    _start, _end, snippet = found
    return True, snippet


def _content_without_cta_ending(content: str, tail_chars: int, search_anywhere: bool) -> tuple[str, bool, str]:
    """
    Remove CTA-style ending from content. Returns (new_content, changed, removed_snippet).
    If the CTA is in the tail, we remove from its start to the end; optionally trim back
    to the start of that paragraph (previous \\n\\n).
    """
    if not content or not content.strip():
        return content, False, ""

    text = content.strip()
    if search_anywhere:
        search_region = text
        region_start_in_full = 0
    else:
        tail_chars = min(tail_chars, len(text))
        search_region = text[-tail_chars:]
        region_start_in_full = len(text) - len(search_region)

    found = _find_cta_start_in_region(search_region)
    if found is None:
        return content, False, ""

    start_in_region, end_in_region, snippet = found
    # Map to full content indices
    abs_start = region_start_in_full + start_in_region
    abs_end = region_start_in_full + end_in_region
    # Optionally start removal at previous paragraph boundary so we don't leave a blank line
    paragraph_start = text.rfind("\n\n", 0, abs_start)
    if paragraph_start != -1 and abs_start - paragraph_start < 800:
        abs_start = paragraph_start + 2  # after \n\n
    else:
        # Trim leading newlines/whitespace before CTA
        while abs_start > 0 and text[abs_start - 1] in "\n\r\t ":
            abs_start -= 1
    new_content = text[:abs_start].rstrip() + "\n"
    removed = text[abs_start:abs_end]
    return new_content, True, removed


async def run(
    tail_chars: int = DEFAULT_TAIL_CHARS,
    search_anywhere: bool = False,
    remove: bool = False,
    dry_run: bool = False,
):
    from datetime import datetime, timezone
    from database import admin_db

    cursor = admin_db.blogs.find(
        {},
        {"_id": 0, "id": 1, "title": 1, "slug": 1, "content": 1, "status": 1},
    )
    blogs = await cursor.to_list(None)

    matches = []
    for blog in blogs:
        content = blog.get("content") or ""
        matched, snippet = _content_has_cta_ending(content, tail_chars, search_anywhere)
        if not matched:
            continue
        new_content, changed, removed_block = _content_without_cta_ending(
            content, tail_chars, search_anywhere
        )
        entry = {
            "id": blog.get("id"),
            "slug": blog.get("slug"),
            "title": blog.get("title"),
            "status": blog.get("status"),
            "snippet": snippet,
            "new_content": new_content,
            "removed": removed_block,
        }
        matches.append(entry)

        if remove and changed and not dry_run:
            await admin_db.blogs.update_one(
                {"id": blog["id"]},
                {"$set": {"content": new_content, "updated_at": datetime.now(timezone.utc)}},
            )

    return matches


def main():
    import argparse
    parser = argparse.ArgumentParser(
        description="Find and optionally remove CTA-style endings from blogs (e.g. 'Would you like me to help you draft...')."
    )
    parser.add_argument(
        "--tail",
        type=int,
        default=DEFAULT_TAIL_CHARS,
        help=f"Number of characters from end of content to search (default {DEFAULT_TAIL_CHARS}).",
    )
    parser.add_argument(
        "--anywhere",
        action="store_true",
        help="Search entire content instead of only the tail.",
    )
    parser.add_argument(
        "--remove",
        action="store_true",
        help="Remove CTA ending from matching blogs and update the database.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="With --remove: show what would be removed without updating the database.",
    )
    args = parser.parse_args()

    if args.dry_run and not args.remove:
        print("--dry-run has no effect without --remove.")
    remove = args.remove
    dry_run = args.dry_run

    matches = asyncio.run(
        run(
            tail_chars=args.tail,
            search_anywhere=args.anywhere,
            remove=remove,
            dry_run=dry_run,
        )
    )

    if dry_run and remove:
        print(f"[DRY RUN] Would remove CTA ending from {len(matches)} blog(s).\n")
    elif remove:
        print(f"Removed CTA ending from {len(matches)} blog(s).\n")
    else:
        print(f"Found {len(matches)} blog(s) with CTA-style ending text.\n")

    for i, m in enumerate(matches, 1):
        print(f"--- {i} ---")
        print(f"id:    {m['id']}")
        print(f"slug:  {m['slug']}")
        print(f"title: {m['title']}")
        print(f"status: {m['status']}")
        print(f"snippet: {m['snippet'][:500]}{'...' if len(m['snippet']) > 500 else ''}")
        if remove or dry_run:
            removed_preview = (m["removed"] or "")[:400].replace("\n", " ")
            print(f"removed: {removed_preview}{'...' if len(m['removed'] or '') > 400 else ''}")
        print()

    if not matches:
        print("No blogs matched. Try --anywhere to search the full content, or --tail 2500 to check a longer tail.")
    elif remove and not dry_run:
        print("Done. Database updated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
