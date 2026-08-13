import type { Metadata } from "next";
import Link from "next/link";
import {
  PenLine,
  Workflow,
  ShieldCheck,
  Inbox,
  Users,
  BarChart3,
  MailCheck,
  Ban,
  Lock,
  Globe,
  Send,
  Sparkles,
  Activity,
  Server,
  KeyRound,
  Timer,
  Split,
  Radar,
  FileText,
  ArrowRight,
  Check,
} from "lucide-react";
import { JsonLd } from "@/components/seo/JsonLd";
import { SITE_NAME, SITE_URL } from "@/lib/seo";
import { MarketingCtaButtons } from "@/components/marketing/MarketingCtaButtons";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Everything Pigeon does: multi-step sequences, mailbox warm-up, deliverability and DNS automation, AI writing, lead discovery, a unified inbox, workflow automation and full analytics — open source and self-hostable.",
  alternates: { canonical: `${SITE_URL}/features` },
};

type Feature = {
  icon: React.ComponentType<{ className?: string }>;
  name: string;
  desc: string;
  points: string[];
};

type Group = {
  id: string;
  label: string;
  blurb: string;
  features: Feature[];
};

const GROUPS: Group[] = [
  {
    id: "sending",
    label: "Campaigns & sending",
    blurb: "Build a sequence once, then let it run across every mailbox you own.",
    features: [
      {
        icon: Workflow,
        name: "Multi-step sequences",
        desc: "Chain follow-ups with per-step delays and stop them automatically when someone replies.",
        points: [
          "Unlimited steps with independent wait times",
          "Auto-stop on reply, bounce or unsubscribe",
          "Schedule by weekday, send window and timezone",
        ],
      },
      {
        icon: Split,
        name: "A/B testing with auto-winner",
        desc: "Run template variants inside a single step and let the campaign pick what works.",
        points: [
          "Multiple variants per sequence step",
          "Winner scored 60% on replies, 40% on opens",
          "Per-template performance breakdown",
        ],
      },
      {
        icon: Send,
        name: "Inbox rotation",
        desc: "Spread volume across many senders so no single mailbox carries the load.",
        points: [
          "Round-robin or random rotation",
          "Mix Gmail and SMTP inboxes in one campaign",
          "Per-inbox daily caps, hard-limited at 50/day",
        ],
      },
      {
        icon: Timer,
        name: "Ramp-up & human pacing",
        desc: "New mailboxes start slow and speed up as they age, with human-like gaps between sends.",
        points: [
          "Tiered daily limits based on mailbox age",
          "Randomised intervals, never a fixed cadence",
          "Quieter days assigned per inbox each week",
        ],
      },
    ],
  },
  {
    id: "deliverability",
    label: "Deliverability & warm-up",
    blurb: "The part that decides whether any of the above ever reaches an inbox.",
    features: [
      {
        icon: ShieldCheck,
        name: "Mailbox warm-up",
        desc: "Real conversations that build sender reputation before you send anything cold.",
        points: [
          "Multi-turn threads with proper reply headers",
          "AI-generated replies, not canned templates",
          "Automatically rescues mail from the spam folder",
        ],
      },
      {
        icon: Radar,
        name: "Pairing risk scoring",
        desc: "Scores every warm-up pairing so the pattern never looks artificial to a mailbox provider.",
        points: [
          "Weighs repeat pairs, reciprocity and concentration",
          "Shadow mode logs decisions before enforcing them",
          "Engagement targeted at 30–50%, not a giveaway 100%",
        ],
      },
      {
        icon: Globe,
        name: "DNS automation",
        desc: "SPF, DKIM and DMARC records written straight to your registrar instead of copy-paste.",
        points: [
          "Cloudflare, GoDaddy, Namecheap and Route 53",
          "Verification via provider API and direct DNS",
          "0–100 domain health score",
        ],
      },
      {
        icon: MailCheck,
        name: "Inbox placement testing",
        desc: "Seed sends through real Gmail and Outlook accounts to see where you actually land.",
        points: [
          "Classifies inbox, spam or promotions",
          "Per-domain and per-subdomain results",
          "Re-checks on a schedule as reputation shifts",
        ],
      },
    ],
  },
  {
    id: "ai",
    label: "AI & lead generation",
    blurb: "Bring your own API keys — you control the model and the spend.",
    features: [
      {
        icon: PenLine,
        name: "AI writing & personalization",
        desc: "Per-recipient copy generated at send time, not merge tags in a template.",
        points: [
          "OpenAI, Anthropic, Gemini, DeepSeek, Grok or Groq",
          "Spintax with nested variants and variables",
          "Optional web enrichment personalises from live search",
        ],
      },
      {
        icon: Sparkles,
        name: "AI Campaign Studio",
        desc: "Describe the campaign in chat and it builds the templates, list and schedule for you.",
        points: [
          "Creates templates, picks lists and inboxes",
          "Launches campaigns straight from the conversation",
          "Runs spam-word checks before you send",
        ],
      },
      {
        icon: Users,
        name: "Smart Leads discovery",
        desc: "Turn a description of your buyer into a verified, ready-to-send contact list.",
        points: [
          "Search, scrape and extract companies and people",
          "Email pattern guessing with live validation",
          "Runs async so you can close the tab",
        ],
      },
      {
        icon: Ban,
        name: "Risky contact blocking",
        desc: "Bad addresses are removed before they can damage your sender reputation.",
        points: [
          "Bulk verification removes undeliverables",
          "Auto-blocks after repeated non-engagement",
          "Manual block and unblock overrides",
        ],
      },
    ],
  },
  {
    id: "manage",
    label: "Inbox, automation & insight",
    blurb: "Everything that happens after the send.",
    features: [
      {
        icon: Inbox,
        name: "Unified inbox",
        desc: "Every reply across every connected mailbox, in one thread view.",
        points: [
          "Gmail API, IMAP and inbound webhook capture",
          "Rich-text replies with AI drafting",
          "Classifies human replies from auto-responders",
        ],
      },
      {
        icon: Activity,
        name: "Workflow automation",
        desc: "A visual canvas for anything the sequence builder can't express.",
        points: [
          "Triggers on send, open, reply or a schedule",
          "Conditions, waits, list changes and campaign control",
          "Full run history with per-step status",
        ],
      },
      {
        icon: BarChart3,
        name: "Analytics & tracking",
        desc: "Opens, clicks and replies, sliced by campaign, inbox and hour of day.",
        points: [
          "Open pixels and click tracking on your own domain",
          "Best-send-time and sending-behaviour insight",
          "Per-campaign and per-template comparison",
        ],
      },
      {
        icon: FileText,
        name: "Templates & builder",
        desc: "Write in plain text, HTML or a drag-and-drop editor — whatever suits the campaign.",
        points: [
          "Visual builder with CSS inlining",
          "38 ready-made designs in the library",
          "Reusable variables and personalisation tokens",
        ],
      },
    ],
  },
  {
    id: "platform",
    label: "Platform & control",
    blurb: "It's your infrastructure and your data.",
    features: [
      {
        icon: Server,
        name: "Self-hostable",
        desc: "Run the whole stack yourself with one Docker command. No per-seat pricing, no send limits.",
        points: [
          "MIT licensed, the full source is public",
          "Docker Compose for the entire stack",
          "Terraform and Caddy configs included",
        ],
      },
      {
        icon: KeyRound,
        name: "Connect any mailbox",
        desc: "Gmail and Outlook over OAuth, or any provider over SMTP and IMAP.",
        points: [
          "Ten SMTP presets, plus fully custom",
          "App-password auth where OAuth isn't wanted",
          "Credentials encrypted at rest with Fernet",
        ],
      },
      {
        icon: Lock,
        name: "Security & compliance",
        desc: "Two-factor auth, revocable sessions and one-click unsubscribe handling.",
        points: [
          "2FA on by default, sessions individually revocable",
          "Unsubscribe and suppression handled automatically",
          "Team seats with page-level permissions",
        ],
      },
      {
        icon: Globe,
        name: "Custom tracking domains",
        desc: "Serve pixels and links from your own subdomain instead of a shared one.",
        points: [
          "Branded click and open URLs",
          "Automatic certificate issuance",
          "Verified before any traffic is routed",
        ],
      },
    ],
  },
];

