"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Mail, Plus, Trash2, LogIn, Shield, TrendingUp, Inbox as InboxIcon, Settings2, CheckCircle2, Clock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { useInboxes, useForceReadyInbox, useDeleteInbox, useInboxSpamScores } from "@/hooks/useInboxes";
import { useCheckReplies } from "@/hooks/useInboxEmails";
import { InboxSettingsDialog } from "@/components/InboxSettingsDialog";
import type { Inbox } from "@/types/api";
import { usePlanGate } from "@/hooks/usePlanGate";
import { PremiumBadge } from "@/components/PremiumBadge";
import { UpgradeModal } from "@/components/UpgradeModal";
import { InboxReputationTooltip } from "@/components/InboxReputationTooltip";
import { HelpLinks } from "@/components/HelpLinks";
import { AppPageShell } from "@/components/AppPageShell";
import { EmptyState } from "@/components/EmptyState";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

// ─── Status Badge ────────────────────────────────────────────────────────────

function getInboxStatus(status: string) {
  switch (status) {
    case "ready":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-600/20">
          <CheckCircle2 className="h-3 w-3" />
          Ready
        </span>
      );
    case "warming":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 dark:bg-primary/40 px-2.5 py-1 text-xs font-medium text-primary dark:text-primary ring-1 ring-inset ring-primary/20">
          <TrendingUp className="h-3 w-3" />
          Warming
        </span>
      );
    case "paused":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-400 ring-1 ring-inset ring-zinc-500/20">
          <Clock className="h-3 w-3" />
          Paused
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-400 ring-1 ring-inset ring-zinc-500/20">
          {status}
        </span>
      );
  }
}

// ─── Sender Type Badge ────────────────────────────────────────────────────────

function SenderTypeBadge({ type }: { type: string }) {
  const t = (type || "smtp").toUpperCase();
  const isGmail = t === "GMAIL";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide ring-1 ring-inset",
        isGmail
          ? "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 ring-red-500/30"
          : "bg-primary/10 dark:bg-primary/40 text-primary dark:text-primary ring-primary/30"
      )}
    >
      {t}
    </span>
  );
}

// ─── Reputation Cell ──────────────────────────────────────────────────────────

function ReputationCell({ inbox, inboxSpamScores }: { inbox: Inbox; inboxSpamScores: any }) {
  const score = inboxSpamScores?.scores?.find((s: any) => s.inbox_id === inbox.id);
  if (!score) {
    return <span className="text-xs text-muted-foreground/60 italic">Not checked</span>;
  }
  const safe = score.stop_forum_spam_ok;
  const freq = score.frequency ?? 0;
  return (
    <div className="flex flex-col gap-1" title={score.message}>
      <span
        className={cn(
          "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
          safe
            ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-600/20"
            : "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-600/20"
        )}
      >
        <Shield className="h-3 w-3" />
        {safe ? "Safe" : "Risky"}
      </span>
      <span className="text-[11px] text-muted-foreground/70">Spam score: {freq}</span>
    </div>
  );
}

// ─── Warmup Progress Cell ─────────────────────────────────────────────────────

