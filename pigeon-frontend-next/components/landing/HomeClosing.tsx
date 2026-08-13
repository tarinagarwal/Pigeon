import Link from "next/link";
import { GITHUB_URL } from "@/components/layout/Header";

export function HomeClosing() {
  return (
    <section className="border-b-[3px] border-foreground bg-[hsl(var(--sb-lilac))]">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
        <p className="font-display inline-block rounded-full border-[3px] border-foreground bg-card px-4 py-1.5 text-[12px] font-bold uppercase tracking-[0.1em] text-foreground">
          MIT licensed
        </p>
        <h2 className="font-display mt-6 max-w-3xl text-4xl font-black leading-[0.98] text-foreground sm:text-6xl">
          Run it with us.
          <br />
          Or run it yourself.
        </h2>
        <p className="mt-6 max-w-xl text-[15.5px] leading-relaxed text-foreground/70">
          We set your account up and get you sending the same day, priced to your volume. Or clone
          the repo and self-host the whole thing — every feature, no licence fee, no seat limits.
        </p>
        <div className="mt-9 flex flex-col gap-4 sm:flex-row">
          <Link
            href="/contact"
            className="inline-flex items-center justify-center font-display rounded-2xl border-[3px] border-foreground bg-primary px-8 py-4 text-[15px] font-bold text-primary-foreground shadow-[6px_6px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[3px_3px_0_0_hsl(var(--foreground))]"
          >
            Talk to us →
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center font-display rounded-2xl border-[3px] border-foreground bg-card px-8 py-4 text-[15px] font-bold text-foreground shadow-[6px_6px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[3px_3px_0_0_hsl(var(--foreground))]"
          >
            ★ Source
          </a>
        </div>
      </div>
    </section>
  );
}
