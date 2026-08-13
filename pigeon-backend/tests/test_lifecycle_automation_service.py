import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

from services.lifecycle_automation_service import LifecycleAutomationService


def _build_service():
    db = SimpleNamespace(
        lifecycle_events=SimpleNamespace(insert_one=AsyncMock()),
        lifecycle_journeys=SimpleNamespace(update_one=AsyncMock()),
        lifecycle_email_sends=SimpleNamespace(
            update_one=AsyncMock(),
            update_many=AsyncMock(),
            find_one=AsyncMock(),
            find=AsyncMock(),
            find_one_and_update=AsyncMock(),
        ),
        lifecycle_suppressions=SimpleNamespace(find_one=AsyncMock(), update_one=AsyncMock()),
        user_settings=SimpleNamespace(find_one=AsyncMock()),
        users=SimpleNamespace(find_one=AsyncMock(), find=AsyncMock()),
        domains=SimpleNamespace(count_documents=AsyncMock()),
        inboxes=SimpleNamespace(count_documents=AsyncMock()),
        email_logs=SimpleNamespace(count_documents=AsyncMock()),
        sessions=SimpleNamespace(find_one=AsyncMock()),
    )
    smtp = SimpleNamespace(send_app_notification_email=AsyncMock(return_value=True))
    svc = LifecycleAutomationService(db, smtp)
    return svc, db, smtp


def test_signup_event_schedules_trial_track():
    svc, db, _ = _build_service()
    asyncio.run(svc.emit_event("u1", "signup_confirmed", {"email": "a@b.com"}))
    # 1 insert for event + 1 upsert for journey + 6 schedule upserts
    assert db.lifecycle_events.insert_one.await_count == 1
    assert db.lifecycle_journeys.update_one.await_count == 1
    assert db.lifecycle_email_sends.update_one.await_count == 6


def test_payment_confirmed_schedules_paid_track():
    svc, db, _ = _build_service()
    asyncio.run(svc.emit_event("u1", "payment_confirmed", {"source": "webhook"}))
    # Email 10 immediate + Email 11 and 12 delayed
    assert db.lifecycle_email_sends.update_one.await_count == 3


def test_unsubscribe_sets_lifecycle_suppression():
    svc, db, _ = _build_service()
    db.lifecycle_email_sends.find_one.return_value = {"id": "send1", "user_id": "u1"}
    ok = asyncio.run(svc.unsubscribe("tok123"))
    assert ok is True
    assert db.lifecycle_suppressions.update_one.await_count == 1
    assert db.lifecycle_email_sends.update_one.await_count == 1


def test_process_one_sends_email_when_eligible(monkeypatch):
    svc, db, smtp = _build_service()
    db.lifecycle_email_sends.find_one.return_value = {
        "id": "send1",
        "user_id": "u1",
        "template_key": "email_1",
    }
    db.users.find_one.return_value = {"id": "u1", "email": "user@example.com", "first_name": "Alex"}
    monkeypatch.setattr(svc, "_is_eligible", AsyncMock(return_value=True))
    monkeypatch.setattr(
        svc,
        "_template_vars",
        AsyncMock(return_value={"first_name": "Alex", "plan_price": "$29", "open_rate": "41.0", "open_rate_position": "above"}),
    )
    ok = asyncio.run(svc._process_one("send1"))
    assert ok is True
    assert smtp.send_app_notification_email.await_count == 1
    # One update for tracking tokens + one final status update.
    assert db.lifecycle_email_sends.update_one.await_count >= 2


def test_subscription_renewed_event_schedules_thank_you_and_cancels_pending():
    svc, db, _ = _build_service()
    asyncio.run(svc.emit_event("u1", "subscription_renewed", {"source": "webhook", "cycle_end": "2026-04-30"}))
    assert db.lifecycle_email_sends.update_many.await_count == 1
    assert db.lifecycle_email_sends.update_one.await_count == 1
    _, kwargs = db.lifecycle_email_sends.update_one.await_args
    assert kwargs["upsert"] is True
    assert kwargs["filter"]["idempotency_key"] == "u1:renewal_email_6:2026-04-30"


def test_schedule_once_uses_cycle_safe_idempotency_suffix():
    svc, db, _ = _build_service()
    asyncio.run(
        svc._schedule_once(
            "u1",
            "renewal_email_1",
            datetime.now(timezone.utc),
            idempotency_suffix="2026-05-01",
            extra_fields={"renewal_cycle_end": "2026-05-01"},
        )
    )
    _, kwargs = db.lifecycle_email_sends.update_one.await_args
    assert kwargs["filter"]["idempotency_key"] == "u1:renewal_email_1:2026-05-01"
    assert kwargs["update"]["$setOnInsert"]["renewal_cycle_end"] == "2026-05-01"


def test_enqueue_subscription_renewals_schedules_correct_template_for_offsets():
    from datetime import datetime, timedelta, timezone

    svc, db, _ = _build_service()
    today = datetime.now(timezone.utc).date()
    users = [
        {"id": "u3", "plan_id": "starter", "subscription_status": "active", "subscription_end": (today + timedelta(days=3)).isoformat()},
        {"id": "u1", "plan_id": "starter", "subscription_status": "active", "subscription_end": (today + timedelta(days=1)).isoformat()},
        {"id": "u_1", "plan_id": "starter", "subscription_status": "cancelled", "subscription_end": (today - timedelta(days=1)).isoformat()},
        {"id": "u_5", "plan_id": "starter", "subscription_status": "past_due", "subscription_end": (today - timedelta(days=5)).isoformat()},
        {"id": "u_10", "plan_id": "starter", "subscription_status": "expired", "subscription_end": (today - timedelta(days=10)).isoformat()},
    ]

    class _FindCursor:
        def __init__(self, docs):
            self._docs = docs

        def limit(self, _):
            return self

        async def to_list(self, _):
            return self._docs

    db.users.find.return_value = _FindCursor(users)

    asyncio.run(svc._enqueue_subscription_renewals())

    assert db.lifecycle_email_sends.update_one.await_count == 5
    scheduled_templates = [call.args[1]["$setOnInsert"]["template_key"] for call in db.lifecycle_email_sends.update_one.await_args_list]
    assert set(scheduled_templates) == {
        "renewal_email_1",
        "renewal_email_2",
        "renewal_email_3",
        "renewal_email_4",
        "renewal_email_5",
    }
