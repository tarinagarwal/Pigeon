"use client";

import { useMemo } from "react";
import { Mail, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { Inbox } from "@/types/api";
import type { Domain } from "@/types/api";

function getRootDomain(domain: string): string {
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  return labels.slice(-2).join(".");
}

interface OutreachInboxPickerProps {
  inboxes: Inbox[];
  domains?: Domain[];
  selectedInboxIds: string[];
  onSelect: (inboxIds: string[]) => void;
  /** Called when user clicks "Use X selected inboxes"; if provided, only this is called for the button (not onSelect). */
  onConfirmSelection?: (inboxIds: string[]) => void;
}

export function OutreachInboxPicker({
  inboxes,
  domains = [],
  selectedInboxIds,
  onSelect,
  onConfirmSelection,
}: OutreachInboxPickerProps) {
  const { readyOrWarming, gmail, smtp } = useMemo(() => {
    const readyOrWarming = inboxes.filter((i) => i.status === "ready" || i.status === "warming");
    return {
      readyOrWarming,
      gmail: readyOrWarming.filter((i) => i.sender_type === "gmail"),
      smtp: readyOrWarming.filter((i) => i.sender_type === "smtp"),
    };
  }, [inboxes]);

  const domainById = useMemo(() => {
    const map = new Map<string, Domain>();
    domains.forEach((d) => map.set(d.id, d));
    return map;
  }, [domains]);

  const getSmtpRootGroupKey = (inbox: Inbox): string | null => {
    const d = inbox.domain_id ? domainById.get(inbox.domain_id) : undefined;
    if (d?.domain) return getRootDomain(d.domain);
    const email = inbox.email ?? "";
    const at = email.lastIndexOf("@");
    if (at >= 0) return getRootDomain(email.slice(at + 1));
    return inbox.domain_id ?? null;
  };

  /** Group key: "gmail" for Gmail, or root domain (e.g. pigeon.com) for SMTP so subdomains nest under the same group. */
  const getInboxGroup = (inbox: Inbox | undefined): string | null =>
    !inbox ? null : inbox.sender_type === "gmail" ? "gmail" : getSmtpRootGroupKey(inbox);

  const smtpByDomain = useMemo(() => {
    if (smtp.length === 0) return [];
    if (domains.length === 0) {
      return [{ domain: { id: "", domain: "SMTP" }, inboxes: smtp }];
    }
    const withRoot = smtp
      .map((inbox) => {
        const root = getSmtpRootGroupKey(inbox);
        return root ? { inbox, root } : null;
      })
      .filter((x): x is { inbox: Inbox; root: string } => x !== null);

    const roots = Array.from(new Set(withRoot.map((x) => x.root))).sort();
    return roots.map((root) => ({
      domain: { id: root, domain: root },
      inboxes: withRoot.filter((x) => x.root === root).map((x) => x.inbox),
    }));
  }, [smtp, domains.length, domainById]);

  const inboxById = new Map(readyOrWarming.map((i) => [i.id, i]));
  const selectedGroup =
    selectedInboxIds.length > 0 ? getInboxGroup(inboxById.get(selectedInboxIds[0])) : null;

  const toggleInbox = (inboxId: string) => {
    const inbox = inboxById.get(inboxId);
    if (!inbox) return;
    if (selectedInboxIds.includes(inboxId)) {
      onSelect(selectedInboxIds.filter((id) => id !== inboxId));
    } else {
      const newGroup = getInboxGroup(inbox);
      if (selectedGroup === null || selectedGroup === newGroup) {
        onSelect([...selectedInboxIds, inboxId]);
      } else {
        onSelect([inboxId]);
      }
    }
  };

  const isInboxDisabled = (inbox: Inbox) =>
    selectedGroup !== null && getInboxGroup(inbox) !== selectedGroup;

  if (readyOrWarming.length === 0) {
    return (
      <Card className="w-full max-w-md rounded-xl border border-border/60 bg-card/80 shadow-sm text-foreground overflow-hidden">
        <CardHeader className="pb-2 pt-3 px-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Mail className="h-4 w-4 text-primary" />
            </div>
            <span className="font-medium text-sm text-foreground">Pick which account(s) to send from</span>
          </div>
        </CardHeader>
        <CardContent className="px-3 pb-3 text-foreground">
          <p className="text-sm text-muted-foreground">
            No email accounts connected yet. Add your Gmail or other email in Inbox first.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md rounded-xl border border-border/60 bg-card/80 shadow-sm text-foreground overflow-hidden">
      <CardHeader className="pb-2 pt-3 px-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Mail className="h-4 w-4 text-primary" />
          </div>
          <span className="font-medium text-sm text-foreground">Pick which account(s) to send from</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-3 pb-3 text-foreground">
        {gmail.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Mail className="h-3.5 w-3" />
              Gmail
            </div>
            <div className="flex flex-col gap-1">
              {gmail.map((inbox) => {
                const disabled = isInboxDisabled(inbox);
                return (
                  <label
                    key={inbox.id}
                    className={cn(
                      "flex items-center gap-2 rounded-lg py-1.5 px-2",
                      disabled ? "cursor-not-allowed opacity-50" : "hover:bg-muted/50 cursor-pointer"
                    )}
                  >
                    <Checkbox
                      checked={selectedInboxIds.includes(inbox.id)}
                      onCheckedChange={() => !disabled && toggleInbox(inbox.id)}
                      disabled={disabled}
                    />
                    <span className="text-sm truncate">{inbox.email}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {inbox.sent_today}/{inbox.daily_limit} today
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
        {smtpByDomain.map(
          ({ domain, inboxes: domainInboxes }) =>
            domainInboxes.length > 0 && (
              <div key={domain.id ?? domain.domain} className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Building2 className="h-3.5 w-3" />
                  {domain.domain}
                </div>
                <div className="flex flex-col gap-1">
                  {domainInboxes.map((inbox) => {
                    const disabled = isInboxDisabled(inbox);
                    return (
                      <label
                        key={inbox.id}
                        className={cn(
                          "flex items-center gap-2 rounded-lg py-1.5 px-2",
                          disabled ? "cursor-not-allowed opacity-50" : "hover:bg-muted/50 cursor-pointer"
                        )}
                      >
                        <Checkbox
                          checked={selectedInboxIds.includes(inbox.id)}
                          onCheckedChange={() => !disabled && toggleInbox(inbox.id)}
                          disabled={disabled}
                        />
                        <span className="text-sm truncate">{inbox.email}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {inbox.sent_today}/{inbox.daily_limit} today
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )
        )}
        <Button
          size="sm"
          className="w-full rounded-lg mt-1"
          onClick={() => (onConfirmSelection ? onConfirmSelection(selectedInboxIds) : onSelect(selectedInboxIds))}
          disabled={selectedInboxIds.length === 0}
        >
          Use these {selectedInboxIds.length} inbox{selectedInboxIds.length !== 1 ? "es" : ""} to send from
        </Button>
      </CardContent>
    </Card>
  );
}
