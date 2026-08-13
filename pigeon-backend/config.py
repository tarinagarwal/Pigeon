"""Shared constants (e.g. audience block threshold)."""
import os

# Pending contacts who have received this many emails globally are "blocked" from campaigns
BLOCK_AFTER_EMAILS = 3

# After this many failed delivery attempts (bounce/drop/etc), mark contact as blocked in global contacts
BLOCK_AFTER_FAILED_ATTEMPTS = int(os.environ.get("BLOCK_AFTER_FAILED_ATTEMPTS", "3"))

# Permanently delete contacts that have stayed in status=blocked for this many days.
BLOCKED_CONTACT_RETENTION_DAYS = int(os.environ.get("BLOCKED_CONTACT_RETENTION_DAYS", "7"))

# Frequency for blocked-contact cleanup loop.
BLOCKED_CONTACT_CLEANUP_INTERVAL_HOURS = int(
    os.environ.get("BLOCKED_CONTACT_CLEANUP_INTERVAL_HOURS", "24")
)

# Delete contacts that have not been used in this many days.
CONTACT_UNUSED_RETENTION_DAYS = int(os.environ.get("CONTACT_UNUSED_RETENTION_DAYS", "60"))

# Permanently delete email logs that have had no changes for this many days.
EMAIL_LOG_RETENTION_DAYS = int(os.environ.get("EMAIL_LOG_RETENTION_DAYS", "60"))

# Frequency for stale email-log cleanup loop.
EMAIL_LOG_CLEANUP_INTERVAL_HOURS = int(
    os.environ.get("EMAIL_LOG_CLEANUP_INTERVAL_HOURS", "24")
)
