import type { Metadata } from "next";
import Link from "next/link";
import { Check, ArrowRight, Mail } from "lucide-react";
import { JsonLd } from "@/components/seo/JsonLd";
import { SITE_NAME, SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Custom plans for Pigeon, priced to your sending volume and mailbox count. Starts at ₹19,999 per month.",
  alternates: { canonical: `${SITE_URL}/pricing` },
};

const INCLUDED = [
  "Unlimited multi-step campaigns and sequences",
  "Mailbox warm-up with pairing risk scoring",
  "Connect unlimited Gmail, Outlook and SMTP inboxes",
  "SPF, DKIM and DMARC automation across four DNS providers",
  "AI writing, personalization and lead discovery",
  "Unified inbox with reply detection",
  "Workflow automation and full analytics",
  "Custom tracking domains",
  "Team seats with per-page permissions",
  "Onboarding and priority support",
];

export default function PricingPage() {
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: `Pricing | ${SITE_NAME}`,
          description: "Custom plans priced to your sending volume. Starts at ₹19,999 per month.",
          url: `${SITE_URL}/pricing`,
        }}
      />

      <section className="border-b-[3px] border-foreground bg-[hsl(var(--sb-cream))]">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-3xl pt-20 pb-12 text-center">
          <h1 className="font-display text-4xl font-black leading-[1.0] text-foreground text-balance sm:text-6xl">
            One plan, shaped around you.
          </h1>
          <p className="mt-6 text-[17px] leading-relaxed text-foreground/75">
            Pigeon is priced to your sending volume and the number of mailboxes you run — not to a
            seat count. Tell us what you need and we&rsquo;ll put a number on it.
          </p>
        </div>
      </section>

      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-2xl py-16">
        <div className="rounded-3xl border-[3px] border-foreground bg-card p-8 shadow-[8px_8px_0_0_hsl(var(--foreground))] sm:p-10">
          <p className="font-display inline-block rounded-full border-[3px] border-foreground bg-[hsl(var(--sb-butter))] px-4 py-1.5 text-[12px] font-bold uppercase tracking-[0.1em] text-foreground">
            Custom pricing
          </p>

          <div className="mt-5 flex items-end gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground pb-2">Starts at</span>
            <span className="font-display text-5xl font-black text-foreground tabular-nums sm:text-6xl">
              ₹19,999
            </span>
            <span className="text-lg text-muted-foreground pb-2">/month</span>
          </div>

          <p className="mt-4 text-[15px] text-muted-foreground leading-relaxed">
            Final pricing depends on how many inboxes and domains you send from, and your monthly
            volume. Everything below is included at every level.
          </p>

          <div className="mt-8 h-[3px] rounded-full bg-foreground" />

          <ul className="mt-8 flex flex-col gap-3">
            {INCLUDED.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-[14.5px] text-foreground/85">
                <Check className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                {item}
              </li>
            ))}
          </ul>

          <Link href="/contact" className="mt-9 block">
            <button className="font-display inline-flex w-full items-center justify-center gap-2 rounded-2xl border-[3px] border-foreground bg-primary px-7 py-4 text-[15px] font-bold text-primary-foreground shadow-[6px_6px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[3px_3px_0_0_hsl(var(--foreground))]">
              Talk to us
              <ArrowRight className="w-4 h-4" />
            </button>
          </Link>

          <p className="mt-4 text-center text-[13px] text-muted-foreground">
            Accounts are set up by our team — we&rsquo;ll get you sending the same day.
          </p>
        </div>

        <div className="mt-10 flex items-start gap-4 rounded-3xl border-[3px] border-foreground bg-[hsl(var(--sb-mint))] p-6 shadow-[6px_6px_0_0_hsl(var(--foreground))]">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-[3px] border-foreground bg-card">
            <Mail className="w-4.5 h-4.5 text-primary" />
          </div>
          <div>
            <p className="font-display text-[16px] font-black text-foreground">Prefer to run it yourself?</p>
            <p className="mt-1 text-[13.5px] text-muted-foreground leading-relaxed">
              Pigeon is MIT licensed and self-hostable. Everything above is in the open-source
              repository — no licence fee, no seat limits.{" "}
              <Link href="/features" className="text-primary hover:underline">
                See what&rsquo;s included
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
