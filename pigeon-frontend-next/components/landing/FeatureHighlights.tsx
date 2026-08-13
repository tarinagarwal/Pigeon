import { Sparkles, Zap, RefreshCw, BarChart3, MessageCircle, Send, Target } from "lucide-react";

const FEATURES = [
  {
    icon: Sparkles,
    feature: "AI Campaign Studio",
    outcome: "Create AI email campaigns in minutes",
    desc: "Describe your offer and target audience — AI drafts your full campaign, subject lines, and follow-ups instantly.",
    gradient: "from-primary to-primary/70",
    glow: "shadow-primary/20",
    size: "lg",
  },
  {
    icon: Zap,
    feature: "Email personalization at scale",
    outcome: "Every email feels individually written",
    desc: "Per-contact AI variations, merge fields, and dynamic content make each recipient feel like the email was written just for them.",
    gradient: "from-primary to-primary/70",
    glow: "shadow-primary/20",
    size: "lg",
  },
  {
    icon: RefreshCw,
    feature: "Automated follow-up sequences",
    outcome: "Never lose a lead to a missed follow-up",
    desc: "Build multi-step sequences that run on autopilot — the right message, at the right time, every time.",
    gradient: "from-emerald-500 to-teal-500",
    glow: "shadow-emerald-500/20",
    size: "sm",
  },
  {
    icon: Target,
    feature: "Inbox placement optimization",
    outcome: "Reach the inbox, not the spam folder",
    desc: "Built-in sending best practices, reputation management, and inbox rotation maximize your deliverability.",
    gradient: "from-primary to-primary/70",
    glow: "shadow-primary/20",
    size: "sm",
  },
  {
    icon: Send,
    feature: "Multi-step email workflows",
    outcome: "Full campaign automation",
    desc: "Design complex email workflows with conditional logic — nurture leads from first touch to closed deal.",
    gradient: "from-amber-500 to-orange-500",
    glow: "shadow-amber-500/20",
    size: "sm",
  },
  {
    icon: MessageCircle,
    feature: "Unified reply inbox",
    outcome: "All replies in one place",
    desc: "Every campaign response lands in one shared inbox — respond faster and never miss a hot prospect.",
    gradient: "from-rose-500 to-primary/70",
    glow: "shadow-rose-500/20",
    size: "sm",
  },
  {
    icon: BarChart3,
    feature: "Real-time analytics",
    outcome: "See exactly what converts",
    desc: "Campaign performance, conversions, and ROI in one dashboard — optimize what works and drop what doesn't.",
    gradient: "from-teal-500 to-emerald-500",
    glow: "shadow-teal-500/20",
    size: "sm",
  },
];

function FeatureCard({
  f,
  large = false,
}: {
  f: (typeof FEATURES)[number];
  large?: boolean;
}) {
  const Icon = f.icon;
  return (
    <div className={`group relative rounded-2xl border border-border/60 bg-card/80 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 overflow-hidden ${large ? "p-8" : "p-6"}`}>
      {/* Hover glow */}
      <div className={`absolute inset-0 bg-gradient-to-br ${f.gradient} opacity-0 group-hover:opacity-[0.04] transition-opacity duration-300 pointer-events-none`} />

      <div
        className={`flex items-center justify-center rounded-2xl bg-gradient-to-br ${f.gradient} shadow-lg ${f.glow} mb-5 group-hover:scale-110 transition-transform duration-300 ${large ? "w-14 h-14" : "w-11 h-11"}`}
      >
        <Icon className={`text-white ${large ? "w-7 h-7" : "w-5 h-5"}`} />
      </div>

      <p className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-[0.12em] mb-1.5">
        {f.feature}
      </p>
      <p className={`font-bold text-foreground leading-snug mb-2 ${large ? "text-xl" : "text-base"}`}>
        {f.outcome}
      </p>
      <p className={`text-muted-foreground leading-relaxed ${large ? "text-sm" : "text-[13px]"}`}>
        {f.desc}
      </p>
    </div>
  );
}

export function FeatureHighlights() {
  const large = FEATURES.filter((f) => f.size === "lg");
  const small = FEATURES.filter((f) => f.size === "sm");

  return (
    <section
      id="features"
      className="py-16 lg:py-24 marketing-band-subtle"
      aria-labelledby="features-heading"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">

        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-12 lg:mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/25 bg-primary/8 text-primary text-[11px] font-black uppercase tracking-[0.1em] mb-5">
            Features
          </div>
          <h2
            id="features-heading"
            className="text-4xl sm:text-5xl lg:text-[3rem] font-black leading-[1.1] tracking-[-0.03em] mb-4"
          >
            Create AI-powered email campaigns
            <span className="block mt-1 bg-gradient-to-r from-primary via-primary/85 to-primary/70 bg-clip-text text-transparent">
              that convert.
            </span>
          </h2>
          <p className="text-lg text-muted-foreground font-medium leading-relaxed">
            AI writing, personalization, automation, and analytics — one platform covers every step of your email marketing workflow.
          </p>
        </div>

        {/* Bento grid */}
        <div className="space-y-4 lg:space-y-5">
          {/* Row 1: two large cards */}
          <div className="grid sm:grid-cols-2 gap-4 lg:gap-5">
            {large.map((f, i) => (
              <FeatureCard key={i} f={f} large />
            ))}
          </div>

          {/* Row 2: five small cards */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4 lg:gap-5">
            {small.map((f, i) => (
              <FeatureCard key={i} f={f} />
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}
