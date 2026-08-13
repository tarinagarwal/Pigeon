"""Sanity checks for monthly SMTP metering (quota + email_logs counting)."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from services.email_service import EmailService
from services.plan_service import MonthlySmtpQuotaExceeded, PlanService


def test_inbox_counts_against_smtp_quota():
    assert EmailService.inbox_counts_against_smtp_monthly_quota({"sender_type": "smtp"}) is True
    assert EmailService.inbox_counts_against_smtp_monthly_quota(
        {"sender_type": "gmail", "gmail_auth_method": "app_password"}
    ) is True
    assert EmailService.inbox_counts_against_smtp_monthly_quota(
        {"sender_type": "gmail", "gmail_auth_method": "oauth"}
    ) is False


def test_metering_log_sender_fields():
    assert EmailService.metering_log_sender_fields({"sender_type": "smtp"}) == ("smtp", False)
    assert EmailService.metering_log_sender_fields(
        {"sender_type": "gmail", "gmail_auth_method": "app_password"}
    ) == ("gmail", True)
    assert EmailService.metering_log_sender_fields(
        {"sender_type": "gmail", "gmail_auth_method": "oauth"}
    ) == ("gmail", False)


def test_monthly_smtp_count_uses_sender_type_or_counts_as_smtp():
    captured = {}

    async def count_documents(filter_arg):
        captured["filter"] = filter_arg
        return 3

    db = SimpleNamespace(
        email_logs=SimpleNamespace(count_documents=count_documents),
        users=SimpleNamespace(
            find_one=AsyncMock(
                return_value={"subscription_start": "", "subscription_end": ""}
            )
        ),
    )
    svc = PlanService(db, SimpleNamespace())

    async def _run():
        return await svc.monthly_smtp_emails_sent("user-1")

    n = asyncio.run(_run())
    assert n == 3
    f = captured["filter"]
    assert f["user_id"] == "user-1"
    assert f["status"] == "sent"
    assert "$gte" in f["sent_at"]
    assert f["$or"] == [{"sender_type": "smtp"}, {"counts_as_smtp": True}]


def test_assert_monthly_smtp_quota_raises_at_limit():
    db = SimpleNamespace(
        users=SimpleNamespace(
            find_one=AsyncMock(
                return_value={
                    "id": "u1",
                    "plan_id": "p1",
                    "subscription_start": "",
                    "subscription_end": "",
                }
            )
        ),
        email_logs=SimpleNamespace(count_documents=AsyncMock(return_value=10)),
    )
    svc = PlanService(db, SimpleNamespace())
    svc.get_user_limits = AsyncMock(return_value={"max_monthly_smtp_emails": 10})

    async def _run():
        await svc.assert_monthly_smtp_quota("u1")

    with pytest.raises(MonthlySmtpQuotaExceeded):
        asyncio.run(_run())
