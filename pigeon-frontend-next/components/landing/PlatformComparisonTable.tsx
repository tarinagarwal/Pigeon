"use client";

import { useMemo, useState } from "react";
import { Search, ExternalLink, ChevronDown } from "lucide-react";
import { COLD_EMAIL_PLATFORMS } from "@/lib/coldEmailPlatforms";

const INITIAL_VISIBLE = 12;

/** Group the many raw categories into a few brutal buckets for filtering. */
function bucketOf(category: string): string {
  const c = category.toLowerCase();
  if (c.includes("warm-up") || c.includes("warmup")) return "Warm-up";
  if (c.includes("verification") || c.includes("enrichment") || c.includes("finder") || c.includes("testing"))
    return "Data / Verification";
  if (c.includes("infrastructure")) return "Infrastructure";
  if (c.includes("sdr") || c.includes("gtm") || c.includes("copilot") || c.includes("ai)"))
    return "AI SDR / GTM";
  if (c.includes("engagement") || c.includes("multichannel")) return "Sales Engagement";
  return "Cold Email";
}

const FILTERS = [
  "All",
  "Cold Email",
  "Warm-up",
  "Infrastructure",
  "AI SDR / GTM",
  "Sales Engagement",
  "Data / Verification",
] as const;

export function PlatformComparisonTable() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [expanded, setExpanded] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return COLD_EMAIL_PLATFORMS.filter((p) => {
      const inFilter = filter === "All" || bucketOf(p.category) === filter;
      const inQuery =
        !q ||
        p.platform.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.claim.toLowerCase().includes(q);
      return inFilter && inQuery;
    });
  }, [query, filter]);

  const visible = expanded ? rows : rows.slice(0, INITIAL_VISIBLE);

  return (
    <section className="py-16 lg:py-24 relative overflow-hidden bg-background" aria-labelledby="platforms-heading">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl relative z-10">

        {/* Header */}
        <div className="max-w-3xl mx-auto text-center mb-10">
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-muted/50 text-foreground/80 text-[11px] font-black uppercase tracking-[0.12em]">
            The landscape · {COLD_EMAIL_PLATFORMS.length} platforms
          </span>
          <h2
            id="platforms-heading"
            className="mt-5 text-4xl sm:text-5xl font-black tracking-[-0.03em] leading-[1.05] text-foreground"
          >
            {COLD_EMAIL_PLATFORMS.length} tools. One promise.
            <span className="block mt-2 text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-orange-500">
              Zero of them fix the real problem.
            </span>
          </h2>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
            We catalogued the outbound/GTM market — every warm-up network, deliverability &ldquo;stack,&rdquo; AI SDR, and
            infrastructure vendor. Read the claims in their own words. Notice they&rsquo;re all selling the same thing:
            get more email <span className="text-foreground/90 font-semibold">out</span> — never a reason for anyone to want it
            <span className="text-foreground/90 font-semibold"> in</span>.
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search 38 platforms — try “warm-up”, “deliverability”, “98%”…"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-card text-[14px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40"
            />
          </div>
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-2 mb-6">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                setFilter(f);
                setExpanded(false);
              }}
              className={`px-3 py-1.5 rounded-full text-[12.5px] font-semibold border transition-all duration-150 ${
                filter === f
                  ? "bg-foreground text-background border-foreground"
                  : "bg-card text-foreground/75 border-border hover:border-foreground/30 hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left border-collapse">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="py-3 px-4 text-[11px] font-black uppercase tracking-wider text-muted-foreground w-10">#</th>
                  <th className="py-3 px-4 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Platform</th>
                  <th className="py-3 px-4 text-[11px] font-black uppercase tracking-wider text-muted-foreground whitespace-nowrap">Category</th>
                  <th className="py-3 px-4 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Their deliverability / GTM claim</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id} className="border-b border-border/60 last:border-b-0 hover:bg-muted/30 transition-colors align-top">
                    <td className="py-3.5 px-4 text-[12px] font-mono text-muted-foreground/70 tabular-nums">{p.id}</td>
                    <td className="py-3.5 px-4">
                      <a
                        href={p.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 font-bold text-[13.5px] text-foreground hover:text-primary transition-colors whitespace-nowrap"
                      >
                        {p.platform}
                        <ExternalLink className="w-3 h-3 opacity-40" />
                      </a>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold bg-muted border border-border text-muted-foreground whitespace-nowrap">
                        {bucketOf(p.category)}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-[13px] text-muted-foreground leading-snug max-w-md">{p.claim}</td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-muted-foreground text-sm">
                      No platforms match &ldquo;{query}&rdquo;.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Show more / less */}
          {rows.length > INITIAL_VISIBLE && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="w-full py-3 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-foreground/80 hover:text-foreground bg-muted/30 hover:bg-muted/50 border-t border-border transition-colors"
            >
              {expanded ? "Show fewer" : `Show all ${rows.length}`}
              <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>

        <p className="mt-4 text-center text-[12px] text-muted-foreground/70">
          Showing {visible.length} of {rows.length}
          {filter !== "All" ? ` in ${filter}` : ""}. Claims are each vendor&rsquo;s own marketing language, sourced from the
          cited article. Listing ≠ endorsement.
        </p>
      </div>
    </section>
  );
}
