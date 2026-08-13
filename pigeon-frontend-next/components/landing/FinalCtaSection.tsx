import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

export function FinalCtaSection() {
  return (
    <section
      className="py-16 lg:py-24 relative overflow-hidden border-t border-border/40"
      aria-label="Final call to action"
    >
      {/* Always-dark ink background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "linear-gradient(135deg, #06091a 0%, #0b0f2a 50%, #0f0820 100%)",
        }}
      />

      {/* Grid overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(139,92,246,1) 1px, transparent 1px), linear-gradient(90deg, rgba(139,92,246,1) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />

      {/* Glow orb — lighter blur on mobile to reduce paint cost */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[340px] h-[220px] sm:w-[700px] sm:h-[400px] pointer-events-none blur-[55px] sm:blur-[100px]"
        style={{
          opacity: 0.25,
          background: "radial-gradient(ellipse, rgba(6,182,212,0.7) 0%, rgba(99,102,241,0.4) 50%, transparent 100%)",
        }}
      />

      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-4xl relative z-10 text-center">

        {/* Badge */}
        <div
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-black uppercase tracking-[0.1em] mb-8"
          style={{ background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.25)", color: "#67e8f9" }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Start for free today
        </div>

        {/* Headline */}
        <h2 className="text-4xl sm:text-5xl lg:text-[3.4rem] font-black leading-[1.08] tracking-[-0.03em] mb-6 text-white">
          The best AI email marketing tool
          <span className="block mt-1 bg-gradient-to-r from-primary via-primary/85 to-primary/70 bg-clip-text text-transparent">
            to 10× your sales
          </span>
        </h2>

        <p className="text-lg font-medium mb-10 max-w-xl mx-auto" style={{ color: "rgba(255,255,255,0.55)" }}>
          Create AI-powered campaigns, personalize every email, automate follow-ups, and convert more leads into customers — all from one platform. Join 5,000+ businesses already growing with Pigeon.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-8">
          <Link href="/login" className="group">
            <button
              className="flex items-center justify-center gap-2 px-10 py-4 rounded-2xl font-bold text-base text-white w-full sm:w-auto transition-all duration-300 hover:scale-[1.05] hover:shadow-2xl"
              style={{
                background: "linear-gradient(135deg, #ea580c 0%, #c2410c 100%)",
                boxShadow: "0 8px 32px rgba(6,182,212,0.40)",
              }}
            >
              Book a demo
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
          </Link>
          <Link href="/contact">
            <button
              className="flex items-center justify-center gap-2 px-10 py-4 rounded-2xl font-semibold text-base w-full sm:w-auto transition-all duration-300 hover:scale-[1.02]"
              style={{
                color: "rgba(255,255,255,0.75)",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.14)",
              }}
            >
              Talk to sales
            </button>
          </Link>
        </div>

        {/* Perks row */}
        <div className="flex flex-wrap justify-center gap-x-7 gap-y-2 text-[13px] font-medium" style={{ color: "rgba(255,255,255,0.4)" }}>
          {["Custom plans", "Cancel anytime", "Full feature access", "Open source"].map((t) => (
            <span key={t} className="flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 text-emerald-400" strokeWidth={3} />
              {t}
            </span>
          ))}
        </div>

      </div>
    </section>
  );
}
