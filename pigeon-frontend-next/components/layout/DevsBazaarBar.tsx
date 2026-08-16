import { GITHUB_URL } from "@/lib/site";
import { StarIcon } from "@/components/ui/GitHubStars";

const STARS = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * Attribution strip shown above the nav on every public surface.
 *
 * `stars` is passed in rather than fetched here: this renders inside the
 * client-side Header, so it cannot do its own server-side fetch.
 */
export function DevsBazaarBar({ stars = null }: { stars?: number | null }) {
  return (
    <div className="border-b-[3px] border-foreground bg-foreground text-background">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 py-2 text-center sm:px-6 lg:px-8">
        <span className="font-display text-[12px] font-bold sm:text-[13px]">
          A{" "}
          <a
            href="https://devsbazaar.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-2 underline-offset-2 hover:text-primary"
          >
            DevsBazaar
          </a>{" "}
          product — open sourced.
        </span>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={
            stars !== null
              ? `Star Pigeon on GitHub — ${stars.toLocaleString("en-US")} stars`
              : "Star Pigeon on GitHub"
          }
          className="font-display inline-flex items-center gap-1.5 rounded-full border-2 border-background/35 px-2.5 py-0.5 text-[12px] font-bold transition-colors hover:border-primary hover:text-primary sm:text-[13px]"
        >
          <StarIcon className="text-amber-400" />
          <span>Star on GitHub</span>
          {stars !== null && (
            <span className="border-l-2 border-background/35 pl-1.5 tabular-nums">
              {STARS.format(stars)}
            </span>
          )}
        </a>
      </div>
    </div>
  );
}
