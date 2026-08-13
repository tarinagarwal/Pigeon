"""
System-level email templates for Pigeon AI.
Provides consistent, professional HTML and plain-text for verification, notifications, and alerts.
"""

import html as html_lib
import os
from typing import Tuple

BRAND_NAME = "Pigeon"
SUPPORT_EMAIL = os.environ.get("SUPPORT_EMAIL", "tarinagarwal@gmail.com")
# Brand theme: near-black shell with a single warm ember accent.
PRIMARY_BLUE = "#c2410c"       # Kept name for backwards compatibility; now ember
PRIMARY_PURPLE = "#9a3412"     # Deeper ember (gradient end)
PRIMARY_COLOR = "#c2410c"      # Solid fallback
PRIMARY_LIGHT = "#fdf3ee"      # Very light warm tint
FOOTER_COLOR = "#78716c"
LINK_COLOR = "#c2410c"
# Gradient for header and CTAs (135deg ember tonal ramp)
GRADIENT = "linear-gradient(135deg, #c2410c 0%, #9a3412 100%)"

# Shared HTML wrapper: header + content + footer
def _wrap_html(content: str, preheader: str = "") -> str:
    preheader_block = f'<div style="display:none;max-height:0;overflow:hidden;">{preheader}</div>' if preheader else ""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{BRAND_NAME}</title>
    {preheader_block}
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;background-color:#f1f5f9;color:#1e293b;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f1f5f9;">
        <tr>
            <td align="center" style="padding:32px 16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1),0 2px 4px -2px rgba(0,0,0,0.1);">
                    <tr>
                        <td style="padding:32px 32px 24px;background:linear-gradient(135deg, #0ea5e9 0%, #7c3aed 100%);border-radius:12px 12px 0 0;">
                            <div style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">{BRAND_NAME}</div>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:32px;">
                            {content}
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:24px 32px;border-top:1px solid #e2e8f0;font-size:12px;color:{FOOTER_COLOR};">
                            This is an automated message from {BRAND_NAME}. If you have questions, contact <a href="mailto:{SUPPORT_EMAIL}" style="color:{LINK_COLOR};text-decoration:none;">{SUPPORT_EMAIL}</a>.
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>"""


def verification_otp(code: str, expires_minutes: int = 15) -> Tuple[str, str, str]:
    """Email verification OTP (e.g. after signup). Returns (subject, plain, html)."""
    subject = "Verify your email — Pigeon AI"
    plain = (
        f"Hi,\n\n"
        f"Your verification code is: {code}\n\n"
        f"This code expires in {expires_minutes} minutes. If you didn't create an account with Pigeon AI, you can safely ignore this email.\n\n"
        f"Best regards,\n{BRAND_NAME}"
    )
    content = f"""
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#334155;">Hi,</p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#334155;">Use the code below to verify your email address and activate your account.</p>
        <div style="background:{PRIMARY_LIGHT};border:2px solid {PRIMARY_BLUE};border-radius:8px;padding:20px 24px;text-align:center;margin:0 0 24px;">
            <span style="font-size:28px;font-weight:700;letter-spacing:6px;color:{PRIMARY_PURPLE};">{code}</span>
        </div>
        <p style="margin:0 0 8px;font-size:14px;color:#64748b;">This code expires in {expires_minutes} minutes.</p>
        <p style="margin:0;font-size:14px;color:#64748b;">If you didn't create an account, you can safely ignore this email.</p>
    """
    html = _wrap_html(content, preheader=f"Your verification code is {code}")
    return subject, plain, html


def login_2fa_otp(code: str, expires_minutes: int = 5) -> Tuple[str, str, str]:
    """Login 2FA OTP. Returns (subject, plain, html)."""
    subject = "Your login code — Pigeon AI"
    plain = (
        f"Hi,\n\n"
        f"Your login verification code is: {code}\n\n"
        f"This code expires in {expires_minutes} minutes. If you didn't try to sign in, please secure your account immediately.\n\n"
        f"Best regards,\n{BRAND_NAME}"
    )
    content = f"""
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#334155;">Hi,</p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#334155;">Use the code below to complete your sign-in to Pigeon AI.</p>
        <div style="background:{PRIMARY_LIGHT};border:2px solid {PRIMARY_BLUE};border-radius:8px;padding:20px 24px;text-align:center;margin:0 0 24px;">
            <span style="font-size:28px;font-weight:700;letter-spacing:6px;color:{PRIMARY_PURPLE};">{code}</span>
        </div>
        <p style="margin:0 0 8px;font-size:14px;color:#64748b;">This code expires in {expires_minutes} minutes.</p>
        <p style="margin:0;font-size:14px;color:#64748b;">If you didn't request this code, please secure your account immediately.</p>
    """
    html = _wrap_html(content, preheader=f"Your login code is {code}")
    return subject, plain, html


def password_reset(reset_url: str, expires_hours: int = 1) -> Tuple[str, str, str]:
    """Password reset email with link. Returns (subject, plain, html)."""
    subject = "Reset your password — Pigeon AI"
    plain = (
        f"Hi,\n\n"
        f"You requested a password reset for your Pigeon AI account.\n\n"
        f"Click the link below to set a new password (this link expires in {expires_hours} hour):\n{reset_url}\n\n"
        f"If you didn't request this, you can safely ignore this email. Your password will remain unchanged.\n\n"
        f"Best regards,\n{BRAND_NAME}"
    )
    content = f"""
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#334155;">Hi,</p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#334155;">You requested a password reset for your Pigeon AI account. Click the button below to choose a new password.</p>
        <p style="margin:0 0 24px;"><a href="{reset_url}" style="display:inline-block;background:linear-gradient(135deg, #0ea5e9 0%, #7c3aed 100%);color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 28px;border-radius:8px;">Reset password</a></p>
        <p style="margin:0 0 8px;font-size:14px;color:#64748b;">This link expires in {expires_hours} hour.</p>
        <p style="margin:0;font-size:14px;color:#64748b;">If you didn't request a reset, you can ignore this email. Your password will not change.</p>
    """
    html = _wrap_html(content, preheader="Reset your Pigeon AI password")
    return subject, plain, html


def mailbox_password_reset(reset_url: str, inbox_email: str, expires_hours: int = 1) -> Tuple[str, str, str]:
    """Mailbox set/reset password email (sent to account owner). Returns (subject, plain, html)."""
    subject = "Set or reset mailbox password — Pigeon AI"
    plain = (
        f"Hi,\n\n"
        f"A request was made to set or reset the password for the mailbox: {inbox_email}.\n\n"
        f"Click the link below to set a new password (this link expires in {expires_hours} hour):\n{reset_url}\n\n"
        f"If you didn't request this, you can safely ignore this email.\n\n"
        f"Best regards,\n{BRAND_NAME}"
    )
    content = f"""
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#334155;">Hi,</p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#334155;">A request was made to set or reset the password for the mailbox <strong>{inbox_email}</strong>. Click the button below to set a new password.</p>
        <p style="margin:0 0 24px;"><a href="{reset_url}" style="display:inline-block;background:linear-gradient(135deg, #0ea5e9 0%, #7c3aed 100%);color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 28px;border-radius:8px;">Set mailbox password</a></p>
        <p style="margin:0 0 8px;font-size:14px;color:#64748b;">This link expires in {expires_hours} hour.</p>
        <p style="margin:0;font-size:14px;color:#64748b;">If you didn't request this, you can ignore this email.</p>
    """
    html = _wrap_html(content, preheader=f"Set or reset password for {inbox_email}")
    return subject, plain, html


def campaign_started(campaign_name: str) -> Tuple[str, str, str]:
    """Campaign started notification. Returns (subject, plain, html)."""
    subject = "Campaign started — Pigeon AI"
    plain = (
        f"Your campaign \"{campaign_name}\" has started and is now sending emails.\n\n"
        f"Log in to Pigeon AI to monitor progress and replies.\n\n"
        f"Best regards,\n{BRAND_NAME}"
    )
    content = f"""
        <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:{PRIMARY_PURPLE};">Campaign started</p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#334155;">Your campaign <strong>\"{campaign_name}\"</strong> has started and is now sending emails.</p>
        <p style="margin:0;font-size:15px;color:#64748b;">Log in to your dashboard to monitor progress and replies.</p>
    """
    html = _wrap_html(content, preheader=f'Campaign "{campaign_name}" has started')
    return subject, plain, html


def campaign_paused(campaign_name: str) -> Tuple[str, str, str]:
    """Campaign paused notification. Returns (subject, plain, html)."""
    subject = "Campaign paused — Pigeon AI"
    plain = (
        f"Your campaign \"{campaign_name}\" has been paused. No further emails will be sent until you resume it.\n\n"
        f"Log in to Pigeon AI to resume or adjust your campaign.\n\n"
        f"Best regards,\n{BRAND_NAME}"
    )
    content = f"""
        <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:{PRIMARY_PURPLE};">Campaign paused</p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#334155;">Your campaign <strong>\"{campaign_name}\"</strong> has been paused. No further emails will be sent until you resume it.</p>
        <p style="margin:0;font-size:15px;color:#64748b;">Log in to your dashboard to resume or adjust your campaign.</p>
    """
    html = _wrap_html(content, preheader=f'Campaign "{campaign_name}" has been paused')
    return subject, plain, html


def campaign_completed(campaign_name: str) -> Tuple[str, str, str]:
    """Campaign completed notification. Returns (subject, plain, html)."""
    subject = "Campaign completed — Pigeon AI"
    plain = (
        f"Your campaign \"{campaign_name}\" has completed. All contacts have been sent.\n\n"
        f"Log in to Pigeon AI to view results and replies.\n\n"
        f"Best regards,\n{BRAND_NAME}"
    )
    content = f"""
        <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:{PRIMARY_PURPLE};">Campaign completed</p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#334155;">Your campaign <strong>\"{campaign_name}\"</strong> has finished. All contacts have been sent.</p>
        <p style="margin:0;font-size:15px;color:#64748b;">Log in to your dashboard to view results and any replies.</p>
    """
    html = _wrap_html(content, preheader=f'Campaign "{campaign_name}" has completed')
    return subject, plain, html


def reply_notification() -> Tuple[str, str, str]:
    """New reply to campaign notification. Returns (subject, plain, html)."""
    subject = "New reply to your campaign — Pigeon AI"
    plain = (
        "A prospect has replied to your email.\n\n"
        "Log in to Pigeon AI to read the reply and continue the conversation.\n\n"
        f"Best regards,\n{BRAND_NAME}"
    )
    content = """
        <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:{PRIMARY_PURPLE};">New reply</p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#334155;">A prospect has replied to your campaign email. Check your inbox in Pigeon AI to read the reply and respond.</p>
        <p style="margin:0;font-size:15px;color:#64748b;">Log in to your dashboard to view and manage replies.</p>
    """
    html = _wrap_html(content, preheader="You have a new reply to your campaign")
    return subject, plain, html


def _escape_html(s: str) -> str:
    """Escape HTML for safe display in emails."""
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def ticket_reply_notification(
    ticket_id: str, ticket_subject: str, reply_body: str, view_ticket_url: str
) -> Tuple[str, str, str]:
    """Support replied to your ticket. Returns (subject, plain, html)."""
    subject = "Support replied to your ticket — Pigeon AI"
    snippet = reply_body[:500] + ("..." if len(reply_body) > 500 else "")
    snippet_plain = snippet.replace("\n", " ").strip()
    plain = (
        "Support has replied to your ticket.\n\n"
        f"Ticket: {ticket_subject}\n\n"
        "Reply:\n"
        f"{reply_body}\n\n"
        f"View ticket: {view_ticket_url}\n\n"
        f"Best regards,\n{BRAND_NAME}"
    )
    snippet_safe = _escape_html(snippet).replace("\n", "<br>")
    content = f"""
        <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:{PRIMARY_PURPLE};">Support replied to your ticket</p>
        <p style="margin:0 0 12px;font-size:16px;line-height:1.6;color:#334155;">Ticket: {_escape_html(ticket_subject)}</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155;white-space:pre-wrap;">{snippet_safe}</div>
        <p style="margin:0;font-size:15px;color:#64748b;"><a href="{view_ticket_url}" style="color:{LINK_COLOR};text-decoration:none;font-weight:600;">View ticket &rarr;</a></p>
    """
    html = _wrap_html(content, preheader=f"Support replied: {snippet_plain[:80]}")
    return subject, plain, html


def health_alert(domain_name: str, message: str) -> Tuple[str, str, str]:
    """Domain health alert. Returns (subject, plain, html)."""
    subject = "Domain health alert — Pigeon AI"
    plain = (
        f"Domain health alert: {message}\n\n"
        "Log in to Pigeon AI to review your domain health and consider pausing campaigns if needed.\n\n"
        f"Best regards,\n{BRAND_NAME}"
    )
    content = f"""
        <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:{PRIMARY_PURPLE};">Domain health alert</p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#334155;">{message}</p>
        <p style="margin:0;font-size:15px;color:#64748b;">Log in to your dashboard to review domain health and consider pausing campaigns if needed.</p>
    """
    html = _wrap_html(content, preheader=f"Alert: {domain_name}")
    return subject, plain, html


def weekly_report(sent: int, opened: int, replied: int) -> Tuple[str, str, str]:
    """Weekly activity report. Returns (subject, plain, html)."""
    subject = "Your weekly report — Pigeon AI"
    plain = (
        "Your weekly summary (last 7 days):\n\n"
        f"• Emails sent: {sent}\n"
        f"• Opened: {opened}\n"
        f"• Replied: {replied}\n\n"
        "Log in to Pigeon AI to see full details and manage your campaigns.\n\n"
        f"Best regards,\n{BRAND_NAME}"
    )
    content = f"""
        <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:{PRIMARY_PURPLE};">Your weekly summary</p>
        <p style="margin:0 0 20px;font-size:14px;color:#64748b;">Last 7 days</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 24px;">
            <tr>
                <td style="padding:12px 16px;background:#f8fafc;border-radius:8px;font-size:15px;color:#334155;width:33%;">Emails sent</td>
                <td style="padding:12px 16px;font-size:18px;font-weight:600;color:{PRIMARY_PURPLE};">{sent}</td>
            </tr>
            <tr><td colspan="2" style="height:8px;"></td></tr>
            <tr>
                <td style="padding:12px 16px;background:#f8fafc;border-radius:8px;font-size:15px;color:#334155;">Opened</td>
                <td style="padding:12px 16px;font-size:18px;font-weight:600;color:{PRIMARY_PURPLE};">{opened}</td>
            </tr>
            <tr><td colspan="2" style="height:8px;"></td></tr>
            <tr>
                <td style="padding:12px 16px;background:#f8fafc;border-radius:8px;font-size:15px;color:#334155;">Replied</td>
                <td style="padding:12px 16px;font-size:18px;font-weight:600;color:{PRIMARY_PURPLE};">{replied}</td>
            </tr>
        </table>
        <p style="margin:0;font-size:15px;color:#64748b;">Log in to your dashboard to see full details and manage your campaigns.</p>
    """
    html = _wrap_html(content, preheader=f"Weekly summary: {sent} sent, {opened} opened, {replied} replied")
    return subject, plain, html


def connection_test_email() -> Tuple[str, str, str]:
    """Inbox/connection test email. Returns (subject, plain, html)."""
    subject = "Connection successful — Pigeon AI"
    plain = (
        "Hi,\n\n"
        "Your email connection test was successful. Your inbox is activated and ready to use with Pigeon AI.\n\n"
        f"Best regards,\n{BRAND_NAME}"
    )
    content = f"""
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#334155;">Hi,</p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#334155;">Your email connection test was successful. Your inbox is activated and ready to use with Pigeon AI.</p>
        <div style="background:{PRIMARY_LIGHT};border:1px solid {PRIMARY_BLUE};border-radius:8px;padding:16px;font-size:15px;color:{PRIMARY_PURPLE};font-weight:600;">✓ Connection verified</div>
    """
    html = _wrap_html(content, preheader="Your Pigeon AI inbox is ready")
    return subject, plain, html


def workspace_team_invitation(
    inviter_display_name: str,
    *,
    invitee_has_account: bool,
    signup_url: str,
    login_url: str,
) -> Tuple[str, str, str]:
    """Notify a team member they were added to a workspace. Returns (subject, plain, html)."""
    inviter_plain = inviter_display_name.strip() or "A workspace owner"
    inviter_html = html_lib.escape(inviter_plain)
    subject = "You've been added to a workspace — Pigeon AI"
    if invitee_has_account:
        plain = (
            f"Hi,\n\n"
            f"{inviter_plain} has added you to their Pigeon AI workspace as a team member.\n\n"
            f"Sign in with your existing account to access the workspace:\n{login_url}\n\n"
            f"If you weren't expecting this message, you can ignore this email.\n\n"
            f"Best regards,\n{BRAND_NAME}"
        )
        content = f"""
        <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:{PRIMARY_PURPLE};">Workspace invitation</p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#334155;">Hi,</p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#334155;"><strong>{inviter_html}</strong> has added you to their Pigeon AI workspace as a team member.</p>
        <p style="margin:0 0 24px;"><a href="{html_lib.escape(login_url, quote=True)}" style="display:inline-block;background:linear-gradient(135deg, #0ea5e9 0%, #7c3aed 100%);color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 28px;border-radius:8px;">Sign in</a></p>
        <p style="margin:0;font-size:14px;color:#64748b;">If you weren&apos;t expecting this, you can ignore this email.</p>
        """
    else:
        plain = (
            f"Hi,\n\n"
            f"{inviter_plain} has added you to their Pigeon AI workspace as a team member.\n\n"
            f"There is no account yet for this email address. Create a free account to join the workspace:\n{signup_url}\n\n"
            f"After you sign up and verify your email, you can sign in and access the workspace.\n\n"
            f"If you weren't expecting this message, you can ignore this email.\n\n"
            f"Best regards,\n{BRAND_NAME}"
        )
        content = f"""
        <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:{PRIMARY_PURPLE};">Workspace invitation</p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#334155;">Hi,</p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#334155;"><strong>{inviter_html}</strong> has added you to their Pigeon AI workspace as a team member.</p>
        <div style="background:{PRIMARY_LIGHT};border:1px solid {PRIMARY_BLUE};border-radius:8px;padding:16px 18px;margin:0 0 24px;">
            <p style="margin:0;font-size:15px;line-height:1.55;color:#334155;">There is no account yet for this email address. Use the button below to create your free account, then verify your email to access the workspace.</p>
        </div>
        <p style="margin:0 0 24px;"><a href="{html_lib.escape(signup_url, quote=True)}" style="display:inline-block;background:linear-gradient(135deg, #0ea5e9 0%, #7c3aed 100%);color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 28px;border-radius:8px;">Create your account</a></p>
        <p style="margin:0;font-size:14px;color:#64748b;">If you weren&apos;t expecting this, you can ignore this email.</p>
        """
    html = _wrap_html(content, preheader=f"{inviter_plain} added you to a workspace")
    return subject, plain, html


def subscription_payment_failed_notification(
    billing_url: str,
    *,
    provider_display: str,
    error_hint: str | None = None,
    provider_key: str | None = None,
) -> Tuple[str, str, str]:
    """Billing provider reported a failed subscription charge. Returns (subject, plain, html).

    provider_key: ``razorpay`` | ``lemonsqueezy`` — used only for the contextual tip in HTML.
    """
    subject = "Your subscription payment didn't go through — Pigeon AI"
    billing_url = (billing_url or "").strip()
    provider_display = (provider_display or "your payment provider").strip()
    hint = (error_hint or "").strip()
    hint_plain = f"\n\nDetails ({provider_display}): {hint}\n" if hint else "\n"
    pk = (provider_key or "").strip().lower()
    if pk == "razorpay":
        tip_plain = (
            '\nTip: On the billing page, use "Manage subscription" to open Razorpay and update your card or UPI.\n'
        )
    elif pk == "lemonsqueezy":
        tip_plain = (
            "\nTip: Lemon Squeezy may also send you a link to update your payment method.\n"
        )
    else:
        tip_plain = "\n"
    plain = (
        "Hi,\n\n"
        "We were notified that a charge for your Pigeon AI subscription could not be completed. "
        "Your subscription may pause or end if the payment isn't updated.\n"
        f"{hint_plain}"
        f"Open billing settings to review your plan and update your payment method:\n{billing_url}\n"
        f"{tip_plain}\n"
        "If you already updated your payment details, you can ignore this email.\n\n"
        f"Best regards,\n{BRAND_NAME}"
    )
    provider_safe = html_lib.escape(provider_display)
    url_safe = html_lib.escape(billing_url, quote=True)
    hint_block = ""
    if hint:
        hint_safe = _escape_html(hint).replace("\n", "<br>")
        hint_block = f"""
        <div style="background:#fff7ed;border:1px solid #fdba74;border-radius:10px;padding:16px 18px;margin:0 0 24px;">
            <p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#9a3412;text-transform:uppercase;letter-spacing:0.04em;">From {provider_safe}</p>
            <p style="margin:0;font-size:15px;line-height:1.6;color:#431407;">{hint_safe}</p>
        </div>"""
    if pk == "razorpay":
        tip_inner = (
            "<strong style=\"color:#475569;\">Tip:</strong> You can use the &ldquo;Manage subscription&rdquo; link "
            "on the billing page to open Razorpay and update your card or UPI details."
        )
    elif pk == "lemonsqueezy":
        tip_inner = (
            "<strong style=\"color:#475569;\">Tip:</strong> Open billing settings to manage your plan; "
            "Lemon Squeezy may also email you a direct link to update your payment method."
        )
    else:
        tip_inner = (
            "<strong style=\"color:#475569;\">Tip:</strong> Use the billing page to review your plan and "
            "follow your payment provider&rsquo;s steps to update your method."
        )
    content = f"""
        <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:{PRIMARY_PURPLE};">Payment update needed</p>
        <p style="margin:0 0 20px;font-size:16px;line-height:1.65;color:#334155;">We were notified that a charge for your subscription could not be completed. Update your payment method so your plan stays active and you keep uninterrupted access.</p>
        {hint_block}
        <p style="margin:0 0 20px;"><a href="{url_safe}" style="display:inline-block;background:linear-gradient(135deg, #0ea5e9 0%, #7c3aed 100%);color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 28px;border-radius:8px;">Open billing settings</a></p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin:0;">
            <p style="margin:0;font-size:14px;line-height:1.55;color:#64748b;">{tip_inner}</p>
        </div>
        <p style="margin:20px 0 0;font-size:14px;color:#64748b;">If you already fixed your payment, no action is needed.</p>
    """
    pre = "Your subscription payment failed — update your payment method"
    html = _wrap_html(content, preheader=pre)
    return subject, plain, html
