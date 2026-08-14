"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Gift,
  Clock,
  Lock,
  Unlock,
  ArrowRight,
  ChevronDown,
  CircleDollarSign,
  MailOpen,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Info,
  Timer,
  RefreshCw,
  Banknote,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useRYN, rynFetch, type RYNTransaction } from "@/contexts/RYNContext";
import RYNShell from "../RYNShell";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────
interface PendingHold {
  id: string;
  amount: number;
  description: string;
  hold_until: string;
  created_at: string;
}

interface CreditsData {
  credits_balance: number;
  credits_held: number;
  credits_total_earned: number;
  credits_total_spent: number;
  hold_hours: number;
  pending_holds: PendingHold[];
  transactions: RYNTransaction[];
}

const MIN_WITHDRAW_CREDITS = 500;
const PLATFORM_FEE_PERCENT = 10;

// ─── Guide content ──────────────────────────────────────────────────────────
const HOW_CREDITS_WORK = [
  {
    icon: TrendingUp,
    color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400",
    title: "Earning credits",
    body: "Every time another user rents one of your listed emails for warmup, you earn credits into your held balance right away. Those credits move to your available balance once the platform confirms a reply on that warmup message. If that doesn’t happen within 48 hours, the renter is refunded and that held amount does not become yours.",
  },
  {
    icon: TrendingDown,
    color: "bg-primary/10 text-primary dark:bg-primary dark:text-primary",
    title: "Spending credits",
    body: "When you rent someone else's email listing, the listed credit cost is deducted from your available balance immediately. Only your available (released) balance can be spent — held credits are not spendable.",
  },
  {
    icon: Lock,
    color: "bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400",
    title: "Held until reply",
    body: "While credits are held, they show in your balance card but are not spendable. They release to your available balance when a reply is tracked on that rental’s warmup send.\n\nYou have up to 48 hours from send for that to happen. If it doesn’t, the renter’s credits are refunded and the held amount is removed — you don’t keep that earning for that use.",
  },
  {
    icon: RefreshCw,
    color: "bg-primary/10 text-primary dark:bg-primary dark:text-primary",
    title: "Credit flow between users",
    body: "When User A rents User B’s listed email:\n① User A’s available balance is charged immediately.\n② User B gets credits in held balance.\n③ When a reply is confirmed on that warmup, User B’s credits move to available. If not within 48 hours, User A is refunded and User B does not earn that use.\n\nOn a successful earn, the platform takes no cut — 100% of credits go to the listing owner.",
  },
  {
    icon: Unlock,
    color: "bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400",
    title: "No expiry, no lock-in",
    body: "Credits never expire. Your balance carries over indefinitely. You can pause or remove any listing at any time without losing earned credits. Credits already in your available balance are yours permanently.",
  },
  {
    icon: Gift,
    color: "bg-primary/10 text-primary",
    title: "Bonus credits",
    body: "Occasionally, bonus credits may be added to your account (e.g. for promotional events). Bonus credits are added directly to your available balance — no hold period applies.",
  },
];

const FAQ = [
  {
    q: "What does “reply-based release” mean for my earnings?",
    a: "When someone rents your listed email for warmup, we wait for a reply signal on that send. Your held credits release to your available balance once a reply is detected. The transaction list may say “releases on reply” for those entries.",
  },
  {
    q: "What if there’s no reply within 48 hours?",
    a: "If engagement isn’t confirmed within about 48 hours of that warmup send, the renter’s credits are refunded and you don’t keep that held amount for that rental — it won’t move to your available balance.",
  },
  {
    q: "Can I spend credits that are currently on hold?",
    a: "No. Only your available (released) balance can be used to rent other emails. Held credits stay locked until they qualify (reply detected) or the window ends without qualifying.",
  },
  {
    q: "Can I withdraw credits as cash?",
    a: `Yes. Open Withdrawals in the sidebar (minimum ${MIN_WITHDRAW_CREDITS} available credits). A ${PLATFORM_FEE_PERCENT}% platform fee applies to the amount you request; the rest is paid out after an admin processes your request.`,
  },
  {
    q: "What happens if the platform removes a listing I rented?",
    a: "If a listing you paid for is removed by the owner after your transaction, your credits are not automatically refunded. Contact support if you believe a rental was unfairly removed.",
  },
  {
    q: "Is there a minimum balance required?",
    a: "No minimum. You simply need enough available credits to cover the cost of any listing you want to rent.",
  },
  {
    q: "What if I pause my listing while credits are on hold?",
    a: "Pausing only stops new rentals. Existing held credits still follow the same rules: they release on reply, or drop off if the 48-hour window expires without qualifying.",
  },
  {
    q: "Can I gift credits to another user?",
    a: "Direct credit transfers between users are not supported. Credits can only move through rental transactions.",
  },
];

