#!/usr/bin/env python3
"""
Move blog featured images from Cloudinary to ImageKit and save the new URL in MongoDB.

  python scripts/migrate_blog_images_cloudinary_to_imagekit.py
  python scripts/migrate_blog_images_cloudinary_to_imagekit.py --dry-run
  python scripts/migrate_blog_images_cloudinary_to_imagekit.py --limit 1
  python scripts/migrate_blog_images_cloudinary_to_imagekit.py --workers 5

Writes scripts/blog_cloudinary_migration_log.json (Cloudinary URLs to delete later).
Uses 5 parallel workers by default; log file updates are serialized under a lock.

Fill in the values below before running.
"""
import argparse
import asyncio
import base64
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

_SCRIPT_DIR = Path(__file__).resolve().parent
_BACKEND_ROOT = _SCRIPT_DIR.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

DEFAULT_WORKERS = 5


def _load_dotenv():
    try:
        from dotenv import load_dotenv
        load_dotenv(_BACKEND_ROOT / ".env")
    except Exception:
        pass


_load_dotenv()

# --- Cloudinary (source) — set in .env or the environment ---
CLOUDINARY_CLOUD_NAME = os.environ.get("CLOUDINARY_CLOUD_NAME", "")
CLOUDINARY_API_KEY = os.environ.get("CLOUDINARY_API_KEY", "")
CLOUDINARY_API_SECRET = os.environ.get("CLOUDINARY_API_SECRET", "")

# --- ImageKit (destination) — set in .env or the environment ---
IMAGEKIT_PRIVATE_KEY = os.environ.get("IMAGEKIT_PRIVATE_KEY", "")
IMAGEKIT_UPLOAD_FOLDER = os.environ.get("IMAGEKIT_UPLOAD_FOLDER", "/blogs")

# ---------------------------------------------------------------------------

CLOUDINARY_MARKER = "res.cloudinary.com"
IMAGEKIT_MARKER = r"ik\.imagekit\.io"
DEFAULT_LOG_PATH = _SCRIPT_DIR / "blog_cloudinary_migration_log.json"


def _load_migration_log(path: Path) -> dict:
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("migrations"), list):
                return data
        except (json.JSONDecodeError, OSError):
            pass
    return {"migrations": [], "cloudinary_urls_to_delete": []}


