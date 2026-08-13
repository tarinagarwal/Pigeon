import Link from "next/link";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ArrowRight } from "lucide-react";
import { SITE_FAQS } from "@/lib/site-knowledge";

export function FAQSection() {
  return (
    <section
      id="faq"
      className="py-16 lg:py-24 marketing-band"
      aria-labelledby="faq-heading"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-3xl">

        {/* Header */}
        <div className="text-center mb-10 lg:mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/25 bg-primary/8 text-primary text-[11px] font-black uppercase tracking-[0.1em] mb-5">
            FAQ
          </div>
          <h2
            id="faq-heading"
            className="text-4xl sm:text-5xl font-black tracking-[-0.03em] leading-[1.08] mb-3"
          >
            Common questions
          </h2>
          <p className="text-lg text-muted-foreground font-medium">
            Quick answers to help you get started.
          </p>
        </div>

        {/* Accordion */}
        <div className="rounded-2xl border border-border/60 bg-card/80 overflow-hidden divide-y divide-border/50">
          <Accordion type="single" collapsible className="w-full">
            {SITE_FAQS.map((faq, i) => (
              <AccordionItem
                key={i}
                value={`faq-${i}`}
                className="border-0 px-6 lg:px-8 first:pt-1 last:pb-1"
              >
                <AccordionTrigger className="text-left font-bold text-foreground py-5 hover:no-underline hover:text-primary transition-colors text-[15px] [&>svg]:text-primary">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground font-medium leading-relaxed pb-5 text-[14px]">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        {/* Bottom CTA */}
        <div className="text-center mt-10">
          <p className="text-sm text-muted-foreground mb-4">Still have questions?</p>
          <Link href="/contact">
            <button className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-[14px] text-foreground border border-border/70 bg-card/60 hover:border-primary/40 hover:bg-primary/4 transition-all duration-200 group">
              Contact us
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </Link>
        </div>

      </div>
    </section>
  );
}