function WarmupProgressCell({ progress }: { progress: number }) {
  const pct = progress ?? 0;
  return (
    <div className="flex items-center gap-3 min-w-[130px]">
      <div className="flex-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            pct >= 80
              ? "bg-emerald-500"
              : pct >= 40
              ? "bg-primary"
              : "bg-amber-500"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums font-medium text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}

// ─── Sent Today Cell ──────────────────────────────────────────────────────────

function SentTodayCell({ sentToday, dailyLimit }: { sentToday: number; dailyLimit: number }) {
  const pct = dailyLimit ? (sentToday / dailyLimit) * 100 : 0;
  const nearLimit = pct >= 90;
  return (
    <span
      className={cn(
        "tabular-nums text-sm font-medium",
        nearLimit ? "text-amber-600 dark:text-amber-400" : "text-foreground"
      )}
    >
      {sentToday ?? 0}
    </span>
  );
}

// ─── Inbox Row (per-row lazy stats) ─────────────────────────────────────────────

interface InboxRowProps {
  inbox: Inbox;
  index: number;
  inboxSpamScores: any;
  confirmDialog: (options: { title: string; description?: string; variant?: "default" | "destructive" }) => Promise<boolean>;
  forceReadyInbox: ReturnType<typeof useForceReadyInbox>;
  deleteInbox: ReturnType<typeof useDeleteInbox>;
  refetchInboxes: () => void;
  onOpenSettings: (inbox: Inbox) => void;
  selected: boolean;
  onToggleSelected: () => void;
}

function InboxRow({
  inbox,
  index,
  inboxSpamScores,
  confirmDialog,
  forceReadyInbox,
  deleteInbox,
  refetchInboxes,
  onOpenSettings,
  selected,
  onToggleSelected,
}: InboxRowProps) {
  return (
    <TableRow
      key={inbox.id}
      className="group border-border/40 hover:bg-muted/30 transition-colors"
    >
      <TableCell className="pl-5 pr-3 py-3.5 w-10">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelected}
          aria-label={`Select inbox ${inbox.email}`}
        />
      </TableCell>
      <TableCell className="px-0 py-3.5 text-center text-xs text-muted-foreground w-10">
        {index + 1}
      </TableCell>
      <TableCell className="py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Mail className="h-3.5 w-3.5 text-primary" />
          </div>
          <span className="text-sm font-medium text-foreground truncate max-w-[180px]">
            {inbox.email}
          </span>
        </div>
      </TableCell>
      <TableCell className="py-3.5">
        <SenderTypeBadge type={inbox.sender_type || "smtp"} />
      </TableCell>
      <TableCell className="py-3.5">
        {getInboxStatus(inbox.status || "pending")}
      </TableCell>
      <TableCell className="py-3.5">
        <ReputationCell inbox={inbox} inboxSpamScores={inboxSpamScores} />
      </TableCell>
      <TableCell className="py-3.5">
        <WarmupProgressCell progress={inbox.warmup_progress ?? 0} />
      </TableCell>
      <TableCell className="text-center py-3.5">
        <span className="tabular-nums text-sm text-muted-foreground">
          {inbox.daily_limit ?? "—"}
        </span>
      </TableCell>
      <TableCell className="text-center py-3.5">
        <SentTodayCell sentToday={inbox.sent_today ?? 0} dailyLimit={inbox.daily_limit ?? 0} />
      </TableCell>
      <TableCell className="text-right pr-4 py-3.5">
        <RowActions
          inbox={inbox}
          onSettings={() => {
            onOpenSettings(inbox);
          }}
          onDelete={async () => {
            const confirmed = await confirmDialog({
              title: "Delete inbox",
              description: `Delete inbox ${inbox.email}? This cannot be undone.`,
              variant: "destructive",
            });
            if (!confirmed) return;
            try {
              await deleteInbox.mutateAsync(inbox.id);
              refetchInboxes();
            } catch (error) {
              console.error(error);
            }
          }}
          onForceReady={() => forceReadyInbox.mutate(inbox.id)}
          forceReadyPending={forceReadyInbox.isPending}
          deletePending={deleteInbox.isPending}
        />
      </TableCell>
    </TableRow>
  );
}

// ─── Row Actions ──────────────────────────────────────────────────────────────

