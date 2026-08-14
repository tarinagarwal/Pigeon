"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  Trash2,
  Pause,
  Play,
  Mail,
  Coins,
  BarChart2,
  ArrowDownToLine,
  ShieldCheck,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useRYN, rynFetch, type RYNListing } from "@/contexts/RYNContext";
import RYNShell from "../RYNShell";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  paused: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  removed: "bg-muted text-muted-foreground",
};

const PROVIDER_META: Record<string, { label: string; color: string; icon: string }> = {
  gmail:      { label: "Gmail",       color: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",           icon: "G" },
  outlook:    { label: "Outlook",     color: "bg-primary/10 text-primary dark:bg-primary dark:text-primary",       icon: "O" },
  yahoo:      { label: "Yahoo",       color: "bg-primary/10 text-primary dark:bg-primary dark:text-primary", icon: "Y" },
  icloud:     { label: "iCloud",      color: "bg-primary/10 text-primary dark:bg-primary dark:text-primary",           icon: "i" },
  zoho:       { label: "Zoho",        color: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400", icon: "Z" },
  protonmail: { label: "Proton",      color: "bg-primary/10 text-primary dark:bg-primary dark:text-primary", icon: "P" },
  fastmail:   { label: "Fastmail",    color: "bg-primary/10 text-primary dark:bg-primary dark:text-primary",       icon: "F" },
  aol:        { label: "AOL",         color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300", icon: "A" },
  gmx:        { label: "GMX",         color: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",    icon: "X" },
  yandex:     { label: "Yandex",      color: "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200",          icon: "Я" },
  mailru:     { label: "Mail.ru",     color: "bg-primary/10 text-primary dark:bg-primary dark:text-primary",       icon: "M" },
  tutanota:   { label: "Tutanota",    color: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300", icon: "T" },
  hey:        { label: "HEY",         color: "bg-primary/10 text-primary dark:bg-primary dark:text-primary", icon: "H" },
};

function ProviderBadge({ provider }: { provider?: string | null }) {
  if (!provider || !PROVIDER_META[provider]) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-muted text-muted-foreground">
        —
      </span>
    );
  }
  const meta = PROVIDER_META[provider];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium", meta.color)}>
      <span className="font-bold text-[10px]">{meta.icon}</span>
      {meta.label}
    </span>
  );
}

export default function RYNEmailsPage() {
  const { user, isLoading } = useRYN();
  const [listings, setListings] = useState<RYNListing[]>([]);
  const [fetching, setFetching] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RYNListing | null>(null);
  // Step 1: email entry + spam check + OTP send
  // Step 2: OTP entry + note + limit + submit
  const [step, setStep] = useState<1 | 2>(1);
  const [emailInput, setEmailInput] = useState("");
  const [otp, setOtp] = useState("");
  const [note, setNote] = useState("");
  const [dailyLimit, setDailyLimit] = useState("10");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RYNListing | null>(null);

  const loadData = async () => {
    try {
      const data = await rynFetch("/ryn/emails");
      setListings(data.listings ?? []);
    } catch {
      toast.error("Failed to load listings");
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    if (user) loadData();
  }, [user]);

  const poolEligibleListings = listings.filter(
    (l) => l.status === "active" || l.status === "paused"
  );
  const providerBuckets = poolEligibleListings.reduce(
    (acc, listing) => {
      const provider = (listing.provider || "").toLowerCase();
      if (provider === "gmail") acc.gmail += 1;
      else if (provider === "outlook") acc.outlook += 1;
      else acc.others += 1;
      return acc;
    },
    { gmail: 0, outlook: 0, others: 0 }
  );
  const totalPoolCount = poolEligibleListings.length;
  const pct = (n: number) =>
    totalPoolCount > 0 ? Math.round((n / totalPoolCount) * 100) : 0;
  const providerMix = {
    gmail: pct(providerBuckets.gmail),
    outlook: pct(providerBuckets.outlook),
    others: pct(providerBuckets.others),
  };

  function openAdd() {
    setEditTarget(null);
    setStep(1);
    setEmailInput("");
    setOtp("");
    setNote("");
    setDailyLimit("10");
    setDialogOpen(true);
  }

  async function handleSendOtp() {
    if (!emailInput.trim()) {
      toast.error("Please enter an email address");
      return;
    }
    setSendingOtp(true);
    try {
      await rynFetch("/ryn/emails/verify/send", {
        method: "POST",
        body: JSON.stringify({ email: emailInput.trim() }),
      });
      toast.success(`Verification code sent to ${emailInput.trim()}`);
      setStep(2);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send code");
    } finally {
      setSendingOtp(false);
    }
  }

  function openEdit(listing: RYNListing) {
    setEditTarget(listing);
    setEmailInput(listing.email);
    setNote(listing.note ?? "");
    setDailyLimit(String(listing.daily_receive_limit ?? 10));
    setDialogOpen(true);
  }

  async function handleSave() {
    const limit = parseInt(dailyLimit, 10);
    if (isNaN(limit) || limit < 1 || limit > 20) {
      toast.error("Daily receive limit must be between 1 and 20");
      return;
    }
    setSaving(true);
    try {
      if (editTarget) {
        await rynFetch(`/ryn/emails/${editTarget.id}`, {
          method: "PATCH",
          body: JSON.stringify({ note: note || null, daily_receive_limit: limit }),
        });
        toast.success("Listing updated");
      } else {
        if (!otp.trim()) {
          toast.error("Please enter the verification code");
          setSaving(false);
          return;
        }
        await rynFetch("/ryn/emails", {
          method: "POST",
          body: JSON.stringify({ email: emailInput.trim(), otp: otp.trim(), note }),
        });
        toast.success("Email listed — you'll earn 1 credit each time it's used in warmup");
      }
      setDialogOpen(false);
      await loadData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(listing: RYNListing) {
    const newStatus = listing.status === "active" ? "paused" : "active";
    try {
      await rynFetch(`/ryn/emails/${listing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      toast.success(newStatus === "active" ? "Listing resumed" : "Listing paused");
      await loadData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await rynFetch(`/ryn/emails/${deleteTarget.id}`, { method: "DELETE" });
      toast.success("Listing removed");
      setDeleteTarget(null);
      await loadData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  if (isLoading || fetching) {
    return (
      <RYNShell>
        <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
          Loading…
        </div>
      </RYNShell>
    );
  }

  return (
    <RYNShell>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">My Email Listings</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              List your connected warmup emails to earn{" "}
              <span className="font-medium text-foreground">1 credit</span> each time they&apos;re used.
            </p>
          </div>
          <Button onClick={openAdd}>
            <Plus className="w-4 h-4 mr-1.5" />
            Add email
          </Button>
        </div>
        <div className="rounded-xl border border-primary/20 bg-primary/70 px-4 py-3 text-sm text-primary dark:border-primary dark:bg-primary/30 dark:text-primary">
          For better pool quality, maintain provider mix close to{" "}
          <span className="font-semibold">50% Gmail</span>,{" "}
          <span className="font-semibold">40% Outlook</span>, and{" "}
          <span className="font-semibold">10% others</span> (Yahoo, Zoho, Hostinger, etc.).
        </div>
        <div className="rounded-xl border bg-card px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Live provider mix (active + paused listings)</p>
            <p className="text-xs text-muted-foreground">
              {totalPoolCount} listing{totalPoolCount === 1 ? "" : "s"}
            </p>
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg border p-2">
              <p className="font-medium">Gmail</p>
              <p className="text-muted-foreground mt-0.5">
                {providerMix.gmail}% now (target 50%)
              </p>
            </div>
            <div className="rounded-lg border p-2">
              <p className="font-medium">Outlook</p>
              <p className="text-muted-foreground mt-0.5">
                {providerMix.outlook}% now (target 40%)
              </p>
            </div>
            <div className="rounded-lg border p-2">
              <p className="font-medium">Others</p>
              <p className="text-muted-foreground mt-0.5">
                {providerMix.others}% now (target 10%)
              </p>
            </div>
          </div>
        </div>

        {/* Listings */}
        {listings.length === 0 ? (
          <div className="rounded-xl border bg-muted/30 p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
              <Mail className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No listings yet</p>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              Add an email from your warmup network and earn 1 credit every time it&apos;s rented.
            </p>
            <Button size="sm" onClick={openAdd}>
              <Plus className="w-4 h-4 mr-1" />
              Add your first email
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {listings.map((listing) => (
              <div
                key={listing.id}
                className="rounded-xl border bg-card px-4 py-3.5 flex items-center gap-4"
              >
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Mail className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{listing.email}</span>
                    <span
                      className={cn(
                        "text-xs px-2 py-0.5 rounded-full font-medium capitalize",
                        STATUS_COLORS[listing.status] ?? STATUS_COLORS.removed
                      )}
                    >
                      {listing.status}
                    </span>
                    <ProviderBadge provider={listing.provider} />
                  </div>
                  {listing.note && (
                    <p className="text-xs text-muted-foreground mt-0.5">{listing.note}</p>
                  )}
                  <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Coins className="w-3 h-3 text-amber-500" />
                      1 credit/use
                    </span>
                    <span className="flex items-center gap-1">
                      <ArrowDownToLine className="w-3 h-3" />
                      {listing.daily_receive_limit ?? 10}/day limit
                    </span>
                    <span className="flex items-center gap-1">
                      <BarChart2 className="w-3 h-3" />
                      {listing.times_rented} used
                    </span>
                    <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <Coins className="w-3 h-3" />
                      {listing.credits_earned} earned
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {listing.status !== "removed" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-8 h-8"
                      title={listing.status === "active" ? "Pause" : "Resume"}
                      onClick={() => toggleStatus(listing)}
                    >
                      {listing.status === "active" ? (
                        <Pause className="w-3.5 h-3.5" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-8 h-8"
                    title="Edit note"
                    onClick={() => openEdit(listing)}
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z"/>
                    </svg>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-8 h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteTarget(listing)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editTarget ? "Edit listing" : step === 1 ? "List an email" : "Verify ownership"}
            </DialogTitle>
          </DialogHeader>

          {/* EDIT mode */}
          {editTarget && (
            <div className="space-y-4 py-1">
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/50 text-sm">
                <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="font-medium">{editTarget.email}</span>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-note">Note <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input id="d-note" placeholder="e.g. SaaS outreach…" value={note} onChange={(e) => setNote(e.target.value)} maxLength={100} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-limit">Daily receive limit</Label>
                <div className="flex items-center gap-2">
                  <Input id="d-limit" type="number" min={1} max={20} value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} className="w-24" />
                  <span className="text-sm text-muted-foreground">emails/day max</span>
                </div>
              </div>
            </div>
          )}

          {/* ADD STEP 1: email input */}
          {!editTarget && step === 1 && (
            <div className="space-y-4 py-1">
              <div className="space-y-1.5">
                <Label htmlFor="d-email">Email address</Label>
                <Input
                  id="d-email"
                  type="email"
                  placeholder="outreach@yourdomain.com"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
                />
                <p className="text-xs text-muted-foreground">
                  We&apos;ll run a spam reputation check and send a 6-digit code to verify you own this address.
                </p>
              </div>
            </div>
          )}

          {/* ADD STEP 2: OTP + note + limit */}
          {!editTarget && step === 2 && (
            <div className="space-y-4 py-1">
              {/* Verified email chip */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-700 text-sm">
                <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                <span className="font-medium text-emerald-700 dark:text-emerald-300 truncate">{emailInput}</span>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="d-otp">Verification code</Label>
                <Input
                  id="d-otp"
                  type="text"
                  inputMode="numeric"
                  placeholder="123456"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  autoFocus
                  className="tracking-widest text-center text-lg font-mono"
                />
                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={sendingOtp}
                  className="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
                >
                  <RotateCcw className="w-3 h-3" />
                  {sendingOtp ? "Sending…" : "Resend code"}
                </button>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="d-note">Note <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input id="d-note" placeholder="e.g. SaaS outreach, personal brand…" value={note} onChange={(e) => setNote(e.target.value)} maxLength={100} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="d-limit">Daily receive limit</Label>
                <div className="flex items-center gap-2">
                  <Input id="d-limit" type="number" min={1} max={20} value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} className="w-24" />
                  <span className="text-sm text-muted-foreground">warmup emails/day max (1–20)</span>
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 px-3 py-2.5">
                <Coins className="w-4 h-4 text-amber-500 shrink-0" />
                <div className="text-xs">
                  <span className="font-medium text-amber-700 dark:text-amber-300">1 credit earned</span>
                  <span className="text-muted-foreground"> each time this email is used in warmup. Releases after a reply.</span>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            {editTarget ? (
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            ) : step === 1 ? (
              <Button onClick={handleSendOtp} disabled={sendingOtp || !emailInput.trim()}>
                {sendingOtp ? "Checking…" : "Send code"}
              </Button>
            ) : (
              <Button onClick={handleSave} disabled={saving || otp.length !== 6}>
                {saving ? "Listing…" : "List email"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove listing?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{deleteTarget?.email}</span> will no longer
            be available for renting. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </RYNShell>
  );
}
