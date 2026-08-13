import Link from "next/link";
import { SITE_FAQS } from "@/lib/site-knowledge";

/** Same source as the FAQPage JSON-LD, so copy and structured data can't drift. */
export function HomeFaq() {
  return (
    <section className="border-b-[3px] border-foreground bg-background">
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <h2 className="font-display text-3xl font-black text-foreground sm:text-5xl">Questions.</h2>

        <div className="mt-12 flex flex-col gap-5">
          {SITE_FAQS.map((f) => (
            <div
              key={f.question}
              className="rounded-3xl border-[3px] border-foreground bg-card p-6 shadow-[5px_5px_0_0_hsl(var(--foreground))] sm:p-7"
            >
              <h3 className="font-display text-[1.1rem] font-black leading-snug text-foreground">
                {f.question}
              </h3>
              <p className="mt-2.5 text-[14.5px] leading-relaxed text-foreground/70">{f.answer}</p>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-[14px] text-foreground/70">
          Something else?{" "}
          <Link href="/contact" className="font-bold text-primary underline underline-offset-4">
            Ask us →
          </Link>
        </p>
      </div>
    </section>
  );
}
