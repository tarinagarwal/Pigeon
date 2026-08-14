"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  Search,
  Mail,
  Star,
  Archive,
  Trash2,
  MoreHorizontal,
  Paperclip,
  Clock,
  Reply,
  Forward,
  Tag,
  Info,
  Loader2,
  RefreshCw,
  Sparkles,
  PenSquare,
  Check,
  Globe,
  ChevronDown,
  Maximize2,
  Minimize2,
  Send,
  Flame,
  X,
  ArrowLeft,
  Inbox as InboxIcon,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  useInboxEmails,
  useArchiveEmail,
  useDeleteEmail,
  useTagEmail,
  useMarkEmailAsRead,
  useMarkAllAsRead,
  useArchiveAll,
  useCheckReplies,
  useSendReply,
  useSendReceivedReply,
  useToggleStarEmail,
} from "@/hooks/useInboxEmails";
import { useLLMConfigs } from "@/hooks/useLLM";
import { useAiEmailGenerator } from "@/hooks/useAiEmailGenerator";
import { api } from "@/lib/api";
import type { InboundMessage, InboxEmail, Inbox } from "@/types/api";
import { toast } from "sonner";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { formatDistanceToNow, format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePlanGate } from "@/hooks/usePlanGate";
import { UpgradeModal } from "@/components/UpgradeModal";
import { HelpLinks } from "@/components/HelpLinks";
import { EmailHtmlViewer } from "@/components/EmailHtmlViewer";
import { RichTextEditor } from "@/components/RichTextEditor";
import { ThreadMessageCard } from "@/components/mail/ThreadMessageCard";
import { AppPageShell } from "@/components/AppPageShell";
import { EmptyState } from "@/components/EmptyState";
import { htmlToPlainText, threadSnippet } from "@/lib/templateBody";

/** True if content looks like HTML (contains tags), so it should be rendered with EmailHtmlViewer. */
function looksLikeHtml(str: string): boolean {
  return typeof str === "string" && /[<][a-z!/][^>]*>/i.test(str);
}

function cleanMailboxHeaderValue(value?: string | null): string {
  if (!value) return "";
  return value.replace(/^\s*(from|to)\s*:\s*/i, "").trim();
}

function mailboxListFromLabel(msg: InboundMessage): string {
  if (msg.compose_email) {
    return cleanMailboxHeaderValue(msg.sender_email) || cleanMailboxHeaderValue(msg.from) || "—";
  }
  return cleanMailboxHeaderValue(msg.from) || "—";
}

function mailboxListToLabel(msg: InboundMessage): string {
  if (msg.compose_email) {
    return cleanMailboxHeaderValue(msg.to) || "—";
  }
  return cleanMailboxHeaderValue(msg.to) || "—";
}

const PREVIEW_URL_REGEX = /(https?:\/\/[^\s<>"']+)/gi;
const PREVIEW_LINK_MAX = 52;

/** Renders preview text as plain text (no clickable links); container breaks/crops overflow. */
function PreviewWithLinks({ text, className = "" }: { text: string; className?: string }) {
  if (!text) return <span className={className} />;
  return (
    <p className={cn("text-sm text-muted-foreground break-words overflow-hidden line-clamp-2 min-w-0", className)}>
      {text}
    </p>
  );
}

/** Same linkify + break behavior as list preview but for full body: URLs clickable (full href), long text wraps. */
function BodyWithLinks({ text, className = "" }: { text: string; className?: string }) {
  if (!text) return null;
  const parts = text.split(PREVIEW_URL_REGEX);
  return (
    <div className={cn("whitespace-pre-wrap break-words overflow-hidden min-w-0", className)}>
      {parts.map((part, i) => {
        const isUrl = /^https?:\/\//i.test(part);
        if (isUrl) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline break-all"
              onClick={(e) => e.stopPropagation()}
            >
              {part}
            </a>
          );
        }
        return part;
      })}
    </div>
  );
}

import Link from "next/link";

type PlanGateAi = { atLimit: boolean; upgradeLine?: string | null };

