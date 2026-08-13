"use client";

import { useEffect } from "react";

export function BadgesSection() {
  useEffect(() => {
    const load = (src: string) => {
      if (document.querySelector(`script[src="${src}"]`)) return;
      const sc = document.createElement("script");
      sc.async = true;
      sc.src = src;
      const p = document.getElementsByTagName("script")[0];
      p.parentNode?.insertBefore(sc, p);
    };
    load("https://b.sf-syn.com/badge_js?sf_id=4097466&variant_id=sf");
    load("https://b.sf-syn.com/badge_js?sf_id=4097466&variant_id=tbs");
  }, []);

  return (
    <section
      aria-label="Awards and recognition"
      className="py-12 lg:py-16 border-t border-border/40"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">

        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground/40 text-center mb-8">
          Awards &amp; recognition
        </p>

        <div className="rounded-2xl border border-border/50 bg-muted/10 px-6 py-8 lg:px-12 flex flex-col gap-7">

          {/* Row 1 — flat/rectangular badges */}
          <div className="flex flex-wrap justify-center items-center gap-x-8 gap-y-5 lg:gap-x-12">

            {/* Dang.ai */}
            <a
              href="https://dang.ai/"
              target="_blank"
              rel="noopener noreferrer"
              className="opacity-80 hover:opacity-100 hover:scale-[1.04] transition-all duration-200 flex items-center"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://cdn.prod.website-files.com/63d8afd87da01fb58ea3fbcb/6487e2868c6c8f93b4828827_dang-badge.png"
                alt="Dang.ai"
                width={150}
                height={54}
                style={{ width: 150, height: 54 }}
                loading="lazy"
              />
            </a>

            {/* Product Hunt */}
            <a
              href="https://www.producthunt.com/products/pigeon-ai/reviews/new?utm_source=badge-product_review&utm_medium=badge&utm_souce=badge-pigeon-ai"
              target="_blank"
              rel="noopener noreferrer"
              className="opacity-80 hover:opacity-100 hover:scale-[1.04] transition-all duration-200 flex items-center"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://api.producthunt.com/widgets/embed-image/v1/product_review.svg?product_id=1157961&theme=light"
                alt="Pigeon AI - Stop Landing in Spam. Start Getting Replies. | Product Hunt"
                width={250}
                height={54}
                style={{ width: 250, height: 54 }}
                loading="lazy"
              />
            </a>

            {/* NextGen Tools */}
            <a
              href="https://www.nxgntools.com/tools/pigeon-ai?utm_source=pigeon-ai"
              target="_blank"
              rel="noopener noreferrer"
              className="opacity-80 hover:opacity-100 hover:scale-[1.04] transition-all duration-200 flex items-center"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://www.nxgntools.com/api/embed/pigeon-ai?type=FEATURED_ON&hideUpvotes=true"
                alt="Featured on NextGen Tools"
                style={{ height: 48, width: "auto" }}
                loading="lazy"
              />
            </a>

          </div>

          {/* Divider */}
          <div className="w-full h-px bg-border/40" />

          {/* Row 2 — emblem/shield badges (SoftwareSuggest + SourceForge + TBS) */}
          <div className="flex flex-wrap justify-center items-center gap-x-10 gap-y-5">

            {/* SoftwareSuggest */}
            <a
              href="https://www.softwaresuggest.com/pigeon-ai"
              target="_blank"
              rel="noopener noreferrer"
              className="opacity-80 hover:opacity-100 hover:scale-[1.04] transition-all duration-200 flex items-center"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://www.softwaresuggest.com/award_logo/highly-recommended-winter-2025.png"
                alt="Highly Recommended – SoftwareSuggest Winter 2025"
                style={{ height: 125, width: "auto" }}
                loading="lazy"
              />
            </a>

            <div
              className="sf-root opacity-80 hover:opacity-100 hover:scale-[1.04] transition-all duration-200"
              data-id="4097466"
              data-badge="customers-love-us-white"
              data-variant-id="sf"
              style={{ width: 125 }}
            >
              <a
                href="https://sourceforge.net/software/product/Pigeon/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground"
              >
                Pigeon Reviews
              </a>
            </div>

            <div
              className="sf-root opacity-80 hover:opacity-100 hover:scale-[1.04] transition-all duration-200"
              data-id="4097466"
              data-badge="most-loved"
              data-variant-id="tbs"
              style={{ width: 125 }}
            >
              <a
                href="https://topbusinesssoftware.com/products/Pigeon/reviews/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground"
              >
                Pigeon Reviews
              </a>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
}
