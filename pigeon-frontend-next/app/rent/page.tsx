import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";

export const metadata: Metadata = {
  title: "Rent & Earn — Pigeon",
  description:
    "List inboxes you already own and earn credits when they receive warm-up mail, or spend credits to reach verified inboxes. Free to join, withdraw to bank or UPI.",
};

const TICKER = ["FREE TO JOIN", "1 CREDIT PER USE", "48-HOUR HOLD", "WITHDRAW TO BANK OR UPI"];

const STEPS = [
  {
    p: "peach",
    t: "List an inbox",
    d: "Add an address you own. We check its MX records, detect the provider and email you a code to prove ownership.",
  },
  {
    p: "mint",
    t: "It gets rented",
    d: "Members send warm-up mail to your address, capped by the daily receive limit you set. You earn one credit per use.",
  },
  {
    p: "lilac",
    t: "Earnings settle",
    d: "Credits sit under a 48-hour hold, then release. If the sender got no engagement, they're refunded instead — nobody pays for nothing.",
  },
  {
    p: "butter",
    t: "Cash out",
    d: "Withdraw to a bank account or UPI once you clear 500 credits. A flat 10% platform fee is deducted.",
  },
] as const;

const SIDES = [
  {
    p: "mint",
    tag: "Earn",
    title: "You already own the inboxes.",
    body: "Every address you control is idle capacity. List it, set how much mail it should receive per day, and let it earn while you do nothing.",
    points: ["Set your own daily receive cap", "Pause or remove a listing anytime", "Track every credit in one ledger"],
  },
  {
    p: "peach",
    tag: "Rent",
    title: "Reach real, verified inboxes.",
    body: "Spend credits to route warm-up mail through inboxes owned by other members — real addresses on real providers, not a synthetic pool.",
    points: ["Filter the marketplace by provider", "One credit per send", "Refunded if there's no engagement"],
  },
] as const;

const FAQS = [
  {
    q: "Is this the same account as Pigeon?",
    a: "No. Rent & Earn is a separate portal with its own email and password. Your main Pigeon account and this one are completely independent.",
  },
  {
    q: "What does it cost to join?",
    a: "Nothing. Listing inboxes is free and you start earning as soon as your first listing is verified and rented.",
  },
  {
    q: "How much can one inbox earn?",
    a: "It depends on the daily receive limit you set and how often the marketplace rents it. Each use is worth one credit.",
  },
  {
    q: "When can I withdraw?",
    a: "Once your available balance clears 500 credits. Payouts go to a bank account or UPI, with a flat 10% platform and transaction fee.",
  },
];

