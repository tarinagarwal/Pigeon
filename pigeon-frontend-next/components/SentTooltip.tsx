"use client";

import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const SENT_POPOVER_CONTENT = (
  <>
    <p className="font-medium mb-2">How we send &amp; protect reputation</p>
    <ul className="text-muted-foreground text-xs leading-relaxed space-y-1.5 list-none">
      <li>
        <strong className="text-foreground">Rotation:</strong> We rotate across your inboxes (round-robin or random) so no single inbox is overused.
      </li>
      <li>
        <strong className="text-foreground">Human-like timing:</strong> Variable gaps between emails, occasional &quot;coffee breaks,&quot; and we prefer business hours (8am–6pm in your campaign timezone).
      </li>
      <li>
        <strong className="text-foreground">Weekly rhythm:</strong> Each inbox has 1–2 &quot;light&quot; days per week with longer gaps between sends for natural variation.
      </li>
      <li>
        <strong className="text-foreground">Daily limits:</strong> Per-inbox limits reset at midnight UTC; we stop when limits are reached and use a safer pattern when an inbox is new (&lt;7 days) or near its daily cap.
      </li>
    </ul>
  </>
);

export function SentTooltip() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation transition-colors ml-1 align-middle"
          aria-label="How sent count and sending work"
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="max-w-[320px] text-left p-3">
        {SENT_POPOVER_CONTENT}
      </PopoverContent>
    </Popover>
  );
}

interface SentTooltipWithNumberProps {
  sent: number;
  isLoading?: boolean;
}

/** Use in table rows: click the sent number to open the same tooltip. */
export function SentTooltipWithNumber({ sent, isLoading }: SentTooltipWithNumberProps) {
  if (isLoading) {
    return <span className="tabular-nums">-</span>;
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="tabular-nums text-right underline decoration-dotted underline-offset-2 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          aria-label="View how sent count works"
        >
          {sent.toLocaleString()}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="max-w-[320px] text-left p-3">
        {SENT_POPOVER_CONTENT}
      </PopoverContent>
    </Popover>
  );
}

const CLICK_RATE_POPOVER_CONTENT = (
  <p className="text-muted-foreground text-xs leading-relaxed">
    Click rate is the percentage of delivered emails where the recipient clicked at least one link. It includes all links in your sent emails (CTAs, unsubscribe, etc.).
  </p>
);

export function ClickRateTooltip() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation transition-colors ml-1 align-middle"
          aria-label="What click rate means"
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="max-w-[280px] text-left p-3">
        {CLICK_RATE_POPOVER_CONTENT}
      </PopoverContent>
    </Popover>
  );
}

interface ClickRateTooltipWithNumberProps {
  clickRate: number;
  isLoading?: boolean;
}

/** Use in table rows: click the click rate value to open the tooltip (like Sent). */
export function ClickRateTooltipWithNumber({ clickRate, isLoading }: ClickRateTooltipWithNumberProps) {
  if (isLoading) {
    return <span className="tabular-nums">—</span>;
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="tabular-nums text-right underline decoration-dotted underline-offset-2 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded text-primary"
          aria-label="What click rate means"
        >
          {clickRate}%
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="max-w-[280px] text-left p-3">
        {CLICK_RATE_POPOVER_CONTENT}
      </PopoverContent>
    </Popover>
  );
}
