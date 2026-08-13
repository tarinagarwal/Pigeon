const STEPS = [
  { p: "peach", t: "Connect mailboxes", d: "Gmail and Outlook over OAuth, or any SMTP host. Add a domain and SPF, DKIM and DMARC get written straight to your DNS provider." },
  { p: "mint", t: "Warm them up", d: "Multi-turn conversations build reputation before you send cold. Engagement targets 30–50%, and a risk scorer blocks pairings that look artificial." },
  { p: "lilac", t: "Launch sequences", d: "Multi-step campaigns with A/B variants per step, rotation across every inbox, send windows by timezone, and ramp-up scaled to mailbox age." },
  { p: "butter", t: "Work the replies", d: "Every response lands in one threaded inbox. Follow-ups stop the moment someone answers." },
] as const;

export function HowItWorks() {
  return (
    <section className="border-b-[3px] border-foreground bg-background">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <h2 className="font-display text-3xl font-black leading-[1.02] text-foreground sm:text-5xl">
          Four steps.
          <br />
          <span className="text-foreground/45">That&rsquo;s the whole setup.</span>
        </h2>

        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {STEPS.map((s, i) => (
            <div
              key={s.t}
              className="rounded-3xl border-[3px] border-foreground p-7 shadow-[6px_6px_0_0_hsl(var(--foreground))] sm:p-8"
              style={{ background: `hsl(var(--sb-${s.p}))` }}
            >
              <span className="font-display inline-flex h-9 w-9 items-center justify-center rounded-full border-[3px] border-foreground bg-background text-[13px] font-black tabular-nums text-foreground">
                {i + 1}
              </span>
              <h3 className="font-display mt-4 text-xl font-black text-foreground">{s.t}</h3>
              <p className="mt-2.5 text-[14.5px] leading-relaxed text-foreground/70">{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
