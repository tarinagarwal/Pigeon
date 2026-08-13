import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  FileText,
  Mail,
  Search,
  Users,
  Sparkles,
  ListChecks,
  Shield,
  Clock,
  Target,
  TrendingUp,
  Zap,
  Star,
  ChevronRight,
  MessageSquare,
  Database,
  CheckCircle2,
  AlertCircle,
  Building2,
  Globe,
  Rocket,
  Package,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HelpLinks } from "@/components/HelpLinks";

/** Sales contact number in international format, digits only. Override per deployment. */
const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "919352023583";
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}`;

export const metadata: Metadata = {
  title: "Buy List – Verified B2B Contact Lists | Pigeon",
  description:
    "Get ready-to-use contact lists of decision-makers. We identify the right people at target companies, verify work emails, and deliver lists you can plug straight into outreach.",
};

const steps = [
  {
    icon: FileText,
    title: "You provide",
    items: [
      "Link of the target site (e.g. https://www.example.com/)",
      "Target keywords (e.g. AI tools, AI tools directory, Discover AI tools, Compare AI tools, Best AI tools, AI tool search)",
    ],
  },
  {
    icon: Search,
    title: "We identify decision-makers",
    description:
      "We scan public professional profiles and company mentions across the web to find the right people inside each target company—for example, marketing or HR team members.",
  },
  {
    icon: Users,
    title: "We build a verified list",
    description:
      "From this, we build a verified list of decision-makers with their names, roles, and profile links—so you know exactly who you're reaching.",
  },
  {
    icon: Mail,
    title: "We find & validate emails",
    description:
      "We predict and validate each person's work email using common company email patterns and live checks. You get real, usable contact details—not guesses.",
  },
  {
    icon: ListChecks,
    title: "You get a ready-to-use list",
    description:
      "The output is a ready-to-use contact list you can plug straight into outreach or sales workflows—with high accuracy and minimal manual work.",
  },
];

const stats = [
  { value: "95%+", label: "Email accuracy rate", icon: Shield },
  { value: "48h", label: "Average turnaround", icon: Clock },
  { value: "10k+", label: "Contacts delivered", icon: Database },
  { value: "3x", label: "Better reply rates", icon: TrendingUp },
];

const benefits = [
  {
    icon: Target,
    title: "Laser-targeted prospects",
    description:
      "We don't just scrape directories. We find decision-makers who match your exact ICP—by role, industry, and intent signals.",
  },
  {
    icon: Shield,
    title: "Verified, not guessed",
    description:
      "Every email is live-validated before delivery. No bounces, no spam traps, no wasted outreach budget.",
  },
  {
    icon: Zap,
    title: "Plug-and-play format",
    description:
      "Lists are formatted for instant import into Apollo, Instantly, Lemlist, HubSpot, or any CSV-compatible tool.",
  },
  {
    icon: Clock,
    title: "Save 40+ hours per campaign",
    description:
      "Manual prospecting takes days. We deliver a qualified, verified list while you focus on closing.",
  },
  {
    icon: TrendingUp,
    title: "Higher reply rates",
    description:
      "Reaching the right person with a verified email dramatically improves your open and reply rate from day one.",
  },
  {
    icon: Globe,
    title: "Any market, any niche",
    description:
      "From SaaS to e-commerce to professional services—we build lists across any vertical or geography.",
  },
];

const useCases = [
  {
    persona: "Founders",
    icon: Rocket,
    color: "from-primary/20 to-primary/10 border-primary/30",
    accent: "text-primary",
    headline: "Stop guessing. Start closing.",
    points: [
      "Build your first outbound pipeline without hiring an SDR",
      "Target companies exactly like your best existing customers",
      "Get verified contacts of CEOs, VPs, and decision-makers",
      "Launch campaigns within 48 hours of your request",
    ],
  },
  {
    persona: "Sales Teams",
    icon: Target,
    color: "from-primary/20 to-primary/10 border-primary/30",
    accent: "text-primary",
    headline: "Fill your pipeline. Hit your quota.",
    points: [
      "Replace unreliable scraped lists with verified, segmented data",
      "Get contact lists per territory, industry, or company size",
      "Integrate directly into your CRM or sales sequencer",
      "Reduce bounce rates and protect sender reputation",
    ],
  },
  {
    persona: "Agencies",
    icon: Building2,
    color: "from-emerald-500/20 to-green-500/10 border-emerald-500/30",
    accent: "text-emerald-500",
    headline: "Deliver better results for every client.",
    points: [
      "White-label list building for your outreach campaigns",
      "Scalable—order one list or dozens across clients",
      "Consistent quality with structured data output",
      "Fast turnaround keeps client campaigns on schedule",
    ],
  },
];

const comparisonRows = [
  {
    feature: "Email accuracy",
    us: "95%+ verified",
    them: "60–70% estimated",
    highlight: true,
  },
  {
    feature: "Decision-maker targeting",
    us: "Role + intent matched",
    them: "Job title only",
    highlight: false,
  },
  {
    feature: "Turnaround time",
    us: "24–48 hours",
    them: "Days or weeks",
    highlight: false,
  },
  {
    feature: "Output format",
    us: "Ready-to-import CSV",
    them: "Raw exports requiring cleanup",
    highlight: true,
  },
  {
    feature: "Manual research",
    us: "Zero—we do it all",
    them: "Significant manual cleanup",
    highlight: false,
  },
  {
    feature: "Bounce rate",
    us: "Under 3%",
    them: "Often 15–30%",
    highlight: true,
  },
];

const faqs = [
  {
    q: "How accurate are the emails you provide?",
    a: "We maintain a 95%+ accuracy rate by combining email pattern prediction with live SMTP validation. Every email is checked before delivery—so you get real inboxes, not guesses.",
  },
  {
    q: "How long does it take to get my list?",
    a: "Most lists are delivered within 24–48 hours of your request, depending on size and complexity. We'll give you a clear timeline when you reach out.",
  },
  {
    q: "What format will the list be in?",
    a: "You'll receive a structured CSV file with columns for first name, last name, role, company, LinkedIn URL, and verified work email. It's ready to import into Apollo, Instantly, Lemlist, HubSpot, or any tool you use.",
  },
  {
    q: "Can I request contacts from a specific industry or country?",
    a: "Absolutely. When you reach out, just share your target criteria—industry, geography, company size, or specific roles—and we'll build the list around your ICP.",
  },
  {
    q: "What if some emails bounce?",
    a: "We stand behind our accuracy. If bounce rates exceed 5%, we'll replace the affected contacts or credit you toward your next order. Your trust matters more than any single list.",
  },
  {
    q: "Can I order lists for multiple campaigns at once?",
    a: "Yes—agencies and sales teams often order multiple segmented lists simultaneously. Reach out and we'll scope your requirements and provide a bundled quote.",
  },
  {
    q: "How is this different from buying a database subscription?",
    a: "Generic databases give you millions of stale, unverified contacts. We build a targeted, fresh, verified list specifically for your ICP—quality over quantity, every time.",
  },
];

const testimonials = [
  {
    quote:
      "We went from a 22% bounce rate with our old list to under 4% with Pigeon. Our reply rate doubled in the first week.",
    name: "Sarah K.",
    role: "Head of Growth",
    company: "Series A SaaS startup",
    avatar: "SK",
  },
  {
    quote:
      "As an agency, we need fast turnaround and consistent quality. Pigeon delivers both. Our clients are seeing 3x better open rates.",
    name: "Marcus T.",
    role: "Founder",
    company: "B2B Outreach Agency",
    avatar: "MT",
  },
  {
    quote:
      "Saved our SDR team 30+ hours of prospecting per week. The lists come verified and formatted—we just import and go.",
    name: "Priya M.",
    role: "Sales Director",
    company: "Enterprise SaaS",
    avatar: "PM",
  },
];

export default function BuyListPage() {
  return (
    <div className="min-h-full bg-background overflow-x-hidden">
      {/* Hero */}
      <section className="relative py-12 lg:py-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.03] via-transparent to-accent/[0.04]" />
        <div className="absolute top-0 right-0 w-[520px] h-[520px] bg-gradient-to-br from-primary/8 to-transparent rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-[320px] h-[320px] bg-gradient-to-tr from-accent/8 to-transparent rounded-full blur-3xl translate-y-1/2 -translate-x-1/4" />

        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl relative z-10">
          <div className="inline-flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)] mb-6">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Sparkles className="w-4 h-4" />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Premium service — done for you
            </span>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-5xl xl:text-[2.75rem] font-bold tracking-[-0.02em] mb-5 leading-[1.15]">
            <span className="text-foreground">Verified B2B contact lists</span>
            <span className="mt-2 block bg-gradient-to-r from-primary via-primary/85 to-accent bg-clip-text text-transparent">
              that plug straight into outreach
            </span>
          </h1>

          <p className="text-muted-foreground text-base sm:text-lg max-w-2xl mb-9 leading-[1.6]">
            We identify the right decision-makers at your target companies,
            verify their work emails, and deliver a ready-to-use list—no
            guesswork, no manual research, no bounce headaches.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 mb-11">
            <a
              href={WHATSAPP_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex"
            >
              <Button
                size="lg"
                className="gradient-primary min-h-[52px] px-7 font-bold rounded-xl shadow-sm shadow-primary/15 hover:shadow-primary/40 transition-all w-full sm:w-auto text-base"
              >
                Get a quote on WhatsApp
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </a>
            <Button
              size="lg"
              variant="outline"
              className="min-h-[52px] rounded-xl font-semibold text-base"
              asChild
            >
              <Link href="/contact">Talk to us first</Link>
            </Button>
          </div>

          {/* Trust signals row */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
            {[
              { icon: CheckCircle2, label: "95%+ email accuracy", iconClass: "text-emerald-500" },
              { icon: Zap, label: "24–48h turnaround", iconClass: "text-amber-500" },
              { icon: FileText, label: "CSV ready to import", iconClass: "text-primary" },
            ].map((item, i) => (
              <span key={item.label} className="flex items-center gap-2 font-medium">
                <item.icon className={`w-4 h-4 shrink-0 ${item.iconClass}`} />
                {item.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-y border-border bg-muted/30 py-8">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {stats.map((stat, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/10">
                  <stat.icon className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xl font-bold tracking-tight">{stat.value}</div>
                  <div className="text-xs text-muted-foreground font-medium">
                    {stat.label}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Problem section */}
      <section className="py-10 lg:py-14">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl">
          <div className="grid lg:grid-cols-2 gap-8 items-center">
            <div>
              <Badge variant="outline" className="mb-4 text-destructive border-destructive/30 bg-destructive/5">
                The Problem
              </Badge>
              <h2 className="text-2xl sm:text-3xl font-bold mb-4 leading-tight">
                Bad contact data is killing your outreach
              </h2>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                Most teams waste days manually prospecting—only to end up with
                stale emails, wrong contacts, and 20–30% bounce rates that
                destroy sender reputation. There's a better way.
              </p>
              <div className="space-y-3">
                {[
                  "Hours wasted researching contacts manually",
                  "High bounce rates burning your domain reputation",
                  "Wrong decision-makers = zero replies",
                  "Generic databases with outdated, unverified data",
                ].map((pain, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                    <span className="text-sm text-muted-foreground">{pain}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative">
              <Card className="border-2 border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-transparent">
                <CardHeader className="pb-3">
                  <Badge className="w-fit mb-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                    The Pigeon way
                  </Badge>
                  <CardTitle className="text-lg">What you get instead</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    "Targeted decision-makers matching your exact ICP",
                    "Live-verified emails with under 3% bounce rate",
                    "Delivered in 24–48 hours, ready to import",
                    "Fresh data built specifically for your campaign",
                  ].map((benefit, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <span className="text-sm">{benefit}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* What you give */}
      <section className="py-10 lg:py-14 border-t border-border bg-muted/20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl">
          <div className="mb-8">
            <Badge variant="outline" className="mb-3">
              Simple inputs
            </Badge>
            <h2 className="text-2xl sm:text-3xl font-bold mb-2">
              What you provide
            </h2>
            <p className="text-muted-foreground max-w-xl">
              Two simple inputs are all we need to build your list. That's it.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4 max-w-3xl">
            <Card className="border-2 border-border bg-card hover:border-primary/40 transition-colors">
              <CardHeader className="pb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-3">
                  <FileText className="w-5 h-5" />
                </div>
                <CardTitle className="text-base">Target site URL</CardTitle>
                <CardDescription className="text-sm">
                  The website or company you want to find contacts for.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-muted/50 rounded-lg px-3 py-2 text-xs font-mono text-muted-foreground">
                  https://www.example.com/
                </div>
              </CardContent>
            </Card>
            <Card className="border-2 border-border bg-card hover:border-primary/40 transition-colors">
              <CardHeader className="pb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-3">
                  <Search className="w-5 h-5" />
                </div>
                <CardTitle className="text-base">Target keywords</CardTitle>
                <CardDescription className="text-sm">
                  Keywords that describe your ideal audience or niche.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {["AI tools", "AI directory", "Best AI tools", "Compare AI"].map((kw) => (
                    <Badge
                      key={kw}
                      variant="secondary"
                      className="text-xs font-normal"
                    >
                      {kw}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-10 lg:py-14 border-t border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl">
          <div className="mb-8">
            <Badge variant="outline" className="mb-3">
              The process
            </Badge>
            <h2 className="text-2xl sm:text-3xl font-bold mb-2">
              How it works
            </h2>
            <p className="text-muted-foreground max-w-xl">
              From your two inputs to a verified, outreach-ready list—without
              touching a spreadsheet.
            </p>
          </div>
          <div className="relative">
            {/* Connector line */}
            <div className="absolute left-[19px] top-10 bottom-10 w-px bg-gradient-to-b from-primary/40 via-primary/20 to-transparent hidden sm:block" />
            <div className="space-y-3">
              {steps.map((step, i) => (
                <Card
                  key={i}
                  className="border-2 border-border bg-card overflow-hidden hover:border-primary/30 transition-colors"
                >
                  <CardHeader className="py-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary relative z-10">
                        <step.icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-primary bg-primary/10 rounded-full px-2 py-0.5">
                            Step {i + 1}
                          </span>
                          {step.title}
                          {i === 0 && (
                            <span className="text-xs font-normal text-muted-foreground">
                              (your input)
                            </span>
                          )}
                        </CardTitle>
                        {step.description && (
                          <CardDescription className="mt-1.5 text-sm leading-relaxed">
                            {step.description}
                          </CardDescription>
                        )}
                        {step.items && (
                          <ul className="mt-2.5 space-y-2">
                            {step.items.map((item, j) => (
                              <li
                                key={j}
                                className="flex items-start gap-2 text-muted-foreground text-sm"
                              >
                                <Check className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-10 lg:py-14 border-t border-border bg-muted/20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl">
          <div className="mb-8">
            <Badge variant="outline" className="mb-3">
              Why it works
            </Badge>
            <h2 className="text-2xl sm:text-3xl font-bold mb-2">
              Built for results, not volume
            </h2>
            <p className="text-muted-foreground max-w-xl">
              We don't just hand you names—we give you the right contacts with
              verified emails and the context to convert them.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {benefits.map((b, i) => (
              <Card
                key={i}
                className="border-2 border-border bg-card hover:border-primary/30 hover:shadow-md transition-all"
              >
                <CardHeader className="pb-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-3">
                    <b.icon className="w-5 h-5" />
                  </div>
                  <CardTitle className="text-base">{b.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {b.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Use cases by persona */}
      <section className="py-10 lg:py-14 border-t border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl">
          <div className="mb-8">
            <Badge variant="outline" className="mb-3">
              Use cases
            </Badge>
            <h2 className="text-2xl sm:text-3xl font-bold mb-2">
              Built for every B2B go-to-market team
            </h2>
            <p className="text-muted-foreground max-w-xl">
              Whether you're a solo founder or running a full sales team, we
              adapt to your workflow.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {useCases.map((uc, i) => (
              <Card
                key={i}
                className={`border-2 bg-gradient-to-br ${uc.color} overflow-hidden hover:shadow-lg transition-shadow`}
              >
                <CardHeader className="pb-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-xl bg-background/80 border border-border/50 mb-2 ${uc.accent}`}>
                    <uc.icon className="w-5 h-5" />
                  </div>
                  <Badge
                    variant="outline"
                    className={`w-fit text-xs mb-1 ${uc.accent} border-current/30`}
                  >
                    {uc.persona}
                  </Badge>
                  <CardTitle className="text-base">{uc.headline}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {uc.points.map((pt, j) => (
                      <li key={j} className="flex items-start gap-2 text-sm">
                        <Check className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${uc.accent}`} />
                        <span className="text-muted-foreground">{pt}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section className="py-10 lg:py-14 border-t border-border bg-muted/20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl">
          <div className="mb-8">
            <Badge variant="outline" className="mb-3">
              Comparison
            </Badge>
            <h2 className="text-2xl sm:text-3xl font-bold mb-2">
              Pigeon vs. typical list providers
            </h2>
            <p className="text-muted-foreground max-w-xl">
              Generic databases give you volume. We give you precision.
            </p>
          </div>
          <div className="rounded-xl border-2 border-border overflow-hidden">
            <div className="grid grid-cols-3 bg-muted/50 border-b border-border text-sm font-semibold">
              <div className="p-4">Feature</div>
              <div className="p-4 text-primary">Pigeon</div>
              <div className="p-4 text-muted-foreground">Typical provider</div>
            </div>
            {comparisonRows.map((row, i) => (
              <div
                key={i}
                className={`grid grid-cols-3 border-b border-border last:border-0 text-sm ${
                  row.highlight ? "bg-primary/3" : ""
                }`}
              >
                <div className="p-4 text-muted-foreground font-medium">
                  {row.feature}
                </div>
                <div className="p-4 flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-medium">
                  <Check className="w-4 h-4 shrink-0" />
                  {row.us}
                </div>
                <div className="p-4 flex items-center gap-2 text-muted-foreground">
                  <AlertCircle className="w-4 h-4 shrink-0 text-muted-foreground/50" />
                  {row.them}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-10 lg:py-14 border-t border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl">
          <div className="mb-8">
            <Badge variant="outline" className="mb-3">
              Social proof
            </Badge>
            <h2 className="text-2xl sm:text-3xl font-bold mb-2">
              What our customers say
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {testimonials.map((t, i) => (
              <Card
                key={i}
                className="border-2 border-border bg-card hover:border-primary/30 transition-colors"
              >
                <CardHeader className="pb-3">
                  <MessageSquare className="w-5 h-5 text-primary/40" />
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground italic mb-4 leading-relaxed">
                    "{t.quote}"
                  </p>
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                      {t.avatar}
                    </div>
                    <div>
                      <div className="text-sm font-semibold">{t.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.role} · {t.company}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing positioning */}
      <section className="py-10 lg:py-14 border-t border-border bg-muted/20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl">
          <div className="grid lg:grid-cols-2 gap-8 items-center">
            <div>
              <Badge variant="outline" className="mb-3">
                Pricing
              </Badge>
              <h2 className="text-2xl sm:text-3xl font-bold mb-4">
                Pay for quality, not volume
              </h2>
              <p className="text-muted-foreground mb-4 leading-relaxed">
                We price per verified contact—not per database subscription you'll
                barely use. That means you only pay for what actually works.
              </p>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                Pricing scales with list size and complexity. Agencies and teams
                ordering multiple lists get preferential rates. Reach out to get a
                custom quote—we'll scope it together.
              </p>
              <a
                href={WHATSAPP_LINK}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex"
              >
                <Button
                  size="lg"
                  className="gradient-primary min-h-[48px] px-6 font-bold rounded-xl shadow-sm shadow-primary/15"
                >
                  Get a custom quote
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </a>
            </div>
            <div className="space-y-3">
              {[
                {
                  label: "One-time lists",
                  desc: "Perfect for testing a new market or persona",
                  icon: Target,
                },
                {
                  label: "Campaign bundles",
                  desc: "Multiple segmented lists for ongoing outbound",
                  icon: Package,
                },
                {
                  label: "Agency packages",
                  desc: "Scalable pricing across multiple clients",
                  icon: Building2,
                },
              ].map((pkg, i) => (
                <Card
                  key={i}
                  className="border-2 border-border bg-card flex items-center gap-4 p-4 hover:border-primary/30 hover:shadow-md transition-all"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <pkg.icon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm">{pkg.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {pkg.desc}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Trust & compliance */}
      <section className="py-8 border-t border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl">
          <div className="flex flex-wrap gap-4 items-center justify-center lg:justify-start">
            {[
              { icon: CheckCircle2, label: "CAN-SPAM compliant process" },
              { icon: Database, label: "Publicly sourced data only" },
              { icon: Building2, label: "B2B contacts only" },
            ].map((t, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-3 py-2 rounded-full bg-muted/50 border border-border text-sm text-muted-foreground"
              >
                <t.icon className="w-3.5 h-3.5 text-primary" />
                {t.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-10 lg:py-14 border-t border-border bg-muted/20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl">
          <div className="mb-8">
            <Badge variant="outline" className="mb-3">
              FAQ
            </Badge>
            <h2 className="text-2xl sm:text-3xl font-bold mb-2">
              Common questions
            </h2>
            <p className="text-muted-foreground max-w-xl">
              Everything you need to know before ordering your first list.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {faqs.map((faq, i) => (
              <Card
                key={i}
                className="border-2 border-border bg-card hover:border-primary/30 transition-colors"
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold leading-snug">
                    {faq.q}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {faq.a}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-12 lg:py-16 border-t border-border bg-gradient-to-br from-primary/10 via-transparent to-accent/10 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-gradient-to-br from-primary/10 to-transparent rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-3xl text-center relative z-10">
          <div className="inline-flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)] mb-5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Zap className="w-4 h-4" />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Ready to launch?
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 leading-tight">
            Get a verified list that converts
            <span className="block mt-1 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              delivered in 48 hours
            </span>
          </h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
            Reach out on WhatsApp for a fast quote. Tell us your target, and
            we'll scope it in minutes. No forms, no waiting.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href={WHATSAPP_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex"
            >
              <Button
                size="lg"
                className="gradient-primary min-h-[52px] px-8 font-bold rounded-xl shadow-sm shadow-primary/15 hover:shadow-primary/40 transition-all w-full sm:w-auto text-base"
              >
                Contact on WhatsApp
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </a>
            <Button
              size="lg"
              variant="outline"
              className="min-h-[52px] rounded-xl font-semibold"
              asChild
            >
              <Link href="/contact">Send us a message</Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Average response time: under 2 hours · No commitment required
          </p>
        </div>
      </section>

      <section className="container mx-auto px-4 py-8 max-w-3xl">
        <HelpLinks slugs={["use-verified-leads-pro", "create-manage-contact-lists", "import-contacts-csv-excel"]} />
      </section>
    </div>
  );
}