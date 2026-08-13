import Link from "next/link";
import Image from "next/image";
import { GITHUB_URL } from "@/components/layout/Header";

const TICKER = ["MIT LICENSED", "SELF-HOSTABLE", "NO PER-SEAT PRICING", "BRING YOUR OWN INBOXES"];

export function HomeHero() {
  return (
    <section className="border-b-[3px] border-foreground bg-[hsl(var(--sb-cream))]">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
        {/* items-center keeps the mascot optically aligned with the headline block */}
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-14">
          <div>
            <span className="inline-block rounded-full border-[3px] border-foreground bg-[hsl(var(--sb-butter))] px-4 py-1.5 font-display text-[12px] font-bold uppercase tracking-[0.1em] text-foreground">
              Cold email infrastructure
            </span>

            <h1 className="font-display mt-6 text-[2.9rem] font-black leading-[0.95] text-foreground sm:text-[4.2rem] lg:text-[4.6rem]">
              Land in the inbox.
              <span className="mt-2 block">
                <span className="inline-block rounded-2xl border-[3px] border-foreground bg-primary px-3 py-0.5 text-primary-foreground shadow-[5px_5px_0_0_hsl(var(--foreground))]">
                  Not spam.
                </span>
              </span>
            </h1>

            <p className="mt-7 max-w-lg text-[16.5px] leading-relaxed text-foreground/75">
              Pigeon runs multi-step campaigns across mailboxes you already own, warms them until
              providers trust them, and drops every reply into one thread.
            </p>

            <div className="mt-9 flex flex-col gap-4 sm:flex-row">
              <Link
                href="/contact"
                className="font-display inline-flex items-center justify-center rounded-2xl border-[3px] border-foreground bg-primary px-8 py-4 text-[15px] font-bold text-primary-foreground shadow-[6px_6px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[3px_3px_0_0_hsl(var(--foreground))]"
              >
                Talk to us →
              </Link>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-display inline-flex items-center justify-center rounded-2xl border-[3px] border-foreground bg-card px-8 py-4 text-[15px] font-bold text-foreground shadow-[6px_6px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[3px_3px_0_0_hsl(var(--foreground))]"
              >
                ★ Source
              </a>
            </div>
          </div>

          {/* Mascot sits in its own slab so it can't float low against the text column */}
          <div className="rounded-3xl border-[3px] border-foreground bg-[hsl(var(--sb-peach))] p-6 shadow-[6px_6px_0_0_hsl(var(--foreground))] sm:p-8">
            <Image
              src="/pigeon-mark.png"
              alt=""
              width={919}
              height={621}
              sizes="(min-width:1024px) 460px, 80vw"
              priority
              className="mx-auto w-full max-w-[420px]"
            />
          </div>
        </div>
      </div>

      <div className="border-t-[3px] border-foreground bg-foreground text-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
          {TICKER.map((t) => (
            <span key={t} className="font-display text-[12px] font-bold tracking-[0.1em]">
              {t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
