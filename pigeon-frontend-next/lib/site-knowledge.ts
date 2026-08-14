/**
 * Canonical facts about Pigeon for SEO, GAIO (Generative AI Optimization),
 * llms.txt, and JSON-LD. Keep wording factual and consistent across surfaces.
 */

const SITE_URL = (
  typeof process !== "undefined" && process.env?.NEXT_PUBLIC_SITE_URL
    ? process.env.NEXT_PUBLIC_SITE_URL
    : "https://www.pigeon.com"
).replace(/\/$/, "");

export type SiteFaq = { question: string; answer: string };

/** Short brand summary — optimized for AI citation in one paragraph. */
export const BRAND_SUMMARY =
  "Pigeon is an AI email marketing platform that helps businesses create high-converting email campaigns in minutes. Personalize every message, automate follow-up sequences, improve inbox placement, and turn more prospects into paying customers—all from one powerful platform.";

/** Factual bullets LLMs and search engines can quote reliably. */
export const KEY_FACTS = [
  "Product: Pigeon — an AI email marketing platform for businesses, sales teams, and agencies to create, personalize, and automate email campaigns at scale.",
  "AI Campaigns: Pigeon's AI Campaign Studio generates personalized email sequences and follow-ups tailored to each contact—in minutes.",
  "Personalization: Send hyper-personalized emails with per-contact AI variations, merge fields, and dynamic content that feel individually written.",
  "Automation: Build multi-step automated follow-up sequences that run on autopilot so no lead ever goes cold.",
  "Inbox Placement: Built-in inbox placement optimization, sending best practices, and reputation management ensure emails reach the inbox, not spam.",
  "Analytics: Real-time analytics track opens, clicks, replies, and campaign ROI in one unified dashboard.",
  "Use cases: Businesses, B2B sales teams, SDRs, agencies, and founders running email marketing campaigns to grow revenue.",
  "Integrations: Connect Gmail or your own SMTP; bring your own LLM (OpenAI, Anthropic, Gemini, and others) for AI-powered writing.",
  "Pricing: Custom plans starting at Rs 19,999 per month, based on sending volume and mailbox count rather than seats. Pigeon is MIT licensed and can be self-hosted at no licence cost.",
  "Website: https://www.pigeon.com",
] as const;

export const SITE_FAQS: SiteFaq[] = [
  {
    question: "What is Pigeon?",
    answer:
      "Pigeon is an AI email marketing platform that helps businesses create high-converting email campaigns in minutes. It combines AI-powered writing, personalization at scale, automated follow-up sequences, and analytics in one tool—so you can reach more prospects and convert them into paying customers.",
  },
  {
    question: "How does Pigeon use AI for email marketing?",
    answer:
      "Pigeon's AI Campaign Studio generates personalized email copy tailored to each contact. Just describe your offer and target audience, and AI drafts your full email sequence—including subject lines, body copy, and follow-ups—that feel human and drive real replies.",
  },
  {
    question: "Can I automate my email follow-ups with Pigeon?",
    answer:
      "Yes. Pigeon lets you build multi-step automated email sequences that run on autopilot. Set your timing and conditions, and the platform handles follow-ups automatically—so no lead falls through the cracks and your pipeline stays active 24/7.",
  },
  {
    question: "Does Pigeon personalize emails at scale?",
    answer:
      "Yes. Pigeon personalizes every email using per-contact AI variations, merge fields, and dynamic content. Every recipient gets a message that feels individually crafted—even when you're sending to thousands of contacts at once.",
  },
  {
    question: "How does Pigeon improve email deliverability?",
    answer:
      "Pigeon includes built-in tools to maximize inbox placement, including inbox rotation, sending best practices, reputation management, and SPF/DKIM/DMARC guidance—so your campaigns reach the inbox, not the spam folder.",
  },
  {
    question: "How much does Pigeon cost?",
    answer:
      "Pricing is custom and starts at Rs 19,999 per month. It is based on your sending volume and how many mailboxes and domains you run, not on seats. Pigeon is also MIT licensed, so you can self-host the whole platform yourself at no licence cost.",
  },
  {
    question: "Who is Pigeon built for?",
    answer:
      "Pigeon is built for businesses, sales teams, SDRs, agencies, and founders who want to grow revenue through email marketing. Whether you're nurturing leads, running sales outreach, or scaling an agency's campaigns, Pigeon gives you the AI tools to do it faster and more effectively.",
  },
];

/** Important public URLs for crawlers and llms.txt. */
export const KEY_PAGES: { path: string; title: string; description: string }[] = [
  { path: "/", title: "Home", description: "AI email marketing platform overview" },
  { path: "/features", title: "Features", description: "Sequences, warm-up, deliverability, AI writing, lead discovery, analytics" },
  { path: "/pricing", title: "Pricing", description: "Custom plans starting at Rs 19,999 per month" },
  { path: "/rent", title: "Rent & Earn", description: "Marketplace to earn credits by listing inboxes, or rent others" },
  { path: "/contact", title: "Contact", description: "Sales and support contact" },
];

/** Plain-text llms.txt body (https://llmstxt.org/) for AI crawlers. */
export function buildLlmsTxt(): string {
  const lines: string[] = [
    "# Pigeon",
    "",
    `> ${BRAND_SUMMARY}`,
    "",
    "## What is Pigeon?",
    BRAND_SUMMARY,
    "",
    "## Key facts",
    ...KEY_FACTS.map((f) => `- ${f}`),
    "",
    "## Frequently asked questions",
    ...SITE_FAQS.flatMap((f) => [`### ${f.question}`, f.answer, ""]),
    "## Important pages",
    ...KEY_PAGES.map(
      (p) => `- [${p.title}](${SITE_URL}${p.path}): ${p.description}`
    ),
    "",
    "## Optional",
    `- [Sitemap](${SITE_URL}/sitemap.xml): All indexable URLs`,
    `- [Pricing](${SITE_URL}/pricing): Current plans`,
    `- [Contact](${SITE_URL}/contact): Request an account`,
  ];
  return lines.join("\n").trimEnd() + "\n";
}
