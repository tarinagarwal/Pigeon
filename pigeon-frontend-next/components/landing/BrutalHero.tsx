"use client";

import Link from "next/link";
import { ArrowRight, Star, TerminalSquare } from "lucide-react";
import { GITHUB_URL } from "@/components/layout/Header";

const RECEIPTS = [
  { value: "1–5%", label: "Typical cold email reply rate", sub: "The other 95%+ ignore, delete, or report you" },
  { value: "~72%", label: "Real-world inbox placement", sub: "InboxKit's own average across 200+ accounts" },
  { value: "8/21", label: "Smartlead's deliverability score", sub: "On Amplemarket's independent framework" },
  { value: "2021", label: "The year open rates died", sub: "Apple Mail Privacy Protection fakes every open" },
];

export function BrutalHero() {
  return (
    <section
      className="relative overflow-hidden border-b border-border/60 bg-background"
      aria-labelledby="brutal-hero-heading"
    >
      {/* Grid + glow */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.4] dark:opacity-[0.55]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--foreground) / 0.05) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground) / 0.05) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />
      <div
        className="absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[500px] rounded-full pointer-events-none opacity-15 dark:opacity-25 blur-[120px]"
        style={{ background: "radial-gradient(circle, rgba(239,68,68,0.6) 0%, transparent 70%)" }}
      />

      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl relative z-10 pt-16 pb-14 lg:pt-24 lg:pb-20 text-center">

        {/* Eyebrow */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-border bg-muted/50 text-foreground/80 text-[11px] font-mono font-semibold uppercase tracking-[0.14em] mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Open source · Self-hostable · No sending limits
        </div>

        {/* Headline */}
        <h1
          id="brutal-hero-heading"
          className="text-[2.7rem] sm:text-6xl lg:text-[4.6rem] font-black tracking-[-0.04em] leading-[0.98] text-foreground"
        >
          Email marketing
          <br className="hidden sm:block" /> isn&rsquo;t dead.
          <span className="block mt-2 text-transparent bg-clip-text bg-gradient-to-r from-red-500 via-rose-500 to-orange-500">
            The way you&rsquo;re doing it is.
          </span>
        </h1>

        {/* Sub */}
        <p className="mt-8 max-w-2xl mx-auto text-lg sm:text-xl text-muted-foreground leading-relaxed">
          Mass blasts are over. And the fix isn&rsquo;t <em className="text-foreground/90 not-italic font-semibold">infrastructure</em>,
          it isn&rsquo;t <em className="text-foreground/90 not-italic font-semibold">personalization tokens</em>, it isn&rsquo;t more
          <em className="text-foreground/90 not-italic font-semibold"> servers</em>, dedicated IPs, or another
          <em className="text-foreground/90 not-italic font-semibold"> warm-up tool</em>. The entire industry is optimizing the
          wrong number.
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="group w-full sm:w-auto">
            <button className="w-full inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl font-bold text-[0.95rem] text-background bg-foreground hover:bg-foreground/90 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0">
              <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
              Star on GitHub
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </Link>
          <Link href="/login" className="group w-full sm:w-auto">
            <button className="w-full inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl font-semibold text-[0.95rem] text-foreground bg-background border-2 border-border hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all duration-200">
              <TerminalSquare className="w-4 h-4" />
              Try it free
            </button>
          </Link>
        </div>

        {/* Receipts */}
        <div className="mt-14 grid grid-cols-2 lg:grid-cols-4 gap-px rounded-2xl overflow-hidden border border-border bg-border">
          {RECEIPTS.map((r) => (
            <div key={r.label} className="bg-card p-5 text-left">
              <div className="text-3xl sm:text-4xl font-black tracking-tight text-foreground tabular-nums">
                {r.value}
              </div>
              <div className="mt-2 text-[12.5px] font-bold text-foreground/80 leading-snug">{r.label}</div>
              <div className="mt-1 text-[11.5px] text-muted-foreground leading-snug">{r.sub}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground/70 font-mono">
          Sources: InboxKit, Amplemarket independent deliverability framework, Apple Mail Privacy Protection.
        </p>
      </div>
    </section>
  );
}
