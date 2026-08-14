/**
 * Central map of blog slugs to titles for use across app pages.
 * Links point to /blog/[slug]. Use with the HelpLinks component or inline Link.
 */
export const BLOG_LINKS: Record<string, string> = {
  "google-client-id-secret-gmail-setup": "How to Set Up Google Client ID and Secret for Gmail",
  "connect-gmail-app-password-without-oauth": "How to Connect Gmail with an App Password (Without OAuth)",
  "add-verify-sending-domain-pigeon": "How to Add and Verify Your Sending Domain in Pigeon",
  "set-up-reply-to-imap-campaign-replies": "How to Set Up Reply-To (IMAP) for Campaign Replies",
  "add-smtp-inbox-accounts-domain": "How to Add SMTP Inbox Accounts for Your Domain",
  "add-first-gmail-smtp-inbox": "How to Add Your First Gmail or SMTP Inbox",
  "manage-inbox-accounts-warmup-status": "How to Manage Inbox Accounts and See Warmup Status",
  "understanding-inbox-status-ready-warming-warmup-required":
    "Understanding Inbox Status: Ready, Warming, and Warm Up Required",
  "what-is-email-warmup-how-to-use-pigeon": "What Is Email Warmup and How to Use It in Pigeon",
  "start-pause-resume-warmup-inboxes": "How to Start, Pause, or Resume Warmup for Your Inboxes",
  "check-warmup-progress-when-inbox-ready": "How to Check Warmup Progress and When Your Inbox Is Ready",
  "import-contacts-csv-excel": "How to Import Contacts from CSV or Excel",
  "map-columns-when-importing-contacts": "How to Map Columns When Importing Contacts",
  "create-manage-contact-lists": "How to Create and Manage Contact Lists",
  "manually-block-unblock-contacts": "How to Manually Block or Unblock Contacts",
  "use-verified-leads-pro": "How to Use Verified Leads (Pro)",
  "create-first-email-template": "How to Create Your First Email Template",
  "use-merge-variables-first-name-company": "How to Use Merge Variables (first_name, company)",
  "use-template-guide-and-examples": "How to Use the Template Guide and Examples",
  "add-unsubscribe-link-compliance": "How to Add an Unsubscribe Link for Compliance",
  "create-first-campaign-pigeon": "How to Create Your First Campaign in Pigeon",
  "choose-gmail-vs-smtp-select-sending-inboxes": "How to Choose Gmail vs SMTP and Select Sending Inboxes",
  "set-daily-limits-send-time-windows": "How to Set Daily Limits and Send Time Windows",
  "use-ai-generate-campaign-templates-ai-campaign-studio":
    "How to Use AI to Generate Campaign Templates (AI Campaign Studio)",
  "run-template-ab-tests-campaign": "How to Run Template A/B Tests in a Campaign",
  "edit-or-pause-campaign": "How to Edit or Pause a Campaign",
  "view-manage-campaign-replies-inbox": "How to View and Manage Campaign Replies in the Inbox",
  "use-inbox-see-when-contacts-respond": "How to Use the Inbox to See When Contacts Respond",
  "read-dashboard-analytics": "How to Read Your Dashboard and Analytics",
  "use-sending-behavior-tracking-improve-deliverability":
    "How to Use Sending Behavior (Tracking) to Improve Deliverability",
  "understand-sending-by-inbox-and-campaign": "How to Understand Sending by Inbox and by Campaign",
  "configure-compliance-settings-spam-words-links-unsubscribe":
    "How to Configure Compliance Settings (Spam Words, Links, Unsubscribe)",
  "set-up-notification-preferences-replies": "How to Set Up Notification Preferences for Replies",
  "manage-security-active-sessions": "How to Manage Security and Active Sessions",
  "update-billing-subscription": "How to Update Billing and Subscription",
  "why-gmail-connection-fails-how-to-fix": "Why Your Gmail Connection Fails and How to Fix It",
  "redirect-uri-mismatch-fix-google-oauth-errors": "Redirect URI Mismatch: How to Fix Google OAuth Errors",
  "best-practices-inbox-warmup-before-sending-campaigns":
    "Best Practices for Inbox Warmup Before Sending Campaigns",
  "use-get-started-checklist": "How to Use the Get Started Checklist",
  "understanding-alerts-deliverability-system-notifications":
    "Understanding Alerts: Deliverability and System Notifications",
};

export type BlogSlug = keyof typeof BLOG_LINKS;

/** Build /blog/[slug] href for a given slug */
export function blogHref(slug: string): string {
  return `/blog/${slug}`;
}
