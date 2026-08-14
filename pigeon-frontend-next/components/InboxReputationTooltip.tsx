"use client";

import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function InboxReputationTooltip() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation transition-colors"
          aria-label="How inbox reputation is calculated"
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="max-w-[320px] text-left p-3">
        <p className="font-medium mb-1.5">What inbox reputation means</p>
        <ul className="text-muted-foreground text-xs leading-relaxed space-y-1.5 list-disc pl-4">
          <li>
            We check your inbox email against{" "}
            <span className="font-semibold text-foreground">StopForumSpam</span>, a public spam‑report database.
          </li>
          <li>
            <span className="font-semibold text-foreground">Safe</span>: the email does{" "}
            <span className="font-semibold">not</span> appear in spam reports at or above our risk threshold.
          </li>
          <li>
            <span className="font-semibold text-foreground">Risky</span>: the email appears frequently in spam
            reports (e.g. frequency ≥ 50). You should avoid using this inbox for cold outreach.
          </li>
          <li>
            This check is reputation‑only — it does <span className="font-semibold">not</span> block or delete any
            emails automatically.
          </li>
        </ul>
      </PopoverContent>
    </Popover>
  );
}

