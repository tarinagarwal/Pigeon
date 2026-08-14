"use client";

import { ReactNode } from "react";
import { LucideIcon, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon?: LucideIcon;
  headline: string;
  description: string;
  primaryAction?: ReactNode;
  secondaryLink?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon = Inbox,
  headline,
  description,
  primaryAction,
  secondaryLink,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center",
        className
      )}
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Icon className="h-7 w-7 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">{headline}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {primaryAction && <div className="mt-6">{primaryAction}</div>}
      {secondaryLink && <div className="mt-3">{secondaryLink}</div>}
    </div>
  );
}
