"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import {
  Search,
  Mail,
  Reply,
  Trash2,
  PenSquare,
  RefreshCw,
  Check,
  Paperclip,
  Send,
  Flame,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMailbox } from "@/contexts/MailboxContext";
import { api } from "@/lib/api";
import type { InboundMessage } from "@/types/api";
import { toast } from "sonner";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { formatDistanceToNow, format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/EmptyState";
import { EmailHtmlViewer } from "@/components/EmailHtmlViewer";
import { RichTextEditor } from "@/components/RichTextEditor";
import { ThreadMessageCard } from "@/components/mail/ThreadMessageCard";
import { htmlToPlainText, threadSnippet } from "@/lib/templateBody";
import { cn } from "@/lib/utils";

function looksLikeHtml(str: string): boolean {
  return typeof str === "string" && /[<][a-z!/][^>]*>/i.test(str);
}

function formatTime(timeString: string) {
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
}

function BodyWithLinks({ text, className = "" }: { text: string; className?: string }) {
  if (!text) return null;
  const PREVIEW_URL_REGEX = /(https?:\/\/[^\s<>"']+)/gi;
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

export default function MailboxInboxPage() {
  const { userId, inbox, refetchMe } = useMailbox();
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "sent" | "replied" | "unreplied">("all");
  const [hideWarmupThreads, setHideWarmupThreads] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [replyCc, setReplyCc] = useState("");
  const [replyCcExpanded, setReplyCcExpanded] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const latestThreadMessageRef = useRef<HTMLDivElement | null>(null);

  const resetReplyComposer = () => {
    setReplyOpen(false);
    setReplySubject("");
    setReplyBody("");
    setReplyCc("");
    setReplyCcExpanded(false);
  };

  const { data: receivedPage, isLoading: listLoading, refetch: refetchList } = useQuery({
    queryKey: ["mailbox-received", userId],
    queryFn: () => api.mailbox.getReceived({ limit: 200 }),
    enabled: !!userId,
  });
  const receivedList = receivedPage?.threads ?? [];

  const { data: thread, isLoading: threadLoading } = useQuery({
    queryKey: ["mailbox-thread", selectedThreadId, userId],
    queryFn: () => api.mailbox.getReceivedThread(selectedThreadId!),
    enabled: !!userId && !!selectedThreadId,
  });

  const filteredList = useMemo(() => {
    let list = receivedList as InboundMessage[];
    if (filter === "sent") list = list.filter((m) => !!m.compose_email || m.last_sent_reply_at != null);
    else if (filter === "replied") list = list.filter((m) => !m.compose_email && m.last_sent_reply_at != null);
    else if (filter === "unreplied") list = list.filter((m) => !m.compose_email && !m.last_sent_reply_at);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (m) =>
          (m.from ?? "").toLowerCase().includes(q) ||
          (m.subject ?? "").toLowerCase().includes(q) ||
          (m.preview ?? "").toLowerCase().includes(q)
      );
    }
    if (hideWarmupThreads) {
      list = list.filter((m) => !m.warmup_thread);
    }
    return list;
  }, [receivedList, filter, searchQuery, hideWarmupThreads]);

  const selectedSummary = useMemo(
    () => (selectedThreadId ? filteredList.find((m) => (m.thread_id ?? m.id) === selectedThreadId) : undefined),
    [selectedThreadId, filteredList]
  );

  const replyToDisplay = useMemo(() => {
    const lastInbound = thread?.messages?.filter((m) => m.type === "inbound").pop();
    return (lastInbound as { from?: string })?.from ?? selectedSummary?.from ?? "";
  }, [thread?.messages, selectedSummary?.from]);
  const canReplyToThread = useMemo(
    () => !!thread?.messages?.some((m) => m.type === "inbound"),
    [thread?.messages]
  );

  useEffect(() => {
    if (replyOpen && replyCc.trim()) setReplyCcExpanded(true);
  }, [replyOpen, replyCc]);

  useEffect(() => {
    const el = latestThreadMessageRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [selectedThreadId, thread?.messages?.length]);

  const markReadMutation = useMutation({
    mutationFn: (threadId: string) => api.mailbox.markReceivedThreadAsRead(threadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mailbox-received", userId] });
      toast.success("Marked as read.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (threadId: string) => api.mailbox.deleteReceivedThread(threadId),
    onSuccess: () => {
      setSelectedThreadId(null);
      resetReplyComposer();
      queryClient.invalidateQueries({ queryKey: ["mailbox-received", userId] });
      toast.success("Conversation removed.");
    },
  });

  const replyMutation = useMutation({
    mutationFn: ({ messageId, subject, body, cc }: { messageId: string; subject: string; body: string; cc?: string }) =>
      api.mailbox.sendReceivedReply(userId!, messageId, subject, body, cc),
    onSuccess: () => {
      resetReplyComposer();
      queryClient.invalidateQueries({ queryKey: ["mailbox-received", userId] });
      queryClient.invalidateQueries({ queryKey: ["mailbox-thread", selectedThreadId, userId] });
      toast.success("Reply sent.");
    },
    onError: (err: Error) => toast.error(err?.message ?? "Failed to send reply"),
  });

  const composeMutation = useMutation({
    mutationFn: ({ to, subject, body, cc }: { to: string; subject: string; body: string; cc?: string }) =>
      api.mailbox.sendCompose(userId!, to, subject, body, inbox?.id, cc),
    onSuccess: () => {
      setComposeOpen(false);
      setComposeTo("");
      setComposeCc("");
      setComposeSubject("");
      setComposeBody("");
      queryClient.invalidateQueries({ queryKey: ["mailbox-received", userId] });
      toast.success("Email sent.");
    },
    onError: (err: Error) => toast.error(err?.message ?? "Failed to send"),
  });

  const handleSelectThread = (threadId: string, isRead?: boolean) => {
    if (threadId !== selectedThreadId) resetReplyComposer();
    setSelectedThreadId(threadId);
    if (userId && !isRead) markReadMutation.mutate(threadId);
  };

  const handleMarkRead = () => {
    if (selectedThreadId) markReadMutation.mutate(selectedThreadId);
  };

  const handleDelete = async () => {
    if (!selectedThreadId) return;
    const ok = await confirmDialog({
      title: "Delete conversation",
      description: "Remove this conversation from the mailbox view? It won't delete mail from your provider.",
      variant: "destructive",
    });
    if (ok) deleteMutation.mutate(selectedThreadId);
  };

  const handleReply = () => {
    const subj = thread?.messages?.find((m) => (m as { subject?: string }).subject);
    setReplySubject((subj as { subject?: string })?.subject?.startsWith("Re:") ? (subj as { subject?: string }).subject! : `Re: ${(subj as { subject?: string })?.subject ?? ""}`);
    setReplyBody("");
    setReplyCc("");
    setReplyOpen(true);
  };

  const handleSendReply = () => {
    if (!replySubject.trim() || !htmlToPlainText(replyBody).trim()) {
      toast.error("Enter subject and message.");
      return;
    }
    const lastInbound = thread?.messages?.filter((m) => m.type === "inbound").pop();
    const msgId = (lastInbound as { id?: string })?.id ?? "";
    if (!msgId) {
      toast.error("This thread has no incoming message to reply to.");
      return;
    }
    replyMutation.mutate({ messageId: msgId, subject: replySubject.trim(), body: replyBody, cc: replyCc.trim() || undefined });
  };

  const handleSendCompose = () => {
    if (!composeTo.trim() || !composeSubject.trim() || !composeBody.trim()) {
      toast.error("Enter To, Subject, and Message.");
      return;
    }
    composeMutation.mutate({
      to: composeTo.trim(),
      subject: composeSubject.trim(),
      body: composeBody,
      cc: composeCc.trim() || undefined,
    });
  };

  if (!userId) {
    return (
      <div className="container max-w-md mx-auto px-4 pt-28 flex justify-center">
        <p className="text-muted-foreground">Loading mailbox...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <div className="flex flex-col gap-4 h-[calc(100vh-8rem)]">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search emails..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button variant="outline" size="icon" onClick={() => { refetchList(); refetchMe(); toast.success("Refreshed"); }} title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button
            className={cn("gap-2", !composeOpen && "gradient-primary")}
            variant={composeOpen ? "outline" : "default"}
            onClick={() => setComposeOpen((o) => !o)}
          >
            <PenSquare className="w-4 h-4" />
            {composeOpen ? "Close compose" : "Compose"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as "all" | "sent" | "replied" | "unreplied")}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="sent">Sent</TabsTrigger>
              <TabsTrigger value="replied">Replied</TabsTrigger>
              <TabsTrigger value="unreplied">Unreplied</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2">
            <Checkbox
              id="mailbox-hide-warmup"
              checked={hideWarmupThreads}
              onCheckedChange={(c) => setHideWarmupThreads(c === true)}
            />
            <Label htmlFor="mailbox-hide-warmup" className="text-sm font-normal text-muted-foreground cursor-pointer">
              Hide warmup
            </Label>
          </div>
        </div>

        {composeOpen && (
          <div className="rounded-xl border bg-card max-h-[min(70vh,32rem)] min-h-0 flex flex-col overflow-hidden shadow-sm shrink-0">
            <div className="shrink-0 px-4 pt-4 pb-3 border-b border-border/60 bg-card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">New message</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Send a new email from this mailbox.</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setComposeOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="compose-to">To</Label>
                  <Input
                    id="compose-to"
                    type="email"
                    placeholder="recipient@example.com"
                    value={composeTo}
                    onChange={(e) => setComposeTo(e.target.value)}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="compose-cc">CC</Label>
                  <Input
                    id="compose-cc"
                    type="text"
                    placeholder="Optional, comma-separated"
                    value={composeCc}
                    onChange={(e) => setComposeCc(e.target.value)}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="compose-subject">Subject</Label>
                  <Input
                    id="compose-subject"
                    value={composeSubject}
                    onChange={(e) => setComposeSubject(e.target.value)}
                    placeholder="Subject"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="compose-message">Message</Label>
                  <textarea
                    id="compose-message"
                    className="flex min-h-[180px] max-h-[40vh] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    value={composeBody}
                    onChange={(e) => setComposeBody(e.target.value)}
                    placeholder="Type your message..."
                  />
                </div>
              </div>
            </div>
            <div className="shrink-0 px-4 py-3 border-t border-border/60 bg-muted/20 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setComposeOpen(false)}>
                Discard
              </Button>
              <Button
                className="gradient-primary"
                onClick={handleSendCompose}
                disabled={
                  composeMutation.isPending ||
                  !composeTo.trim() ||
                  !composeSubject.trim() ||
                  !composeBody.trim()
                }
              >
                {composeMutation.isPending ? "Sending..." : "Send"}
              </Button>
            </div>
          </div>
        )}

        <div className="flex-1 flex gap-0 bg-card rounded-xl border overflow-hidden min-h-0">
          <div className={cn("flex flex-col border-r flex-1 min-w-0", selectedThreadId ? "w-2/5" : "w-full")}>
            <div className="flex-1 overflow-y-auto">
              {listLoading ? (
                <div className="p-4 space-y-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-20 w-full rounded-lg" />
                  ))}
                </div>
              ) : receivedList.length === 0 ? (
                <EmptyState
                  icon={Mail}
                  headline="No emails"
                  description="Emails sent to this mailbox will appear here."
                  className="m-4 rounded-lg border border-dashed"
                />
              ) : filteredList.length === 0 ? (
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
                        setFilter("all");
                        setHideWarmupThreads(false);
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                  className="m-4 rounded-lg border border-dashed"
                />
              ) : (
                filteredList.map((msg) => {
                  const threadId = msg.thread_id ?? msg.id;
                  const isReplied = !msg.compose_email && !!msg.last_sent_reply_at;
                  const isCompose = !!msg.compose_email;
                  return (
                    <div
                      key={threadId}
                      onClick={() => handleSelectThread(threadId, msg.is_read)}
                      className={cn(
                        "flex items-start gap-3 px-4 py-3 border-b cursor-pointer hover:bg-muted/50",
                        !msg.is_read && "bg-primary/5",
                        selectedThreadId === threadId && "bg-primary/5 border-l-4 border-l-primary"
                      )}
                    >
                      <div className="h-10 w-10 shrink-0 rounded-full bg-muted flex items-center justify-center text-sm font-medium text-muted-foreground">
                        {(msg.from || "?").charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={cn("truncate", msg.is_read ? "text-muted-foreground" : "font-semibold")}>{msg.from}</span>
                          {(msg.has_attachment ?? (msg.attachments?.length ?? 0) > 0) && (
                            <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          )}
                          <span className="text-xs text-muted-foreground ml-auto shrink-0 tabular-nums">
                            {msg.received_at ? formatTime(msg.received_at) : ""}
                          </span>
                        </div>
                        <p className={cn("text-sm truncate", msg.is_read ? "text-muted-foreground" : "font-medium")}>
                          {msg.subject || "(No subject)"}
                        </p>
                        <p className="text-sm text-muted-foreground line-clamp-2 truncate">{msg.preview ?? "—"}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
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
                          {isCompose && (
                            <span className="inline-flex items-center gap-1 text-xs text-primary font-medium">
                              <Send className="w-3 h-3" /> Sent
                            </span>
                          )}
                          {isReplied && (
                            <span className="inline-flex items-center gap-1 text-xs text-primary font-medium">
                              <Reply className="w-3 h-3" /> Replied
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {selectedThreadId && (
            <div className="flex-1 flex flex-col min-w-0 border-l">
              <div className="p-4 border-b flex items-center justify-between gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setSelectedThreadId(null);
                    resetReplyComposer();
                  }}
                >
                  ✕
                </Button>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <Button variant="outline" size="sm" className="gap-2" onClick={handleMarkRead} disabled={markReadMutation.isPending}>
                    <Check className="w-4 h-4" /> Mark as read
                  </Button>
                  <Button variant="outline" size="icon" onClick={handleDelete} disabled={deleteMutation.isPending} title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                  {replyOpen ? (
                    <Button variant="outline" size="sm" onClick={resetReplyComposer}>
                      Cancel reply
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" className="gap-2" onClick={handleReply} disabled={!canReplyToThread}>
                      <Reply className="w-4 h-4" /> Reply
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                {threadLoading ? (
                  <div className="space-y-4">
                    <Skeleton className="h-8 w-3/4" />
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-24 w-full rounded-lg" />
                    ))}
                  </div>
                ) : thread?.messages?.length ? (
                  <>
                    <h2 className="text-xl font-semibold mb-2 break-words">
                      {thread.messages.find((m) => (m as { subject?: string }).subject)?.subject ?? "Thread"}
                    </h2>
                    {selectedSummary?.to && (
                      <p className="text-sm text-muted-foreground mb-4">To: {selectedSummary.to}</p>
                    )}
                    <p className="text-xs text-muted-foreground mb-3">
                      Latest message is expanded; older ones collapse — tap to open.
                    </p>
                    <div className="space-y-3">
                      {thread.messages.map((msg, idx) => {
                        const n = thread.messages.length;
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
                        const warmupInbound =
                          !outbound && !!(msg as { warmup_reply?: boolean }).warmup_reply;
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
                              warmup={warmupInbound}
                            >
                              {htmlPart ? (
                                <EmailHtmlViewer html={htmlPart} />
                              ) : looksLikeHtml(bodyStr) ? (
                                <EmailHtmlViewer html={bodyStr} />
                              ) : (
                                <BodyWithLinks text={bodyStr} />
                              )}
                            </ThreadMessageCard>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground">Thread not found.</p>
                )}
              </div>
              {thread?.messages?.length ? (
                <div className="border-t bg-gradient-to-b from-muted/30 to-muted/50 shrink-0 flex flex-col max-h-[min(60vh,32rem)]">
                  {replyOpen ? (
                    <div className="p-3 sm:p-4 overflow-y-auto">
                      <div
                        className={cn(
                          "rounded-2xl border border-border/80 bg-card text-card-foreground",
                          "shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]",
                          "overflow-hidden"
                        )}
                      >
                        <div className="flex items-start gap-3 px-4 py-3 border-b border-border/60 bg-muted/20">
                          <div
                            className="h-10 w-10 shrink-0 rounded-full bg-primary/12 text-primary flex items-center justify-center text-sm font-semibold"
                            aria-hidden
                          >
                            {(replyToDisplay || "?").trim().charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1 pt-0.5">
                            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                              Reply to
                            </p>
                            <p className="text-sm font-medium text-foreground truncate" title={replyToDisplay}>
                              {replyToDisplay || "Recipient"}
                            </p>
                          </div>
                        </div>
                        <div className="px-4 pt-3 pb-1">
                          <label htmlFor="reply-subject" className="sr-only">
                            Subject
                          </label>
                          <Input
                            id="reply-subject"
                            value={replySubject}
                            onChange={(e) => setReplySubject(e.target.value)}
                            placeholder="Subject"
                            className="border-0 border-b border-transparent rounded-none px-0 h-auto py-1.5 text-base font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-primary/40 bg-transparent placeholder:text-muted-foreground/60"
                          />
                        </div>
                        <div className="px-4 pb-2">
                          {replyCcExpanded ? (
                            <div className="space-y-1.5 pt-1 animate-in fade-in slide-in-from-top-1 duration-200">
                              <Label htmlFor="reply-cc" className="text-xs text-muted-foreground">
                                Cc
                              </Label>
                              <Input
                                id="reply-cc"
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
                              onClick={() => setReplyCcExpanded(true)}
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
                            className={cn(
                              "border-0 shadow-none rounded-none rounded-b-xl bg-white",
                              "[&_.tiptap]:min-h-[200px]"
                            )}
                          />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-border/60 bg-muted/15">
                          <Button
                            className="gap-2 rounded-full gradient-primary px-6 shadow-sm"
                            onClick={handleSendReply}
                            disabled={
                              replyMutation.isPending ||
                              !replySubject.trim() ||
                              !htmlToPlainText(replyBody).trim()
                            }
                          >
                            {replyMutation.isPending ? (
                              "Sending…"
                            ) : (
                              <>
                                <Send className="w-4 h-4" />
                                Send
                              </>
                            )}
                          </Button>
                          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={resetReplyComposer}>
                            Discard
                          </Button>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-2.5 px-1 leading-relaxed">
                        Your reply is sent from this mailbox.
                      </p>
                    </div>
                  ) : (
                    <div className="p-4">
                      <Button
                        className="gap-2 rounded-full gradient-primary px-5 shadow-sm"
                        onClick={handleReply}
                        disabled={!canReplyToThread}
                      >
                        <Reply className="w-4 h-4" />
                        Reply
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
