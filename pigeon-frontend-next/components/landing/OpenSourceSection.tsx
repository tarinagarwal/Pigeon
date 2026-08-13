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
  Radar,
  Star,
  ArrowRight,
  GitFork,
  Check,
} from "lucide-react";
import { GITHUB_URL } from "@/components/layout/Header";

/** Everything the paid platforms charge for — plus the layer none of them have. */
const PARITY = [
  { icon: PenLine, name: "AI writing & personalization", note: "Per-contact variations, not merge tags" },
  { icon: Workflow, name: "Multi-step sequences", note: "Automated follow-ups on autopilot" },
  { icon: ShieldCheck, name: "Warm-up & deliverability", note: "Inbox rotation, sender health" },
  { icon: Globe, name: "SPF / DKIM / DMARC setup", note: "Authentication handled for you" },
  { icon: Inbox, name: "Unified inbox & replies", note: "Every reply in one place" },
  { icon: Users, name: "Lead discovery & enrichment", note: "Find and verify your ICP" },
  { icon: MailCheck, name: "Email verification", note: "Kill bounces before you send" },
  { icon: Ban, name: "Risky-contact blocking", note: "Auto-remove bad addresses" },
  { icon: BarChart3, name: "Analytics & reporting", note: "Opens, clicks, replies, pipeline" },
  { icon: Lock, name: "Security & compliance", note: "Opt-outs, consent, data control" },
];

export function OpenSourceSection() {
  return (
    <section className="py-16 lg:py-24 relative overflow-hidden bg-background" aria-labelledby="open-source-heading">
      {/* glow */}
      <div
        className="absolute -top-32 right-1/4 w-[500px] h-[400px] rounded-full pointer-events-none opacity-15 dark:opacity-20 blur-[120px]"
        style={{ background: "radial-gradient(circle, rgba(16,185,129,0.5) 0%, transparent 70%)" }}
      />
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl relative z-10">

        {/* Header */}
        <div className="max-w-3xl mx-auto text-center mb-14">
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-muted/50 text-foreground/80 text-[11px] font-mono font-bold uppercase tracking-[0.12em]">
            <GitFork className="w-3.5 h-3.5" />
            MIT licensed · Self-hostable
          </span>
          <h2
            id="open-source-heading"
            className="mt-5 text-4xl sm:text-5xl font-black tracking-[-0.03em] leading-[1.05] text-foreground"
          >
            So we made it open source.
          </h2>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
            Pigeon ships <span className="text-foreground/90 font-semibold">every feature those {""}
            <span className="tabular-nums">38</span> platforms charge you for</span> — writing, sequences, warm-up,
            deliverability, enrichment, verification, analytics — and adds the one layer none of them have: a
            <span className="text-foreground/90 font-semibold"> social-first &ldquo;aware&rdquo; step</span> that earns
            recognition before the first email. No per-seat pricing. No per-send limits. Read the code, self-host it, or
            just use it.
          </p>
        </div>

        {/* Parity grid */}
        <div className="mb-8">
          <p className="text-center text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground mb-5">
            Full feature parity with the paid stack
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {PARITY.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.name} className="rounded-xl border border-border bg-card p-4">
                  <div className="w-9 h-9 rounded-lg bg-muted border border-border flex items-center justify-center mb-3">
                    <Icon className="w-4 h-4 text-foreground/80" />
                  </div>
                  <div className="flex items-start gap-1.5">
                    <Check className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <span className="text-[13px] font-bold text-foreground leading-snug">{f.name}</span>
                  </div>
                  <p className="mt-1 text-[11.5px] text-muted-foreground leading-snug pl-5">{f.note}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* The extra layer callout */}
        <div className="max-w-3xl mx-auto rounded-2xl border-2 border-emerald-500/25 bg-emerald-500/[0.05] p-6 flex items-start gap-4 mb-12">
          <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center flex-shrink-0">
            <Radar className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <p className="font-black text-foreground text-[15px] mb-1">
              + The &ldquo;aware&rdquo; layer no paid platform ships
            </p>
            <p className="text-[13.5px] text-muted-foreground leading-relaxed">
              Warm the prospect before you send. Everything above, wired to earn recognition before
              touchpoint two — the actual lever behind inbox placement and replies.
            </p>
          </div>
        </div>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="group w-full sm:w-auto">
            <button className="w-full inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl font-bold text-[0.95rem] text-background bg-foreground hover:bg-foreground/90 transition-all duration-200 hover:-translate-y-0.5">
              <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
              Star the repo
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </Link>
          <Link href="/login" className="w-full sm:w-auto">
            <button className="w-full inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl font-semibold text-[0.95rem] text-foreground bg-background border-2 border-border hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all duration-200">
              Use the hosted version
            </button>
          </Link>
        </div>
      </div>
    </section>
  );
}
