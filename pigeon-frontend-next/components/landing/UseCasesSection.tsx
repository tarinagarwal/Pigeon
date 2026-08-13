import { Rocket, Users, LayoutGrid, UserPlus } from "lucide-react";

const useCases = [
  {
    icon: Rocket,
    label: "B2B founders",
    title: "Startups & founders",
    pains: "No time or budget for a marketing team. Writing emails manually doesn't scale, and generic templates don't convert.",
    solution: "AI generates personalized campaigns in minutes. Automated follow-ups keep prospects engaged — so you close deals without hiring a team.",
  },
  {
    icon: Users,
    label: "Sales teams",
    title: "Sales teams & SDRs",
    pains: "Generic outreach gets ignored. Manual follow-up takes hours. No visibility into what campaigns actually drive pipeline.",
    solution: "AI personalizes every email at scale. Automated sequences run 24/7. Real-time analytics show exactly what converts so you can optimize fast.",
  },
  {
    icon: LayoutGrid,
    label: "Agencies",
    title: "Email marketing agencies",
    pains: "Managing campaigns for multiple clients across different tools is slow, expensive, and hard to report on.",
    solution: "Run all client campaigns from one dashboard. AI creates and personalizes campaigns per client. One login, unified analytics, white-label ready.",
  },
  {
    icon: UserPlus,
    label: "Lead gen consultants",
    title: "Lead gen consultants",
    pains: "Margins shrink when you spend hours writing emails and chasing leads manually for every client.",
    solution: "AI builds the campaigns, automation handles follow-ups, and the unified inbox captures every reply — so you scale results without scaling hours.",
  },
];

export function UseCasesSection() {
  return (
    <section
      id="use-cases"
      className="py-14 lg:py-20 marketing-band"
      aria-labelledby="use-cases-heading"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">
        <div className="text-center max-w-3xl mx-auto mb-10 lg:mb-14">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/25 bg-primary/8 text-primary text-[11px] font-black uppercase tracking-[0.1em] mb-5">
            Use cases
          </div>
          <h2
            id="use-cases-heading"
            className="text-3xl sm:text-4xl lg:text-5xl font-black mb-6 leading-tight"
          >
            AI email marketing
            <span className="block mt-0.5 bg-gradient-to-r from-primary via-primary/85 to-accent bg-clip-text text-transparent">
              built for your business
            </span>
          </h2>
          <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed font-medium">
            Whether you're a founder, sales team, agency, or consultant — Pigeon gives you the AI tools to grow revenue through email.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 lg:gap-8">
          {useCases.map((u, i) => (
            <div
              key={i}
              className="p-8 lg:p-10 rounded-2xl border-2 border-border bg-card hover:border-primary/30 hover:shadow-xl transition-all duration-300"
            >
              <span className="inline-block px-4 py-2 rounded-full bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider mb-4">
                {u.label}
              </span>
              <div className="flex items-start gap-4 mb-5">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <u.icon className="w-7 h-7" />
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground mb-2">{u.title}</p>
                  <p className="text-sm text-muted-foreground font-medium leading-relaxed mb-4">
                    <span className="font-semibold text-foreground/90">Challenge: </span>
                    {u.pains}
                  </p>
                  <p className="text-sm text-muted-foreground leading-relaxed font-medium">
                    <span className="font-semibold text-primary">Pigeon: </span>
                    {u.solution}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
