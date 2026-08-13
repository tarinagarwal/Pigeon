"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Sparkles,
  Zap,
  CheckCircle2,
  ChevronRight,
  BarChart3,
  Mail,
  TrendingUp,
  Users,
  BookOpen,
} from "lucide-react";

// ─── Data ────────────────────────────────────────────────────────────────────

const OUTCOMES = [
  "to 10× your sales.",
  "that converts.",
  "built for growth.",
  "on autopilot.",
];

const METRICS = [
  { value: "AI",   label: "Powered campaigns", valueClass: "text-primary dark:text-primary",       cardClass: "bg-primary/8 border-primary/20"    },
  { value: "10×",  label: "More conversions",   valueClass: "text-emerald-500 dark:text-emerald-400", cardClass: "bg-emerald-500/8 border-emerald-500/20" },
  { value: "Auto", label: "Follow-up sequences",valueClass: "text-primary dark:text-primary",   cardClass: "bg-primary/8 border-primary/20" },
  { value: "100%", label: "Personalized",        valueClass: "text-amber-500 dark:text-amber-400",    cardClass: "bg-amber-500/8 border-amber-500/20"   },
];

// Campaign performance data for the live card
const CAMPAIGNS = [
  { name: "Q3 Launch Sequence",   status: "live",  leads: 342, pipeline: "$28k" },
  { name: "Product Demo Invite",  status: "live",  leads: 198, pipeline: "$19k" },
  { name: "Re-engagement Flow",   status: "draft", leads: 0,   pipeline: ""     },
];

// ─── Typewriter ───────────────────────────────────────────────────────────────

function TypewriterOutcome() {
  const [idx, setIdx]             = useState(0);
  const [displayed, setDisplayed] = useState("");
  const [deleting, setDeleting]   = useState(false);

  useEffect(() => {
    const target = OUTCOMES[idx];
    if (!deleting) {
      if (displayed.length < target.length) {
        const t = setTimeout(() => setDisplayed(target.slice(0, displayed.length + 1)), 58);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setDeleting(true), 2200);
      return () => clearTimeout(t);
    }
    if (displayed.length > 0) {
      const t = setTimeout(() => setDisplayed(displayed.slice(0, -1)), 32);
      return () => clearTimeout(t);
    }
    setDeleting(false);
    setIdx((i) => (i + 1) % OUTCOMES.length);
  }, [displayed, deleting, idx]);

  return (
    <span className="bg-gradient-to-r from-primary via-primary/85 to-primary/70 dark:from-primary dark:via-primary/85 dark:to-primary/70 bg-clip-text text-transparent">
      {displayed}
      <span className="animate-pulse text-primary dark:text-primary not-italic">|</span>
    </span>
  );
}

// ─── Animated stat counter ────────────────────────────────────────────────────

function useCountUp(target: number, startDelay: number) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    const start = setTimeout(() => {
      let v = 0;
      const iv = setInterval(() => {
        v += 2;
        setVal(Math.min(v, target));
        if (v >= target) clearInterval(iv);
      }, 30);
      return () => clearInterval(iv);
    }, startDelay);
    return () => clearTimeout(start);
  }, [target, startDelay]);
  return val;
}

// ─── Campaign row ─────────────────────────────────────────────────────────────

