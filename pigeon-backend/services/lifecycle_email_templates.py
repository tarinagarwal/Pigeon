"""Lifecycle automation templates for trial-to-paid journeys."""

from __future__ import annotations

from typing import Dict


# ---------------------------------------------------------------------------
# HTML building blocks
# ---------------------------------------------------------------------------

def _header_html() -> str:
    return (
        "<table width='100%' cellpadding='0' cellspacing='0' border='0'>"
        "<tr><td style='background:#4f46e5;padding:22px 40px;text-align:center;'>"
        "<span style='color:#ffffff;font-size:22px;font-weight:700;"
        "letter-spacing:-0.5px;font-family:Arial,sans-serif;'>Pigeon</span>"
        "</td></tr></table>"
    )


def _footer_html() -> str:
    return (
        "<table width='100%' cellpadding='0' cellspacing='0' border='0' style='margin-top:32px;'>"
        "<tr><td style='border-top:1px solid #e5e7eb;padding:22px 40px;"
        "text-align:center;color:#9ca3af;font-size:12px;"
        "font-family:Arial,sans-serif;line-height:1.7;'>"
        "<p style='margin:0 0 4px;'>Pigeon &middot; Cold outreach, done right</p>"
        "<p style='margin:0;'>"
        "<a href='{unsubscribe_url}' style='color:#9ca3af;text-decoration:underline;'>"
        "Unsubscribe</a> from these onboarding emails"
        "</p>"
        "</td></tr></table>"
    )


def _cta_button(url: str, label: str) -> str:
    return (
        "<table width='100%' cellpadding='0' cellspacing='0' border='0' style='margin:28px 0;'>"
        "<tr><td align='center'>"
        f"<a href='{url}' style='display:inline-block;background:#4f46e5;color:#ffffff;"
        "text-decoration:none;font-size:15px;font-weight:600;padding:14px 32px;"
        "border-radius:8px;font-family:Arial,sans-serif;'>"
        f"{label}</a>"
        "</td></tr></table>"
    )


def _secondary_link(url: str, label: str) -> str:
    return (
        f"<p style='text-align:center;margin:8px 0 0;font-family:Arial,sans-serif;font-size:14px;'>"
        f"<a href='{url}' style='color:#4f46e5;text-decoration:none;'>{label}</a></p>"
    )


def _divider() -> str:
    return "<hr style='border:none;border-top:1px solid #f3f4f6;margin:24px 0;'/>"


def _wrap_html(body_content: str) -> str:
    """Wrap body content in a full branded email layout."""
    return (
        "<!doctype html><html>"
        "<body style='margin:0;padding:0;background:#f3f4f6;'>"
        "<table width='100%' cellpadding='0' cellspacing='0' border='0'"
        " style='background:#f3f4f6;'>"
        "<tr><td align='center' style='padding:32px 16px;'>"
        "<table width='600' cellpadding='0' cellspacing='0' border='0'"
        " style='max-width:600px;width:100%;background:#ffffff;"
        "border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);'>"
        f"<tr><td>{_header_html()}</td></tr>"
        "<tr><td style='padding:36px 40px;font-family:Arial,sans-serif;"
        "color:#111827;font-size:15px;line-height:1.75;'>"
        f"{body_content}"
        "</td></tr>"
        f"<tr><td>{_footer_html()}</td></tr>"
        "</table>"
        "</td></tr></table>"
        "</body></html>"
    )


def _book_demo_block_html(book_demo_url: str) -> str:
    return (
        f"<div style='margin-top:28px;padding:16px 20px;border-radius:10px;"
        "background:#f5f3ff;border:1px solid #ddd6fe;'>"
        "<p style='margin:0 0 6px;font-size:14px;color:#5b21b6;font-weight:600;"
        "font-family:Arial,sans-serif;'>Need help getting set up?</p>"
        "<p style='margin:0;font-size:14px;color:#374151;font-family:Arial,sans-serif;'>"
        f"Book a free 15-min call — we'll walk through setup together. "
        f"<a href='{book_demo_url}' style='color:#4f46e5;font-weight:600;text-decoration:none;'>"
        "Schedule now &rarr;</a></p>"
        "</div>"
    )


def _book_demo_block_plain(book_demo_url: str) -> str:
    return (
        "\n\nNeed help with setup? Book a free 15-min call and we'll do it together:\n"
        f"{book_demo_url}"
    )


# ---------------------------------------------------------------------------
# Template definitions
# ---------------------------------------------------------------------------

