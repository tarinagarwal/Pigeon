import { cn } from "@/lib/utils";

/** Compact above a thousand — 1.2k rather than 1,204. */
const COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const FULL = new Intl.NumberFormat("en-US");

/** Filled five-point star. An SVG, so it inherits colour and never renders as an emoji. */
export function StarIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={cn("h-[1.05em] w-[1.05em] shrink-0", className)}
    >
      <path d="M12 2.5l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.31l-5.8 3.05 1.11-6.46-4.7-4.58 6.49-.94z" />
    </svg>
  );
}

/**
 * Star glyph plus the repo's star count. When the count is unavailable
 * (GitHub down or rate-limited) only the glyph renders, so the surrounding
 * button keeps its shape.
 */
export function GitHubStars({
  count,
  className,
  iconClassName,
}: {
  count: number | null;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <StarIcon className={iconClassName} />
      {count !== null && (
        <>
          <span aria-hidden="true" className="tabular-nums">
            {COMPACT.format(count)}
          </span>
          <span className="sr-only">{FULL.format(count)} GitHub stars</span>
        </>
      )}
    </span>
  );
}
