import Link from "next/link";
import { ArrowRight, Star } from "lucide-react";
import { GITHUB_URL } from "@/components/layout/Header";

export function BrutalFinalCta() {
  return (
    <section className="relative overflow-hidden bg-foreground text-background" aria-labelledby="final-cta-heading">
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--background) / 1) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--background) / 1) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-3xl relative z-10 py-20 lg:py-28 text-center">
        <h2
          id="final-cta-heading"
          className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-[-0.03em] leading-[1.0]"
        >
          Stop optimizing for send volume.
        </h2>
        <p className="mt-6 text-lg sm:text-xl text-background/70 leading-relaxed max-w-2xl mx-auto">
          If your outbound is still &ldquo;buy a list, send 10,000, hope for 2%,&rdquo; that budget could produce better
          results by building context before the first email goes out. The tool to do it is free, open, and yours.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="group w-full sm:w-auto">
            <button className="w-full inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-bold text-[0.95rem] bg-background text-foreground hover:bg-background/90 transition-all duration-200 hover:-translate-y-0.5">
              <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
              Star on GitHub
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </Link>
          <Link href="/login" className="w-full sm:w-auto">
            <button className="w-full inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-semibold text-[0.95rem] bg-transparent text-background border-2 border-background/30 hover:border-background/60 hover:bg-background/5 transition-all duration-200">
              Try it free
            </button>
          </Link>
        </div>
        <p className="mt-6 text-[12px] text-background/50 font-mono">
          MIT licensed · Self-hostable · No per-seat pricing · No sending limits
        </p>
      </div>
    </section>
  );
}