def _save_migration_log(path: Path, log: dict) -> None:
    seen = set()
    unique_urls = []
    for entry in log["migrations"]:
        url = entry.get("cloudinary_url")
        if url and url not in seen:
            seen.add(url)
            unique_urls.append(url)
    log["cloudinary_urls_to_delete"] = unique_urls
    log["updated_at"] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(log, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _append_migration(log: dict, *, blog_id: str, slug: str, cloudinary_url: str, imagekit_url: str) -> None:
    for entry in log["migrations"]:
        if entry.get("blog_id") == blog_id:
            entry.update(
                {
                    "slug": slug,
                    "cloudinary_url": cloudinary_url,
                    "imagekit_url": imagekit_url,
                    "migrated_at": datetime.now(timezone.utc).isoformat(),
                }
            )
            return
    log["migrations"].append(
        {
            "blog_id": blog_id,
            "slug": slug,
            "cloudinary_url": cloudinary_url,
            "imagekit_url": imagekit_url,
            "migrated_at": datetime.now(timezone.utc).isoformat(),
        }
    )


class MigrationLogStore:
    """Thread-safe (async lock) read-modify-write for the shared JSON log."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = asyncio.Lock()
        self._data = _load_migration_log(path)

    async def record(
        self,
        *,
        blog_id: str,
        slug: str,
        cloudinary_url: str,
        imagekit_url: str,
    ) -> None:
        async with self._lock:
            # Reload so concurrent runs / partial files stay consistent.
            self._data = _load_migration_log(self.path)
            _append_migration(
                self._data,
                blog_id=blog_id,
                slug=slug,
                cloudinary_url=cloudinary_url,
                imagekit_url=imagekit_url,
            )
            _save_migration_log(self.path, self._data)

    @property
    def entry_count(self) -> int:
        return len(self._data.get("migrations", []))


def download_image(url: str) -> bytes:
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return r.content


def upload_to_imagekit(image_bytes: bytes, file_name: str) -> str:
    r = requests.post(
        "https://upload.imagekit.io/api/v1/files/upload",
        auth=(IMAGEKIT_PRIVATE_KEY, ""),
        data={
            "file": base64.b64encode(image_bytes).decode("ascii"),
            "fileName": file_name,
            "folder": IMAGEKIT_UPLOAD_FOLDER,
            "useUniqueFileName": "true",
        },
        timeout=120,
    )
    r.raise_for_status()
    url = r.json().get("url")
    if not url:
        raise RuntimeError(f"ImageKit response missing url: {r.text[:300]}")
    return url


def file_name_for_slug(slug: str, image_url: str) -> str:
    ext = "jpg"
    if "." in image_url.rsplit("/", 1)[-1]:
        ext = image_url.rsplit(".", 1)[-1].split("?")[0] or ext
    safe = "".join(c if c.isalnum() or c in "-_" else "-" for c in slug)
    return f"{safe or 'blog'}.{ext}"


async def _resolve_imagekit_url(
    old_url: str,
    slug: str,
    url_cache: dict[str, str],
    cache_lock: asyncio.Lock,
) -> str:
    async with cache_lock:
        cached = url_cache.get(old_url)
    if cached:
        return cached

    data = await asyncio.to_thread(download_image, old_url)
    name = file_name_for_slug(slug, old_url)
    new_url = await asyncio.to_thread(upload_to_imagekit, data, name)

    async with cache_lock:
        url_cache.setdefault(old_url, new_url)
    return new_url


async def _fetch_migration_counts(admin_db, log_path: Path) -> dict[str, int]:
    total = await admin_db.blogs.count_documents({})
    pending = await admin_db.blogs.count_documents(
        {"featured_image_url": {"$regex": CLOUDINARY_MARKER, "$options": "i"}}
    )
    migrated = await admin_db.blogs.count_documents(
        {"featured_image_url": {"$regex": IMAGEKIT_MARKER, "$options": "i"}}
    )
    log_entries = len(_load_migration_log(log_path).get("migrations", []))
    return {
        "total": total,
        "pending": pending,
        "migrated": migrated,
        "log_entries": log_entries,
    }


def _print_migration_summary(stats: dict[str, int], *, workers: int, this_run: int, limit: int | None) -> None:
    print("=== Blog image migration ===")
    print(f"Total blogs:          {stats['total']}")
    print(f"Already migrated:     {stats['migrated']}  (ImageKit URL in DB)")
    print(f"Pending (Cloudinary): {stats['pending']}")
    print(f"Log file entries:     {stats['log_entries']}")
    if limit is not None:
        print(f"This run (--limit):   {this_run} of {stats['pending']} pending")
    else:
        print(f"This run:             {this_run}")
    print(f"Workers:              {workers}")
    print()


async def _migrate_blog(
    blog: dict,
    *,
    admin_db,
    dry_run: bool,
    log_store: MigrationLogStore,
    url_cache: dict[str, str],
    cache_lock: asyncio.Lock,
    print_lock: asyncio.Lock,
    semaphore: asyncio.Semaphore,
) -> tuple[bool, str | None]:
    async with semaphore:
        slug = blog.get("slug") or blog.get("id") or "blog"
        old_url = (blog.get("featured_image_url") or "").strip()
        blog_id = blog["id"]

        async with print_lock:
            print(f"[worker] {slug}\n  {old_url}")

        if dry_run:
            return True, None

        try:
            new_url = await _resolve_imagekit_url(old_url, slug, url_cache, cache_lock)
            await admin_db.blogs.update_one(
                {"id": blog_id},
                {
                    "$set": {
                        "featured_image_url": new_url,
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )
            await log_store.record(
                blog_id=blog_id,
                slug=slug,
                cloudinary_url=old_url,
                imagekit_url=new_url,
            )
            async with print_lock:
                print(f"  -> {new_url}\n")
            return True, None
        except Exception as exc:
            async with print_lock:
                print(f"  ERROR [{slug}]: {exc}\n", file=sys.stderr)
            return False, str(exc)


async def run(
    dry_run: bool = False,
    limit: int | None = None,
    log_path: Path = DEFAULT_LOG_PATH,
    workers: int = DEFAULT_WORKERS,
) -> int:
    missing = [
        name
        for name, value in (
            ("CLOUDINARY_CLOUD_NAME", CLOUDINARY_CLOUD_NAME),
            ("CLOUDINARY_API_KEY", CLOUDINARY_API_KEY),
            ("CLOUDINARY_API_SECRET", CLOUDINARY_API_SECRET),
            ("IMAGEKIT_PRIVATE_KEY", IMAGEKIT_PRIVATE_KEY),
        )
        if not value.strip()
    ]
    if missing:
        print(
            "ERROR: set the following in .env or the environment: " + ", ".join(missing),
            file=sys.stderr,
        )
        return 1

    if workers < 1:
        print("ERROR: --workers must be >= 1", file=sys.stderr)
        return 1

    from database import admin_db

    stats = await _fetch_migration_counts(admin_db, log_path)

    query = {
        "featured_image_url": {"$regex": CLOUDINARY_MARKER, "$options": "i"},
    }
    cursor = admin_db.blogs.find(
        query,
        {"_id": 0, "id": 1, "slug": 1, "featured_image_url": 1},
    ).sort("slug", 1)
    if limit is not None:
        cursor = cursor.limit(limit)
    blogs = await cursor.to_list(None)

    _print_migration_summary(stats, workers=workers, this_run=len(blogs), limit=limit)

    if not blogs:
        print("Nothing to do — no pending Cloudinary blogs for this run.")
        return 0
    if dry_run:
        print("[DRY RUN] no uploads / no DB updates\n")
    else:
        print(f"Migration log: {log_path}\n")

    if not CLOUDINARY_CLOUD_NAME:
        print("(Cloudinary keys not set — downloading from featured_image_url directly)\n")

    log_store = MigrationLogStore(log_path)
    url_cache: dict[str, str] = {}
    cache_lock = asyncio.Lock()
    print_lock = asyncio.Lock()
    semaphore = asyncio.Semaphore(workers)

    results = await asyncio.gather(
        *[
            _migrate_blog(
                blog,
                admin_db=admin_db,
                dry_run=dry_run,
                log_store=log_store,
                url_cache=url_cache,
                cache_lock=cache_lock,
                print_lock=print_lock,
                semaphore=semaphore,
            )
            for blog in blogs
        ]
    )

    ok = sum(1 for success, _ in results if success)
    fail = len(results) - ok

    if not dry_run and ok:
        print(f"Log saved: {log_path} ({log_store.entry_count} total entries)")
    print(f"Done. ok={ok} failed={fail}")
    return 1 if fail else 0


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--limit", type=int, default=None, help="Process only N blogs (e.g. 1 for a test run)")
    p.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help=f"Parallel workers (default {DEFAULT_WORKERS})",
    )
    p.add_argument(
        "--log",
        type=Path,
        default=DEFAULT_LOG_PATH,
        help=f"JSON log of migrated links (default: {DEFAULT_LOG_PATH.name})",
    )
    args = p.parse_args()
    sys.exit(
        asyncio.run(
            run(
                dry_run=args.dry_run,
                limit=args.limit,
                log_path=args.log,
                workers=args.workers,
            )
        )
    )


if __name__ == "__main__":
    main()