def lifecycle_templates(base_dashboard_url: str, book_demo_url: str) -> Dict[str, Dict[str, str]]:
    """Return template map keyed by email_1..email_13."""
    dashboard = base_dashboard_url.rstrip("/")
    domain_url = f"{dashboard}/domains"
    inbox_url = f"{dashboard}/inboxes"
    campaigns_url = f"{dashboard}/campaigns"
    billing_url = f"{dashboard}/settings?tab=billing"
    stats_url = f"{dashboard}/analytics"
    login_url = f"{dashboard}/login"

    return {
        # ------------------------------------------------------------------
        # Email 1 — Welcome (immediate after signup)
        # ------------------------------------------------------------------
        "email_1": {
            "subject": "You're in — here's how to get replies in 48 hours",
            "plain": (
                "Hi {first_name},\n\n"
                "Welcome to Pigeon. You're 3 steps from sending your first cold campaign.\n\n"
                "Step 1 — Connect your domain\n"
                "Authenticates your sender identity and protects deliverability.\n"
                f"→ {domain_url}\n\n"
                "Step 2 — Create a sending inbox\n"
                "Your outreach goes out from this inbox.\n\n"
                "Step 3 — Launch your first campaign\n"
                "Upload leads, let AI draft copy, hit send.\n\n"
                "Most users finish setup in under 15 minutes. Start with Step 1:\n"
                f"{domain_url}"
                + _book_demo_block_plain(book_demo_url)
                + "\n\n— The Pigeon Team"
            ),
            "html": _wrap_html(
                "<p style='margin:0 0 6px;'>Hi {first_name},</p>"
                "<p style='margin:0 0 20px;color:#374151;'>Welcome to Pigeon. "
                "You're <strong>3 steps away</strong> from your first cold campaign.</p>"
                "<table width='100%' cellpadding='0' cellspacing='0' border='0' style='margin-bottom:24px;'>"
                "<tr>"
                "<td width='36' valign='top' style='padding-top:2px;'>"
                "<div style='width:28px;height:28px;background:#4f46e5;border-radius:50%;"
                "text-align:center;line-height:28px;color:#fff;font-weight:700;font-size:13px;font-family:Arial,sans-serif;'>1</div>"
                "</td>"
                "<td style='padding-left:12px;'>"
                "<p style='margin:0 0 2px;font-weight:700;font-size:15px;'>Connect your domain</p>"
                "<p style='margin:0;color:#6b7280;font-size:14px;'>Authenticates your sender identity — takes about 5 minutes.</p>"
                "</td></tr>"
                "<tr><td colspan='2' style='padding:8px 0;'></td></tr>"
                "<tr>"
                "<td width='36' valign='top' style='padding-top:2px;'>"
                "<div style='width:28px;height:28px;background:#e0e7ff;border-radius:50%;"
                "text-align:center;line-height:28px;color:#4f46e5;font-weight:700;font-size:13px;font-family:Arial,sans-serif;'>2</div>"
                "</td>"
                "<td style='padding-left:12px;'>"
                "<p style='margin:0 0 2px;font-weight:700;font-size:15px;'>Create a sending inbox</p>"
                "<p style='margin:0;color:#6b7280;font-size:14px;'>The email address your campaigns will send from.</p>"
                "</td></tr>"
                "<tr><td colspan='2' style='padding:8px 0;'></td></tr>"
                "<tr>"
                "<td width='36' valign='top' style='padding-top:2px;'>"
                "<div style='width:28px;height:28px;background:#e0e7ff;border-radius:50%;"
                "text-align:center;line-height:28px;color:#4f46e5;font-weight:700;font-size:13px;font-family:Arial,sans-serif;'>3</div>"
                "</td>"
                "<td style='padding-left:12px;'>"
                "<p style='margin:0 0 2px;font-weight:700;font-size:15px;'>Launch your first campaign</p>"
                "<p style='margin:0;color:#6b7280;font-size:14px;'>Upload leads, let AI write the copy, and hit send.</p>"
                "</td></tr>"
                "</table>"
                + _cta_button(domain_url, "Connect my domain \u2192")
                + _book_demo_block_html(book_demo_url)
            ),
        },

        # ------------------------------------------------------------------
        # Email 2 — Domain not connected (T+24h, skipped if domain verified)
        # ------------------------------------------------------------------
        "email_2": {
            "subject": "Quick question — stuck on setup, {first_name}?",
            "plain": (
                "Hi {first_name},\n\n"
                "You signed up yesterday but haven't connected a domain yet.\n\n"
                "Without it, nothing can go out — your account is set up but idle.\n\n"
                "It takes about 5 minutes. You'll add a couple of DNS records, "
                "and Pigeon handles the rest.\n\n"
                f"Connect your domain: {domain_url}"
                + _book_demo_block_plain(book_demo_url)
            ),
            "html": _wrap_html(
                "<p style='margin:0 0 6px;'>Hi {first_name},</p>"
                "<p style='margin:0 0 16px;color:#374151;'>You signed up yesterday but haven't connected a domain yet.</p>"
                "<p style='margin:0 0 20px;color:#374151;'>Without it, nothing can go out — "
                "your account is ready but <strong>completely idle</strong>.</p>"
                "<p style='margin:0 0 20px;color:#374151;'>It takes about 5 minutes: add a couple of DNS records and Pigeon handles the rest.</p>"
                + _cta_button(domain_url, "Connect my domain")
                + _book_demo_block_html(book_demo_url)
            ),
        },

        # ------------------------------------------------------------------
        # Email 3 — Domain verified (immediate trigger)
        # ------------------------------------------------------------------
        "email_3": {
            "subject": "Domain verified — one step left before you can send",
            "plain": (
                "Hi {first_name},\n\n"
                "Your domain is verified.\n\n"
                "Now create your sending inbox — the email address your campaigns will go out from.\n\n"
                "Once that's done, you're ready to launch.\n\n"
                f"Create your inbox: {inbox_url}"
                + _book_demo_block_plain(book_demo_url)
            ),
            "html": _wrap_html(
                "<p style='margin:0 0 6px;'>Hi {first_name},</p>"
                "<p style='margin:0 0 20px;'>"
                "<span style='display:inline-block;background:#d1fae5;color:#065f46;"
                "font-size:13px;font-weight:600;padding:4px 10px;border-radius:20px;'>"
                "&#10003; Domain verified</span></p>"
                "<p style='margin:0 0 16px;color:#374151;'>"
                "One step left: <strong>create your sending inbox</strong>.</p>"
                "<p style='margin:0 0 20px;color:#374151;'>"
                "This is the email address your campaigns will go out from. "
                "Takes about 2 minutes.</p>"
                + _cta_button(inbox_url, "Create my inbox")
                + _book_demo_block_html(book_demo_url)
            ),
        },

        # ------------------------------------------------------------------
        # Email 4 — Domain ready, no inbox (T+3d, skipped if inbox exists)
        # ------------------------------------------------------------------
        "email_4": {
            "subject": "Your domain is connected — but nothing is sending",
            "plain": (
                "Hi {first_name},\n\n"
                "Your domain is connected but you haven't created a sending inbox yet.\n\n"
                "Your trial has been running for 3 days with no campaigns sent.\n\n"
                "Create an inbox now and you can have your first campaign live today.\n\n"
                f"Create your inbox: {inbox_url}"
                + _book_demo_block_plain(book_demo_url)
            ),
            "html": _wrap_html(
                "<p style='margin:0 0 6px;'>Hi {first_name},</p>"
                "<p style='margin:0 0 16px;color:#374151;'>"
                "Your domain is connected — but your trial has been running for 3 days "
                "with <strong>no campaigns sent</strong>.</p>"
                "<p style='margin:0 0 16px;color:#374151;'>"
                "The missing piece: a sending inbox. Create one now and you can have "
                "your first campaign live today.</p>"
                + _cta_button(inbox_url, "Create my inbox")
                + _book_demo_block_html(book_demo_url)
            ),
        },

        # ------------------------------------------------------------------
        # Email 5 — Inbox live (immediate trigger)
        # ------------------------------------------------------------------
        "email_5": {
            "subject": "Your inbox is live — launch your first campaign now",
            "plain": (
                "Hi {first_name},\n\n"
                "Your sending inbox is live.\n\n"
                "Here's how to launch your first campaign:\n\n"
                "1. Import your leads (CSV or manual)\n"
                "2. Let AI generate your email copy — or write your own\n"
                "3. Set your sending schedule and hit launch\n\n"
                "Your first replies could come in within hours.\n\n"
                f"Create your first campaign: {campaigns_url}"
                + _book_demo_block_plain(book_demo_url)
            ),
            "html": _wrap_html(
                "<p style='margin:0 0 6px;'>Hi {first_name},</p>"
                "<p style='margin:0 0 20px;'>"
                "<span style='display:inline-block;background:#d1fae5;color:#065f46;"
                "font-size:13px;font-weight:600;padding:4px 10px;border-radius:20px;'>"
                "&#10003; Inbox live</span></p>"
                "<p style='margin:0 0 20px;color:#374151;'>You're fully set up. Here's how to launch your first campaign:</p>"
                "<table width='100%' cellpadding='0' cellspacing='0' border='0' style='margin-bottom:20px;'>"
                "<tr><td style='padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151;'>"
                "<strong style='color:#4f46e5;'>1.</strong>&nbsp; Import your leads (CSV or manual)</td></tr>"
                "<tr><td style='padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151;'>"
                "<strong style='color:#4f46e5;'>2.</strong>&nbsp; Let AI generate email copy — or write your own</td></tr>"
                "<tr><td style='padding:8px 0;font-size:14px;color:#374151;'>"
                "<strong style='color:#4f46e5;'>3.</strong>&nbsp; Set your sending schedule and launch</td></tr>"
                "</table>"
                + _cta_button(campaigns_url, "Create my first campaign")
                + _book_demo_block_html(book_demo_url)
            ),
        },

        # ------------------------------------------------------------------
        # Email 6 — No campaign sent, T+5d (2 days left in trial)
        # ------------------------------------------------------------------
        "email_6": {
            "subject": "2 days left in your trial — you haven't sent anything yet",
            "plain": (
                "Hi {first_name},\n\n"
                "You have 2 days left in your trial and haven't sent a campaign yet.\n\n"
                "If you're not sure where to start, the AI sequence builder can write "
                "your first email in under 60 seconds. Just describe your target "
                "customer and hit generate.\n\n"
                "Don't let the trial expire without seeing what Pigeon can do.\n\n"
                f"Launch a campaign: {campaigns_url}"
                + _book_demo_block_plain(book_demo_url)
            ),
            "html": _wrap_html(
                "<p style='margin:0 0 6px;'>Hi {first_name},</p>"
                "<div style='background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;"
                "padding:14px 18px;margin-bottom:20px;'>"
                "<p style='margin:0;color:#9a3412;font-size:14px;font-weight:600;'>"
                "&#9888; 2 days left in your trial</p>"
                "</div>"
                "<p style='margin:0 0 16px;color:#374151;'>"
                "You haven't sent a campaign yet. If you're not sure where to start, "
                "the <strong>AI sequence builder</strong> can write your first email "
                "in under 60 seconds — just describe your target customer and hit generate.</p>"
                "<p style='margin:0 0 20px;color:#374151;'>"
                "Don't let the trial expire without seeing what Pigeon can do.</p>"
                + _cta_button(campaigns_url, "Send my first campaign")
                + _book_demo_block_html(book_demo_url)
            ),
        },

        # ------------------------------------------------------------------
        # Email 7 — Trial ends tomorrow, T+6d
        # ------------------------------------------------------------------
        "email_7": {
            "subject": "Your trial ends in 24 hours",
            "plain": (
                "Hi {first_name},\n\n"
                "Your Pigeon trial ends in 24 hours.\n\n"
                "Upgrade now to keep your campaigns running without interruption.\n\n"
                "Plans start from {plan_price}/month. Cancel anytime.\n\n"
                "What you keep on a paid plan:\n"
                "- All campaigns stay active\n"
                "- Unlimited sending inboxes\n"
                "- AI sequence generation\n"
                "- Full analytics\n\n"
                f"Upgrade now: {billing_url}"
                + _book_demo_block_plain(book_demo_url)
            ),
            "html": _wrap_html(
                "<p style='margin:0 0 6px;'>Hi {first_name},</p>"
                "<div style='background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;"
                "padding:14px 18px;margin-bottom:20px;'>"
                "<p style='margin:0;color:#9a3412;font-size:14px;font-weight:600;'>"
                "&#9888;&nbsp; Your trial ends in 24 hours</p>"
                "</div>"
                "<p style='margin:0 0 16px;color:#374151;'>"
                "Upgrade now to keep your campaigns running without interruption.</p>"
                "<table width='100%' cellpadding='0' cellspacing='0' border='0'"
                " style='margin-bottom:24px;background:#f9fafb;border-radius:8px;padding:16px;'>"
                "<tr><td style='padding:6px 0;font-size:14px;color:#374151;'>"
                "&#10003;&nbsp; All campaigns stay active</td></tr>"
                "<tr><td style='padding:6px 0;font-size:14px;color:#374151;'>"
                "&#10003;&nbsp; Unlimited sending inboxes</td></tr>"
                "<tr><td style='padding:6px 0;font-size:14px;color:#374151;'>"
                "&#10003;&nbsp; AI sequence generation</td></tr>"
                "<tr><td style='padding:6px 0;font-size:14px;color:#374151;'>"
                "&#10003;&nbsp; Full analytics &amp; tracking</td></tr>"
                "</table>"
                + _cta_button(billing_url, "Upgrade my account")
                + "<p style='text-align:center;color:#9ca3af;font-size:13px;margin:0;'>"
                "Plans from {plan_price}/month &middot; Cancel anytime</p>"
                + _book_demo_block_html(book_demo_url)
            ),
        },

        # ------------------------------------------------------------------
        # Email 8 — Last trial day, T+7d
        # ------------------------------------------------------------------
        "email_8": {
            "subject": "Last chance — upgrade today or get 3 extra days",
            "plain": (
                "Hi {first_name},\n\n"
                "Today is the last day of your trial.\n\n"
                "Two options:\n\n"
                f"1. Upgrade now and keep everything running: {billing_url}\n\n"
                f"2. Book a demo and get a 3-day extension: {book_demo_url}\n\n"
                "After today, your campaigns will be paused until you upgrade.\n\n"
                "— The Pigeon Team"
            ),
            "html": _wrap_html(
                "<p style='margin:0 0 6px;'>Hi {first_name},</p>"
                "<div style='background:#fef2f2;border:1px solid #fecaca;border-radius:8px;"
                "padding:14px 18px;margin-bottom:24px;'>"
                "<p style='margin:0;color:#991b1b;font-size:14px;font-weight:600;'>"
                "&#128680;&nbsp; Today is your last trial day</p>"
                "</div>"
                "<p style='margin:0 0 16px;color:#374151;'>"
                "After today, your campaigns will be paused until you upgrade.</p>"
                "<p style='margin:0 0 8px;font-weight:600;color:#111827;'>Option 1: Upgrade now</p>"
                "<p style='margin:0 0 20px;color:#374151;font-size:14px;'>"
                "Keep everything running without interruption.</p>"
                + _cta_button(billing_url, "Upgrade my account")
                + _divider()
                + "<p style='margin:0 0 8px;font-weight:600;color:#111827;'>Option 2: Book a demo</p>"
                + "<p style='margin:0 0 8px;color:#374151;font-size:14px;'>"
                "Not quite ready? Book a 15-min call and get a <strong>3-day extension</strong> on the house.</p>"
                + _secondary_link(book_demo_url, "Book a demo for +3 day extension \u2192")
            ),
        },

        # ------------------------------------------------------------------
        # Email 9 — First campaign sent (immediate trigger)
        # ------------------------------------------------------------------
        "email_9": {
            "subject": "Campaign launched — here's what to expect next",
            "plain": (
                "Hi {first_name},\n\n"
                "Your first campaign is live.\n\n"
                "What to expect:\n\n"
                "- Opens typically start within the first few hours\n"
                "- Most replies come in within 24–72 hours of sending\n"
                "- A healthy open rate for cold outreach is 40%+\n\n"
                "Track your results in real time:\n"
                f"{stats_url}"
                + _book_demo_block_plain(book_demo_url)
            ),
            "html": _wrap_html(
                "<p style='margin:0 0 6px;'>Hi {first_name},</p>"
                "<p style='margin:0 0 20px;'>"
                "<span style='display:inline-block;background:#d1fae5;color:#065f46;"
                "font-size:13px;font-weight:600;padding:4px 10px;border-radius:20px;'>"
                "&#128640; Campaign launched</span></p>"
                "<p style='margin:0 0 16px;color:#374151;'>"
                "Your first campaign is live. Here's what to expect:</p>"
                "<table width='100%' cellpadding='0' cellspacing='0' border='0'"
                " style='margin-bottom:24px;'>"
                "<tr><td style='padding:10px 0;border-bottom:1px solid #f3f4f6;"
                "font-size:14px;color:#374151;'>"
                "<strong>Opens</strong> — typically start within the first few hours</td></tr>"
                "<tr><td style='padding:10px 0;border-bottom:1px solid #f3f4f6;"
                "font-size:14px;color:#374151;'>"
                "<strong>Replies</strong> — most come in within 24–72 hours</td></tr>"
                "<tr><td style='padding:10px 0;font-size:14px;color:#374151;'>"
                "<strong>Benchmark</strong> — a healthy open rate for cold outreach is 40%+</td></tr>"
                "</table>"
                + _cta_button(stats_url, "Track my campaign")
                + _book_demo_block_html(book_demo_url)
            ),
        },

        # ------------------------------------------------------------------
        # Email 10 — Welcome to Pro (immediate after payment)
        # ------------------------------------------------------------------
        "email_10": {
            "subject": "You're on Pro — 3 things to set up right now",
            "plain": (
                "Hi {first_name},\n\n"
                "Welcome to Pigeon Pro. Your payment went through.\n\n"
                "Here's how to get the most out of your plan:\n\n"
                "1. Add more sending inboxes\n"
                "   Multiple inboxes = higher daily volume + better deliverability.\n\n"
                "2. Enable inbox rotation on your campaigns\n"
                "   Automatically spreads send load across inboxes.\n\n"
                "3. Set up follow-up sequences\n"
                "   Most replies come from follow-up emails, not the first touch.\n\n"
                f"Go to your dashboard: {dashboard}"
            ),
            "html": _wrap_html(
                "<p style='margin:0 0 6px;'>Hi {first_name},</p>"
                "<p style='margin:0 0 20px;'>"
                "<span style='display:inline-block;background:#ede9fe;color:#5b21b6;"
                "font-size:13px;font-weight:600;padding:4px 10px;border-radius:20px;'>"
                "&#11088; Welcome to Pigeon Pro</span></p>"
                "<p style='margin:0 0 20px;color:#374151;'>"
                "Your payment went through. Here's how to get the most out of your plan:</p>"
                "<table width='100%' cellpadding='0' cellspacing='0' border='0'"
                " style='margin-bottom:24px;'>"
                "<tr>"
                "<td width='36' valign='top' style='padding-top:2px;'>"
                "<div style='width:28px;height:28px;background:#4f46e5;border-radius:50%;"
                "text-align:center;line-height:28px;color:#fff;font-weight:700;"
                "font-size:13px;font-family:Arial,sans-serif;'>1</div>"
                "</td>"
                "<td style='padding-left:12px;padding-bottom:16px;'>"
                "<p style='margin:0 0 2px;font-weight:700;font-size:15px;'>Add more sending inboxes</p>"
                "<p style='margin:0;color:#6b7280;font-size:14px;'>"
                "Multiple inboxes = higher daily volume + better deliverability.</p>"
                "</td></tr>"
                "<tr>"
                "<td width='36' valign='top' style='padding-top:2px;'>"
                "<div style='width:28px;height:28px;background:#4f46e5;border-radius:50%;"
                "text-align:center;line-height:28px;color:#fff;font-weight:700;"
                "font-size:13px;font-family:Arial,sans-serif;'>2</div>"
                "</td>"
                "<td style='padding-left:12px;padding-bottom:16px;'>"
                "<p style='margin:0 0 2px;font-weight:700;font-size:15px;'>Enable inbox rotation on campaigns</p>"
                "<p style='margin:0;color:#6b7280;font-size:14px;'>"
                "Automatically spreads send load across all your inboxes.</p>"
                "</td></tr>"
                "<tr>"
                "<td width='36' valign='top' style='padding-top:2px;'>"
                "<div style='width:28px;height:28px;background:#4f46e5;border-radius:50%;"
                "text-align:center;line-height:28px;color:#fff;font-weight:700;"
                "font-size:13px;font-family:Arial,sans-serif;'>3</div>"
                "</td>"
                "<td style='padding-left:12px;'>"
                "<p style='margin:0 0 2px;font-weight:700;font-size:15px;'>Set up follow-up sequences</p>"
                "<p style='margin:0;color:#6b7280;font-size:14px;'>"
                "Most replies come from follow-ups, not the first touch.</p>"
                "</td></tr>"
                "</table>"
                + _cta_button(dashboard, "Go to my dashboard")
            ),
        },

        # ------------------------------------------------------------------
        # Email 11 — Sending from 1 inbox (T+3d after payment)
        # ------------------------------------------------------------------
        "email_11": {
            "subject": "One inbox caps you at ~50 emails/day — here's the fix",
            "plain": (
                "Hi {first_name},\n\n"
                "You're still sending from a single inbox.\n\n"
                "That limits you to roughly 50 emails per day before deliverability "
                "starts to suffer.\n\n"
                "Add a second inbox and enable rotation — you'll be able to send "
                "200–300+ emails per day without touching spam.\n\n"
                "Your Pro plan supports multiple inboxes at no extra cost.\n\n"
                f"Add another inbox: {inbox_url}"
            ),
            "html": _wrap_html(
                "<p style='margin:0 0 6px;'>Hi {first_name},</p>"
                "<p style='margin:0 0 16px;color:#374151;'>"
                "You're still sending from a single inbox — which caps you at "
                "roughly <strong>50 emails per day</strong> before deliverability "
                "starts to suffer.</p>"
                "<div style='background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;"
                "padding:16px 20px;margin-bottom:20px;'>"
                "<p style='margin:0 0 8px;font-weight:700;color:#166534;font-size:14px;'>"
                "With 2+ inboxes and rotation enabled:</p>"
                "<p style='margin:0 0 4px;font-size:14px;color:#374151;'>"
                "&#10003;&nbsp; 200–300+ emails/day without hurting deliverability</p>"
                "<p style='margin:0 0 4px;font-size:14px;color:#374151;'>"
                "&#10003;&nbsp; Load automatically spread across inboxes</p>"
                "<p style='margin:0;font-size:14px;color:#374151;'>"
                "&#10003;&nbsp; Included in your Pro plan at no extra cost</p>"
                "</div>"
                + _cta_button(inbox_url, "Add another inbox")
            ),
        },

        # ------------------------------------------------------------------
        # Email 12 — One week on Pro check-in (T+7d after payment)
        # ------------------------------------------------------------------
        "email_12": {
            "subject": "Your open rate this week: {open_rate}%",
            "plain": (
                "Hi {first_name},\n\n"
                "You're one week into Pigeon Pro.\n\n"
                "Your open rate this week: {open_rate}% ({open_rate_position} the platform average of 41%).\n\n"
                "If you're above average — great work. Keep split-testing subject lines to push higher.\n\n"
                "If you're below average, a few quick wins:\n"
                "- Shorten your subject lines (under 7 words tends to perform best)\n"
                "- Remove links from email 1 in your sequence\n"
                "- Make sure your inbox warm-up is running\n\n"
                f"View your stats: {stats_url}"
                + _book_demo_block_plain(book_demo_url)
            ),
            "html": _wrap_html(
                "<p style='margin:0 0 6px;'>Hi {first_name},</p>"
                "<p style='margin:0 0 20px;color:#374151;'>"
                "You're one week into Pigeon Pro. Here's how you're tracking:</p>"
                "<div style='background:#f5f3ff;border-radius:10px;padding:20px 24px;"
                "margin-bottom:24px;text-align:center;'>"
                "<p style='margin:0 0 4px;color:#6b7280;font-size:13px;'>Your open rate</p>"
                "<p style='margin:0;font-size:40px;font-weight:700;color:#4f46e5;'>{open_rate}%</p>"
                "<p style='margin:4px 0 0;font-size:13px;color:#6b7280;'>"
                "{open_rate_position} the platform average (41%)</p>"
                "</div>"
                "<p style='margin:0 0 8px;font-weight:600;color:#111827;'>"
                "Quick wins to improve your numbers:</p>"
                "<table width='100%' cellpadding='0' cellspacing='0' border='0'"
                " style='margin-bottom:24px;'>"
                "<tr><td style='padding:7px 0;border-bottom:1px solid #f3f4f6;"
                "font-size:14px;color:#374151;'>"
                "Shorten subject lines to under 7 words</td></tr>"
                "<tr><td style='padding:7px 0;border-bottom:1px solid #f3f4f6;"
                "font-size:14px;color:#374151;'>"
                "Remove links from email 1 in your sequence</td></tr>"
                "<tr><td style='padding:7px 0;font-size:14px;color:#374151;'>"
                "Make sure inbox warm-up is running</td></tr>"
                "</table>"
                + _cta_button(stats_url, "View my campaign stats")
                + _book_demo_block_html(book_demo_url)
            ),
        },

        # ------------------------------------------------------------------
        # Email 13 — Win-back (14 days inactive)
        # ------------------------------------------------------------------
        "email_13": {
            "subject": "Is everything OK, {first_name}?",
            "plain": (
                "Hi {first_name},\n\n"
                "You haven't logged into Pigeon in a while — just checking in.\n\n"
                "Your account is still here. Your domains, inboxes, and campaigns "
                "are exactly as you left them.\n\n"
                "If something got in the way, I'd love to help you get unstuck. "
                "Sometimes it just takes a 10-minute conversation.\n\n"
                f"Log back in: {login_url}"
                + _book_demo_block_plain(book_demo_url)
            ),
            "html": _wrap_html(
                "<p style='margin:0 0 6px;'>Hi {first_name},</p>"
                "<p style='margin:0 0 16px;color:#374151;'>"
                "You haven't logged in for a while — just checking in.</p>"
                "<p style='margin:0 0 16px;color:#374151;'>"
                "Your account is still here. Your domains, inboxes, and campaigns "
                "are <strong>exactly as you left them</strong>.</p>"
                "<p style='margin:0 0 24px;color:#374151;'>"
                "If something got in the way, I'd love to help you get unstuck. "
                "Sometimes it just takes a 10-minute conversation.</p>"
                + _cta_button(login_url, "Log back in")
                + _book_demo_block_html(book_demo_url)
            ),
        },
        # ------------------------------------------------------------------
        # Renewal Email 1 — 3 days before expiry
        # ------------------------------------------------------------------
        "renewal_email_1": {
            "subject": "Your Pigeon subscription ends in 3 days",
            "plain": (
                "Hi {first_name},\n\n"
                "Just a quick reminder that your Pigeon subscription will end in 3 days.\n\n"
                "To continue using your account without interruption, you can renew your subscription here:\n\n"
                f"{billing_url}\n\n"
                "If you need any help with billing or renewal, just reply to this email - we'd be happy to assist.\n\n"
                "Best regards,\n"
                "Team Pigeon"
            ),
            "html": _wrap_html(
                "<p style='margin:0 0 6px;'>Hi {first_name},</p>"
                "<div style='background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;"
                "padding:14px 18px;margin-bottom:20px;'>"
                "<p style='margin:0;color:#3730a3;font-size:14px;font-weight:600;'>"
                "Subscription reminder: 3 days left</p>"
                "</div>"
                "<p style='margin:0 0 16px;color:#374151;'>"
                "Just a quick reminder that your Pigeon subscription will end in 3 days.</p>"
                "<p style='margin:0 0 20px;color:#374151;'>"
                "To continue using your account without interruption, renew your subscription here:</p>"
                + _cta_button(billing_url, "Renew Subscription")
                + "<p style='margin:0;color:#374151;'>"
                "If you need any help with billing or renewal, just reply to this email - we'd be happy to assist.</p>"
            ),
        },
        # ------------------------------------------------------------------
        # Renewal Email 2 — 1 day before expiry
        # ------------------------------------------------------------------
        "renewal_email_2": {
            "subject": "Your Pigeon subscription ends tomorrow",
            "plain": (
                "Hi {first_name},\n\n"
                "Your Pigeon subscription is set to expire tomorrow.\n\n"
                "To avoid any interruption in your account, please renew your subscription here:\n\n"
                f"{billing_url}\n\n"
                "If you need any help, simply reply to this email and our team will assist you.\n\n"
                "Best regards,\n"
                "Team Pigeon"
            ),
            "html": _wrap_html(
                "<p style='margin:0 0 6px;'>Hi {first_name},</p>"
                "<div style='background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;"
                "padding:14px 18px;margin-bottom:20px;'>"
                "<p style='margin:0;color:#9a3412;font-size:14px;font-weight:600;'>"
                "Action needed: your subscription ends tomorrow</p>"
                "</div>"
                "<p style='margin:0 0 16px;color:#374151;'>"
                "Your Pigeon subscription is set to expire tomorrow.</p>"
                "<p style='margin:0 0 20px;color:#374151;'>"
                "To avoid any interruption in your account, please renew your subscription here:</p>"
                + _cta_button(billing_url, "Renew Subscription")
                + "<p style='margin:0;color:#374151;'>"
                "If you need any help, simply reply to this email and our team will assist you.</p>"
            ),
        },
        # ------------------------------------------------------------------
        # Renewal Email 3 — 1 day after expiry
        # ------------------------------------------------------------------
        "renewal_email_3": {
            "subject": "Your Pigeon subscription has expired",
            "plain": (
                "Hi {first_name},\n\n"
                "Your Pigeon subscription has expired.\n\n"
                "To continue using your account and avoid disruption to your workflows, you can renew your subscription here:\n\n"
                f"{billing_url}\n\n"
                "If you faced any billing or payment issue, feel free to reply - we'd be happy to help.\n\n"
                "Best regards,\n"
                "Team Pigeon"
            ),
            "html": _wrap_html(
                "<p style='margin:0 0 6px;'>Hi {first_name},</p>"
                "<div style='background:#fef2f2;border:1px solid #fecaca;border-radius:8px;"
                "padding:14px 18px;margin-bottom:20px;'>"
                "<p style='margin:0;color:#991b1b;font-size:14px;font-weight:600;'>"
                "Subscription expired</p>"
                "</div>"
                "<p style='margin:0 0 16px;color:#374151;'>"
                "Your Pigeon subscription has expired.</p>"
                "<p style='margin:0 0 20px;color:#374151;'>"
                "To continue using your account and avoid disruption to your workflows, you can renew your subscription here:</p>"
                + _cta_button(billing_url, "Renew Subscription")
                + "<p style='margin:0;color:#374151;'>"
                "If you faced any billing or payment issue, feel free to reply - we'd be happy to help.</p>"
            ),
        },
        # ------------------------------------------------------------------
        # Renewal Email 4 — 5 days after expiry
        # ------------------------------------------------------------------
        "renewal_email_4": {
            "subject": "Still want to continue with Pigeon?",
            "plain": (
                "Hi {first_name},\n\n"
                "Just following up in case you still wanted to continue with Pigeon.\n\n"
                "If you'd like to reactivate your subscription, you can do so here:\n\n"
                f"{billing_url}\n\n"
                "And if there's anything stopping you - billing issue, plan confusion, or setup support - just reply to this email and we'll be happy to help.\n\n"
                "Best regards,\n"
                "Team Pigeon"
            ),
            "html": _wrap_html(
                "<p style='margin:0 0 6px;'>Hi {first_name},</p>"
                "<p style='margin:0 0 16px;color:#374151;'>"
                "Just following up in case you still wanted to continue with Pigeon.</p>"
                "<p style='margin:0 0 20px;color:#374151;'>"
                "If you'd like to reactivate your subscription, you can do so here:</p>"
                + _cta_button(billing_url, "Renew Subscription")
                + _divider()
                + "<p style='margin:0;color:#374151;'>"
                "If anything is stopping you - billing issue, plan confusion, or setup support - just reply and we'll be happy to help.</p>"
            ),
        },
        # ------------------------------------------------------------------
        # Renewal Email 5 — 10 days after expiry
        # ------------------------------------------------------------------
        "renewal_email_5": {
            "subject": "Quick question",
            "plain": (
                "Hi {first_name},\n\n"
                "We noticed you haven't renewed your Pigeon subscription, and we just wanted to check in.\n\n"
                "If you decided not to continue, we'd genuinely appreciate knowing why. Even a short reply would help us improve.\n\n"
                "Some common reasons: Pricing - Timing - Didn't get enough value - Technical/setup issues - Needed a different plan\n\n"
                "If you'd still like to continue, you can renew here:\n\n"
                f"{billing_url}\n\n"
                "Or if you'd prefer to discuss things on a quick call, just reply and we'd be happy to connect.\n\n"
                "Best regards,\n"
                "Team Pigeon"
            ),
            "html": _wrap_html(
                "<p style='margin:0 0 6px;'>Hi {first_name},</p>"
                "<p style='margin:0 0 16px;color:#374151;'>"
                "We noticed you haven't renewed your Pigeon subscription, and we just wanted to check in.</p>"
                "<p style='margin:0 0 16px;color:#374151;'>"
                "If you decided not to continue, we'd genuinely appreciate knowing why. Even a short reply would help us improve.</p>"
                "<div style='background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 18px;margin:0 0 20px;'>"
                "<p style='margin:0;color:#374151;font-size:14px;'>"
                "Some common reasons: Pricing, Timing, Didn't get enough value, Technical/setup issues, Needed a different plan."
                "</p></div>"
                + _cta_button(billing_url, "Renew Subscription")
                + "<p style='margin:0;color:#374151;'>"
                "If you'd prefer to discuss things on a quick call, just reply and we'd be happy to connect.</p>"
            ),
        },
        # ------------------------------------------------------------------
        # Renewal Email 6 — payment success thank you
        # ------------------------------------------------------------------
        "renewal_email_6": {
            "subject": "Thank you for renewing your Pigeon subscription",
            "plain": (
                "Hi {first_name},\n\n"
                "Thank you for renewing your Pigeon subscription.\n\n"
                "Your payment has been successfully received, and your subscription is now active.\n\n"
                "You can continue using your account without interruption.\n\n"
                "If you need any help with setup, campaigns, inboxes, or account configuration, feel free to reply - we'd be happy to assist.\n\n"
                "Best regards,\n"
                "Team Pigeon"
            ),
            "html": _wrap_html(
                "<p style='margin:0 0 6px;'>Hi {first_name},</p>"
                "<p style='margin:0 0 20px;'>"
                "<span style='display:inline-block;background:#d1fae5;color:#065f46;"
                "font-size:13px;font-weight:600;padding:4px 10px;border-radius:20px;'>"
                "Payment received</span></p>"
                "<p style='margin:0 0 16px;color:#374151;'>"
                "Thank you for renewing your Pigeon subscription.</p>"
                "<p style='margin:0 0 16px;color:#374151;'>"
                "Your payment has been successfully received, and your subscription is now active.</p>"
                "<p style='margin:0 0 20px;color:#374151;'>"
                "You can continue using your account without interruption.</p>"
                + _cta_button(dashboard, "Go to Dashboard")
                + "<p style='margin:0;color:#374151;'>"
                "If you need any help with setup, campaigns, inboxes, or account configuration, feel free to reply.</p>"
            ),
        },
    }
