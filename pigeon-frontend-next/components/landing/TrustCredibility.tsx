import { Star, Shield, Lock, CheckCircle2, Quote } from "lucide-react";

const LOGOS = ["Salesforce", "HubSpot", "Pipedrive", "Zapier", "Slack", "Google Workspace"];

const METRICS = [
  { value: "10×",    label: "More conversions",   sub: "With AI-powered campaigns",    gradient: "from-emerald-500 to-teal-500" },
  { value: "3×",     label: "More pipeline",      sub: "Avg. per Pigeon customer",   gradient: "from-primary to-primary/70"    },
  { value: "5,000+", label: "Businesses growing", sub: "Using Pigeon to drive sales", gradient: "from-primary to-primary/70"},
];

const TESTIMONIALS = [
  {
    name: "Sarah J.",
    role: "VP Sales, Vertex Systems",
    content: "We 10×'d our pipeline in 60 days. Pigeon's AI campaigns write personalized emails for every lead — our sales team is closing more deals than ever.",
    avatar: "SJ",
    rating: 5,
    metric: "Pipeline grew 10× in 60 days",
    avatarGrad: "from-primary to-rose-500",
  },
  {
    name: "Michael C.",
    role: "Founder, Scalebase",
    content: "We replaced our entire email marketing stack with Pigeon. AI builds the campaigns, automation handles follow-ups, and conversions are up 3× — all from one tool.",
    avatar: "MC",
    rating: 5,
    metric: "3× more conversions, one tool",
    avatarGrad: "from-primary to-primary/70",
  },
  {
    name: "Emily R.",
    role: "Marketing Dir, Nexus Analytics",
    content: "Setup took 10 minutes and our first AI campaign generated $40k in pipeline within a week. No brainer for any team serious about email marketing.",
    avatar: "ER",
    rating: 5,
    metric: "$40k pipeline in first week",
    avatarGrad: "from-primary to-primary/70",
  },
];

const SECURITY = [
  { icon: Shield,       text: "SOC 2 compliant infrastructure" },
  { icon: Lock,         text: "Encrypted data at rest and in transit" },
  { icon: CheckCircle2, text: "Easy unsubscribe & consent built in" },
];

export function TrustCredibility() {
  return (
    <section
      id="testimonials"
      className="py-16 lg:py-24 marketing-band"
      aria-label="Trust and social proof"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">

        {/* Logo row */}
        <div className="text-center mb-12">
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/50 mb-6">
            Trusted by teams at
          </p>
          <div className="flex flex-wrap justify-center items-center gap-3">
            {LOGOS.map((name) => (
              <div
                key={name}
                className="px-5 py-2.5 rounded-xl bg-muted/40 border border-border/50 text-muted-foreground/70 font-semibold text-sm hover:text-foreground hover:border-border hover:bg-muted/60 transition-all duration-200"
              >
                {name}
              </div>
            ))}
          </div>
        </div>

        {/* Big metrics row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-16">
          {METRICS.map((m) => (
            <div
              key={m.label}
              className="relative rounded-2xl border border-border/60 bg-card/80 p-8 text-center overflow-hidden group hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${m.gradient} opacity-0 group-hover:opacity-[0.05] transition-opacity duration-300 pointer-events-none`} />
              <div className={`text-5xl sm:text-6xl font-black bg-gradient-to-r ${m.gradient} bg-clip-text text-transparent mb-2`}>
                {m.value}
              </div>
              <div className="text-base font-bold text-foreground mb-1">{m.label}</div>
              <div className="text-sm text-muted-foreground font-medium">{m.sub}</div>
            </div>
          ))}
        </div>

        {/* Testimonials */}
        <div className="mb-5">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/25 bg-primary/8 text-primary text-[11px] font-black uppercase tracking-[0.1em] mb-6">
            Testimonials
          </div>
          <h2 className="text-3xl sm:text-4xl font-black tracking-[-0.03em] text-foreground mb-8">
            What teams say about Pigeon
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-5 lg:gap-6 mb-10">
          {TESTIMONIALS.map((t, i) => (
            <div
              key={i}
              className="group relative rounded-2xl border border-border/60 bg-card/80 p-7 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 flex flex-col overflow-hidden"
            >
              {/* Quote mark */}
              <Quote className="w-8 h-8 text-primary/15 mb-4 group-hover:text-primary/25 transition-colors" />

              {/* Stars */}
              <div className="flex gap-0.5 mb-4">
                {Array.from({ length: t.rating }).map((_, j) => (
                  <Star key={j} className="w-4 h-4 fill-amber-400 text-amber-400" />
                ))}
              </div>

              <p className="text-[14px] text-foreground font-medium leading-relaxed mb-5 flex-grow">
                &ldquo;{t.content}&rdquo;
              </p>

              {/* Metric chip */}
              <div className="mb-5 px-3.5 py-2 rounded-xl bg-emerald-500/8 border border-emerald-500/20 inline-flex self-start">
                <span className="text-[12px] font-bold text-emerald-600 dark:text-emerald-400">{t.metric}</span>
              </div>

              {/* Author */}
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${t.avatarGrad} flex items-center justify-center text-white text-[11px] font-black flex-shrink-0`}>
                  {t.avatar}
                </div>
                <div>
                  <div className="text-sm font-bold text-foreground">{t.name}</div>
                  <div className="text-[12px] text-muted-foreground font-medium">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Security bar */}
        <div className="rounded-2xl border border-border/60 bg-card/50 p-6 lg:p-8">
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/50 text-center mb-6">
            Security &amp; compliance
          </p>
          <div className="flex flex-wrap justify-center gap-8 lg:gap-14">
            {SECURITY.map((s) => (
              <div key={s.text} className="flex items-center gap-2.5 text-muted-foreground font-medium text-sm">
                <s.icon className="w-4.5 h-4.5 text-primary shrink-0" />
                <span>{s.text}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}
