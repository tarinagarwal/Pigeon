"use client";

import { Button } from "@/components/ui/button";

interface RetryBlockProps {
  title: string;
  description?: string;
  onRetry: () => void;
  className?: string;
}

export function RetryBlock({
  title,
  description = "Please try again.",
  onRetry,
  className,
}: RetryBlockProps) {
  return (
    <div className={className}>
      <p className="text-destructive mb-2">{title}</p>
      <p className="text-sm text-muted-foreground">{description}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

