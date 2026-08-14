import type { DriveStep } from "driver.js";

export const PRODUCT_TOUR_STORAGE_KEY = "pigeon_tour_completed";

export const productTourSteps: DriveStep[] = [
  {
    popover: {
      title: "Welcome",
      description:
        "Welcome to Pigeon AI. This short tour will show you the dashboard and main features so you can get started quickly.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: "[data-tour='sidebar-get-started']",
    popover: {
      title: "Get Started",
      description:
        "Start here to see your setup checklist: connect domains, add inboxes, and create your first campaign.",
      side: "right",
    },
  },
  {
    element: "[data-tour='sidebar-dashboard']",
    popover: {
      title: "Dashboard",
      description:
        "Your command center. See emails sent, open rate, reply rate, domain health, and active campaigns at a glance.",
      side: "right",
    },
  },
  {
    element: "[data-tour='dashboard-stats']",
    popover: {
      title: "Key metrics",
      description:
        "Key metrics at a glance: emails sent today, open rate, click rate, reply rate, and domain health.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='dashboard-campaigns']",
    popover: {
      title: "Active campaigns",
      description:
        "Your active campaigns. Start, pause, or open any campaign to edit and view performance.",
      side: "top",
    },
  },
  {
    element: "[data-tour='dashboard-warmup']",
    popover: {
      title: "Warmup progress",
      description:
        "Warmup progress per inbox. When status is Ready, the inbox is safe for higher volume.",
      side: "left",
    },
  },
  {
    element: "[data-tour='dashboard-alerts']",
    popover: {
      title: "Recent alerts",
      description: "Recent alerts and issues. Check here if something needs your attention.",
      side: "left",
    },
  },
  {
    element: "[data-tour='dashboard-create-campaign']",
    popover: {
      title: "Create a campaign",
      description: "Ready to launch? Create a new campaign to send your first sequence.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='sidebar-campaigns']",
    popover: {
      title: "Campaigns",
      description:
        "Create and manage cold email campaigns. Set up sequences, templates, and sending schedules.",
      side: "right",
    },
  },
  {
    element: "[data-tour='campaigns-create']",
    popover: {
      title: "Add campaigns",
      description:
        "Click Campaigns then use \"Create\" or \"Create campaign\" to start a new campaign and add contacts, templates, and sending rules.",
      side: "right",
    },
  },
  {
    element: "[data-tour='campaigns-new-tab-info']",
    popover: {
      title: "Campaign Info",
      description:
        "Start by naming your campaign and choosing which inboxes will send emails. This keeps sending organized and safe.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='campaigns-new-tab-audience']",
    popover: {
      title: "Audience",
      description:
        "Pick the contact list that will receive this campaign. You’ll see an audience preview with verified, pending, and blocked contacts.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='campaigns-new-tab-sequence']",
    popover: {
      title: "Email Sequence",
      description:
        "Build your sequence using templates and follow-ups. Add variants for A/B testing so the system can find top-performing emails.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='campaigns-new-tab-schedule']",
    popover: {
      title: "Schedule",
      description:
        "Set timezone and daily sending window. You can also use recommended best times based on your past campaign performance.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='campaigns-new-tab-daily-limit']",
    popover: {
      title: "Daily limit",
      description:
        "Control how many emails go out per inbox per day, and configure rotation and optional AI variation for safer sending.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='campaigns-new-tab-replyflow']",
    popover: {
      title: "ReplyFlow",
      description:
        "Decide where replies should go — default, Gmail, IMAP, or a custom address — so conversations are captured where you need them.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='campaigns-new-tab-review']",
    popover: {
      title: "Review",
      description:
        "Before launch, review spam score, sending inboxes, audience, sequence length, and limits to make sure everything looks right.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='sidebar-inbox']",
    popover: {
      title: "Inbox",
      description:
        "See all replies to your campaigns in one place. Track conversations and follow up from here.",
      side: "right",
    },
  },
  {
    element: "[data-tour='sidebar-templates']",
    popover: {
      title: "Templates",
      description:
        "Manage email templates and follow-up sequences. Use AI to generate personalized copy.",
      side: "right",
    },
  },
  {
    element: "[data-tour='templates-add']",
    popover: {
      title: "Add templates",
      description:
        "Go to Templates and click \"Create template\" or \"New template\" to add subject and body. Use merge fields and AI for personalization.",
      side: "right",
    },
  },
  {
    element: "[data-tour='templates-variables']",
    popover: {
      title: "Variables (replace with contact data)",
      description:
        "Use variables like {{first_name}} and {{company}} so each email is personalized with the contact's data when sent.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='templates-spintax']",
    popover: {
      title: "Spintax",
      description:
        "Use {option1|option2} syntax to rotate words and phrases, generating unique email variations automatically for each recipient.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='sidebar-contacts']",
    popover: {
      title: "Contacts",
      description:
        "Manage your contact lists. View all contacts, block or unblock, and keep lists organized for campaigns.",
      side: "right",
    },
  },
  {
    element: "[data-tour='contacts-status-card']",
    popover: {
      title: "Contact Status & Campaign Eligibility",
      description:
        "This card explains how contact status and global send history affect whether a contact is eligible for future campaigns.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='contacts-import']",
    popover: {
      title: "Import contacts",
      description:
        "Use Contacts and the import option to bulk upload contacts via CSV or connect your CRM. Segment and tag for targeted campaigns.",
      side: "right",
    },
  },
  {
    element: "[data-tour='contacts-import-steps']",
    popover: {
      title: "Import steps",
      description:
        "On the Import Contacts page, follow these 3 steps: 1) Upload File, 2) Map Fields, 3) Save. This keeps your lists clean and organized.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='sidebar-analytics']",
    popover: {
      title: "Analytics",
      description:
        "View campaign performance: opens, clicks, replies, and trends. See what works and optimize your sequences.",
      side: "right",
    },
  },
  {
    element: "[data-tour='analytics-overview-cards']",
    popover: {
      title: "Analytics overview cards",
      description:
        "These cards summarize your total send volume, average open/click/reply rates, and deliverability score for the selected campaign and time range.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='sidebar-tracking']",
    popover: {
      title: "Sending Behavior",
      description:
        "Monitor how and when emails are sent, per inbox and campaign. Useful for deliverability and volume control.",
      side: "right",
    },
  },
  {
    element: "[data-tour='tracking-insights-cards']",
    popover: {
      title: "Sending Behavior insights",
      description:
        "These cards show total emails sent, your peak sending hour (UTC), the top sending inbox, and the top campaign so you can tune schedules and load.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='sidebar-domains']",
    popover: {
      title: "Domains",
      description:
        "Add and verify your sending domains. Good domain health is key to deliverability.",
      side: "right",
    },
  },
  {
    element: "[data-tour='domains-add-domain']",
    popover: {
      title: "Add Domain",
      description:
        "Use Add Domain to connect new sending domains, verify SPF/DKIM/DMARC, and keep your inbox accounts mapped to healthy domains.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='sidebar-inboxes']",
    popover: {
      title: "Inbox Accounts",
      description:
        "Add the email accounts that will send your campaigns. Connect Gmail or IMAP inboxes and assign them to domains.",
      side: "right",
    },
  },
  {
    element: "[data-tour='sidebar-warmup']",
    popover: {
      title: "Warmup",
      description:
        "Warm up your domains and inboxes so your emails land in the primary tab, not spam.",
      side: "right",
    },
  }
];
