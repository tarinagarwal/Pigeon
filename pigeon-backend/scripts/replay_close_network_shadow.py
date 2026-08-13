#!/usr/bin/env python3
"""
Replay historical warmup sends through close-network scoring in shadow mode.

Usage:
  python scripts/replay_close_network_shadow.py --days 7 --limit 5000
"""

import argparse
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict

_SCRIPT_DIR = Path(__file__).resolve().parent
_BACKEND_ROOT = _SCRIPT_DIR.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from database import db  # noqa: E402
from services.warmup_sender_service import (  # noqa: E402
    WarmupSenderService,
    _provider_from_domain_or_email,
    _root_domain_from_email,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Replay close-network scoring in shadow mode.")
    parser.add_argument("--days", type=int, default=7, help="How many days of warmup_sent history to replay.")
    parser.add_argument("--limit", type=int, default=5000, help="Max number of docs to evaluate.")
    return parser.parse_args()


async def _main(args: argparse.Namespace) -> None:
    os.environ["WARMUP_CLOSE_NETWORK_MODE"] = "shadow"
    service = WarmupSenderService(
        db=db,
        admin_db=None,
        smtp_service=None,
        gmail_service=None,
        warmup_llm_service=None,
        email_service=None,
    )
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, args.days))
    docs = await db.warmup_sent.find(
        {
            "sent_at": {"$gte": cutoff},
            "inbox_id": {"$exists": True},
            "receiver_email": {"$exists": True},
            "user_id": {"$exists": True},
            "engagement_mode": {"$in": ["network", "shared_pool"]},
        },
        {
            "_id": 0,
            "inbox_id": 1,
            "receiver_email": 1,
            "receiver_provider": 1,
            "receiver_domain_root": 1,
            "user_id": 1,
        },
    ).sort("sent_at", -1).limit(max(1, args.limit)).to_list(None)
    totals: Dict[str, Any] = {
        "evaluated": 0,
        "shadow_blocked": 0,
        "rule_hits": {},
    }
    for d in docs:
        inbox_id = d.get("inbox_id")
        user_id = d.get("user_id")
        receiver_email = (d.get("receiver_email") or "").strip().lower()
        if not inbox_id or not user_id or not receiver_email:
            continue
        inbox = await db.inboxes.find_one({"id": inbox_id}, {"_id": 0, "id": 1, "email": 1})
        if not inbox:
            continue
        state = await service._build_close_network_state(inbox, inbox_id, user_id, datetime.now(timezone.utc))
        receiver_provider = (d.get("receiver_provider") or "").strip().lower() or _provider_from_domain_or_email(receiver_email)
        receiver_domain_root = (d.get("receiver_domain_root") or "").strip().lower() or _root_domain_from_email(receiver_email)
        result = service._score_close_network_candidate(
            state=state,
            receiver_email=receiver_email,
            receiver_provider=receiver_provider,
            receiver_domain_root=receiver_domain_root,
        )
        totals["evaluated"] += 1
        if result.get("shadow_block"):
            totals["shadow_blocked"] += 1
        for reason in result.get("reasons") or []:
            totals["rule_hits"][reason] = int(totals["rule_hits"].get(reason, 0)) + 1
    evaluated = totals["evaluated"]
    blocked = totals["shadow_blocked"]
    block_rate = (blocked / evaluated) if evaluated else 0.0
    print(f"evaluated={evaluated}")
    print(f"shadow_blocked={blocked}")
    print(f"shadow_block_rate={block_rate:.4f}")
    print("rule_hits:")
    for k, v in sorted(totals["rule_hits"].items(), key=lambda x: x[1], reverse=True):
        print(f"  {k}: {v}")


if __name__ == "__main__":
    asyncio.run(_main(_parse_args()))
