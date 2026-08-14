"use client";

import { useState, useEffect, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/** Stacked thread message: latest fully open; older messages show as a one-line strip until tapped (Gmail-style). */
export function ThreadMessageCard({
  side,
  label,
  title,
  subtitle,
  time,
  children,
  isLatest = false,
  snippet,
  warmup = false,
  className,
}: {
  side: "inbound" | "outbound" | "neutral";
  label: string;
  title: string;
  subtitle?: string;
  time?: string;
  children: ReactNode;
  /** When true, body is always shown. When false, starts collapsed; tap to expand. */
  isLatest?: boolean;
  /** Plain-text preview for the collapsed strip (e.g. first line of body). */
  snippet?: string;
  /** Inbound message is a reply to an inbox warmup send. */
  warmup?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(isLatest);

  useEffect(() => {
    setExpanded(isLatest);
  }, [isLatest]);

  const initial = (title || "?").trim().charAt(0).toUpperCase();
  const borderAccent =
    side === "outbound"
      ? "border-l-primary/70 bg-primary/[0.03]"
      : side === "inbound"
        ? "border-l-muted-foreground/35 bg-background"
        : "border-l-border bg-muted/15";

  const avatarBg =
    side === "outbound" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground";

  const preview = (snippet ?? "").replace(/\s+/g, " ").trim() || "…";

  const warmupBadge = warmup ? (
    <Badge
      variant="secondary"
      className="shrink-0 gap-1 font-normal text-[10px] px-1.5 py-0 h-5 border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100"
      title="Reply to a warmup send"
    >
      <Flame className="w-3 h-3 opacity-80" />
      Warmup
    </Badge>
  ) : null;

  if (isLatest) {
    return (
      <div
        className={cn(
          "rounded-xl border border-border/80 shadow-sm overflow-hidden min-w-0 break-words",
          "border-l-[3px]",
          borderAccent,
          className
        )}
      >
        <div className="flex items-start gap-3 px-4 py-3 border-b border-border/50 bg-muted/25">
          <div
            className={cn("h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold", avatarBg)}
            aria-hidden
          >
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                {warmupBadge}
              </div>
              <p className="text-sm font-semibold text-foreground truncate" title={title}>
                {title}
              </p>
              {subtitle ? <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p> : null}
            </div>
            {time ? (
                <time className="text-xs text-muted-foreground whitespace-nowrap tabular-nums shrink-0 pt-0.5">
                  {time}
                </time>
              ) : null}
            </div>
          </div>
        </div>
        <div className="px-4 py-3 text-sm min-w-0 overflow-hidden [&_.prose]:max-w-none">{children}</div>
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={cn(
          "w-full text-left rounded-xl border border-border/80 shadow-sm overflow-hidden min-w-0 break-words",
          "border-l-[3px] transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          borderAccent,
          className
        )}
      >
        <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
          <div
            className={cn("h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold", avatarBg)}
            aria-hidden
          >
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <span className="truncate">{label}</span>
              {warmupBadge}
              {time ? (
                <span className="text-muted-foreground/90 font-normal tabular-nums shrink-0">· {time}</span>
              ) : null}
            </div>
            <p className="text-sm font-medium text-foreground truncate">{title}</p>
            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{preview}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
        </div>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-border/80 shadow-sm overflow-hidden min-w-0 break-words",
        "border-l-[3px]",
        borderAccent,
        className
      )}
    >
      <div className="flex items-start gap-3 px-4 py-3 border-b border-border/50 bg-muted/25">
        <div
          className={cn("h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold", avatarBg)}
          aria-hidden
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                {warmupBadge}
              </div>
              <p className="text-sm font-semibold text-foreground truncate" title={title}>
                {title}
              </p>
              {subtitle ? <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p> : null}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {time ? (
                <time className="text-xs text-muted-foreground whitespace-nowrap tabular-nums pt-0.5">{time}</time>
              ) : null}
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Collapse"
                aria-label="Collapse message"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="px-4 py-3 text-sm min-w-0 overflow-hidden [&_.prose]:max-w-none">{children}</div>
    </div>
  );
}
