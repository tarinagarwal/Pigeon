import { Sparkles, Zap, RefreshCw, BarChart3, MessageCircle } from "lucide-react";

const benefits = [
  {
    icon: Sparkles,
    title: "AI Campaign Studio",
    copy: "Describe your offer and audience — AI generates your full email sequence, subject lines, and follow-ups in minutes.",
    gradient: "from-primary to-primary/70",
    accent: "cyan",
  },
  {
    icon: Zap,
    title: "Personalized at scale",
    copy: "Every email is uniquely crafted for each contact using AI variations and dynamic fields — at any volume.",
    gradient: "from-primary to-primary/70",
    accent: "violet",
  },
  {
    icon: RefreshCw,
    title: "Automated follow-ups",
    copy: "Multi-step sequences run on autopilot. Never lose a lead to a missed follow-up again.",
    gradient: "from-emerald-500 to-teal-500",
    accent: "emerald",
  },
  {
    icon: BarChart3,
    title: "Real-time analytics",
    copy: "Track campaign performance, conversions, and ROI in one unified dashboard — know exactly what drives revenue.",
    gradient: "from-amber-500 to-orange-500",
    accent: "amber",
  },
  {
    icon: MessageCircle,
    title: "Unified reply inbox",
    copy: "All campaign responses land in one shared inbox — respond faster, close more deals, never miss a hot lead.",
    gradient: "from-rose-500 to-primary/70",
    accent: "rose",
  },
];

export function ValueProposition() {
  return (
    <section
      className="py-16 lg:py-24 marketing-band-subtle"
      aria-labelledby="value-prop-heading"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">

        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-12 lg:mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/25 bg-primary/8 text-primary text-[11px] font-black uppercase tracking-[0.1em] mb-5">
            Why Pigeon
          </div>
          <h2
            id="value-prop-heading"
            className="text-4xl sm:text-5xl lg:text-[3rem] font-black leading-[1.1] tracking-[-0.03em] mb-4"
          >
            Everything you need to
            <span className="block mt-1 bg-gradient-to-r from-primary via-primary/85 to-primary/70 bg-clip-text text-transparent">
              grow with email marketing.
            </span>
          </h2>
          <p className="text-lg text-muted-foreground font-medium leading-relaxed">
            AI campaigns, personalization, automation, and analytics — everything your email marketing needs, in one powerful platform.
          </p>
        </div>

        {/* Cards: 2-col then 3-col */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-6">
          {benefits.map((b, i) => {
            const Icon = b.icon;
            return (
              <div
                key={i}
                className="group relative rounded-2xl border border-border/60 bg-card/80 p-7 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 overflow-hidden"
              >
                {/* Hover glow bg */}
                <div className={`absolute inset-0 bg-gradient-to-br ${b.gradient} opacity-0 group-hover:opacity-[0.04] transition-opacity duration-300 pointer-events-none`} />

                {/* Icon */}
                <div
                  className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${b.gradient} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300 shadow-lg`}
                >
                  <Icon className="w-7 h-7 text-white" />
                </div>

                <p className="text-lg font-bold text-foreground mb-2.5 leading-snug">{b.title}</p>
                <p className="text-[13px] text-muted-foreground leading-relaxed font-medium">{b.copy}</p>
              </div>
            );
          })}

          {/* Stat card — fills 6th spot in the grid */}
          <div className="relative rounded-2xl overflow-hidden border border-primary/20 bg-gradient-to-br from-primary/8 via-primary/5 to-transparent p-7 flex flex-col justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.12em] text-primary mb-4">In numbers</p>
              <div className="space-y-4">
                {[
                  { value: "10×",  label: "More conversions" },
                  { value: "3×",   label: "Average ROI on campaigns" },
                  { value: "100%", label: "Personalized emails" },
                ].map((s) => (
                  <div key={s.label} className="flex items-baseline gap-2">
                    <span className="text-2xl font-black bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">{s.value}</span>
                    <span className="text-[13px] text-muted-foreground font-medium">{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
