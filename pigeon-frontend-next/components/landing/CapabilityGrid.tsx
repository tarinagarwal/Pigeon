import Link from "next/link";

const CAPS: [string, string][] = [
  ["Sequences & A/B", "Multi-step follow-ups, template variants per step, auto-selected winner."],
  ["Warm-up", "Threaded conversations, spam-folder rescue, pairing risk scoring."],
  ["Deliverability", "SPF / DKIM / DMARC automation, health scoring, inbox-placement tests."],
  ["AI writing", "Per-recipient copy at send time with your own model key."],
  ["Lead discovery", "Search, scrape and verify prospects into a ready list."],
  ["Analytics", "Opens, clicks and replies by campaign, inbox and hour."],
  ["Unified inbox", "Every reply across every mailbox in one thread view."],
  ["Workflows", "Visual automation on triggers, conditions and waits."],
];

export function CapabilityGrid() {
  return (
    <section className="border-b-[3px] border-foreground bg-[hsl(var(--sb-cream))]">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <h2 className="font-display text-3xl font-black leading-[1.02] text-foreground sm:text-5xl">
            Everything included.
          </h2>
          <Link
            href="/features"
            className="font-display rounded-2xl border-[3px] border-foreground bg-card px-6 py-3 text-[14px] font-bold text-foreground shadow-[5px_5px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[2px_2px_0_0_hsl(var(--foreground))]"
          >
            All 20 features →
          </Link>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {CAPS.map(([t, d]) => (
            <div
              key={t}
              className="rounded-3xl border-[3px] border-foreground bg-card p-6 shadow-[5px_5px_0_0_hsl(var(--foreground))]"
            >
              <h3 className="font-display text-[1.1rem] font-black text-foreground">{t}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-foreground/70">{d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
