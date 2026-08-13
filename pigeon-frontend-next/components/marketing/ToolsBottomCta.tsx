import { MarketingCtaButtons } from "./MarketingCtaButtons";

type ToolsBottomCtaProps = {
  description?: string;
};

export function ToolsBottomCta({
  description = "Pigeon automatically validates and removes risky emails from your contact lists before every send.",
}: ToolsBottomCtaProps) {
  return (
    <section className="border-t border-border/60 py-12">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
        <p className="mb-4 text-sm text-muted-foreground">{description}</p>
        <MarketingCtaButtons
          size="sm"
          trackLabels={{ primary: "book_demo", secondary: "hero_start_trial" }}
        />
      </div>
    </section>
  );
}
