import { Mail, Sparkles, Zap, Rocket, BarChart3 } from "lucide-react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

const steps = [
  {
    step: 1,
    title: "Connect your email",
    desc: "Connect your Gmail or SMTP account in minutes. Pigeon handles inbox setup and best practices for you.",
    icon: Mail,
    gradient: "from-primary to-primary/70",
    glow: "shadow-primary/30",
  },
  {
    step: 2,
    title: "Build your campaign with AI",
    desc: "Describe your offer and target audience — AI generates a full email sequence, subject lines, and follow-ups instantly.",
    icon: Sparkles,
    gradient: "from-primary to-primary/70",
    glow: "shadow-primary/30",
  },
  {
    step: 3,
    title: "Personalize for every contact",
    desc: "Upload your lead list and Pigeon personalizes each email with AI variations and dynamic fields — at any scale.",
    icon: Zap,
    gradient: "from-amber-500 to-orange-500",
    glow: "shadow-amber-500/30",
  },
  {
    step: 4,
    title: "Launch & automate follow-ups",
    desc: "Go live in one click. Automated follow-up sequences keep prospects engaged until they're ready to buy.",
    icon: Rocket,
    gradient: "from-emerald-500 to-teal-500",
    glow: "shadow-emerald-500/30",
  },
  {
    step: 5,
    title: "Track, respond, and convert",
    desc: "Monitor campaign performance and conversions in real time. All responses land in one unified inbox — close deals faster.",
    icon: BarChart3,
    gradient: "from-rose-500 to-primary/70",
    glow: "shadow-rose-500/30",
  },
];

export function HowItWorksSection() {
  return (
    <section
      id="how-it-works"
      className="py-16 lg:py-24 marketing-band"
      aria-labelledby="how-heading"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl">

        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-12 lg:mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/25 bg-primary/8 text-primary text-[11px] font-black uppercase tracking-[0.1em] mb-5">
            How it works
          </div>
          <h2
            id="how-heading"
            className="text-4xl sm:text-5xl lg:text-[3rem] font-black leading-[1.08] tracking-[-0.03em] mb-4"
          >
            Automate email marketing with AI
            <span className="block mt-1 bg-gradient-to-r from-primary via-primary/85 to-primary/70 bg-clip-text text-transparent">
              in 5 simple steps
            </span>
          </h2>
          <p className="text-lg text-muted-foreground font-medium">
            From setup to first conversion in minutes. No technical complexity, no steep learning curve.
          </p>
        </div>

        {/* Steps — horizontal on desktop, vertical on mobile */}
        <div className="relative">

          {/* Connector line — desktop only */}
          <div
            className="hidden lg:block absolute top-10 left-0 right-0 h-px pointer-events-none"
            style={{
              background: "linear-gradient(90deg, transparent 0%, hsl(var(--border)) 8%, hsl(var(--border)) 92%, transparent 100%)",
            }}
            aria-hidden
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 lg:gap-4">
            {steps.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.step} className="flex flex-col items-center text-center gap-4 group">
                  {/* Circle with step number + icon */}
                  <div className="relative flex-shrink-0">
                    <div
                      className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${item.gradient} flex items-center justify-center shadow-xl ${item.glow} group-hover:scale-110 transition-transform duration-300 relative z-10`}
                    >
                      <Icon className="w-8 h-8 text-white" />
                    </div>
                    {/* Step number chip */}
                    <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-card border-2 border-border flex items-center justify-center z-20">
                      <span className="text-[10px] font-black text-foreground">{item.step}</span>
                    </div>
                  </div>

                  <div>
                    <p className="font-bold text-base text-foreground mb-1.5 leading-snug">{item.title}</p>
                    <p className="text-[13px] text-muted-foreground leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center mt-12">
          <Link href="/login">
            <button
              className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl font-bold text-[0.95rem] text-white transition-all duration-300 hover:scale-[1.04] hover:shadow-2xl group"
              style={{
                background: "linear-gradient(135deg, #ea580c 0%, #c2410c 100%)",
                boxShadow: "0 8px 28px rgba(6,182,212,0.30)",
              }}
            >
              Book a demo
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </Link>
        </div>

      </div>
    </section>
  );
}
