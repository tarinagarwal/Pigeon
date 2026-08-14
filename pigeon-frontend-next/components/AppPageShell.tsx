"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AppPageShellProps {
  title: string;
  description?: ReactNode;
  /** Primary CTA(s) in the header (e.g. "Create campaign" button) */
  actions?: ReactNode;
  children?: ReactNode;
  /** If true, show a simple "empty state" message instead of children */
  emptyState?: boolean;
  emptyMessage?: string;
  className?: string;
}

export function AppPageShell({
  title,
  description,
  actions,
  children,
  emptyState,
  emptyMessage = "Content will be available here soon.",
  className,
}: AppPageShellProps) {
  return (
    <div className={cn("page-section-spacing space-y-5", className)}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
        <div className="min-w-0 space-y-0.5">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
          {description && (
            <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
          )}
        </div>
        {actions ? (
          <div className="flex w-full shrink-0 flex-wrap items-center gap-2 md:w-auto md:justify-end">
            {actions}
          </div>
        ) : null}
      </div>
      {emptyState && !children ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-12 text-center">
          <p className="text-muted-foreground">{emptyMessage}</p>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
