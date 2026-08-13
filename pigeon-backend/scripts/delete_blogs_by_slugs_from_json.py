#!/usr/bin/env python3
"""
Delete all blogs from the database whose slug appears in a JSON file (e.g. blogs.json).

Uses admin_db.blogs. Run from backend root with .env set:

  python scripts/delete_blogs_by_slugs_from_json.py
  python scripts/delete_blogs_by_slugs_from_json.py --dry-run
  python scripts/delete_blogs_by_slugs_from_json.py --file /path/to/blogs.json
"""
import asyncio
import json
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


def load_slugs_from_json(file_path: Path) -> list[str]:
    """Load JSON array of blog objects and return list of slugs."""
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise SystemExit(f"Expected a JSON array in {file_path}")
    slugs = []
    for i, item in enumerate(data):
        if not isinstance(item, dict):
            raise SystemExit(f"Item at index {i} is not an object")
        slug = item.get("slug")
        if slug is None or not isinstance(slug, str) or not slug.strip():
            raise SystemExit(f"Item at index {i} missing or invalid 'slug'")
        slugs.append(slug.strip())
    return slugs


async def run(file_path: Path, dry_run: bool = False) -> tuple[list[str], int]:
    """
    Delete blogs in admin_db.blogs whose slug is in the given JSON file.
    Returns (list of slugs from file, number of docs deleted).
    """
    from database import admin_db

    slugs = load_slugs_from_json(file_path)
    if not slugs:
        return slugs, 0

    if dry_run:
        cursor = admin_db.blogs.find({"slug": {"$in": slugs}}, {"_id": 0, "slug": 1, "title": 1})
        existing = await cursor.to_list(None)
        print(f"[DRY RUN] Would delete {len(existing)} blog(s) matching {len(slugs)} slug(s) from file.")
        for doc in existing:
            print(f"  - {doc.get('slug')!r}  ({doc.get('title', '')[:50]}...)")
        return slugs, 0

    result = await admin_db.blogs.delete_many({"slug": {"$in": slugs}})
    return slugs, result.deleted_count


def main():
    import argparse
    parser = argparse.ArgumentParser(
        description="Delete blogs from the database by slug using slugs from a JSON file (e.g. blogs.json)."
    )
    default_file = _BACKEND_ROOT.parent / "blogs.json"
    parser.add_argument(
        "--file",
        type=Path,
        default=default_file,
        help=f"Path to JSON file containing array of blog objects with 'slug' (default: {default_file}).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only list which blogs would be deleted; do not modify the database.",
    )
    args = parser.parse_args()

    if not args.file.is_file():
        print(f"Error: File not found: {args.file}", file=sys.stderr)
        sys.exit(1)

    slugs, deleted = asyncio.run(run(args.file, dry_run=args.dry_run))

    if not slugs:
        print("No slugs found in the JSON file. Nothing to do.")
        return 0

    if args.dry_run:
        print("Run without --dry-run to perform the deletion.")
        return 0

    print(f"Deleted {deleted} blog(s) matching {len(slugs)} slug(s) from {args.file}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