function CampaignRow({ c }: { c: (typeof CAMPAIGNS)[number] }) {
  const leadsCount = useCountUp(c.leads, 800);
  const isLive     = c.status === "live";

  return (
    <div className="flex items-center gap-3 py-2">
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${
          isLive ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/30"
        }`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-foreground/90 truncate">{c.name}</p>
      </div>
      {isLive ? (
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] text-muted-foreground/60">
            <span className="font-bold text-primary dark:text-primary">{leadsCount}</span> leads
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            <span className="font-bold text-emerald-600 dark:text-emerald-400">{c.pipeline}</span> pipeline
          </span>
        </div>
      ) : (
        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/40">
          Draft
        </span>
      )}
    </div>
  );
}

// ─── AI Campaign Dashboard Card ───────────────────────────────────────────────

function AICampaignCard() {
  const leadsReached = useCountUp(2847, 400);

  return (
    <div className="relative w-full max-w-lg mx-auto lg:max-w-none">
      {/* Ambient glow behind card */}
      <div className="absolute -inset-8 rounded-3xl blur-3xl opacity-30 dark:opacity-60 pointer-events-none bg-gradient-to-br from-primary/40 via-transparent to-primary/40" />

      {/* Card */}
      <div className="relative rounded-2xl border border-border/70 bg-card/95 backdrop-blur-xl shadow-2xl overflow-hidden ring-1 ring-foreground/5 dark:ring-white/5">

        {/* Browser chrome */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60 bg-muted/20">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
          </div>
          <div className="flex-1 mx-3 h-5 rounded-md bg-muted/60 flex items-center justify-center">
            <span className="text-[10px] font-medium text-muted-foreground/50">
              AI Campaign Dashboard — Pigeon
            </span>
          </div>
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/12 border border-primary/25">
            <Sparkles className="w-2.5 h-2.5 text-primary dark:text-primary" />
            <span className="text-[9px] text-primary dark:text-primary font-black">AI POWERED</span>
          </div>
        </div>

        <div className="p-5 space-y-4">

          {/* Top stat tiles */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="rounded-xl bg-primary/8 border border-primary/20 p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Mail className="w-3 h-3 text-primary dark:text-primary" />
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">Campaigns</span>
              </div>
              <span className="text-2xl font-black text-primary dark:text-primary tabular-nums">12</span>
              <p className="text-[9px] text-muted-foreground/60 mt-0.5">Active this month</p>
            </div>
            <div className="rounded-xl bg-emerald-500/8 border border-emerald-500/20 p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <TrendingUp className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">Pipeline</span>
              </div>
              <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">$47k</span>
              <p className="text-[9px] text-muted-foreground/60 mt-0.5">Generated this month</p>
            </div>
            <div className="rounded-xl bg-primary/8 border border-primary/20 p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Users className="w-3 h-3 text-primary dark:text-primary" />
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">Leads reached</span>
              </div>
              <span className="text-xl font-black text-primary dark:text-primary tabular-nums leading-tight">{leadsReached.toLocaleString()}</span>
              <p className="text-[9px] text-muted-foreground/60 mt-0.5">This month</p>
            </div>
          </div>

          {/* Live campaigns list */}
          <div className="rounded-xl bg-muted/25 border border-border/50 px-3.5 py-2">
            <div className="flex items-center justify-between pb-1.5 mb-1 border-b border-border/40">
              <span className="text-[9px] font-black uppercase tracking-wider text-muted-foreground/60">
                AI campaigns
              </span>
              <span className="flex items-center gap-1 text-[9px] text-emerald-600 dark:text-emerald-400 font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
              </span>
            </div>
            <div className="divide-y divide-border/30">
              {CAMPAIGNS.map((c) => (
                <CampaignRow key={c.name} c={c} />
              ))}
            </div>
          </div>

          {/* AI personalization snippet */}
          <div className="rounded-xl bg-primary/5 border border-primary/15 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles className="w-3 h-3 text-primary dark:text-primary" />
              <span className="text-[9px] font-black uppercase tracking-wider text-primary dark:text-primary">AI personalization</span>
            </div>
            <p className="text-[10px] text-muted-foreground/80 leading-relaxed font-mono">
              <span className="text-foreground/70">Hi </span>
              <span className="text-primary dark:text-primary font-semibold">{"{{first_name}}"}</span>
              <span className="text-foreground/70">, I noticed </span>
              <span className="text-primary dark:text-primary font-semibold">{"{{company}}"}</span>
              <span className="text-foreground/70"> is growing fast — we help teams like yours...</span>
            </p>
          </div>

          {/* Feature strip */}
          <div className="flex flex-wrap gap-1.5">
            {["AI writing ✓", "Sequences ✓", "Personalization ✓", "Analytics ✓", "Auto follow-up ✓"].map((b) => (
              <span
                key={b}
                className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-muted/50 border border-border/60 text-muted-foreground/70"
              >
                {b}
              </span>
            ))}
          </div>

        </div>
      </div>

      {/* Floating badges */}
      <div className="absolute -top-4 -left-4 text-white text-[10px] font-black px-3.5 py-1.5 rounded-full whitespace-nowrap shadow-sm shadow-primary/15 border-2 border-background bg-gradient-to-br from-primary to-primary/70">
        <CheckCircle2 className="inline w-3 h-3 mr-1 -mt-0.5" /> 10× more revenue
      </div>
      <div className="absolute -bottom-4 -right-4 text-white text-[10px] font-black px-3.5 py-1.5 rounded-full whitespace-nowrap shadow-sm shadow-primary/15 border-2 border-background bg-gradient-to-br from-primary to-primary/70">
        <Zap className="inline w-3 h-3 mr-1 -mt-0.5" /> Personalized at scale
      </div>
    </div>
  );
}

// ─── Hero Section ─────────────────────────────────────────────────────────────

export function HeroSection() {
  return (
    <section
      className="relative pt-12 pb-24 lg:pt-20 lg:pb-32 overflow-hidden
        bg-gradient-to-br from-slate-50 via-white to-primary/40
        dark:from-[#06091a] dark:via-[#0b0f2a] dark:to-[#0f0820]"
      aria-labelledby="hero-heading"
    >
      {/* Grid lines */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.35] dark:opacity-100"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--foreground) / 0.06) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground) / 0.06) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />

      {/* Glow orbs */}
      <div
        className="absolute top-0 left-1/4 w-[320px] h-[320px] sm:w-[700px] sm:h-[700px] rounded-full pointer-events-none opacity-10 dark:opacity-18 blur-[60px] sm:blur-[120px]"
        style={{ background: "radial-gradient(circle, rgba(6,182,212,0.7) 0%, transparent 70%)" }}
      />
      <div
        className="absolute bottom-0 right-1/4 w-[280px] h-[280px] sm:w-[600px] sm:h-[600px] rounded-full pointer-events-none opacity-8 dark:opacity-14 blur-[60px] sm:blur-[120px]"
        style={{ background: "radial-gradient(circle, rgba(139,92,246,0.7) 0%, transparent 70%)" }}
      />

      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl relative z-10">
        <div className="grid lg:grid-cols-[1fr_1.08fr] gap-14 lg:gap-20 xl:gap-28 items-center">

          {/* ── LEFT: Copy ── */}
          <div className="max-w-xl mx-auto lg:mx-0">

            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/25 bg-primary/8 text-primary text-[11px] font-black uppercase tracking-[0.1em] mb-8 animate-slide-up">
              <Sparkles className="w-3.5 h-3.5" />
              The AI Email Marketing Platform
            </div>

            {/* Headline */}
            <h1
              id="hero-heading"
              className="text-[2.8rem] sm:text-5xl lg:text-[3.4rem] xl:text-[3.9rem] font-black tracking-[-0.03em] leading-[1.05] mb-2 text-foreground animate-slide-up"
              style={{ animationDelay: "80ms" }}
            >
              Best AI email marketing
            </h1>

            {/* Typewriter line */}
            <div
              className="text-[2.4rem] sm:text-4xl lg:text-[2.9rem] xl:text-[3.3rem] font-black tracking-[-0.03em] leading-[1.15] mb-8 animate-slide-up min-h-[1.25em]"
              style={{ animationDelay: "140ms" }}
            >
              <TypewriterOutcome />
            </div>

            {/* Subtext */}
            <p
              className="text-base sm:text-[1.05rem] text-muted-foreground leading-relaxed max-w-lg mb-9 animate-slide-up"
              style={{ animationDelay: "200ms" }}
            >
              Pigeon helps businesses create high-converting AI email campaigns in minutes.
              Personalize every message, automate follow-ups, improve inbox placement, and turn
              more prospects into paying customers—all from one powerful platform.
            </p>

            {/* CTAs */}
            <div
              className="flex flex-col sm:flex-row gap-3 mb-10 animate-slide-up"
              style={{ animationDelay: "280ms" }}
            >
              <Link
                href="/login"
                className="group"
                onClick={() =>
                  import("@/lib/marketingAnalytics").then((m) =>
                    m.trackCtaClick("book_demo")
                  )
                }
              >
                <button
                  className="flex items-center justify-center gap-2 px-8 py-4 rounded-2xl font-bold text-[0.95rem] text-white w-full sm:w-auto transition-all duration-300 hover:scale-[1.04] active:scale-[0.98] hover:shadow-2xl"
                  style={{
                    background: "linear-gradient(135deg, #ea580c 0%, #c2410c 100%)",
                    boxShadow: "0 8px 28px rgba(6,182,212,0.32), inset 0 1px 0 rgba(255,255,255,0.15)",
                  }}
                >
                  Book a Demo
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>
              </Link>
              <Link
                href="/login"
                className="group"
                onClick={() =>
                  import("@/lib/marketingAnalytics").then((m) =>
                    m.trackCtaClick("hero_start_trial")
                  )
                }
              >
                <button className="flex items-center justify-center gap-2 px-8 py-4 rounded-2xl font-semibold text-[0.95rem] w-full sm:w-auto transition-all duration-300 hover:scale-[1.02] text-foreground bg-background border-2 border-border hover:border-primary/40 hover:bg-primary/4 hover:shadow-sm">
                  Talk to us
                  <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </button>
              </Link>
            </div>

            {/* Inbox Playbook link */}
            <Link
              href="/cold-email-deliverability"
              className="group inline-flex items-center gap-2.5 mb-9 pl-2.5 pr-4 py-2 rounded-full border border-emerald-500/25 bg-emerald-500/8 hover:bg-emerald-500/14 hover:border-emerald-500/40 transition-all duration-200 animate-slide-up"
              style={{ animationDelay: "320ms" }}
            >
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/15 flex-shrink-0">
                <BookOpen className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              </span>
              <span className="text-[13px] font-semibold text-foreground/90">
                Free Inbox Playbook
                <span className="hidden sm:inline text-muted-foreground font-normal"> — fix deliverability in 10 min</span>
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 group-hover:translate-x-1 transition-transform" />
            </Link>

            {/* Metric pills */}
            <div
              className="grid grid-cols-2 sm:grid-cols-4 gap-2 animate-slide-up"
              style={{ animationDelay: "440ms" }}
            >
              {METRICS.map((m) => (
                <div key={m.label} className={`rounded-xl border ${m.cardClass} p-2.5 text-center`}>
                  <div className={`text-lg font-black ${m.valueClass}`}>{m.value}</div>
                  <div className="text-[9px] font-medium text-muted-foreground/70 mt-0.5">{m.label}</div>
                </div>
              ))}
            </div>

          </div>

          {/* ── RIGHT: AI Campaign Dashboard ── */}
          <div className="animate-slide-up" style={{ animationDelay: "160ms" }}>
            <AICampaignCard />
          </div>

        </div>
      </div>
    </section>
  );
}
