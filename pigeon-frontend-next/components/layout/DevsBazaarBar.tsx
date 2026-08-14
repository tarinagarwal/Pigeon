import { GITHUB_URL } from "@/components/layout/Header";

/** Attribution strip shown above the nav on every public surface. */
export function DevsBazaarBar() {
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
          className="font-display text-[12px] font-bold underline decoration-2 underline-offset-2 hover:text-primary sm:text-[13px]"
        >
          View on GitHub ↗
        </a>
      </div>
    </div>
  );
}
