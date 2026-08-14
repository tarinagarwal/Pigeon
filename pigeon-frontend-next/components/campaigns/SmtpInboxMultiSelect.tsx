"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export type SmtpInboxMultiSelectInbox = {
  id: string;
  email: string;
  rootDomain: string;
  warm_up_required?: boolean;
  warmup_warning?: boolean;
  warmup_progress?: number;
};

type SmtpInboxMultiSelectProps = {
  inboxes: SmtpInboxMultiSelectInbox[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
};

export function SmtpInboxMultiSelect({ inboxes, selectedIds, onSelectionChange }: SmtpInboxMultiSelectProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return inboxes;
    return inboxes.filter(
      (i) =>
        i.email.toLowerCase().includes(q) ||
        i.rootDomain.toLowerCase().includes(q) ||
        i.id.toLowerCase().includes(q)
    );
  }, [inboxes, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, SmtpInboxMultiSelectInbox[]>();
    for (const inbox of filtered) {
      const key = inbox.rootDomain || "Other";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(inbox);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([domain, list]) => ({
        domain,
        list: list.sort((x, y) => x.email.localeCompare(y.email)),
      }));
  }, [filtered]);

  const selectedInScope = useMemo(
    () => inboxes.filter((i) => selectedIds.includes(i.id)),
    [inboxes, selectedIds]
  );
  const selectedCount = selectedInScope.length;

  const allSelected =
    inboxes.length > 0 && inboxes.every((i) => selectedIds.includes(i.id));

  const handleToggle = (id: string, checked: boolean) => {
    if (checked) {
      if (selectedIds.includes(id)) return;
      onSelectionChange([...selectedIds, id]);
    } else {
      onSelectionChange(selectedIds.filter((x) => x !== id));
    }
  };

  const handleSelectAllToggle = () => {
    if (allSelected) {
      onSelectionChange([]);
    } else {
      onSelectionChange(inboxes.map((i) => i.id));
    }
  };

  return (
    <div className="space-y-3 pt-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Label className="text-base font-semibold">Select inboxes</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {inboxes.length === 0
              ? "No inboxes available for the selected domains"
              : selectedCount === 0
                ? `None selected · ${inboxes.length} available`
                : `${selectedCount} of ${inboxes.length} selected`}
          </p>
        </div>
        {inboxes.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 shrink-0 text-xs font-medium"
            onClick={handleSelectAllToggle}
          >
            {allSelected ? "Deselect all" : "Select all"}
          </Button>
        )}
      </div>

      {inboxes.length > 0 && (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by email or domain…"
            className="h-10 pl-9"
            autoComplete="off"
            aria-label="Filter inboxes"
          />
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border/80 bg-muted/10">
        <ScrollArea className="h-[min(22rem,50vh)]">
          <div className="space-y-0 p-2">
            {inboxes.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm leading-relaxed text-muted-foreground">
                No ready inboxes for these domains yet.{" "}
                <Link href="/inboxes" className="font-medium text-primary underline-offset-4 hover:underline">
                  Add inboxes
                </Link>{" "}
                in Inbox Accounts.
              </p>
            ) : grouped.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                No inboxes match &ldquo;{query.trim()}&rdquo;. Try another search.
              </p>
            ) : (
              grouped.map(({ domain, list }) => (
                <div key={domain} className="border-b border-border/60 py-3 last:border-b-0 first:pt-1">
                  <div className="mb-2 flex items-baseline justify-between gap-2 px-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {domain}
                    </p>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {list.length} inbox{list.length !== 1 ? "es" : ""}
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {list.map((inbox) => {
                      const checked = selectedIds.includes(inbox.id);
                      return (
                        <li key={inbox.id}>
                          <label
                            className={cn(
                              "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors",
                              checked
                                ? "border-primary/40 bg-primary/5 shadow-sm"
                                : "border-transparent bg-background/90 hover:border-border hover:bg-muted/50"
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => handleToggle(inbox.id, e.target.checked)}
                              className="mt-0.5 h-4 w-4 shrink-0 rounded border-input"
                            />
                            <span
                              className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500"
                              aria-hidden
                            />
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                                <span className="break-all text-sm font-medium leading-snug text-foreground">
                                  {inbox.email}
                                </span>
                                <div className="shrink-0 sm:pt-0.5">
                                  <span className="text-xs tabular-nums text-muted-foreground">
                                    {inbox.warmup_progress ?? 0}% warmed
                                  </span>
                                </div>
                              </div>
                              <p className="text-[11px] text-muted-foreground">Sending domain · {domain}</p>
                            </div>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="flex gap-2 rounded-lg border border-border/60 bg-muted/30 p-3">
        <Shield className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Prefer inboxes with strong warmup. For small lists, fewer sending accounts usually means better deliverability.
        </p>
      </div>
    </div>
  );
}
