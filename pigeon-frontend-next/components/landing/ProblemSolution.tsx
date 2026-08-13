const problems = [
  { title: "Generic batch-and-blast emails",       stat: "Low conversions and poor ROI — your emails blend in and get ignored" },
  { title: "Manual follow-up for every lead",      stat: "Leads go cold when you forget to follow up — revenue slips through the cracks" },
  { title: "No personalization at scale",          stat: "Writing individual emails takes hours — so you send the same template to everyone" },
];

const solutions = [
  { title: "AI creates campaigns in minutes",     desc: "Describe your offer and audience — AI drafts personalized email sequences ready to send." },
  { title: "Automated follow-ups on autopilot",   desc: "Multi-step sequences run automatically, so every lead gets the right message at the right time." },
  { title: "Personalized for every contact",      desc: "Per-contact AI variations make every email feel individually written, even at scale." },
  { title: "Analytics to see what converts",      desc: "Real-time campaign performance and conversions in one dashboard — optimize what drives revenue." },
];

export function ProblemSolution() {
  return (
    <section
      className="py-16 lg:py-24 relative overflow-hidden marketing-band"
      aria-labelledby="problem-solution-heading"
    >
      {/* Subtle bg glows */}
      <div className="absolute top-1/3 -left-48 w-80 h-80 rounded-full blur-3xl pointer-events-none bg-red-500/6 dark:bg-red-500/10" />
      <div className="absolute bottom-1/3 -right-48 w-80 h-80 rounded-full blur-3xl pointer-events-none bg-emerald-500/6 dark:bg-emerald-500/10" />

      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl relative z-10">

        {/* Section label */}
        <div className="flex justify-center mb-4">
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/25 bg-primary/8 text-primary text-[11px] font-black uppercase tracking-[0.1em]">
            The old way vs. the AI way
          </span>
        </div>

        {/* Headline */}
        <div className="text-center max-w-2xl mx-auto mb-12 lg:mb-16">
          <h2
            id="problem-solution-heading"
            className="text-4xl sm:text-5xl lg:text-[3.2rem] font-black leading-[1.08] tracking-[-0.03em] mb-4"
          >
            Email marketing without AI
            <span className="block mt-1 bg-gradient-to-r from-primary via-primary/85 to-primary/70 bg-clip-text text-transparent">
              is leaving money on the table.
            </span>
          </h2>
          <p className="text-lg text-muted-foreground font-medium leading-relaxed">
            Most teams send the same template to everyone and wonder why conversions are low. Pigeon uses AI to personalize, automate, and optimize every campaign.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-6 lg:gap-8">

          {/* ── PROBLEM panel ── */}
          <div className="relative group">
            <div className="absolute -inset-px rounded-2xl bg-gradient-to-br from-red-500/40 to-rose-600/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
            <div className="relative rounded-2xl border border-red-500/25 bg-card/90 p-8 lg:p-10 overflow-hidden">
              {/* Corner accent */}
              <div className="absolute top-0 right-0 w-32 h-32 rounded-bl-[4rem] bg-gradient-to-bl from-red-500/8 to-transparent pointer-events-none" />

              {/* Label */}
              <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 rounded-xl bg-red-500/12 border border-red-500/20 flex items-center justify-center text-lg">
                  ⚠️
                </div>
                <span className="px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-500 dark:text-red-400 text-[10px] font-black uppercase tracking-widest">
                  Without Pigeon
                </span>
              </div>

              <ul className="space-y-6">
                {problems.map((p, i) => (
                  <li key={i} className="flex gap-4">
                    <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-red-500 dark:text-red-400 font-black text-base leading-none">✕</span>
                    </div>
                    <div>
                      <p className="font-bold text-base text-foreground mb-1">{p.title}</p>
                      <p className="text-sm text-muted-foreground font-medium leading-snug">{p.stat}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* ── SOLUTION panel ── */}
          <div className="relative group">
            <div className="absolute -inset-px rounded-2xl bg-gradient-to-br from-emerald-500/40 to-teal-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
            <div className="relative rounded-2xl border border-emerald-500/25 bg-card/90 p-8 lg:p-10 overflow-hidden">
              {/* Corner accent */}
              <div className="absolute top-0 right-0 w-32 h-32 rounded-bl-[4rem] bg-gradient-to-bl from-emerald-500/8 to-transparent pointer-events-none" />

              {/* Label */}
              <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/12 border border-emerald-500/20 flex items-center justify-center text-lg">
                  ✨
                </div>
                <span className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase tracking-widest">
                  With Pigeon
                </span>
              </div>

              <ul className="space-y-5">
                {solutions.map((s, i) => (
                  <li key={i} className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-md shadow-emerald-500/20">
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-bold text-base text-foreground mb-0.5">{s.title}</p>
                      <p className="text-sm text-muted-foreground font-medium leading-snug">{s.desc}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
