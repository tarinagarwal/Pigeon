"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Send, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTicket, useTicketComments, useAddTicketComment } from "@/hooks/useTickets";
import type { TicketComment, TicketStatus, TicketPriority } from "@/types/api";
import { format, formatDistanceToNow } from "date-fns";

const STATUS_OPTIONS: { value: TicketStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const PRIORITY_OPTIONS: { value: TicketPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

function StatusBadge({ status }: { status: TicketStatus }) {
  const map: Record<TicketStatus, string> = {
    open: "bg-primary/10 text-primary",
    in_progress: "bg-amber-100 text-amber-800",
    resolved: "bg-green-100 text-green-800",
    closed: "bg-zinc-100 text-zinc-600",
  };
  const label = STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status;
  return <Badge variant="secondary" className={map[status] ?? ""}>{label}</Badge>;
}

function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const map: Record<TicketPriority, string> = {
    low: "bg-zinc-100 text-zinc-600",
    medium: "bg-primary/10 text-primary",
    high: "bg-orange-100 text-orange-800",
    urgent: "bg-red-100 text-red-800",
  };
  const label = PRIORITY_OPTIONS.find((p) => p.value === priority)?.label ?? priority;
  return <Badge variant="outline" className={map[priority] ?? ""}>{label}</Badge>;
}

export default function TicketDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [reply, setReply] = useState("");

  const { data: ticket, isLoading: ticketLoading } = useTicket(id);
  const { data: comments = [], isLoading: commentsLoading } = useTicketComments(id);
  const addComment = useAddTicketComment();

  const handleReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    addComment.mutate(
      { ticketId: id, data: { body: reply.trim() } },
      { onSuccess: () => setReply("") }
    );
  };

  const formatDate = (iso: string) => {
    try {
      return format(new Date(iso), "MMM d, yyyy HH:mm");
    } catch {
      return iso;
    }
  };

  const formatLocalTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return format(d, "MMM d, h:mm a");
    } catch {
      return iso;
    }
  };

  if (!id) {
    return (
      <div className="space-y-6">
        <Link href="/tickets" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to tickets
        </Link>
        <p className="text-muted-foreground">Invalid ticket.</p>
      </div>
    );
  }

  if (ticketLoading || !ticket) {
    return (
      <div className="space-y-6">
        <Link href="/tickets" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to tickets
        </Link>
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/tickets"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground w-fit"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to tickets
        </Link>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xl">Ticket details</CardTitle>
          <div className="flex flex-wrap gap-2 items-center pt-2">
            <StatusBadge status={ticket.status as TicketStatus} />
            <PriorityBadge priority={ticket.priority as TicketPriority} />
            <span className="text-xs text-muted-foreground" title={formatDistanceToNow(new Date(ticket.updated_at), { addSuffix: true })}>
              Updated {formatLocalTime(ticket.updated_at)}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h2 className="font-semibold text-lg">{ticket.subject}</h2>
            <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
              {ticket.description}
            </p>
          </div>

          <div className="border-t pt-4">
            <h3 className="text-sm font-medium mb-2">Comments</h3>
            {commentsLoading ? (
              <p className="text-sm text-muted-foreground">Loading comments…</p>
            ) : comments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No comments yet.</p>
            ) : (
              <ul className="space-y-3">
                {comments.map((c: TicketComment) => (
                  <li
                    key={c.id}
                    className={`rounded-lg p-3 text-sm ${
                      c.author_type === "admin"
                        ? "bg-primary/5 border border-primary/20"
                        : "bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Tag className="h-3.5 w-3.5" />
                      <span className="font-medium">
                        {c.author_type === "admin" ? "Support" : "You"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(c.created_at)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap">{c.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(ticket.status === "open" || ticket.status === "in_progress" || ticket.status === "resolved") && (
            <div className="space-y-2 border-t pt-4">
              <Label htmlFor="comment">Add a comment</Label>
              <form onSubmit={handleReply} className="space-y-2">
                <Textarea
                  id="comment"
                  placeholder="Type your message..."
                  rows={3}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  className="min-h-[5rem] max-h-[12rem] sm:max-h-[16rem] resize-y w-full"
                />
                <Button
                  size="sm"
                  type="submit"
                  disabled={!reply.trim() || addComment.isPending}
                  className="gap-2"
                >
                  <Send className="h-4 w-4" />
                  {addComment.isPending ? "Sending…" : "Send"}
                </Button>
              </form>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