// ─── Countdown helper ────────────────────────────────────────────────────────
function holdCountdown(holdUntil: string): string {
  const diff = new Date(holdUntil).getTime() - Date.now();
  if (diff <= 0) return "Releasing soon…";
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m remaining`;
  return `${m}m remaining`;
}

function holdProgress(createdAt: string, holdUntil: string): number {
  const total = new Date(holdUntil).getTime() - new Date(createdAt).getTime();
  const elapsed = Date.now() - new Date(createdAt).getTime();
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

// ─── Sub-components ──────────────────────────────────────────────────────────
function BalanceCard({ data }: { data: CreditsData }) {
  return (
    <div className="rounded-2xl border bg-card overflow-hidden">
      {/* Gradient header */}
      <div className="gradient-primary px-6 py-6 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 rounded-full bg-white/10 -translate-y-1/2 translate-x-1/4" />
        <p className="text-sm text-white/80 mb-1 relative">Available balance</p>
        <div className="flex items-end gap-2 relative">
          <span className="text-5xl font-black tabular-nums">{data.credits_balance.toLocaleString()}</span>
          <span className="text-lg text-white/70 mb-1">credits</span>
        </div>
        {data.credits_held > 0 && (
          <div className="mt-3 inline-flex items-center gap-1.5 bg-white/20 backdrop-blur-sm rounded-lg px-3 py-1.5 text-xs font-medium relative">
            <Lock className="w-3 h-3" />
            {data.credits_held} credits held (pending reply)
          </div>
        )}
      </div>
      {/* Stats row */}
      <div className="grid grid-cols-3 divide-x">
        <div className="px-4 py-4">
          <p className="text-xs text-muted-foreground">On hold</p>
          <p className="text-base font-bold text-amber-600 dark:text-amber-400 tabular-nums flex items-center gap-1 mt-0.5">
            <Lock className="w-3.5 h-3.5" />
            {data.credits_held.toLocaleString()}
          </p>
        </div>
        <div className="px-4 py-4">
          <p className="text-xs text-muted-foreground">Total earned</p>
          <p className="text-base font-bold text-emerald-600 dark:text-emerald-400 tabular-nums flex items-center gap-1 mt-0.5">
            <TrendingUp className="w-3.5 h-3.5" />
            {data.credits_total_earned.toLocaleString()}
          </p>
        </div>
        <div className="px-4 py-4">
          <p className="text-xs text-muted-foreground">Total spent</p>
          <p className="text-base font-bold text-primary dark:text-primary tabular-nums flex items-center gap-1 mt-0.5">
            <TrendingDown className="w-3.5 h-3.5" />
            {data.credits_total_spent.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}

function PendingHoldCard({ hold }: { hold: PendingHold }) {
  const progress = holdProgress(hold.created_at, hold.hold_until);
  const countdown = holdCountdown(hold.hold_until);
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
            <Lock className="w-3.5 h-3.5" />
          </div>
          <div>
            <p className="text-sm font-medium">+{hold.amount} credits held</p>
            <p className="text-xs text-muted-foreground truncate max-w-[220px]">{hold.description}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1 justify-end">
            <Timer className="w-3 h-3" />
            {countdown}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Settles by {new Date(hold.hold_until).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      </div>
      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-amber-400 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">{Math.round(progress)}% of 48h window — earn when a reply lands before then</p>
    </div>
  );
}

function TransactionRow({ tx }: { tx: RYNTransaction }) {
  const isHeld = tx.type === "earn_held";
  const isEarn = tx.type === "earn";
  const isExpired = tx.type === "earn_expired";
  const isRefund = tx.type === "refund";
  const isBonus = tx.type === "bonus";
  const isWithdraw = tx.type === "withdraw";

  const iconBg = isWithdraw
    ? "bg-primary/10 text-primary dark:bg-primary dark:text-primary"
    : isHeld
    ? "bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400"
    : isExpired
    ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
    : isRefund
    ? "bg-primary/10 text-primary dark:bg-primary dark:text-primary"
    : isBonus
    ? "bg-primary/10 text-primary dark:bg-primary dark:text-primary"
    : isEarn
    ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400"
    : "bg-primary/10 text-primary dark:bg-primary dark:text-primary";

  const Icon = isWithdraw
    ? Banknote
    : isHeld
    ? Lock
    : isExpired
    ? AlertCircle
    : isRefund
    ? RefreshCw
    : isBonus
    ? Gift
    : isEarn || tx.amount > 0
    ? TrendingUp
    : TrendingDown;

  const typeLabel: Record<string, string> = {
    earn_held: "held",
    earn: "earned",
    earn_expired: "expired",
    spend: "spent",
    refund: "refunded",
    bonus: "bonus",
    withdraw: "withdrawal",
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
      <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0", iconBg)}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{tx.description}</p>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
          <Clock className="w-2.5 h-2.5" />
          {new Date(tx.created_at).toLocaleString(undefined, {
            month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit",
          })}
          <span className={cn(
            "px-1.5 py-0.5 rounded text-[10px] font-medium",
            isWithdraw ? "bg-primary/10 text-primary dark:bg-primary dark:text-primary" :
            isHeld ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400" :
            isExpired ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" :
            isRefund ? "bg-primary/10 text-primary dark:bg-primary dark:text-primary" :
            isEarn ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" :
            isBonus ? "bg-primary/10 text-primary dark:bg-primary dark:text-primary" :
            "bg-primary/10 text-primary dark:bg-primary dark:text-primary"
          )}>
            {typeLabel[tx.type] ?? tx.type}
          </span>
        </p>
      </div>
      <span className={cn(
        "text-sm font-bold tabular-nums shrink-0",
        isWithdraw ? "text-primary dark:text-primary" :
        isHeld ? "text-amber-600 dark:text-amber-400" :
        isExpired ? "text-zinc-400" :
        isRefund ? "text-primary dark:text-primary" :
        isEarn || isBonus ? "text-emerald-600 dark:text-emerald-400" :
        "text-primary dark:text-primary"
      )}>
        {tx.amount > 0 ? "+" : ""}{tx.amount}
      </span>
    </div>
  );
}

function GuideCard({ icon: Icon, color, title, body }: {
  icon: React.ElementType; color: string; title: string; body: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-5 space-y-3 hover:border-primary/20 hover:shadow-sm transition-all">
      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", color)}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <h3 className="font-semibold text-sm mb-1.5">{title}</h3>
        <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">{body}</p>
      </div>
    </div>
  );
}

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-muted/30 transition-colors gap-3"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-sm font-medium">{q}</span>
        <Info className={cn("w-4 h-4 shrink-0 transition-colors", open ? "text-primary" : "text-muted-foreground")} />
      </button>
      {open && (
        <div className="px-4 pb-4 border-t">
          <p className="text-xs text-muted-foreground leading-relaxed pt-3">{a}</p>
        </div>
      )}
    </div>
  );
}

function CreditFlowDiagram() {
  const steps = [
    { icon: CircleDollarSign, label: "Listing used", sub: "Renter pays; credits go to held" },
    { icon: Lock, label: "Held", sub: "Waiting for a reply on that warmup" },
    { icon: MailOpen, label: "Reply detected", sub: "Reply tracked → credits release" },
    { icon: TrendingUp, label: "Available", sub: "Spendable in your balance" },
  ];

  function stepAccent(i: number) {
    return i === 1 || i === 2
      ? "bg-amber-500 shadow-amber-200 dark:shadow-amber-900"
      : "gradient-primary shadow-primary/20";
  }

  return (
    <div className="rounded-2xl border bg-card p-6">
      <h3 className="font-semibold mb-5 text-sm">From rental to available balance</h3>

      {/* Mobile: vertical — arrows between steps, aligned */}
      <div className="flex flex-col items-center sm:hidden max-w-sm mx-auto gap-0">
        {steps.map(({ icon: Icon, label, sub }, i) => (
          <Fragment key={label}>
            <div className="flex flex-col items-center text-center w-full">
              <div
                className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 shadow-md",
                  stepAccent(i)
                )}
              >
                <Icon className="w-5 h-5" />
              </div>
              <div className="mt-2 min-h-[3rem] w-full px-1">
                <p className="text-xs font-semibold leading-tight">{label}</p>
                <p className="text-[10px] text-muted-foreground leading-snug mt-1">{sub}</p>
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className="flex h-8 items-center justify-center py-1" aria-hidden>
                <ChevronDown className="w-5 h-5 text-muted-foreground/45" strokeWidth={2} />
              </div>
            )}
          </Fragment>
        ))}
      </div>

      {/* Desktop: icon row + arrow row alignment; labels equal height */}
      <div className="hidden sm:block w-full">
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] gap-x-0 gap-y-3">
          {steps.map(({ icon: Icon, label, sub }, i) => (
            <Fragment key={label}>
              <div className="flex justify-center" style={{ gridColumn: i * 2 + 1, gridRow: 1 }}>
                <div
                  className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-md shrink-0",
                    stepAccent(i)
                  )}
                >
                  <Icon className="w-5 h-5" />
                </div>
              </div>
              {i < steps.length - 1 && (
                <div
                  className="flex items-center justify-center px-0.5"
                  style={{ gridColumn: i * 2 + 2, gridRow: 1 }}
                  aria-hidden
                >
                  <ArrowRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
                </div>
              )}
              <div
                className="text-center px-1 min-h-[3.25rem] flex flex-col justify-start"
                style={{ gridColumn: i * 2 + 1, gridRow: 2 }}
              >
                <p className="text-xs font-semibold leading-tight">{label}</p>
                <p className="text-[10px] text-muted-foreground leading-snug mt-1">{sub}</p>
              </div>
            </Fragment>
          ))}
        </div>
      </div>

      {/* Two-column explanation */}
      <div className="mt-6 grid sm:grid-cols-2 gap-3">
        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-4 py-3 space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
            <Lock className="w-3.5 h-3.5" /> Held balance
          </div>
          <p className="text-xs text-amber-700/80 dark:text-amber-400/80 leading-relaxed">
            Earned but not yet spendable. Visible on your balance card. Releases to available when a reply is confirmed; if not within ~48 hours, the renter is refunded and you don’t keep that credit for that use.
          </p>
        </div>
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-4 py-3 space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            <Unlock className="w-3.5 h-3.5" /> Available balance
          </div>
          <p className="text-xs text-emerald-700/80 dark:text-emerald-400/80 leading-relaxed">
            Released credits ready to spend. Can be used to rent any email in the network. Spent credits are deducted instantly.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function RYNCreditsPage() {
  const { user, isLoading } = useRYN();
  const [data, setData] = useState<CreditsData | null>(null);
  const [fetching, setFetching] = useState(true);

  const loadCredits = useCallback(async () => {
    if (!user) return;
    setFetching(true);
    try {
      const c = await rynFetch("/ryn/credits");
      setData(c);
    } catch {
      toast.error("Failed to load credits");
    } finally {
      setFetching(false);
    }
  }, [user]);

  useEffect(() => {
    loadCredits();
  }, [loadCredits]);

  if (isLoading || fetching) {
    return (
      <RYNShell>
        <div className="p-6 max-w-4xl mx-auto space-y-4">
          <div className="h-40 rounded-2xl bg-muted animate-pulse" />
          <div className="h-6 w-32 rounded bg-muted animate-pulse" />
          <div className="grid grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => <div key={i} className="h-32 rounded-xl bg-muted animate-pulse" />)}
          </div>
        </div>
      </RYNShell>
    );
  }

  const txs = data?.transactions ?? [];
  const holds = data?.pending_holds ?? [];

  return (
    <RYNShell>
      <div className="p-6 max-w-4xl mx-auto space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-xl font-semibold">Credits & Guide</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Your balance, held credits (reply-based), transaction history, and how credits work. To cash out, use{" "}
            <Link href="/rent/withdraw" className="text-primary font-medium hover:underline">
              Withdrawals
            </Link>
            .
          </p>
        </div>

        {/* Balance card */}
        {data && <BalanceCard data={data} />}

        {/* Zero-balance CTA */}
        {data?.credits_balance === 0 && data.credits_held === 0 && (
          <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3.5">
            <AlertCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">You have no credits yet</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                List an email account and earn credits when others rent it.
              </p>
            </div>
            <Button size="sm" asChild>
              <Link href="/rent/emails">List an email <ArrowRight className="w-3.5 h-3.5 ml-1.5" /></Link>
            </Button>
          </div>
        )}

        {/* Pending holds */}
        {holds.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-base font-semibold">Pending holds</h2>
              <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium">
                {holds.length} active
              </span>
            </div>
            <div className="space-y-2">
              {holds.map((h) => <PendingHoldCard key={h.id} hold={h} />)}
            </div>
          </div>
        )}

        {/* Transaction history */}
        <div>
          <h2 className="text-base font-semibold mb-3">Transaction history</h2>
          {txs.length === 0 ? (
            <div className="rounded-3xl border-[3px] border-foreground bg-card p-8 text-center text-sm text-muted-foreground shadow-[5px_5px_0_0_hsl(var(--foreground))]">
              No transactions yet. Credits appear here when you earn, spend, or withdraw (see{" "}
              <Link href="/rent/withdraw" className="text-primary font-medium hover:underline">
                Withdrawals
              </Link>
              ).
            </div>
          ) : (
            <div className="rounded-xl border bg-card divide-y overflow-hidden">
              {txs.map((tx) => <TransactionRow key={tx.id} tx={tx} />)}
            </div>
          )}
        </div>

        <div className="border-t" />

        {/* Flow diagram */}
        <div>
          <div className="mb-4">
            <h2 className="text-base font-semibold">How credits work</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Credits are the in-platform currency of Rent Your Network.
            </p>
          </div>
          <CreditFlowDiagram />
        </div>

        {/* Guide cards */}
        <div>
          <h2 className="text-base font-semibold mb-4">Credits guide</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {HOW_CREDITS_WORK.map((item) => <GuideCard key={item.title} {...item} />)}
          </div>
        </div>

        {/* Balance rules */}
        <div className="rounded-2xl border bg-card p-5 space-y-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            Balance rules at a glance
          </h3>
          <div className="space-y-2.5">
            {[
              { icon: CheckCircle2, color: "text-emerald-500", text: "Available balance = spendable right now." },
              { icon: CheckCircle2, color: "text-emerald-500", text: "Held balance = credits from rentals waiting for a reply (or the ~48h window to end without qualifying)." },
              { icon: CheckCircle2, color: "text-emerald-500", text: "Renter's credits are deducted instantly at the moment of rental." },
              { icon: CheckCircle2, color: "text-emerald-500", text: "You earn the held amount when a reply is tracked; if not in time, the renter is refunded." },
              { icon: CheckCircle2, color: "text-emerald-500", text: "Credits never expire and carry over indefinitely." },
              { icon: CheckCircle2, color: "text-emerald-500", text: "Pausing or removing a listing does not affect existing holds or your balance." },
              { icon: AlertCircle, color: "text-amber-500", text: "Held credits cannot be spent until they release to available." },
              { icon: Banknote, color: "text-emerald-500", text: `Cash withdrawal: minimum ${MIN_WITHDRAW_CREDITS} credits, ${PLATFORM_FEE_PERCENT}% fee — open Withdrawals in the sidebar.` },
            ].map(({ icon: Icon, color, text }) => (
              <div key={text} className="flex items-start gap-2.5">
                <Icon className={cn("w-4 h-4 shrink-0 mt-0.5", color)} />
                <p className="text-xs text-muted-foreground leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div>
          <h2 className="text-base font-semibold mb-4">Frequently asked questions</h2>
          <div className="space-y-2">
            {FAQ.map((item) => <FAQItem key={item.q} {...item} />)}
          </div>
        </div>

      </div>
    </RYNShell>
  );
}
