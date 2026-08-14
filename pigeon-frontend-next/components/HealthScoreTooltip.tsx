"use client";

import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function HealthScoreTooltip() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation transition-colors"
          aria-label="How is health score calculated?"
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="max-w-[280px] text-left p-3">
        <p className="font-medium mb-1.5">How is health score calculated?</p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Health is based on verified DNS for your email provider. 100% means all required checks for your provider are verified.
        </p>
      </PopoverContent>
    </Popover>
  );
}
