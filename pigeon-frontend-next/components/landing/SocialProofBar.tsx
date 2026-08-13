"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

const LOGOS = [
  "Salesforce", "HubSpot", "Pipedrive", "Zapier",
  "Slack", "Google Workspace", "Apollo", "Outreach",
  "Salesforce", "HubSpot", "Pipedrive", "Zapier",
  "Slack", "Google Workspace", "Apollo", "Outreach",
];

export function SocialProofBar() {
  return (
    <div className="border-y border-border/50 bg-muted/20 backdrop-blur-sm overflow-hidden">
      {/* Top strip: "Trusted by" + animated logo ticker */}
      <div className="py-4 border-b border-border/30">
        <div className="flex items-center gap-4 px-6 mb-3">
          <span className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/60 shrink-0 mx-auto">
            Trusted by teams using
          </span>
        </div>
        <div className="relative">
          {/* Fade edges */}
          <div className="absolute left-0 top-0 bottom-0 w-20 z-10 pointer-events-none bg-gradient-to-r from-background to-transparent" />
          <div className="absolute right-0 top-0 bottom-0 w-20 z-10 pointer-events-none bg-gradient-to-l from-background to-transparent" />

          <div className="flex gap-3 animate-marquee whitespace-nowrap">
            {LOGOS.map((name, i) => (
              <div
                key={i}
                className="inline-flex items-center px-5 py-2 rounded-lg bg-muted/50 border border-border/50 text-muted-foreground/70 font-semibold text-[12px] shrink-0 hover:text-foreground hover:border-border transition-colors"
              >
                {name}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom strip: CTA */}
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 py-3">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <p className="text-sm font-semibold text-foreground text-center sm:text-left">
              Join <span className="text-primary font-black">5,247+</span> teams scaling cold outreach without spam
            </p>
          </div>
          <Link
            href="/login"
            className="shrink-0 group"
            onClick={() =>
              import("@/lib/marketingAnalytics").then((m) =>
                m.trackCtaClick("social_proof_bar_book_demo")
              )
            }
          >
            <button
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl font-bold text-[13px] text-white transition-all duration-200 hover:scale-[1.03] hover:shadow-lg"
              style={{
                background: "linear-gradient(135deg, #ea580c 0%, #c2410c 100%)",
                boxShadow: "0 4px 14px rgba(6,182,212,0.28)",
              }}
            >
              Book a demo
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}
