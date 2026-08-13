import { Server, Sparkles, Network, Flame, PenLine, Megaphone, XCircle } from "lucide-react";

/** Every "fix" the outbound industry sells — and why it doesn't move the number that matters. */
const DEAD_FIXES = [
  {
    icon: Server,
    myth: "Better infrastructure",
    sold: "“Buy 50 domains and 200 mailboxes.”",
    reality:
      "Mailbox providers fingerprint newly-spun domains in bulk. More infrastructure is a bigger footprint to flag, not a shortcut to the inbox.",
  },
  {
    icon: Sparkles,
    myth: "Personalization tokens",
    sold: "“Add {{first_name}} and a custom first line.”",
    reality:
      "A merge field doesn't make a stranger's email wanted. Filters read behavior and recognition, not how many variables you spliced in.",
  },
  {
    icon: Network,
    myth: "Dedicated IPs & servers",
    sold: "“Get a private IP so you own your reputation.”",
    reality:
      "A cold IP with no engagement history is a liability, not an asset. Reputation is earned by people wanting your mail — not by renting hardware.",
  },
  {
    icon: Flame,
    myth: "Warm-up networks",
    sold: "“20,000-inbox warm-up guarantees the inbox.”",
    reality:
      "Warm-up is bots emailing bots. Providers increasingly discount it. Fake engagement can't manufacture real recipient interest.",
  },
  {
    icon: PenLine,
    myth: "Rewriting the copy",
    sold: "“A/B test subject lines and openers.”",
    reality:
      "Once you're flagged, a new subject line won't save you. A fully automated sequence still behaves like one, no matter how good the words are.",
  },
  {
    icon: Megaphone,
    myth: "More volume",
    sold: "“Send 10,000 and hope for 2%.”",
    reality:
      "Volume is the disease, not the cure. Every extra send at scale spends domain reputation faster than any reply can earn it back.",
  },
];

export function DeadEmailData() {
  return (
    <section className="py-16 lg:py-24 relative overflow-hidden marketing-band" aria-labelledby="dead-email-heading">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl relative z-10">

        {/* Header */}
        <div className="max-w-3xl mx-auto text-center mb-14">
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-red-500/25 bg-red-500/8 text-red-500 dark:text-red-400 text-[11px] font-black uppercase tracking-[0.12em]">
            The brutal part
          </span>
          <h2
            id="dead-email-heading"
            className="mt-5 text-4xl sm:text-5xl font-black tracking-[-0.03em] leading-[1.05] text-foreground"
          >
            None of it works.
            <span className="block mt-2 text-muted-foreground text-2xl sm:text-3xl font-bold">
              Not the thing they sold you to fix it.
            </span>
          </h2>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
            The bottleneck was never your copy, your servers, or your merge tags. It&rsquo;s that in 2026 spam filters weigh
            sending <span className="text-foreground/90 font-semibold">behavior</span>, engagement history, cross-channel
            activity, and whether the recipient has any reason to recognize you at all. Here&rsquo;s every &ldquo;fix&rdquo;
            the industry keeps selling — and why it can&rsquo;t move that.
          </p>
        </div>

        {/* Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5">
          {DEAD_FIXES.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.myth}
                className="relative rounded-2xl border border-border bg-card p-6 overflow-hidden group"
              >
                <div className="absolute top-0 right-0 w-24 h-24 rounded-bl-[3rem] bg-gradient-to-bl from-red-500/8 to-transparent pointer-events-none" />
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-muted border border-border flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <span className="font-black text-[15px] text-foreground leading-tight line-through decoration-red-500/60 decoration-2">
                      {f.myth}
                    </span>
                  </div>
                </div>
                <p className="text-[13px] font-mono text-muted-foreground/80 mb-3 leading-snug">{f.sold}</p>
                <p className="text-[13.5px] text-foreground/85 leading-relaxed">{f.reality}</p>
              </div>
            );
          })}
        </div>

        {/* Punchline */}
        <div className="mt-12 max-w-3xl mx-auto rounded-2xl border-2 border-foreground/15 bg-foreground/[0.03] dark:bg-foreground/[0.04] p-7 text-center">
          <p className="text-xl sm:text-2xl font-bold tracking-tight text-foreground leading-snug">
            &ldquo;Buy a list, send 10,000 emails, hope for a 2% reply rate&rdquo; isn&rsquo;t a strategy.
          </p>
          <p className="mt-3 text-base text-muted-foreground">
            It&rsquo;s a way to burn a domain and call it growth. The number to optimize was never <span className="text-foreground/90 font-semibold">volume</span>.
            It was <span className="text-foreground/90 font-semibold">familiarity</span>.
          </p>
        </div>
      </div>
    </section>
  );
}
