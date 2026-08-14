import Link from "next/link";
import {
  BookOpen,
  Flame,
  ShieldCheck,
  Users,
  FileText,
  Send,
  BarChart3,
  Activity,
  AlertTriangle,
  Settings,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";

const fundamentals = [
  {
    title: "What warmup is",
    text:
      "Warmup gradually builds inbox reputation by sending low-risk, human-like email traffic over time. It helps providers trust your mailbox behavior before you scale campaigns.",
  },
  {
    title: "What warmup is not",
    text:
      "Warmup is not a one-time switch, and it does not guarantee deliverability by itself. Domain setup, content quality, list quality, and sending habits still matter.",
  },
  {
    title: "How progress works",
    text:
      "Each inbox accumulates warmup history and health signals. As consistency and engagement improve, inboxes move from warming toward ready state.",
  },
];

const sections = [
  {
    title: "Warmup Dashboard",
    icon: Flame,
    description:
      "See active warmups, ready inboxes, total capacity, timeline, and inbox-level progress. Use this page to monitor day-to-day health and control pause/resume.",
    href: "/warmup",
  },
  {
    title: "Email Templates",
    icon: FileText,
    description:
      "Create neutral, natural warmup copy. Rotate templates to reduce repetitive patterns and keep message distribution healthier.",
    href: "/warmup/templates",
  },
  {
    title: "My Network",
    icon: Users,
    description:
      "Add and verify your own warmup contacts. This is the recommended path for stronger reputation signals and long-term safety.",
    href: "/warmup/network",
  },
  {
    title: "Sent Emails",
    icon: Send,
    description:
      "Review what was sent, when, from which inbox, and through which engagement path. Useful for auditing and troubleshooting behavior changes.",
    href: "/warmup/logs",
  },
  {
    title: "Pool Activity",
    icon: Activity,
    description:
      "Track shared-pool and credit-related activity. Use this to understand external participation and marketplace dynamics.",
    href: "/warmup/alerts",
  },
];

const systemOptions = [
  {
    title: "Inbox-level controls (Dashboard)",
    items: [
      "Pause/resume warmup per inbox",
      "Choose engagement mode per inbox",
      "Quick Engagement to send one immediate warmup email",
      "Warmup timeline + last 7 day sent/replied snapshot",
      "Per-inbox progress, health, daily volume, and sent today",
    ],
  },
  {
    title: "Engagement modes",
    items: [
      "Network: send to your own verified Warmup Network contacts",
      "Network + Shared contacts add-on: your network first, then supplement with shared contacts (credits)",
      "Hybrid: weighted mix of real network + shared contact pool",
      "Pool / Auto Pool: platform-managed receiver pool",
    ],
  },
  {
    title: "Templates",
    items: [
      "Create, edit, and delete warmup templates",
      "Subject + body with plain/html/rich handling",
      "Placeholder support (for sender/receiver context)",
      "Template rotation during sends for safer distribution",
    ],
  },
  {
    title: "My Network and verification",
    items: [
      "Add contacts with OTP verification flow",
      "Provider/domain checks before adding contacts",
      "Manage contact label and remove contacts",
      "Set contact_daily_limit (emails per contact per rolling 24h)",
      "Shared pool contributor eligibility checks",
    ],
  },
  {
    title: "Credits and shared pool",
    items: [
      "Top up credits to use shared contacts",
      "Spend credits for shared pool sends",
      "Earn credits when your eligible network is rented",
      "Refund/settlement behavior tied to engagement outcomes",
      "Pool Activity page to monitor transactions and contribution status",
    ],
  },
  {
    title: "Logs and transparency",
    items: [
      "Sent Emails page with engagement_mode filter",
      "Time-range filters (all / 24h / 48h)",
      "Recent sends visibility on warmup routes",
      "Mode-level badges: network, shared_pool, pool",
    ],
  },
  {
    title: "Safety and anti-detection safeguards",
    items: [
      "Pair cooldown and reciprocity controls",
      "Provider/domain concentration checks",
      "Shadow / high-confidence / full enforcement modes",
      "Adaptive throttling when candidate pools are constrained",
      "Risk telemetry fields in warmup send records",
    ],
  },
];

const bestPractices = [
  "Ramp gradually. Avoid sudden jumps in daily send volume.",
  "Keep provider/domain diversity healthy across recipients.",
  "Do not repeatedly hit the same sender-recipient pairs.",
  "Use clean, non-promotional warmup copy and rotate templates.",
  "Keep DNS and mailbox configuration healthy (SPF, DKIM, DMARC).",
  "Prefer steady daily activity over bursty on/off behavior.",
];

const riskSignals = [
  "Same pair repetition in short windows",
  "High concentration on one provider or domain",
  "Low recipient diversity over rolling 24h windows",
  "Abrupt volume spikes after inactivity",
  "Poor reply/engagement quality over time",
];

const faq = [
  {
    q: "How long should warmup run?",
    a: "Run warmup continuously for active sending inboxes. New inboxes typically need a gradual ramp period before heavy outreach.",
  },
  {
    q: "Can I pause warmup?",
    a: "Yes, but frequent pauses/resumes can create unnatural patterns. Resume with a gradual ramp when possible.",
  },
  {
    q: "Should I rely only on shared pools?",
    a: "No. Your own verified network is usually safer and more durable. Shared pools should complement, not replace, healthy sender fundamentals.",
  },
  {
    q: "What should I check if health drops?",
    a: "Check DNS/auth setup, recent volume changes, template quality, recipient diversity, and sent logs for concentration patterns.",
  },
];

export default function WarmupLearnPage() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <BookOpen className="h-3.5 w-3.5" />
            Warmup Guide
          </Badge>
          <Badge variant="outline" className="gap-1">
            <ShieldCheck className="h-3.5 w-3.5" />
            Deliverability First
          </Badge>
        </div>
        <h1 className="mt-3 text-2xl font-bold">Learn Warmup</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Everything in one place: what warmup does, how each section works, best practices,
          risk signals, and how to operate safely as you scale.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Warmup fundamentals</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {fundamentals.map((item) => (
            <div key={item.title} className="rounded-lg border p-4">
              <h3 className="text-sm font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{item.text}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Warmup sections explained</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <div key={section.title} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">{section.title}</h3>
                  </div>
                  <Button asChild size="sm" variant="outline" className="h-7">
                    <Link href={section.href}>Open</Link>
                  </Button>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{section.description}</p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Everything available in our warmup system</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {systemOptions.map((group) => (
            <div key={group.title} className="rounded-lg border p-4">
              <h3 className="text-sm font-semibold">{group.title}</h3>
              <div className="mt-2 space-y-2">
                {group.items.map((item) => (
                  <div key={item} className="flex items-start gap-2 text-sm">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary/70" />
                    <span className="text-muted-foreground">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Best practices
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {bestPractices.map((item) => (
              <div key={item} className="flex items-start gap-2 text-sm">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span className="text-muted-foreground">{item}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Risk signals to watch
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {riskSignals.map((item) => (
              <div key={item} className="flex items-start gap-2 text-sm">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
                <span className="text-muted-foreground">{item}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recommended operating flow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <Settings className="h-3.5 w-3.5" />
              Setup
            </Badge>
            <span>-</span>
            <Badge variant="outline" className="gap-1">
              <Users className="h-3.5 w-3.5" />
              Build Network
            </Badge>
            <span>-</span>
            <Badge variant="outline" className="gap-1">
              <BarChart3 className="h-3.5 w-3.5" />
              Monitor
            </Badge>
            <span>-</span>
            <Badge variant="outline" className="gap-1">
              <Activity className="h-3.5 w-3.5" />
              Tune
            </Badge>
          </div>
          <Separator />
          <p>
            Start with healthy domain and inbox setup, then add verified network contacts, keep volume
            ramp gradual, monitor timeline/logs daily, and tune templates/distribution if concentration
            or warning signals rise.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">FAQ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {faq.map((item) => (
            <div key={item.q}>
              <h3 className="text-sm font-semibold">{item.q}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{item.a}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