function RentNav() {
  return (
    <header className="sticky top-0 z-50 border-b-[3px] border-foreground bg-[hsl(var(--sb-cream))]">
      <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/rent" className="flex items-center gap-2.5">
          <Image
            src="/rent-mark.png"
            alt=""
            width={1129}
            height={957}
            sizes="80px"
            priority
            className="h-10 w-auto"
          />
          <span className="font-display text-[1.35rem] font-black leading-none text-foreground">
            Rent&nbsp;&amp;&nbsp;Earn
          </span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/"
            className="font-display hidden rounded-full border-[3px] border-transparent px-4 py-1.5 text-[13px] font-bold text-foreground/70 hover:border-foreground hover:text-foreground sm:block"
          >
            Pigeon
          </Link>
          <Link
            href="/rent/login"
            className="font-display rounded-full border-[3px] border-transparent px-4 py-1.5 text-[13px] font-bold text-foreground/70 hover:border-foreground hover:text-foreground"
          >
            Sign in
          </Link>
          <Link
            href="/rent/signup"
            className="font-display rounded-2xl border-[3px] border-foreground bg-primary px-5 py-2.5 text-[13px] font-bold text-primary-foreground shadow-[4px_4px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_hsl(var(--foreground))]"
          >
            Join free
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function RentLandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <RentNav />

      {/* ── Hero ── */}
      <section className="border-b-[3px] border-foreground bg-[hsl(var(--sb-cream))]">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
          <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-14">
            <div>
              <span className="font-display inline-block rounded-full border-[3px] border-foreground bg-[hsl(var(--sb-butter))] px-4 py-1.5 text-[12px] font-bold uppercase tracking-[0.1em] text-foreground">
                Free to join
              </span>

              <h1 className="font-display mt-6 text-[2.9rem] font-black leading-[0.95] text-foreground sm:text-[4.2rem] lg:text-[4.5rem]">
                Your inbox
                <span className="mt-2 block">
                  <span className="inline-block rounded-2xl border-[3px] border-foreground bg-primary px-3 py-0.5 text-primary-foreground shadow-[5px_5px_0_0_hsl(var(--foreground))]">
                    can earn.
                  </span>
                </span>
              </h1>

              <p className="mt-7 max-w-lg text-[16.5px] leading-relaxed text-foreground/75">
                List email addresses you already own and collect credits every time they receive
                warm-up mail. Or spend credits to reach verified inboxes of your own.
              </p>

              <div className="mt-9 flex flex-col gap-4 sm:flex-row">
                <Link
                  href="/rent/signup"
                  className="font-display inline-flex items-center justify-center rounded-2xl border-[3px] border-foreground bg-primary px-8 py-4 text-[15px] font-bold text-primary-foreground shadow-[6px_6px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[3px_3px_0_0_hsl(var(--foreground))]"
                >
                  Start earning →
                </Link>
                <Link
                  href="/rent/login"
                  className="font-display inline-flex items-center justify-center rounded-2xl border-[3px] border-foreground bg-card px-8 py-4 text-[15px] font-bold text-foreground shadow-[6px_6px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[3px_3px_0_0_hsl(var(--foreground))]"
                >
                  Sign in
                </Link>
              </div>
            </div>

            <div className="rounded-3xl border-[3px] border-foreground bg-[hsl(var(--sb-mint))] p-6 shadow-[6px_6px_0_0_hsl(var(--foreground))] sm:p-8">
              <Image
                src="/rent-mark.png"
                alt=""
                width={1129}
                height={957}
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

      {/* ── How it works ── */}
      <section className="border-b-[3px] border-foreground bg-background">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <h2 className="font-display text-3xl font-black leading-[1.02] text-foreground sm:text-5xl">
            Four steps.
            <br />
            <span className="text-foreground/45">Then it runs itself.</span>
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

      {/* ── Two sides ── */}
      <section className="border-b-[3px] border-foreground bg-[hsl(var(--sb-cream))]">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <h2 className="font-display text-3xl font-black leading-[1.02] text-foreground sm:text-5xl">
            Two ways to use it.
          </h2>

          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            {SIDES.map((s) => (
              <div
                key={s.tag}
                className="rounded-3xl border-[3px] border-foreground p-8 shadow-[6px_6px_0_0_hsl(var(--foreground))]"
                style={{ background: `hsl(var(--sb-${s.p}))` }}
              >
                <span className="font-display inline-block rounded-full border-[3px] border-foreground bg-background px-4 py-1 text-[12px] font-bold uppercase tracking-[0.1em] text-foreground">
                  {s.tag}
                </span>
                <h3 className="font-display mt-5 text-2xl font-black leading-tight text-foreground">
                  {s.title}
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-foreground/75">{s.body}</p>
                <ul className="mt-5 flex flex-col gap-2.5">
                  {s.points.map((pt) => (
                    <li key={pt} className="flex items-start gap-2.5 text-[14px] text-foreground/80">
                      <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full border-2 border-foreground bg-background" />
                      {pt}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="border-b-[3px] border-foreground bg-background">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <h2 className="font-display text-3xl font-black text-foreground sm:text-5xl">Questions.</h2>
          <div className="mt-12 flex flex-col gap-5">
            {FAQS.map((f) => (
              <div
                key={f.q}
                className="rounded-3xl border-[3px] border-foreground bg-card p-6 shadow-[5px_5px_0_0_hsl(var(--foreground))] sm:p-7"
              >
                <h3 className="font-display text-[1.1rem] font-black leading-snug text-foreground">
                  {f.q}
                </h3>
                <p className="mt-2.5 text-[14.5px] leading-relaxed text-foreground/70">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Closing ── */}
      <section className="border-b-[3px] border-foreground bg-[hsl(var(--sb-lilac))]">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <h2 className="font-display max-w-3xl text-4xl font-black leading-[0.98] text-foreground sm:text-6xl">
            Free to join.
            <br />
            Paid to participate.
          </h2>
          <p className="mt-6 max-w-xl text-[15.5px] leading-relaxed text-foreground/70">
            Create an account, verify one inbox, and you&rsquo;re earning. No subscription, no
            minimum commitment, and you can pause a listing whenever you like.
          </p>
          <div className="mt-9 flex flex-col gap-4 sm:flex-row">
            <Link
              href="/rent/signup"
              className="font-display inline-flex items-center justify-center rounded-2xl border-[3px] border-foreground bg-primary px-8 py-4 text-[15px] font-bold text-primary-foreground shadow-[6px_6px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[3px_3px_0_0_hsl(var(--foreground))]"
            >
              Create free account →
            </Link>
            <Link
              href="/"
              className="font-display inline-flex items-center justify-center rounded-2xl border-[3px] border-foreground bg-card px-8 py-4 text-[15px] font-bold text-foreground shadow-[6px_6px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[3px_3px_0_0_hsl(var(--foreground))]"
            >
              Back to Pigeon
            </Link>
          </div>
        </div>
      </section>

      <footer className="bg-background">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p className="text-[13px] text-foreground/60">
            © {new Date().getFullYear()} Pigeon · Rent &amp; Earn
          </p>
          <Link href="/" className="font-display text-[14px] font-bold text-foreground hover:underline">
            Back to Pigeon →
          </Link>
        </div>
      </footer>
    </div>
  );
}