/** Escape plain text and wrap as HTML for TipTap when AI returns plain text. */
function plainTextToReplyHtml(text: string): string {
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<p>${esc.replace(/\n/g, "<br />")}</p>`;
}

function InboxReplyComposerForm({
  replyTarget,
  firstInboundInThread,
  selected,
  replyCc,
  setReplyCc,
  replySubject,
  setReplySubject,
  replyBody,
  setReplyBody,
  onCancel,
  onSend,
  isPending,
  handleAiReply,
  aiReplyLoading,
  llmConfigsLength,
  aiGate,
  setUpgradeOpen,
}: {
  replyTarget: "campaign" | "received";
  firstInboundInThread: { from?: string } | null | undefined;
  selected: InboxEmail | undefined;
  replyCc: string;
  setReplyCc: (v: string) => void;
  replySubject: string;
  setReplySubject: (v: string) => void;
  replyBody: string;
  setReplyBody: (v: string) => void;
  onCancel: () => void;
  onSend: () => void;
  isPending: boolean;
  handleAiReply: () => void | Promise<void>;
  aiReplyLoading: boolean;
  llmConfigsLength: number;
  aiGate: PlanGateAi;
  setUpgradeOpen: (open: boolean) => void;
}) {
  const [ccExpanded, setCcExpanded] = useState(false);
  const toEmail = replyTarget === "received" ? firstInboundInThread?.from : selected?.senderEmail;
  const toLabel =
    replyTarget === "campaign" && selected?.sender && selected.sender !== selected.senderEmail
      ? `${selected.senderEmail} (${selected.sender})`
      : toEmail;

  useEffect(() => {
    if (replyCc.trim()) setCcExpanded(true);
  }, [replyCc]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground leading-relaxed px-0.5">
        {replyTarget === "received" ? (
          <>
            Your reply is sent from your connected sending account (Inboxes). It will not appear in your personal Gmail
            Sent unless that account is Gmail. The recipient will see it in their Inbox—ask them to check Spam if they
            don&apos;t see it.
          </>
        ) : (
          <>
            Your reply will be sent to the contact&apos;s email. If that address doesn&apos;t exist or can&apos;t receive
            mail, you&apos;ll get a bounce.
          </>
        )}
      </p>
      <div
        className={cn(
          "rounded-2xl border border-border/80 bg-card text-card-foreground",
          "shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]",
          "overflow-hidden"
        )}
      >
        <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-border/60 bg-muted/20">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div
              className="h-10 w-10 shrink-0 rounded-full bg-primary/12 text-primary flex items-center justify-center text-sm font-semibold"
              aria-hidden
            >
              {(toLabel || "?").trim().charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 pt-0.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Reply to</p>
              <p className="text-sm font-medium text-foreground truncate" title={toLabel}>
                {toLabel || "Recipient"}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0 group h-8"
            onClick={() => {
              if (aiGate.atLimit) {
                toast.error(aiGate.upgradeLine ?? "AI Reply is available on higher plans.");
                setUpgradeOpen(true);
                return;
              }
              void handleAiReply();
            }}
            disabled={llmConfigsLength === 0 || aiReplyLoading}
          >
            {aiReplyLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-accent group-hover:text-white transition-colors" />
            )}
            <span className="hidden sm:inline">
              {aiReplyLoading ? "Generating…" : aiGate.atLimit ? "Upgrade" : "AI Reply"}
            </span>
          </Button>
        </div>
        <div className="px-4 pt-3 pb-1">
          <label htmlFor="inbox-reply-subject" className="sr-only">
            Subject
          </label>
          <Input
            id="inbox-reply-subject"
            value={replySubject}
            onChange={(e) => setReplySubject(e.target.value)}
            placeholder="Subject"
            className="border-0 border-b border-transparent rounded-none px-0 h-auto py-1.5 text-base font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-primary/40 bg-transparent placeholder:text-muted-foreground/60"
          />
        </div>
        <div className="px-4 pb-2">
          {ccExpanded ? (
            <div className="space-y-1.5 pt-1 animate-in fade-in slide-in-from-top-1 duration-200">
              <Label htmlFor="inbox-reply-cc" className="text-xs text-muted-foreground">
                Cc
              </Label>
              <Input
                id="inbox-reply-cc"
                type="text"
                value={replyCc}
                onChange={(e) => setReplyCc(e.target.value)}
                placeholder="Optional, comma-separated"
                className="h-9 text-sm bg-muted/30 border-border/60"
              />
            </div>
          ) : (
            <button
              type="button"
              className="text-xs font-medium text-primary hover:underline py-1"
              onClick={() => setCcExpanded(true)}
            >
              Cc
            </button>
          )}
        </div>
        <div className="px-2 sm:px-3 pb-2">
          <RichTextEditor
            value={replyBody}
            onChange={setReplyBody}
            placeholder="Compose email"
            className={cn("border-0 shadow-none rounded-none rounded-b-xl bg-white", "[&_.tiptap]:min-h-[200px]")}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-border/60 bg-muted/15">
          <Button
            className="gap-2 rounded-full gradient-primary px-6 shadow-sm"
            onClick={onSend}
            disabled={isPending || !replySubject.trim() || !htmlToPlainText(replyBody).trim()}
          >
            {isPending ? (
              "Sending..."
            ) : (
              <>
                <Send className="w-4 h-4" />
                Send
              </>
            )}
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onCancel}>
            Discard
          </Button>
        </div>
      </div>
    </div>
  );
}

type MailboxGroup = {
  domain: string;
  inboxes: Inbox[];
};

/** Threads per request / per “Load older” batch (matches backend default cap). */
const MAILBOX_PAGE_SIZE = 50;
const MAX_CAMPAIGN_LIST = 50;

export function InboxPageContent({ inboxView }: { inboxView: "campaign" | "received" }) {
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();

  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [filter, setFilter] = useState("replied");
  const [searchQuery, setSearchQuery] = useState("");
  const [isFullScreen, setIsFullScreen] = useState(true);

  const {
    data: emails = [],
    isLoading: emailsLoading,
    isError: emailsError,
    error: emailsErrorMsg,
    refetch: refetchCampaign,
    isRefetching: campaignRefetching,
  } = useInboxEmails(userId, filter === "all" ? undefined : filter, inboxView === "campaign");
  const archiveEmail = useArchiveEmail();
  const deleteEmail = useDeleteEmail();
  const tagEmail = useTagEmail();
  const markEmailAsRead = useMarkEmailAsRead();
  const markAllAsRead = useMarkAllAsRead();
  const archiveAll = useArchiveAll();
  const checkReplies = useCheckReplies();
  const sendReply = useSendReply();
  const sendReceivedReply = useSendReceivedReply();
  const toggleStarEmail = useToggleStarEmail();
  const { data: llmConfigs = [] } = useLLMConfigs(userId);
  const { generateEmail, loading: aiReplyLoading } = useAiEmailGenerator(userId);

  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagEmailId, setTagEmailId] = useState<string | null>(null);
  const [tagName, setTagName] = useState("");
  const [replyDialogOpen, setReplyDialogOpen] = useState(false);
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [replyCc, setReplyCc] = useState("");
  const [replyTarget, setReplyTarget] = useState<"campaign" | "received">("campaign");
  const [mailboxFilter, setMailboxFilter] = useState<"all" | "sent" | "replied" | "unreplied">("all");
  /** When true, exclude threads that include a warmup reply (warmup_thread). */
  const [hideWarmupThreads, setHideWarmupThreads] = useState(false);
  const [mailboxInboxId, setMailboxInboxId] = useState<string>("");
  const [collapsedDomains, setCollapsedDomains] = useState<Record<string, boolean>>({});
  const [selectedReceivedId, setSelectedReceivedId] = useState<string | null>(null);
  const [showSpamDescription, setShowSpamDescription] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeAbout, setComposeAbout] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeInboxId, setComposeInboxId] = useState<string>("");
  const [showAllReceivedMessages, setShowAllReceivedMessages] = useState<boolean>(false);
  const latestThreadMessageRef = useRef<HTMLDivElement | null>(null);

  const resetReplyComposer = () => {
    setReplyDialogOpen(false);
    setReplySubject("");
    setReplyBody("");
    setReplyCc("");
    setReplyTarget("campaign");
  };

  useEffect(() => {
    setShowSpamDescription(false);
    setShowAllReceivedMessages(false);
  }, [selectedReceivedId]);

  useEffect(() => {
    setSelectedReceivedId(null);
    resetReplyComposer();
  }, [mailboxInboxId]);

  const receivedPagedQueryKey = [
    "inbox-received-paged",
    userId,
    mailboxInboxId || "all",
    mailboxInboxId ? "all-messages" : "unread-only",
  ] as const;
  const {
    data: receivedPagesData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: receivedPagedLoading,
    isRefetching: receivedPagedRefetching,
    refetch: refetchReceivedPaged,
  } = useInfiniteQuery({
    queryKey: receivedPagedQueryKey,
    queryFn: ({ pageParam }) => {
      const offset = typeof pageParam === "number" ? pageParam : 0;
      const params = mailboxInboxId
        ? { inbox_id: mailboxInboxId, limit: MAILBOX_PAGE_SIZE, offset }
        : { limit: MAILBOX_PAGE_SIZE, offset, unread_only: true };
      return api.inbox.getReceivedEmails(userId, params, {
        queryKey: [...receivedPagedQueryKey, offset],
        getCachedData: () => queryClient.getQueryData([...receivedPagedQueryKey, offset]),
      });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.has_more) return undefined;
      return allPages.reduce((sum, p) => sum + p.threads.length, 0);
    },
    enabled: !!userId && inboxView === "received",
  });
  const { data: receivedThread, isLoading: receivedThreadLoading } = useQuery({
    queryKey: ["inbox-received-thread", userId, selectedReceivedId],
    queryFn: () => api.inbox.getReceivedThread(selectedReceivedId!, userId),
    enabled: !!userId && !!selectedReceivedId,
  });

  const visibleReceivedThreadMessages = useMemo(
    () =>
      receivedThread?.messages && receivedThread.messages.length
        ? showAllReceivedMessages
          ? receivedThread.messages
          : receivedThread.messages.slice(-3)
        : [],
    [receivedThread?.messages, showAllReceivedMessages]
  );

  const inboxesQueryKey = ["inboxes", userId];
  const { data: inboxes = [], isLoading: inboxesLoading } = useQuery({
    queryKey: inboxesQueryKey,
    queryFn: () =>
      api.inboxes.list(userId, {
        queryKey: inboxesQueryKey,
        getCachedData: () => queryClient.getQueryData(inboxesQueryKey),
      }),
    enabled: !!userId && (composeOpen || inboxView === "received"),
  });
  /** Unread-only fetch for sidebar badge counts (all inboxes; not used for the message list). */
  const receivedAllQueryKey = ["inbox-received-all", userId] as const;
  const {
    data: receivedEmailsAllPage,
    isLoading: receivedAllLoading,
    refetch: refetchReceivedAll,
  } = useQuery({
    queryKey: receivedAllQueryKey,
    queryFn: () =>
      api.inbox.getReceivedEmails(userId, { limit: 200, unread_only: true }, {
        queryKey: [...receivedAllQueryKey],
        getCachedData: () => queryClient.getQueryData(receivedAllQueryKey),
      }),
    enabled: !!userId && inboxView === "received",
    staleTime: 30 * 1000,
  });
  const receivedEmailsAll = receivedEmailsAllPage?.threads ?? [];
  const sendComposeMutation = useMutation({
    mutationFn: ({
      toEmail,
      subject,
      body,
      inboxId,
      cc,
    }: {
      toEmail: string;
      subject: string;
      body: string;
      inboxId?: string;
      cc?: string;
    }) => api.inbox.sendCompose(userId, toEmail, subject, body, inboxId || undefined, cc),
    onSuccess: () => {
      setComposeOpen(false);
      setComposeTo("");
      setComposeCc("");
      setComposeAbout("");
      setComposeSubject("");
      setComposeBody("");
      setComposeInboxId("");
      refetchReceivedPaged();
      refetchReceivedAll();
      toast.success("Email sent.");
    },
    onError: (err: Error) => {
      toast.error(err?.message ?? "Failed to send email.");
    },
  });
  const firstInboundInThread = receivedThread?.messages?.find((m) => m.type === "inbound");
  const lastInboundInThread = receivedThread?.messages
    ? [...receivedThread.messages].reverse().find((m) => m.type === "inbound")
    : null;
  const replyToMessageId = lastInboundInThread?.id ?? firstInboundInThread?.id;

  const filteredEmails = useMemo(() => {
    if (!searchQuery) return emails;
    const query = searchQuery.toLowerCase();
    return emails.filter(
      (email: InboxEmail) =>
        email.sender.toLowerCase().includes(query) ||
        email.senderEmail.toLowerCase().includes(query) ||
        email.subject.toLowerCase().includes(query) ||
        email.preview.toLowerCase().includes(query)
    );
  }, [emails, searchQuery]);

  const visibleCampaignEmails = useMemo(
    () => filteredEmails.slice(0, MAX_CAMPAIGN_LIST),
    [filteredEmails]
  );

  const receivedEmailsForList = useMemo(() => {
    const threads = receivedPagesData?.pages.flatMap((p) => p.threads) ?? [];
    if (!mailboxInboxId) return threads;
    return threads.filter((m) => m.inbox_id === mailboxInboxId);
  }, [receivedPagesData, mailboxInboxId]);
  const selectedReceivedSummary = useMemo(
    () =>
      selectedReceivedId
        ? (receivedEmailsForList as InboundMessage[]).find(
            (m) => (m.thread_id ?? m.id) === selectedReceivedId
          )
        : undefined,
    [selectedReceivedId, receivedEmailsForList]
  );
  const selectedReceivedToValue = useMemo(
    () => cleanMailboxHeaderValue(selectedReceivedSummary?.to),
    [selectedReceivedSummary]
  );
  const selectedReceivedFromValue = useMemo(() => {
    const senderEmail = cleanMailboxHeaderValue(selectedReceivedSummary?.sender_email ?? "");
    if (senderEmail) return senderEmail;
    const fromValue = cleanMailboxHeaderValue(selectedReceivedSummary?.from);
    const toValue = cleanMailboxHeaderValue(selectedReceivedSummary?.to);
    if (fromValue && toValue && fromValue.toLowerCase() === toValue.toLowerCase()) return "";
    return fromValue;
  }, [selectedReceivedSummary]);
  const inboxUnreadCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    let allUnread = 0;
    for (const m of receivedEmailsAll) {
      if (m.is_read) continue;
      allUnread++;
      const iid = m.inbox_id;
      if (iid) {
        counts[iid] = (counts[iid] ?? 0) + 1;
      }
    }
    if (allUnread > 0) {
      counts["_all"] = allUnread;
    }
    return counts;
  }, [receivedEmailsAll]);
  const mailboxGroups: MailboxGroup[] = useMemo(() => {
    const groups: Record<string, Inbox[]> = {};

    (inboxes as Inbox[])
      .filter((inbox) => inbox.sender_type === "smtp")
      .forEach((inbox) => {
        const email = inbox.email ?? "";
        const atIndex = email.indexOf("@");
        const domain =
          atIndex !== -1 && atIndex < email.length - 1
            ? email.slice(atIndex + 1).toLowerCase()
            : "Other";

        if (!groups[domain]) {
          groups[domain] = [];
        }
        groups[domain].push(inbox);
      });

    return Object.entries(groups)
      .sort(([a, _aInboxes], [b, _bInboxes]) => a.localeCompare(b))
      .map(([domain, domainInboxes]) => ({
        domain,
        inboxes: domainInboxes.sort((a, b) => (a.email ?? "").localeCompare(b.email ?? "")),
      }));
  }, [inboxes]);
  /** Inboxes that can send mail (matches backend default when no inbox_id is sent). */
  const sendableInboxes = useMemo(
    () => (inboxes as Inbox[]).filter((i) => i.status === "ready"),
    [inboxes]
  );
  const filteredReceivedEmails = useMemo(() => {
    let list = receivedEmailsForList;
    if (!mailboxInboxId) {
      list = list.filter((m: InboundMessage) => !m.is_read);
    }
    if (mailboxFilter === "sent") {
      list = list.filter((m: InboundMessage) => !!m.compose_email || m.last_sent_reply_at != null);
    } else if (mailboxFilter === "replied") {
      list = list.filter((m: InboundMessage) => !m.compose_email && m.last_sent_reply_at != null);
    } else if (mailboxFilter === "unreplied") {
      list = list.filter((m: InboundMessage) => !m.compose_email && !m.last_sent_reply_at);
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      list = list.filter(
        (m: InboundMessage) =>
          (m.from ?? "").toLowerCase().includes(query) ||
          (m.to ?? "").toLowerCase().includes(query) ||
          (m.subject ?? "").toLowerCase().includes(query) ||
          (m.preview ?? "").toLowerCase().includes(query)
      );
    }
    if (hideWarmupThreads) {
      list = list.filter((m: InboundMessage) => !m.warmup_thread);
    }
    return list;
  }, [receivedEmailsForList, mailboxInboxId, mailboxFilter, searchQuery, hideWarmupThreads]);

  const handleArchiveEmail = (emailId: string) => {
    archiveEmail.mutate({ emailId, userId });
  };

  const handleDeleteEmail = async (emailId: string) => {
    const confirmed = await confirmDialog({
      title: "Delete email",
      description: "Are you sure you want to delete this email?",
      variant: "destructive",
    });
    if (confirmed) {
      deleteEmail.mutate(
        { emailId, userId },
        {
          onSuccess: () => {
            if (selectedEmail === emailId) setSelectedEmail(null);
          },
        }
      );
    }
  };

  const handleTagEmail = (emailId: string) => {
    setTagEmailId(emailId);
    setTagDialogOpen(true);
  };

  const handleSubmitTag = () => {
    if (!tagEmailId || !tagName.trim()) {
      toast.error("Please enter a tag name");
      return;
    }
    tagEmail.mutate(
      { emailId: tagEmailId, userId, tag: tagName.trim() },
      {
        onSuccess: () => {
          setTagDialogOpen(false);
          setTagName("");
          setTagEmailId(null);
        },
      }
    );
  };

  const selected = filteredEmails.find((e: InboxEmail) => e.id === selectedEmail);

  /** Scroll so the newest message sits at the top of the thread pane (Gmail-style). */
  useEffect(() => {
    const el = latestThreadMessageRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [
    selectedEmail,
    selectedReceivedId,
    selected?.id,
    selected?.messages?.length,
    receivedThread?.messages?.length,
    showAllReceivedMessages,
    inboxView,
  ]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullScreen) setIsFullScreen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isFullScreen]);

  const handleSelectEmail = (email: InboxEmail) => {
    if (email.id !== selectedEmail) resetReplyComposer();
    setSelectedEmail(email.id);
    if (!email.isRead && userId) {
      markEmailAsRead.mutate({ emailId: email.id, userId });
    }
  };

  const handleReply = () => {
    if (!selected) return;
    setReplyTarget("campaign");
    setReplySubject(selected.subject.startsWith("Re:") ? selected.subject : `Re: ${selected.subject}`);
    setReplyBody("");
    setReplyCc("");
    setReplyDialogOpen(true);
  };

  const handleReplyReceived = () => {
    const subjectMsg = receivedThread?.messages?.find((m) => (m as { subject?: string }).subject);
    const subject = (subjectMsg as { subject?: string } | undefined)?.subject ?? "";
    if (!replyToMessageId) return;
    setReplyTarget("received");
    setReplySubject(subject.startsWith("Re:") ? subject : `Re: ${subject}`);
    setReplyBody("");
    setReplyCc("");
    setReplyDialogOpen(true);
  };

  const handleSendReply = () => {
    if (!replySubject.trim() || !htmlToPlainText(replyBody).trim()) {
      toast.error("Please enter subject and message");
      return;
    }
    if (replyTarget === "received" && replyToMessageId) {
      sendReceivedReply.mutate(
        {
          messageId: replyToMessageId,
          userId,
          subject: replySubject.trim(),
          // Preserve user formatting (spaces/newlines). Validation above already checks non-empty.
          body: replyBody,
          cc: replyCc.trim() || undefined,
        },
        {
          onSuccess: () => {
            resetReplyComposer();
          },
        }
      );
      return;
    }
    if (!selected) {
      toast.error("Please select an email");
      return;
    }
    sendReply.mutate(
      {
        userId,
        emailLogId: selected.id,
        subject: replySubject.trim(),
        // Preserve user formatting (spaces/newlines). Validation above already checks non-empty.
        body: replyBody,
        cc: replyCc.trim() || undefined,
      },
      {
        onSuccess: () => {
          resetReplyComposer();
        },
      }
    );
  };

  const handleAiReply = async () => {
    if (llmConfigs.length === 0) {
      toast.error("Configure an AI provider in Settings to use AI Reply.");
      return;
    }
    const from =
      replyTarget === "received"
        ? (firstInboundInThread as { from?: string } | undefined)?.from
        : selected?.sender ?? selected?.senderEmail;
    const subject =
      replyTarget === "received"
        ? (firstInboundInThread as { subject?: string } | undefined)?.subject
        : selected?.subject;
    const body =
      replyTarget === "received"
        ? ((firstInboundInThread as { body_text?: string; preview?: string })?.body_text ??
          (firstInboundInThread as { body_text?: string; preview?: string })?.preview ?? "")
            .slice(0, 2000)
        : (selected?.preview ?? "").slice(0, 2000);
    const prompt = `Generate a short, professional email reply to the following message. Return ONLY in this exact format, no other text:
SUBJECT: Re: <subject line>
BODY: <reply body in plain text>

Message we're replying to:
From: ${from ?? "Unknown"}
Subject: ${subject ?? ""}

${body}`;
    const result = await generateEmail({
      prompt,
      provider: llmConfigs[0].provider,
    });
    if (result) {
      setReplySubject(result.subject);
      const body = result.body?.trim() ?? "";
      setReplyBody(!body ? "" : looksLikeHtml(body) ? body : plainTextToReplyHtml(body));
      toast.success("AI reply generated. Edit if needed, then send.");
    }
  };

  const handleForward = () => {
    if (!selected) return;
    toast.info("Forward feature coming soon");
  };

  const handleAiCompose = async () => {
    if (llmConfigs.length === 0) {
      toast.error("Configure an AI provider in Settings to use AI Write.");
      return;
    }
    if (aiGate.atLimit) {
      setUpgradeOpen(true);
      toast.error(aiGate.upgradeLine ?? "AI Write is available on higher plans.");
      return;
    }
    const about = composeAbout.trim();
    if (!about) {
      toast.error("Please describe what this email should be about so AI can generate a relevant draft.");
      return;
    }
    const prompt = `Generate a short, professional email based on the user's description. Return ONLY in this exact format, no other text:
SUBJECT: <subject line>
BODY: <email body in plain text>

What the email should be about: ${about}
Recipient: ${composeTo || "Unknown"}
${composeSubject ? `Optional subject hint: ${composeSubject}` : ""}`;
    const result = await generateEmail({
      prompt,
      provider: llmConfigs[0].provider,
    });
    if (result) {
      setComposeSubject(result.subject);
      const body = result.body?.trim() ?? "";
      setComposeBody(!body ? "" : looksLikeHtml(body) ? body : plainTextToReplyHtml(body));
      toast.success("AI draft generated. Edit if needed, then send.");
    }
  };

  const handleSendCompose = () => {
    if (!composeTo.trim() || !composeSubject.trim() || !htmlToPlainText(composeBody).trim()) {
      toast.error("Please enter To, Subject, and Message.");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(composeTo.trim())) {
      toast.error("Please enter a valid email address.");
      return;
    }
    sendComposeMutation.mutate({
      toEmail: composeTo.trim(),
      subject: composeSubject.trim(),
      // Preserve user formatting (spaces/newlines). Validation above already checks non-empty.
      body: composeBody,
      inboxId: composeInboxId || undefined,
      cc: composeCc.trim() || undefined,
    });
  };

  const handleToggleStar = (emailId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    toggleStarEmail.mutate({ emailId, userId });
  };

  const handleMarkAllAsRead = () => {
    markAllAsRead.mutate(userId);
  };

  const handleRefresh = () => {
    if (!userId) return;
    refetchCampaign();
    if (inboxView === "received") {
      refetchReceivedPaged();
      refetchReceivedAll();
      toast.success("Refreshing received mail…");
      return;
    }
    if (!checkReplies.isPending) {
      checkReplies.mutate(userId);
    }
    toast.success("Refreshing campaign replies…");
  };

  const isRefreshing = campaignRefetching || receivedPagedRefetching;
  const receivedListLoading = receivedPagedLoading;

  const handleArchiveAll = async () => {
    const confirmed = await confirmDialog({
      title: "Archive all emails",
      description: "Are you sure you want to archive all emails?",
    });
    if (confirmed) archiveAll.mutate(userId);
  };

  const handleSelectReceivedThread = (threadId: string, isRead?: boolean) => {
    if (threadId !== selectedReceivedId) resetReplyComposer();
    setSelectedReceivedId(threadId);
    if (userId && !isRead) {
      api.inbox.markReceivedThreadAsRead(threadId, userId).then(() => {
        queryClient.invalidateQueries({ queryKey: ["inbox-received-paged", userId] });
        queryClient.invalidateQueries({ queryKey: ["inbox-received-all", userId] });
      });
    }
  };

  const handleMarkSelectedReceivedAsRead = () => {
    if (!selectedReceivedId || !userId) return;
    api.inbox.markReceivedThreadAsRead(selectedReceivedId, userId).then(() => {
      queryClient.invalidateQueries({ queryKey: ["inbox-received-paged", userId] });
      queryClient.invalidateQueries({ queryKey: ["inbox-received-all", userId] });
      toast.success("Conversation marked as read.");
    });
  };

  const handleDeleteReceivedThread = async () => {
    if (!selectedReceivedId || !userId) return;
    const confirmed = await confirmDialog({
      title: "Delete conversation",
      description:
        "This will remove this MailBox conversation from Pigeon. It will not delete mail from your actual email provider.",
      variant: "destructive",
    });
    if (!confirmed) return;
    await api.inbox.deleteReceivedThread(selectedReceivedId, userId);
    setSelectedReceivedId(null);
    resetReplyComposer();
    await Promise.all([
      refetchReceivedAll(),
      queryClient.invalidateQueries({ queryKey: ["inbox-received-paged", userId] }),
    ]);
    queryClient.invalidateQueries({ queryKey: ["inbox-received-all", userId] });
    toast.success("Conversation deleted from MailBox view.");
  };

  const getLabelColor = (label: string) => {
    switch (label) {
      case "interested":
        return "bg-success/10 text-success border-success/20";
      case "lead":
        return "bg-primary/10 text-primary border-primary/20";
      case "priority":
        return "bg-accent/10 text-accent border-accent/20";
      case "follow-up":
        return "bg-warning/10 text-warning border-warning/20";
      case "replied":
        return "bg-primary/10 text-primary border-primary/20";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const formatTime = (timeString: string) => {
    try {
      const date = new Date(timeString);
      const now = new Date();
      const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
      if (diffInHours < 24) return format(date, "h:mm a");
      if (diffInHours < 48) return "Yesterday";
      if (diffInHours < 168) return formatDistanceToNow(date, { addSuffix: true });
      return format(date, "MMM d");
    } catch {
      return timeString;
    }
  };

  const aiGate = usePlanGate("ai_emails");
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  return (
    <AppPageShell
      title={inboxView === "campaign" ? "Campaign replies" : "Mailbox"}
      description={
        inboxView === "campaign"
          ? "See replies to your outreach campaigns and qualify leads in one place."
          : "All mail received at your domain addresses—support, inquiries, and more."
      }
    >
    <div className="space-y-4">
      <UpgradeModal
        featureKey="ai_emails"
        gate={aiGate}
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
      />
      {!hintDismissed && (
        <div className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/[0.04] px-3.5 py-2.5 text-sm">
          <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" />
          <p className="min-w-0 flex-1 text-muted-foreground leading-relaxed">
            {inboxView === "campaign" ? (
              <>
                <span className="font-medium text-foreground">Campaign replies.</span> Responses to
                your outreach so you can qualify leads quickly. Manage sending accounts on the{" "}
                <Link href="/inboxes" className="text-primary font-medium hover:underline">
                  Inboxes
                </Link>{" "}
                page.
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">Mailbox.</span> Every message received
                at your domain addresses—support, inquiries, and replies. Enable receiving per domain
                on the{" "}
                <Link href="/domains" className="text-primary font-medium hover:underline">
                  Domains
                </Link>{" "}
                page.
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => setHintDismissed(true)}
            className="shrink-0 -mr-1 -mt-0.5 rounded-md p-1 text-muted-foreground/70 hover:bg-primary/10 hover:text-foreground transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <div
        className={cn(
          "flex gap-0 bg-card border overflow-hidden transition-all duration-200",
          isFullScreen
            ? "fixed inset-0 z-50 rounded-none mt-0"
            : "mt-1 h-[calc(100vh-9.5rem)] rounded-xl shadow-sm"
        )}
      >
            {/* Mailbox sidebar (MailBox view only) */}
            {inboxView === "received" && (
              <div className="w-64 shrink-0 flex flex-col border-r border-border/80 bg-muted/20">
                <div className="px-3 py-3 border-b border-border/60 bg-background/90 flex items-center justify-between gap-2 rounded-tr-lg">
                  <span className="flex items-center gap-2 text-xs font-semibold text-foreground uppercase tracking-wider">
                    <Mail className="w-3.5 h-3.5 text-primary" />
                    Mailboxes
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-lg text-muted-foreground hover:text-white hover:bg-primary"
                    onClick={() => {
                      refetchReceivedAll();
                      refetchReceivedPaged();
                      toast.success("Mailboxes refreshed");
                    }}
                    title="Refresh mailboxes"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>
                <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-1 min-h-0">
                  {receivedAllLoading || inboxesLoading ? (
                    <>
                      <div className="rounded-lg px-2.5 py-2.5 flex items-center gap-2.5">
                        <Skeleton className="h-4 w-4 rounded" />
                        <Skeleton className="h-4 flex-1" />
                      </div>
                      {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="rounded-lg px-2.5 py-2 flex items-center gap-2.5">
                          <Skeleton className="h-4 w-4 rounded" />
                          <Skeleton className="h-4 flex-1" />
                          <Skeleton className="h-5 w-6 rounded-full" />
                        </div>
                      ))}
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setMailboxInboxId("")}
                        className={cn(
                          "group w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                          !mailboxInboxId
                            ? "bg-primary/10 text-primary font-semibold"
                            : "text-foreground/80 font-medium hover:bg-muted"
                        )}
                      >
                        <InboxIcon
                          className={cn(
                            "w-4 h-4 shrink-0",
                            !mailboxInboxId ? "text-primary" : "text-muted-foreground"
                          )}
                        />
                        <span className="truncate flex-1">All inboxes</span>
                        {(inboxUnreadCounts["_all"] ?? 0) > 0 && (
                          <span
                            className={cn(
                              "shrink-0 min-w-[1.25rem] text-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                              !mailboxInboxId ? "bg-primary text-primary-foreground" : "bg-primary/12 text-primary"
                            )}
                          >
                            {inboxUnreadCounts["_all"]}
                          </span>
                        )}
                      </button>
                      <div className="pt-1 space-y-0.5">
                        {mailboxGroups.map(({ domain, inboxes: domainInboxes }) => {
                          const isCollapsed = collapsedDomains[domain] ?? false;
                          const domainUnread = domainInboxes.reduce(
                            (sum, i) => sum + (inboxUnreadCounts[i.id] ?? 0),
                            0
                          );
                          return (
                            <div key={domain} className="pt-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setCollapsedDomains((prev) => ({
                                    ...prev,
                                    [domain]: !isCollapsed,
                                  }))
                                }
                                className="group flex w-full items-center gap-1.5 px-2.5 py-1 text-left rounded-md hover:bg-muted/60 transition-colors"
                              >
                                <ChevronDown
                                  className={cn(
                                    "w-3 h-3 text-muted-foreground/60 shrink-0 transition-transform duration-150",
                                    isCollapsed && "-rotate-90"
                                  )}
                                  aria-hidden
                                />
                                <Globe className="w-3 h-3 text-muted-foreground/60 shrink-0" />
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate flex-1">
                                  {domain === "Other" ? "Other" : domain}
                                </span>
                                {isCollapsed && domainUnread > 0 && (
                                  <span className="shrink-0 rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] font-semibold text-primary tabular-nums">
                                    {domainUnread}
                                  </span>
                                )}
                              </button>
                              {!isCollapsed && (
                                <div className="mt-0.5 space-y-0.5">
                                  {domainInboxes.map((inbox) => {
                                const unread = inboxUnreadCounts[inbox.id] ?? 0;
                                const isSelected = mailboxInboxId === inbox.id;
                                const localPart = (inbox.email ?? inbox.id).split("@")[0];
                                return (
                                  <button
                                    key={inbox.id}
                                    type="button"
                                    onClick={() => setMailboxInboxId(inbox.id)}
                                    title={inbox.email ?? inbox.id}
                                    className={cn(
                                      "w-full flex items-center gap-2.5 rounded-lg pl-4 pr-2.5 py-1.5 text-left text-sm transition-colors",
                                      isSelected
                                        ? "bg-primary/10 text-primary font-medium"
                                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        "h-1.5 w-1.5 shrink-0 rounded-full",
                                        isSelected ? "bg-primary" : unread > 0 ? "bg-primary/50" : "bg-transparent"
                                      )}
                                      aria-hidden
                                    />
                                    <span className="truncate min-w-0 flex-1 text-left">{localPart}</span>
                                    {unread > 0 && (
                                      <span
                                        className={cn(
                                          "shrink-0 min-w-[1.25rem] text-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                                          isSelected ? "bg-primary text-primary-foreground" : "bg-primary/12 text-primary"
                                        )}
                                      >
                                        {unread}
                                      </span>
                                    )}
                                  </button>
                                );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </nav>
                <div className="p-2.5 border-t border-border/60 bg-background/90 rounded-br-lg">
                  <Button
                    type="button"
                    className="w-full gap-2.5 gradient-primary shadow-sm hover:shadow-md transition-shadow rounded-xl py-2.5"
                    size="sm"
                    onClick={() => {
                      if (composeOpen) {
                        setComposeOpen(false);
                      } else {
                        setComposeTo("");
                        setComposeCc("");
                        setComposeAbout("");
                        setComposeSubject("");
                        setComposeBody("");
                        setComposeInboxId(
                          mailboxInboxId && sendableInboxes.some((i) => i.id === mailboxInboxId)
                            ? mailboxInboxId
                            : ""
                        );
                        setComposeOpen(true);
                      }
                    }}
                  >
                    <PenSquare className="w-4 h-4" />
                    {composeOpen ? "Close compose" : "Write mail"}
                  </Button>
                </div>
              </div>
            )}
            {/* Email list column */}
            <div
              className={cn(
                "flex flex-col border-r transition-all duration-300 min-w-0 min-h-0",
                (inboxView === "campaign" && selectedEmail) || (inboxView === "received" && selectedReceivedId)
                  ? "hidden md:flex md:w-[384px] md:shrink-0 lg:w-[416px]"
                  : "flex flex-1 w-full"
              )}
            >
              <div className="p-3 border-b space-y-3 bg-background/60">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search emails..."
                      className="pl-9 bg-background"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleRefresh}
                    disabled={isRefreshing || !userId || checkReplies.isPending}
                    title="Refresh"
                  >
                    <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
                  </Button>
                  <Button
                    variant={isFullScreen ? "default" : "outline"}
                    size="sm"
                    onClick={() => setIsFullScreen((v) => !v)}
                    title={isFullScreen ? "Exit full screen (Esc)" : "Full screen"}
                    className={cn(
                      "gap-2 shrink-0",
                      isFullScreen && "bg-foreground text-background hover:bg-foreground/90"
                    )}
                  >
                    {isFullScreen ? (
                      <>
                        <Minimize2 className="w-4 h-4" />
                        <span className="hidden sm:inline">Exit full screen</span>
                        <kbd className="hidden md:inline-flex items-center rounded border border-background/30 bg-background/10 px-1.5 py-0.5 text-[10px] font-medium leading-none">
                          Esc
                        </kbd>
                      </>
                    ) : (
                      <>
                        <Maximize2 className="w-4 h-4" />
                        <span className="hidden sm:inline">Full screen</span>
                      </>
                    )}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={handleMarkAllAsRead}
                        disabled={markAllAsRead.isPending}
                      >
                        {markAllAsRead.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Marking all as read…
                          </>
                        ) : (
                          "Mark all as read"
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleArchiveAll}>Archive all</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {inboxView === "campaign" && (
                    <Button
                      type="button"
                      className={cn("gap-2 shrink-0", !composeOpen && "gradient-primary")}
                      variant={composeOpen ? "outline" : "default"}
                      size="sm"
                      onClick={() => {
                        if (composeOpen) {
                          setComposeOpen(false);
                        } else {
                          setComposeTo("");
                          setComposeCc("");
                          setComposeAbout("");
                          setComposeSubject("");
                          setComposeBody("");
                          setComposeInboxId("");
                          setComposeOpen(true);
                        }
                      }}
                    >
                      <PenSquare className="w-4 h-4" />
                      {composeOpen ? "Close compose" : "Write mail"}
                    </Button>
                  )}
                </div>
                {composeOpen && (
                  <div className="rounded-xl border bg-muted/20 max-h-[min(70vh,32rem)] min-h-0 flex flex-col overflow-hidden">
                    <div className="shrink-0 px-4 pt-4 pb-3 border-b border-border/60 bg-muted/30">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold">Write mail</h3>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Send a new email from your MailBox. Choose a sending inbox or leave default to use your first
                            ready inbox.
                          </p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setComposeOpen(false)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="inbox-compose-to">To</Label>
                      <Input
                        id="inbox-compose-to"
                        type="email"
                        placeholder="recipient@example.com"
                        value={composeTo}
                        onChange={(e) => setComposeTo(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="inbox-compose-cc">CC</Label>
                      <Input
                        id="inbox-compose-cc"
                        type="text"
                        placeholder="Optional, comma-separated"
                        value={composeCc}
                        onChange={(e) => setComposeCc(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="inbox-compose-about">
                        What is this email about?{" "}
                        <span className="text-muted-foreground font-normal">(used by AI Write)</span>
                      </Label>
                      <Input
                        id="inbox-compose-about"
                        placeholder="e.g. follow-up on our meeting, request for a quote, brief introduction..."
                        value={composeAbout}
                        onChange={(e) => setComposeAbout(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>From (inbox)</Label>
                      {inboxesLoading ? (
                        <Skeleton className="h-10 w-full rounded-md" />
                      ) : sendableInboxes.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No ready sending inbox yet. Connect an account on{" "}
                          <Link href="/inboxes" className="text-primary underline font-medium">
                            Inboxes
                          </Link>{" "}
                          to send mail.
                        </p>
                      ) : (
                        <Select
                          value={
                            composeInboxId && sendableInboxes.some((i) => i.id === composeInboxId)
                              ? composeInboxId
                              : "_default"
                          }
                          onValueChange={(v) => setComposeInboxId(v === "_default" ? "" : v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Default (first ready inbox)" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_default">Default (first ready inbox)</SelectItem>
                            {sendableInboxes.map((inbox) => (
                              <SelectItem key={inbox.id} value={inbox.id}>
                                {inbox.email ?? inbox.id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="inbox-compose-subject">Subject</Label>
                      <Input
                        id="inbox-compose-subject"
                        value={composeSubject}
                        onChange={(e) => setComposeSubject(e.target.value)}
                        placeholder="Subject"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label>Message</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5 shrink-0 group"
                          onClick={() => {
                            if (aiGate.atLimit) {
                              setUpgradeOpen(true);
                              toast.error(aiGate.upgradeLine ?? "AI Write is available on higher plans.");
                              return;
                            }
                            void handleAiCompose();
                          }}
                          disabled={llmConfigs.length === 0 || aiReplyLoading || !composeAbout.trim()}
                          title={!composeAbout.trim() ? "Describe what the email should be about above first" : undefined}
                        >
                          {aiReplyLoading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="w-3.5 h-3.5 text-accent group-hover:text-white transition-colors" />
                          )}
                          {aiReplyLoading ? "Generating…" : aiGate.atLimit ? "Upgrade for AI Write" : "AI Write"}
                        </Button>
                      </div>
                      <RichTextEditor
                        value={composeBody}
                        onChange={setComposeBody}
                        placeholder="Type your message..."
                        className="min-h-[180px]"
                      />
                    </div>
                    </div>
                    <div className="shrink-0 px-4 py-3 border-t border-border/60 bg-muted/30 flex flex-wrap justify-end gap-2">
                      <Button variant="outline" onClick={() => setComposeOpen(false)}>
                        Discard
                      </Button>
                      <Button
                        className="gradient-primary"
                        onClick={handleSendCompose}
                        disabled={
                          sendComposeMutation.isPending ||
                          !composeTo.trim() ||
                          !composeSubject.trim() ||
                          !htmlToPlainText(composeBody).trim()
                        }
                      >
                        {sendComposeMutation.isPending ? "Sending..." : "Send"}
                      </Button>
                    </div>
                  </div>
                )}
                {inboxView === "campaign" && (
                  <Tabs value={filter} onValueChange={setFilter}>
                    <TabsList className="grid w-full grid-cols-6">
                      <TabsTrigger value="all">All</TabsTrigger>
                      <TabsTrigger value="unread">Unread</TabsTrigger>
                      <TabsTrigger value="sent">Sent</TabsTrigger>
                      <TabsTrigger value="replied">Replied</TabsTrigger>
                      <TabsTrigger value="starred">Starred</TabsTrigger>
                      <TabsTrigger value="archived">Archived</TabsTrigger>
                    </TabsList>
                  </Tabs>
                )}
                {inboxView === "received" && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Tabs value={mailboxFilter} onValueChange={(v) => setMailboxFilter(v as "all" | "sent" | "replied" | "unreplied")}>
                      <TabsList className="h-9 bg-muted/80 p-0.5 rounded-lg inline-flex gap-0.5">
                        <TabsTrigger value="all" className="rounded-md px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                          All
                        </TabsTrigger>
                        <TabsTrigger value="sent" className="rounded-md px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                          Sent
                        </TabsTrigger>
                        <TabsTrigger value="replied" className="rounded-md px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                          Replied
                        </TabsTrigger>
                        <TabsTrigger value="unreplied" className="rounded-md px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                          Unreplied
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="inbox-hide-warmup"
                        checked={hideWarmupThreads}
                        onCheckedChange={(c) => setHideWarmupThreads(c === true)}
                      />
                      <Label htmlFor="inbox-hide-warmup" className="text-sm font-normal text-muted-foreground cursor-pointer">
                        Hide warmup
                      </Label>
                    </div>
                  </div>
                )}
              </div>

            <div className="flex-1 overflow-y-auto">
              {inboxView === "received" ? (
                <>
                  {receivedListLoading ? (
                    <div className="space-y-0">
                      {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                        <div key={i} className="flex items-start gap-3 px-4 py-3 border-b">
                          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-center gap-2">
                              <Skeleton className="h-4 w-32" />
                              <Skeleton className="h-3 w-12 ml-auto" />
                            </div>
                            <Skeleton className="h-4 w-full max-w-[85%]" />
                            <Skeleton className="h-3 w-2/3" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : receivedEmailsForList.length === 0 ? (
                    <EmptyState
                      icon={Mail}
                      headline={
                        mailboxInboxId
                          ? "No emails in this mailbox"
                          : "No unread mail in your inboxes"
                      }
                      description={
                        mailboxInboxId
                          ? "Enable receiving on the Domains page for a verified domain; then all mail sent to that domain will appear here."
                          : "You're all caught up. Select a specific inbox to browse read mail, or wait for new messages."
                      }
                      primaryAction={
                        mailboxInboxId ? (
                          <Button asChild>
                            <Link href="/domains">Go to Domains</Link>
                          </Button>
                        ) : undefined
                      }
                      className="m-4 rounded-lg border border-dashed"
                    />
                  ) : filteredReceivedEmails.length === 0 ? (
                    <EmptyState
                      icon={Search}
                      headline="No emails match your filter or search"
                      description={
                        hideWarmupThreads
                          ? "Try turning off “Hide warmup”, choose a different tab, or clear the search box."
                          : "Try a different filter or clear the search box."
                      }
                      primaryAction={
                        <Button
                          variant="outline"
                          onClick={() => {
                            setSearchQuery("");
                            setMailboxFilter("all");
                            setHideWarmupThreads(false);
                          }}
                        >
                          Clear filters
                        </Button>
                      }
                      className="m-4 rounded-lg border border-dashed"
                    />
                  ) : (
                    filteredReceivedEmails.map((msg: InboundMessage) => {
                      const threadId = msg.thread_id ?? msg.id;
                      const messageCount = (msg as { message_count?: number }).message_count;
                      const fromLabel = mailboxListFromLabel(msg);
                      const toLabel = mailboxListToLabel(msg);
                      const initial = (fromLabel || "?").charAt(0).toUpperCase();
                      const isCompose = !!msg.compose_email;
                      const isReplied = !isCompose && !!msg.last_sent_reply_at;
                      const showFromTo = !mailboxInboxId;
                      const preview = (msg.preview ?? "").toString().replace(/\s+/g, " ").trim();
                      const hasAttachment = msg.has_attachment ?? (msg.attachments?.length ?? 0) > 0;
                      const isSelected = selectedReceivedId === threadId;
                      const hasMeta =
                        (showFromTo && !!toLabel) ||
                        !!msg.warmup_thread ||
                        isCompose ||
                        isReplied ||
                        (messageCount != null && messageCount > 1);
                      return (
                        <div
                          key={threadId}
                          onClick={() => handleSelectReceivedThread(threadId, msg.is_read)}
                          className={cn(
                            "group flex items-start gap-2.5 border-b border-l-2 border-border/60 pl-2 pr-4 py-2.5 cursor-pointer transition-colors",
                            isSelected
                              ? "border-l-primary bg-primary/[0.06]"
                              : "border-l-transparent hover:bg-muted/50"
                          )}
                        >
                          <span
                            className={cn(
                              "mt-[1.15rem] h-2 w-2 shrink-0 rounded-full transition-colors",
                              !msg.is_read ? "bg-primary" : "bg-transparent"
                            )}
                            aria-hidden
                          />
                          <div
                            className={cn(
                              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                              !msg.is_read ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground"
                            )}
                            aria-hidden
                          >
                            {initial}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "min-w-0 flex-1 truncate text-sm",
                                  !msg.is_read ? "font-semibold text-foreground" : "font-medium text-foreground/90"
                                )}
                                title={fromLabel}
                              >
                                {fromLabel}
                              </span>
                              {hasAttachment && (
                                <span title="Has attachment" className="shrink-0">
                                  <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
                                </span>
                              )}
                              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                {msg.received_at ? formatTime(msg.received_at) : ""}
                              </span>
                            </div>
                            <p className="truncate text-sm mt-0.5" title={msg.subject || undefined}>
                              <span
                                className={cn(
                                  !msg.is_read ? "font-medium text-foreground" : "text-foreground/80"
                                )}
                              >
                                {msg.subject || "(No subject)"}
                              </span>
                              {preview && <span className="text-muted-foreground">{"  —  " + preview}</span>}
                            </p>
                            {hasMeta && (
                              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                {showFromTo && toLabel && (
                                  <span
                                    className="inline-flex max-w-[16rem] items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                                    title={`Received at ${toLabel}`}
                                  >
                                    <InboxIcon className="w-3 h-3 shrink-0 opacity-70" />
                                    <span className="truncate">{toLabel}</span>
                                  </span>
                                )}
                                {isCompose && (
                                  <span className="inline-flex items-center gap-1 text-[11px] text-primary font-medium">
                                    <Send className="w-3 h-3" />
                                    Sent
                                  </span>
                                )}
                                {isReplied && (
                                  <span className="inline-flex items-center gap-1 text-[11px] text-primary font-medium">
                                    <Reply className="w-3 h-3" />
                                    Replied
                                  </span>
                                )}
                                {messageCount != null && messageCount > 1 && (
                                  <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                                    {messageCount}
                                  </span>
                                )}
                                {msg.warmup_thread && (
                                  <Badge
                                    variant="secondary"
                                    className="gap-1 text-[10px] font-normal px-1.5 py-0 h-5 border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100"
                                    title="This conversation includes a reply to a warmup send"
                                  >
                                    <Flame className="w-3 h-3 opacity-80" />
                                    Warmup
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                  {hasNextPage && (
                    <div className="px-4 py-3 border-t bg-background/80">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        disabled={isFetchingNextPage}
                        onClick={() => fetchNextPage()}
                      >
                        {isFetchingNextPage ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Loading…
                          </>
                        ) : (
                          `Load older (${MAILBOX_PAGE_SIZE} more)`
                        )}
                      </Button>
                    </div>
                  )}
                </>
              ) : emailsLoading ? (
                  <div className="space-y-0">
                    {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                      <div key={i} className="flex items-start gap-3 p-4 border-b">
                        <Skeleton className="h-4 w-4 shrink-0 rounded mt-1" />
                        <Skeleton className="h-4 w-4 shrink-0 rounded mt-1" />
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-center gap-2">
                            <Skeleton className="h-4 w-28" />
                            <Skeleton className="h-3 w-14 ml-auto" />
                          </div>
                          <Skeleton className="h-4 w-full max-w-[80%]" />
                          <Skeleton className="h-3 w-3/4" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : emailsError ? (
                  <div className="text-center py-8">
                    <p className="text-destructive mb-2">Failed to load emails</p>
                    <p className="text-sm text-muted-foreground">
                      {emailsErrorMsg?.message ?? "Please try again later"}
                    </p>
                  </div>
                ) : filteredEmails.length === 0 ? (
                  <EmptyState
                    icon={Search}
                    headline={searchQuery ? "No emails match your search" : "No conversations yet"}
                    description={
                      searchQuery
                        ? "Try a different search or clear the search box."
                        : "Replies to your campaigns will appear here. Create a campaign to get started."
                    }
                    primaryAction={
                      searchQuery ? (
                        <Button variant="outline" onClick={() => setSearchQuery("")}>
                          Clear search
                        </Button>
                      ) : (
                        <Button asChild>
                          <Link href="/campaigns">View campaigns</Link>
                        </Button>
                      )
                    }
                    className="m-4 rounded-lg border border-dashed"
                  />
                ) : (
                  visibleCampaignEmails.map((email: InboxEmail) => (
                    <div
                      key={email.id}
                      onClick={() => handleSelectEmail(email)}
                      className={cn(
                        "group p-4 border-b cursor-pointer transition-colors hover:bg-muted",
                        selectedEmail === email.id && "bg-primary/5 border-l-2 border-l-primary",
                        !email.isRead && "bg-primary/5"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox className="mt-1" onClick={(e) => e.stopPropagation()} />
                        <button
                          type="button"
                          onClick={(e) => handleToggleStar(email.id, e)}
                          className="mt-1 min-w-[1rem] min-h-[1rem] flex items-center justify-center"
                          title={email.isStarred ? "Unstar" : "Star"}
                          disabled={toggleStarEmail.isPending}
                        >
                          {toggleStarEmail.isPending &&
                          toggleStarEmail.variables?.emailId === email.id ? (
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                          ) : (
                            <Star
                              className={cn(
                                "w-4 h-4 transition-colors",
                                email.isStarred
                                  ? "fill-warning text-warning"
                                      : "text-muted-foreground group-hover:text-foreground"
                              )}
                            />
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className={cn(
                                "font-medium truncate",
                                email.isRead
                                  ? "text-muted-foreground group-hover:text-foreground"
                                  : "text-foreground font-semibold"
                              )}
                            >
                              {email.sender}
                            </span>
                            {email.hasAttachment && (
                              <Paperclip className="w-3 h-3 text-muted-foreground group-hover:text-foreground transition-colors" />
                            )}
                            <span className="text-xs text-muted-foreground group-hover:text-foreground ml-auto flex-shrink-0 transition-colors">
                              {formatTime(email.time)}
                            </span>
                          </div>
                          <p
                            className={cn(
                              "text-sm truncate mb-1 transition-colors",
                              !email.isRead ? "font-medium" : "text-muted-foreground group-hover:text-foreground"
                            )}
                          >
                            {email.subject}
                          </p>
                          <PreviewWithLinks
                            text={email.preview ?? ""}
                            className="group-hover:text-foreground transition-colors"
                          />
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            {email.replySource === "domain_received" ? (
                              <Badge
                                variant="secondary"
                                className="text-xs bg-primary/10 text-primary border-primary/20"
                              >
                                Domain Received
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs text-muted-foreground">
                                Reply To
                              </Badge>
                            )}
                            {email.campaign && (
                              <Badge variant="outline" className="text-xs">
                                {email.campaign}
                              </Badge>
                            )}
                            {email.labels.map((label) => (
                              <Badge
                                key={label}
                                variant="outline"
                                className={cn("text-xs", getLabelColor(label))}
                              >
                                {label}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
                {filteredEmails.length > visibleCampaignEmails.length && (
                  <div className="px-4 py-3 border-t text-xs text-muted-foreground bg-background/80">
                    Showing first {visibleCampaignEmails.length} conversations. Refine your search or
                    filter to narrow down results.
                  </div>
                )}
              </div>
            </div>

            {/* Campaign reply detail panel */}
            {inboxView === "campaign" && selectedEmail && selected && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex-1 flex flex-col min-h-0 min-w-0"
              >
                <div className="p-3 border-b flex items-center justify-between gap-2 bg-background/60">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 -ml-1 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setSelectedEmail(null);
                        resetReplyComposer();
                      }}
                      title="Back to list"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      <span className="hidden sm:inline">Back</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => selected && handleArchiveEmail(selected.id)}
                    >
                      <Archive className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => selected && handleDeleteEmail(selected.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => selected && handleTagEmail(selected.id)}
                    >
                      <Tag className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {replyDialogOpen && replyTarget === "campaign" ? (
                      <Button variant="outline" size="sm" onClick={resetReplyComposer}>
                        Cancel reply
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" className="gap-2" onClick={handleReply}>
                        <Reply className="w-4 h-4" />
                        Reply
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-6 min-h-0">
                  <h2 className="text-xl font-semibold mb-4">{selected.subject}</h2>
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center text-white font-semibold">
                      {selected.sender.charAt(0)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{selected.sender}</span>
                        <span className="text-sm text-muted-foreground">
                          &lt;{selected.senderEmail}&gt;
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        <span>{formatTime(selected.time)}</span>
                        <span>•</span>
                        <span>Replied to you</span>
                      </div>
                      {selected.sentFromInboxEmail && (
                        <p className="text-sm text-muted-foreground break-words">
                          <span className="font-medium text-foreground">Sent from:</span>{" "}
                          {selected.sentFromInboxEmail}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleStar(selected.id)}
                      className="shrink-0 min-w-[1.25rem] min-h-[1.25rem] flex items-center justify-center"
                      title={selected.isStarred ? "Unstar" : "Star"}
                      disabled={toggleStarEmail.isPending}
                    >
                      {toggleStarEmail.isPending &&
                      toggleStarEmail.variables?.emailId === selected.id ? (
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                      ) : (
                        <Star
                          className={cn(
                            "w-5 h-5 cursor-pointer transition-colors",
                            selected.isStarred
                              ? "fill-warning text-warning"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        />
                      )}
                    </button>
                  </div>
                  <div className="space-y-3 min-w-0 overflow-hidden">
                    <p className="text-xs text-muted-foreground">
                      Latest message is expanded. Older ones show as a single line — tap to expand.
                    </p>
                    {selected.messages && selected.messages.length > 0 ? (
                      selected.messages.map((msg, idx) => {
                        const n = selected.messages!.length;
                        const isLatest = idx === n - 1;
                        const label =
                          msg.type === "our_send"
                            ? "Your message"
                            : msg.from === "us"
                              ? "Your reply"
                              : "Their reply";
                        const side: "outbound" | "inbound" | "neutral" =
                          msg.from === "us" ? (msg.type === "our_send" ? "neutral" : "outbound") : "inbound";
                        const title =
                          msg.from === "us"
                            ? selected.sentFromInboxEmail ?? "You"
                            : `${selected.sender} · ${selected.senderEmail}`;
                        const timeStr = msg.at ? formatTime(msg.at) : undefined;
                        const rawBody = msg.body ?? "";
                        const htmlPart = (msg as { body_html?: string }).body_html;
                        const snippet = threadSnippet(htmlPart, rawBody);
                        return (
                          <div
                            key={idx}
                            ref={isLatest ? latestThreadMessageRef : undefined}
                            className={cn(isLatest && "scroll-mt-2")}
                          >
                            <ThreadMessageCard
                              isLatest={isLatest}
                              snippet={snippet}
                              side={side}
                              label={label}
                              title={title}
                              time={timeStr}
                            >
                              {htmlPart ? (
                                <EmailHtmlViewer html={htmlPart} />
                              ) : looksLikeHtml(rawBody) ? (
                                <EmailHtmlViewer html={rawBody} />
                              ) : (
                                <BodyWithLinks text={rawBody || "(No content)"} />
                              )}
                            </ThreadMessageCard>
                          </div>
                        );
                      })
                    ) : (
                      <>
                        {(() => {
                          const showOrig = !!selected.originalBody;
                          const theirRaw = (selected.body ?? selected.preview ?? "").trim();
                          const showTheir = !!theirRaw;
                          const showYours = !!selected.lastSentReplyBody;
                          const lastIs: "yours" | "their" | "orig" | null = showYours
                            ? "yours"
                            : showTheir
                              ? "their"
                              : showOrig
                                ? "orig"
                                : null;
                          return (
                            <>
                              {showOrig ? (
                                <div
                                  ref={lastIs === "orig" ? latestThreadMessageRef : undefined}
                                  className={cn(lastIs === "orig" && "scroll-mt-2")}
                                >
                                  <ThreadMessageCard
                                    isLatest={lastIs === "orig"}
                                    snippet={threadSnippet(
                                      looksLikeHtml(selected.originalBody!) ? selected.originalBody : undefined,
                                      selected.originalBody ?? ""
                                    )}
                                    side="neutral"
                                    label="Your message"
                                    title={selected.sentFromInboxEmail ?? "You"}
                                    time={selected.time ? formatTime(selected.time) : undefined}
                                  >
                                    {looksLikeHtml(selected.originalBody!) ? (
                                      <EmailHtmlViewer html={selected.originalBody ?? ""} />
                                    ) : (
                                      <BodyWithLinks
                                        text={selected.originalBody ?? ""}
                                        className="text-muted-foreground"
                                      />
                                    )}
                                  </ThreadMessageCard>
                                </div>
                              ) : null}
                              {showTheir ? (
                                <div
                                  ref={lastIs === "their" ? latestThreadMessageRef : undefined}
                                  className={cn(lastIs === "their" && "scroll-mt-2")}
                                >
                                  <ThreadMessageCard
                                    isLatest={lastIs === "their"}
                                    snippet={threadSnippet(
                                      looksLikeHtml(theirRaw) ? theirRaw : undefined,
                                      theirRaw
                                    )}
                                    side="inbound"
                                    label="Their reply"
                                    title={`${selected.sender} · ${selected.senderEmail}`}
                                  >
                                    {looksLikeHtml(theirRaw) ? (
                                      <EmailHtmlViewer html={theirRaw} />
                                    ) : (
                                      <BodyWithLinks text={theirRaw} />
                                    )}
                                  </ThreadMessageCard>
                                </div>
                              ) : null}
                              {showYours ? (
                                <div
                                  ref={lastIs === "yours" ? latestThreadMessageRef : undefined}
                                  className={cn(lastIs === "yours" && "scroll-mt-2")}
                                >
                                  <ThreadMessageCard
                                    isLatest={lastIs === "yours"}
                                    snippet={threadSnippet(undefined, selected.lastSentReplyBody ?? "")}
                                    side="outbound"
                                    label="Your reply"
                                    title={selected.sentFromInboxEmail ?? "You"}
                                  >
                                    <BodyWithLinks text={selected.lastSentReplyBody ?? ""} />
                                  </ThreadMessageCard>
                                </div>
                              ) : null}
                            </>
                          );
                        })()}
                      </>
                    )}
                  </div>
                </div>
                <div className="border-t bg-gradient-to-b from-muted/30 to-muted/50 shrink-0 flex flex-col max-h-[min(60vh,32rem)]">
                  {replyDialogOpen && replyTarget === "campaign" ? (
                    <div className="p-3 sm:p-4 overflow-y-auto">
                      <InboxReplyComposerForm
                        key={selectedEmail ?? "campaign-reply"}
                        replyTarget="campaign"
                        firstInboundInThread={firstInboundInThread}
                        selected={selected}
                        replyCc={replyCc}
                        setReplyCc={setReplyCc}
                        replySubject={replySubject}
                        setReplySubject={setReplySubject}
                        replyBody={replyBody}
                        setReplyBody={setReplyBody}
                        onCancel={resetReplyComposer}
                        onSend={handleSendReply}
                        isPending={sendReply.isPending}
                        handleAiReply={handleAiReply}
                        aiReplyLoading={aiReplyLoading}
                        llmConfigsLength={llmConfigs.length}
                        aiGate={aiGate}
                        setUpgradeOpen={setUpgradeOpen}
                      />
                    </div>
                  ) : (
                    <div className="p-4">
                      <div className="flex gap-2 mb-1 flex-wrap">
                        <Button className="gap-2 rounded-full gradient-primary px-5 shadow-sm" onClick={handleReply}>
                          <Reply className="w-4 h-4" />
                          Reply
                        </Button>
                        <Button variant="outline" className="gap-2" onClick={handleForward}>
                          <Forward className="w-4 h-4" />
                          Forward
                        </Button>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Use <span className="font-medium">AI Reply</span> in the composer below to generate a draft response.
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* Received email detail panel */}
            {inboxView === "received" && selectedReceivedId && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex-1 flex flex-col min-w-0 min-h-0"
              >
                <div className="p-3 border-b flex items-center justify-between gap-2 bg-background/60">
                  <div className="flex items-center gap-2 min-w-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 -ml-1 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setSelectedReceivedId(null);
                        resetReplyComposer();
                      }}
                      title="Back to list"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      <span className="hidden sm:inline">Back</span>
                    </Button>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-muted-foreground hover:text-foreground"
                      onClick={handleMarkSelectedReceivedAsRead}
                      disabled={!selectedReceivedId}
                      title="Mark as read"
                    >
                      <Check className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-muted-foreground hover:text-destructive"
                      onClick={handleDeleteReceivedThread}
                      title="Delete conversation from MailBox"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    <span className="mx-1 h-5 w-px bg-border" aria-hidden />
                    {replyDialogOpen && replyTarget === "received" ? (
                      <Button variant="outline" size="sm" onClick={resetReplyComposer}>
                        Cancel reply
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="gap-2 gradient-primary rounded-full px-4 shadow-sm"
                        onClick={handleReplyReceived}
                        disabled={!replyToMessageId}
                      >
                        <Reply className="w-4 h-4" />
                        Reply
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto overflow-x-auto min-w-0">
                  {receivedThreadLoading ? (
                    <div className="p-6 space-y-6">
                      <Skeleton className="h-8 w-3/4" />
                      <div className="space-y-4">
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="rounded-lg border p-4 space-y-3">
                            <Skeleton className="h-3 w-24" />
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-2/3" />
                            <Skeleton className="h-20 w-full" />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : receivedThread?.messages?.length ? (
                  <div className="mx-auto w-full max-w-3xl px-5 sm:px-8 py-6">
                    <h2 className="text-2xl font-semibold tracking-tight mb-3 break-words leading-snug">
                      {receivedThread.messages.find((m) => m.subject)?.subject ?? "Thread"}
                    </h2>
                    {(selectedReceivedToValue || selectedReceivedFromValue) && (
                      <div className="mb-5 flex flex-wrap items-center gap-2">
                        {selectedReceivedToValue && (
                          <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
                            <InboxIcon className="w-3.5 h-3.5 shrink-0 opacity-70" />
                            <span className="text-foreground/60">To</span>
                            <span className="truncate font-medium text-foreground">{selectedReceivedToValue}</span>
                          </span>
                        )}
                        {selectedReceivedFromValue && (
                          <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
                            <Send className="w-3.5 h-3.5 shrink-0 opacity-70" />
                            <span className="text-foreground/60">Sent from</span>
                            <span className="truncate font-medium text-foreground">{selectedReceivedFromValue}</span>
                          </span>
                        )}
                      </div>
                    )}
                    {receivedThread.messages.length > 3 && (
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 gap-y-1 border-y border-border/60 py-2">
                        <p className="text-xs text-muted-foreground">
                          {showAllReceivedMessages
                            ? `All ${receivedThread.messages.length} messages`
                            : `Latest 3 of ${receivedThread.messages.length} messages`}
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-primary hover:text-primary hover:bg-primary/10"
                          onClick={() => setShowAllReceivedMessages((prev) => !prev)}
                        >
                          {showAllReceivedMessages ? "Collapse to latest 3" : "Show full conversation"}
                        </Button>
                      </div>
                    )}
                    <div className="space-y-3">
                      {visibleReceivedThreadMessages.map((msg, idx) => {
                        const n = visibleReceivedThreadMessages.length;
                        const isLatest = idx === n - 1;
                        const outbound = msg.type === "outbound";
                        const label = outbound ? "Your reply" : "Incoming message";
                        const side = outbound ? "outbound" : "inbound";
                        const from = (msg as { from?: string }).from;
                        const title = outbound ? "You" : from ?? "Sender";
                        const receivedAt = (msg as { received_at?: string }).received_at;
                        const at = (msg as { at?: string }).at;
                        const timeRaw = receivedAt ?? at;
                        const timeStr = timeRaw ? formatTime(timeRaw) : undefined;
                        const bodyStr =
                          (msg as { body_text?: string }).body_text ??
                          (msg as { body?: string }).body ??
                          (msg as { preview?: string }).preview ??
                          "";
                        const htmlPart = (msg as { body_html?: string }).body_html;
                        const snippet = threadSnippet(htmlPart, bodyStr);
                        const attachments =
                          (msg as { attachments?: { filename?: string; type?: string }[] }).attachments ?? [];
                        const warmupInbound =
                          !outbound && !!(msg as { warmup_reply?: boolean }).warmup_reply;
                        return (
                          <div
                            key={`${selectedReceivedId}-${idx}`}
                            ref={isLatest ? latestThreadMessageRef : undefined}
                            className={cn(isLatest && "scroll-mt-2")}
                          >
                            <ThreadMessageCard
                              isLatest={isLatest}
                              snippet={snippet}
                              side={side}
                              label={label}
                              title={title}
                              time={timeStr}
                              warmup={warmupInbound}
                            >
                              {htmlPart ? (
                                <EmailHtmlViewer html={htmlPart} />
                              ) : looksLikeHtml(bodyStr) ? (
                                <EmailHtmlViewer html={bodyStr} />
                              ) : (
                                <BodyWithLinks text={bodyStr} />
                              )}
                              {attachments.length > 0 ? (
                                <div className="mt-4 rounded-md border bg-muted/40 p-3">
                                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
                                    <Paperclip className="w-3.5 h-3.5" />
                                    Attachments ({attachments.length})
                                  </p>
                                  <ul className="space-y-1 text-sm">
                                    {attachments.map((att, i) => (
                                      <li key={i} className="flex items-center gap-2 text-muted-foreground">
                                        <Paperclip className="w-3 h-3 flex-shrink-0" />
                                        <span className="break-all">
                                          {att.filename ?? `Attachment ${i + 1}`}
                                        </span>
                                        {att.type && (
                                          <span className="text-xs opacity-75">({att.type})</span>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                            </ThreadMessageCard>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  ) : (
                    <p className="text-muted-foreground p-6">Message not found.</p>
                  )}
                </div>
                {receivedThread?.messages?.length ? (
                  <div className="border-t bg-gradient-to-b from-muted/30 to-muted/50 shrink-0 flex flex-col max-h-[min(60vh,32rem)]">
                    {replyDialogOpen && replyTarget === "received" ? (
                      <div className="p-3 sm:p-4 overflow-y-auto w-full mx-auto max-w-3xl">
                        <InboxReplyComposerForm
                          key={selectedReceivedId ?? "received-reply"}
                          replyTarget="received"
                          firstInboundInThread={firstInboundInThread}
                          selected={selected}
                          replyCc={replyCc}
                          setReplyCc={setReplyCc}
                          replySubject={replySubject}
                          setReplySubject={setReplySubject}
                          replyBody={replyBody}
                          setReplyBody={setReplyBody}
                          onCancel={resetReplyComposer}
                          onSend={handleSendReply}
                          isPending={sendReceivedReply.isPending}
                          handleAiReply={handleAiReply}
                          aiReplyLoading={aiReplyLoading}
                          llmConfigsLength={llmConfigs.length}
                          aiGate={aiGate}
                          setUpgradeOpen={setUpgradeOpen}
                        />
                      </div>
                    ) : (
                      <div className="p-4 w-full mx-auto max-w-3xl">
                        <Button
                          className="gap-2 rounded-full gradient-primary px-5 shadow-sm w-full sm:w-auto"
                          onClick={handleReplyReceived}
                          disabled={!replyToMessageId}
                        >
                          <Reply className="w-4 h-4" />
                          Reply
                        </Button>
                      </div>
                    )}
                  </div>
                ) : null}
              </motion.div>
            )}
      </div>

      {/* Tag dialog */}
      <Dialog open={tagDialogOpen} onOpenChange={setTagDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Tag</DialogTitle>
            <DialogDescription>Enter a tag name for this email</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="tag">Tag Name</Label>
              <Input
                id="tag"
                placeholder="e.g., important, follow-up"
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSubmitTag();
                  }
                }}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setTagDialogOpen(false)}>
              Cancel
            </Button>
            <Button className="gradient-primary" onClick={handleSubmitTag}>
              Add Tag
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <HelpLinks
        slugs={[
          "view-manage-campaign-replies-inbox",
          "use-inbox-see-when-contacts-respond",
          "set-up-notification-preferences-replies",
        ]}
        className="mt-6 mx-4"
      />
    </div>
    </AppPageShell>
  );
}
