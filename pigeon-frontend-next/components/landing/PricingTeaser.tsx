import Link from "next/link";
import { ArrowRight, Check, Zap } from "lucide-react";

const FEATURES = [
  "Ready-to-send inboxes — no per-inbox fee",
  "Multiple domains & subdomains",
  "Automatic warm-up on every inbox",
  "AI writer, sequences & inbox rotation",
  "Unified reply inbox & analytics",
  "One login, one bill — no add-ons",
];

export function PricingTeaser() {
  return (
    <section
      id="pricing"
      className="py-16 lg:py-24 relative overflow-hidden marketing-band-subtle"
      aria-labelledby="pricing-teaser-heading"
    >
      {/* Background glows */}
      <div className="absolute top-0 left-1/4 w-96 h-96 rounded-full blur-3xl pointer-events-none bg-primary/6 dark:bg-primary/10" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 rounded-full blur-3xl pointer-events-none bg-primary/6 dark:bg-primary/10" />

      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl relative z-10">

        {/* Section label */}
        <div className="flex justify-center mb-5">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/25 bg-primary/8 text-primary text-[11px] font-black uppercase tracking-[0.1em]">
            Pricing
          </div>
        </div>

        {/* Main card */}
        <div className="rounded-2xl border border-border/60 bg-card/90 overflow-hidden shadow-2xl shadow-primary/5">

          <div className="grid lg:grid-cols-[1fr_1.1fr]">

            {/* Left: headline + perks */}
            <div className="p-8 lg:p-12 border-b lg:border-b-0 lg:border-r border-border/50">
              <h2
                id="pricing-teaser-heading"
                className="text-3xl sm:text-4xl lg:text-[2.6rem] font-black leading-[1.1] tracking-[-0.03em] mb-4"
              >
                One plan. Everything included.
                <span className="block mt-1 bg-gradient-to-r from-primary via-primary/85 to-primary/70 bg-clip-text text-transparent">
                  No per-inbox surprises.
                </span>
              </h2>
              <p className="text-muted-foreground font-medium leading-relaxed mb-8 text-[15px]">
                Inboxes, domains, warm-up, AI, and reply management in one subscription.
              </p>

              {/* Feature list */}
              <ul className="space-y-3">
                {FEATURES.map((f) => (
                  <li key={f} className="flex items-center gap-3 text-[14px] font-medium text-foreground">
                    <div className="w-5 h-5 rounded-full bg-emerald-500/12 border border-emerald-500/25 flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-emerald-500 dark:text-emerald-400" strokeWidth={3} />
                    </div>
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            {/* Right: CTA card */}
            <div className="p-8 lg:p-12 flex flex-col justify-center items-start lg:items-center text-left lg:text-center bg-gradient-to-br from-primary/5 via-transparent to-primary/5">

              {/* Badge */}
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[11px] font-black uppercase tracking-wider mb-6">
                <Zap className="w-3 h-3" /> Free trial — no card needed
              </div>

              <p className="text-5xl font-black text-foreground mb-1">$0</p>
              <p className="text-sm text-muted-foreground font-medium mb-8">to start · 7-day full access</p>

              <Link href="/features" className="w-full lg:w-auto">
                <button
                  className="flex items-center justify-center gap-2 w-full lg:w-auto px-10 py-4 rounded-2xl font-bold text-[0.95rem] text-white transition-all duration-300 hover:scale-[1.04] hover:shadow-2xl group"
                  style={{
                    background: "linear-gradient(135deg, #ea580c 0%, #c2410c 100%)",
                    boxShadow: "0 8px 28px rgba(6,182,212,0.32)",
                  }}
                >
                  View pricing &amp; start free trial
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>
              </Link>

              <div className="flex flex-wrap gap-x-6 gap-y-1.5 mt-6 text-[12px] text-muted-foreground font-medium">
                {["Free trial", "Transparent pricing", "Cancel anytime"].map((t) => (
                  <span key={t} className="flex items-center gap-1.5">
                    <Check className="w-3 h-3 text-emerald-500" strokeWidth={3} /> {t}
                  </span>
                ))}
              </div>

            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