function RowActions({
  inbox,
  onSettings,
  onDelete,
  onForceReady,
  forceReadyPending,
  deletePending,
}: {
  inbox: Inbox;
  onSettings: () => void;
  onDelete: () => void;
  onForceReady: () => void;
  forceReadyPending: boolean;
  deletePending: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        asChild
        className="h-7 px-2.5 text-xs gap-1.5"
      >
        <Link href="/mailbox/login">
          <LogIn className="h-3.5 w-3.5" />
          Mailbox
        </Link>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2.5 text-xs gap-1.5"
        onClick={onSettings}
      >
        <Settings2 className="h-3.5 w-3.5" />
        Settings
      </Button>
      {inbox.status !== "ready" && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs"
          disabled={forceReadyPending}
          onClick={onForceReady}
        >
          Force Ready
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        disabled={deletePending}
        onClick={onDelete}
        aria-label={`Delete inbox ${inbox.email}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InboxesPage() {
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const confirmDialog = useConfirmDialog();
  const [selectedInbox, setSelectedInbox] = useState<Inbox | null>(null);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [selectedInboxes, setSelectedInboxes] = useState<string[]>([]);
  const [selectedDomainFilter, setSelectedDomainFilter] = useState<string>("");

  const { data: inboxes = [], isLoading: inboxesLoading, refetch: refetchInboxes } = useInboxes(userId);
  const {
    data: inboxSpamScores,
    isFetching: spamScoresLoading,
    refetch: refetchInboxSpamScores,
  } = useInboxSpamScores(userId);
  const forceReadyInbox = useForceReadyInbox();
  const deleteInbox = useDeleteInbox();
  const inboxGate = usePlanGate("inboxes");

  const domainOptions = Array.from(
    new Set(
      (inboxes || [])
        .map((i) => i.email?.split("@")[1])
        .filter((d): d is string => !!d),
    ),
  ).sort();

  const toggleInboxSelected = (id: string) => {
    setSelectedInboxes((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectDomainInboxes = () => {
    if (!selectedDomainFilter) return;
    const ids = inboxes
      .filter((i) => i.email?.split("@")[1] === selectedDomainFilter)
      .map((i) => i.id);
    setSelectedInboxes(ids);
  };

  const bulkRadioValue = useMemo(() => {
    if (!inboxes.length || !selectedInboxes.length) return "";
    if (selectedInboxes.length === inboxes.length) return "all";
    if (!selectedDomainFilter) return "";
    const domainIds = inboxes
      .filter((i) => i.email?.split("@")[1] === selectedDomainFilter)
      .map((i) => i.id)
      .sort();
    const sel = [...selectedInboxes].sort();
    if (
      domainIds.length > 0 &&
      sel.length === domainIds.length &&
      sel.every((id, i) => id === domainIds[i])
    ) {
      return "domain";
    }
    return "";
  }, [inboxes, selectedInboxes, selectedDomainFilter]);

  const onBulkRadioChange = (value: string) => {
    if (value === "all") {
      if (!inboxes.length) return;
      setSelectedInboxes(inboxes.map((i) => i.id));
      return;
    }
    if (value === "domain") {
      if (!selectedDomainFilter) {
        toast.error("Select a domain first");
        return;
      }
      selectDomainInboxes();
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedInboxes.length) return;
    const confirmed = await confirmDialog({
      title: "Delete selected inboxes",
      description: `Are you sure you want to delete ${selectedInboxes.length} inbox(es)? This cannot be undone.`,
      variant: "destructive",
    });
    if (!confirmed) return;

    try {
      for (const id of selectedInboxes) {
        // eslint-disable-next-line no-await-in-loop
        await deleteInbox.mutateAsync(id);
      }
      setSelectedInboxes([]);
      refetchInboxes();
    } catch (error) {
      console.error(error);
      toast.error("Failed to delete some inboxes. Please try again.");
    }
  };

  useEffect(() => {
    if (userId) refetchInboxes();
  }, [userId, refetchInboxes]);

  // ── Summary stats ───────────────────────────────────────────────────────────
  const readyCount = inboxes.filter((i) => i.status === "ready").length;
  const warmingCount = inboxes.filter((i) => i.status === "warming").length;
  const totalSentToday = inboxes.reduce((sum, i) => sum + (i.sent_today ?? 0), 0);

  return (
    <AppPageShell
      title="Inboxes"
      description="Manage your email sending accounts"
      actions={
        <div className="flex items-center gap-2">
          {inboxGate.atLimit && <PremiumBadge featureKey="inboxes" />}
          <Button
            variant="outline"
            size="sm"
            disabled={!userId || spamScoresLoading}
            className="gap-1.5 h-8 text-xs"
            onClick={() => {
              if (!userId) {
                toast.error("You must be logged in to check inbox reputation.");
                return;
              }
              refetchInboxSpamScores();
            }}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", spamScoresLoading && "animate-spin")} />
            {spamScoresLoading ? "Checking…" : "Check reputation"}
          </Button>
          {inboxGate.atLimit ? (
            <Button
              size="sm"
              className="h-8 gap-1.5 gradient-primary text-xs font-medium"
              onClick={() => {
                toast.error(inboxGate.upgradeLine || "Your current plan does not allow adding more inboxes.");
                setUpgradeOpen(true);
              }}
              data-tour="inboxes-create"
            >
              <Plus className="h-3.5 w-3.5" />
              Upgrade to add
            </Button>
          ) : (
            <Button asChild size="sm" className="h-8 gap-1.5 gradient-primary text-xs font-medium" data-tour="inboxes-create">
              <Link href="/inboxes/new">
                <Plus className="h-3.5 w-3.5" />
                Add inbox
              </Link>
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-5">

        {/* ── Summary Cards ── */}
        {inboxes.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {[
              {
                label: "Total Inboxes",
                value: inboxes.length,
                sub: `${inboxGate.atLimit ? "At limit" : "Active"}`,
                icon: InboxIcon,
                color: "text-primary dark:text-primary",
                bg: "bg-primary/10 dark:bg-primary/40",
              },
              {
                label: "Ready",
                value: readyCount,
                sub: `${warmingCount} warming`,
                icon: CheckCircle2,
                color: "text-emerald-600 dark:text-emerald-400",
                bg: "bg-emerald-50 dark:bg-emerald-950/40",
              },
              {
                label: "Sent Today",
                value: totalSentToday,
                sub: "across all inboxes",
                icon: TrendingUp,
                color: "text-primary dark:text-primary",
                bg: "bg-primary/10 dark:bg-primary/40",
              },
            ].map(({ label, value, sub, icon: Icon, color, bg }) => (
              <div
                key={label}
                className="rounded-xl border border-border/60 bg-card px-5 py-4 flex items-center gap-4 shadow-sm"
              >
                <div className={cn("rounded-lg p-2.5", bg)}>
                  <Icon className={cn("h-5 w-5", color)} />
                </div>
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
                  <p className="text-2xl font-bold text-foreground leading-none mt-0.5">{value}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Table ── */}
        <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Your Inboxes</h2>
              {inboxes.length > 0 && (
                <p className="text-[11px] text-muted-foreground mt-0.5">{inboxes.length} inbox{inboxes.length !== 1 ? "es" : ""} connected</p>
              )}
            </div>
            {inboxes.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                {domainOptions.length > 1 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Domain:</span>
                    <select
                      className="h-8 rounded-md border bg-background px-2 text-xs text-foreground"
                      value={selectedDomainFilter}
                      onChange={(e) => setSelectedDomainFilter(e.target.value)}
                    >
                      <option value="">All</option>
                      {domainOptions.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <RadioGroup
                  className="flex flex-wrap items-center gap-x-4 gap-y-2"
                  value={bulkRadioValue}
                  onValueChange={onBulkRadioChange}
                >
                  {domainOptions.length > 1 && selectedDomainFilter && (
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="domain" id="bulk-select-domain" className="shrink-0" />
                      <Label htmlFor="bulk-select-domain" className="text-xs cursor-pointer text-muted-foreground font-normal">
                        Select domain inboxes
                      </Label>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="all" id="bulk-select-all" className="shrink-0" />
                    <Label htmlFor="bulk-select-all" className="text-xs cursor-pointer text-muted-foreground font-normal">
                      Select all ({inboxes.length})
                    </Label>
                  </div>
                </RadioGroup>
                {selectedInboxes.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{selectedInboxes.length} selected</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-3 text-xs text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                      onClick={handleBulkDelete}
                      disabled={deleteInbox.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                      Delete selected
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={() => setSelectedInboxes([])}
                    >
                      Clear
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border/60">
                <TableHead className="pl-5 w-10" />
                <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider w-12 text-center">
                  #
                </TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[240px]">
                  Email
                </TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Status
                </TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <div className="flex items-center gap-1.5">
                    Reputation
                    <InboxReputationTooltip />
                  </div>
                </TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Warmup</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">Daily Limit</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">Sent Today</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right pr-5">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inboxesLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-16">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <RefreshCw className="h-5 w-5 animate-spin" />
                      <span className="text-sm">Loading inboxes…</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : inboxes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="p-0">
                    <EmptyState
                      icon={Mail}
                      headline="No inboxes yet"
                      description="Connect Gmail in Settings or create an SMTP inbox to start sending."
                      primaryAction={
                        !inboxGate.atLimit ? (
                          <Button asChild className="gradient-primary" size="sm">
                            <Link href="/inboxes/new">
                              <Plus className="mr-2 h-4 w-4" />
                              Add inbox
                            </Link>
                          </Button>
                        ) : null
                      }
                      secondaryLink={
                        <Link href="/settings?tab=integrations" className="text-sm text-primary hover:underline">
                          Settings → Integrations
                        </Link>
                      }
                      className="rounded-none border-0 border-t border-dashed py-16"
                    />
                  </TableCell>
                </TableRow>
              ) : (
                inboxes.map((inbox, index) => (
                  <InboxRow
                    key={inbox.id}
                    inbox={inbox}
                    index={index}
                    inboxSpamScores={inboxSpamScores}
                    confirmDialog={confirmDialog}
                    forceReadyInbox={forceReadyInbox}
                    deleteInbox={deleteInbox}
                    refetchInboxes={refetchInboxes}
                    selected={selectedInboxes.includes(inbox.id)}
                    onToggleSelected={() => toggleInboxSelected(inbox.id)}
                    onOpenSettings={(ibox) => {
                      setSelectedInbox(ibox);
                      setSettingsDialogOpen(true);
                    }}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <HelpLinks
          slugs={[
            "add-first-gmail-smtp-inbox",
            "manage-inbox-accounts-warmup-status",
            "understanding-inbox-status-ready-warming-warmup-required",
            "what-is-email-warmup-how-to-use-pigeon",
            "start-pause-resume-warmup-inboxes",
            "check-warmup-progress-when-inbox-ready",
          ]}
        />
      </div>

      {selectedInbox && (
        <InboxSettingsDialog
          inbox={selectedInbox}
          open={settingsDialogOpen}
          onOpenChange={setSettingsDialogOpen}
          onSuccess={() => refetchInboxes()}
        />
      )}
      <UpgradeModal
        featureKey="inboxes"
        gate={inboxGate}
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
      />
    </AppPageShell>
  );
}