export default function FeaturesPage() {
  const total = GROUPS.reduce((n, g) => n + g.features.length, 0);

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: `Features | ${SITE_NAME}`,
          description: "Every feature included in Pigeon, the open-source cold email platform.",
          url: `${SITE_URL}/features`,
        }}
      />

      <section className="border-b-[3px] border-foreground bg-[hsl(var(--sb-cream))]">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <span className="font-display inline-block rounded-full border-[3px] border-foreground bg-[hsl(var(--sb-butter))] px-4 py-1.5 text-[12px] font-bold uppercase tracking-[0.1em] text-foreground">
            {total} features · all included
          </span>
          <h1 className="font-display mt-6 text-[2.9rem] font-black leading-[0.95] text-foreground sm:text-[4.3rem]">
            Everything the
            <br />
            paid tools
            <br />
            <span className="inline-block rounded-2xl border-[3px] border-foreground bg-primary px-3 py-0.5 text-primary-foreground shadow-[5px_5px_0_0_hsl(var(--foreground))]">charge for.</span>
          </h1>
          <p className="mt-8 max-w-xl text-[16.5px] leading-relaxed text-foreground/75">
            Sequences, warm-up, deliverability, AI writing, lead discovery and analytics — in one
            open-source platform you can host yourself.
          </p>
        </div>
      </section>

      <nav aria-label="Feature sections" className="border-b-[3px] border-foreground bg-foreground text-background">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-x-7 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
          {GROUPS.map((g, i) => (
            <a key={g.id} href={`#${g.id}`} className="font-display text-[13px] font-bold hover:text-primary">
              {String(i + 1).padStart(2, "0")} {g.label}
            </a>
          ))}
        </div>
      </nav>

      {GROUPS.map((group, gi) => (
        <section key={group.id} id={group.id} className="scroll-mt-20 border-b-[3px] border-foreground bg-background even:bg-[hsl(var(--sb-cream))]">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8 lg:py-16">
            <div className="flex items-baseline gap-4">
              <span className="font-display inline-flex h-9 w-9 items-center justify-center rounded-full border-[3px] border-foreground bg-[hsl(var(--sb-mint))] text-[13px] font-black tabular-nums text-foreground">
                {String(gi + 1).padStart(2, "0")}
              </span>
              <h2 className="font-display text-2xl font-black leading-none text-foreground sm:text-4xl">
                {group.label}
              </h2>
            </div>
            <p className="mt-4 max-w-2xl text-[15px] text-muted-foreground">{group.blurb}</p>

            <dl className="mt-6">
              {group.features.map((f) => (
                <div key={f.name} className="mt-5 rounded-3xl border-[3px] border-foreground bg-card p-6 shadow-[5px_5px_0_0_hsl(var(--foreground))] sm:grid sm:grid-cols-[minmax(0,260px)_minmax(0,1fr)] sm:gap-8">
                  <dt className="font-display text-[1.1rem] font-black text-foreground">
                    {f.name}
                  </dt>
                  <dd>
                    <p className="text-[14.5px] leading-relaxed text-muted-foreground">{f.desc}</p>
                    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
                      {f.points.map((pt) => (
                        <li key={pt} className="text-[13px] text-foreground/65">
                          — {pt}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      ))}

      <section className="border-b-[3px] border-foreground bg-foreground text-background">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <h2 className="font-display max-w-2xl text-3xl font-black leading-[1.0] text-foreground sm:text-5xl">
            Start sending in under ten minutes.
          </h2>
          <p className="mt-5 max-w-xl text-[15.5px] leading-relaxed text-foreground/70">
            Connect a mailbox, import a list, and let warm-up run while you build the first sequence.
          </p>
          <div className="mt-8 flex flex-col gap-4 sm:flex-row">
            <Link href="/contact" className="inline-flex items-center justify-center font-display rounded-2xl border-[3px] border-foreground bg-primary px-8 py-4 text-[15px] font-bold text-primary-foreground shadow-[6px_6px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[3px_3px_0_0_hsl(var(--foreground))]">
              Talk to us →
            </Link>
            <Link href="/pricing" className="inline-flex items-center justify-center font-display rounded-2xl border-[3px] border-foreground bg-card px-8 py-4 text-[15px] font-bold text-foreground shadow-[6px_6px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[3px_3px_0_0_hsl(var(--foreground))]">
              See pricing
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
