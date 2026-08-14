"use client";

import { useEffect, useState, useRef } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { Ticket, Send, MessageSquare, User, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type TicketRecord = {
  id: string;
  user_id: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  assigned_to?: string | null;
  created_at: string;
  updated_at: string;
};

type TicketCommentRecord = {
  id: string;
  ticket_id: string;
  author_id: string;
  author_type: string;
  body: string;
  created_at: string;
};

type UserDetails = { email: string; name?: string | null };

const STATUSES = ["open", "in_progress", "resolved", "closed"];
const PRIORITIES = ["low", "medium", "high", "urgent"];

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function AdminTicketsPage() {
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userFilter, setUserFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<TicketRecord | null>(null);
  const [comments, setComments] = useState<TicketCommentRecord[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [updating, setUpdating] = useState(false);
  const [editStatus, setEditStatus] = useState("");
  const [editPriority, setEditPriority] = useState("");
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const [userDetailsMap, setUserDetailsMap] = useState<Record<string, UserDetails>>({});
  const requestedUserIdsRef = useRef<Set<string>>(new Set());

  const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());

  const fetchTickets = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { limit: 100 };
      if (userFilter && isUuid(userFilter)) params.user_id = userFilter.trim();
      if (statusFilter) params.status = statusFilter;
      const res = await adminApi.get<{ tickets: TicketRecord[]; total: number }>(
        "/admin/tickets",
        { params }
      );
      setTickets(res.data.tickets ?? []);
      setTotal(res.data.total ?? 0);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, [userFilter, statusFilter]);

  // Fetch user details (name, email) for ticket user_ids
  useEffect(() => {
    const userIds = [...new Set(tickets.map((t) => t.user_id))].filter(
      (id) => !requestedUserIdsRef.current.has(id)
    );
    if (userIds.length === 0) return;
    userIds.forEach((id) => requestedUserIdsRef.current.add(id));
    let cancelled = false;
    Promise.all(
      userIds.map(async (userId) => {
        try {
          const res = await adminApi.get<{ email: string; name?: string | null }>(
            `/admin/users/${encodeURIComponent(userId)}`
          );
          const data = res.data as { email?: string; name?: string | null };
          return { userId, email: data?.email ?? "", name: data?.name ?? null };
        } catch {
          return { userId, email: "", name: null };
        }
      })
    ).then((results) => {
      if (cancelled) return;
      const newMap: Record<string, UserDetails> = {};
      results.forEach(({ userId, email, name }) => {
        newMap[userId] = { email, name };
      });
      setUserDetailsMap((prev) => ({ ...prev, ...newMap }));
    });
    return () => {
      cancelled = true;
    };
  }, [tickets]);

  // When a ticket is selected, fetch its user details if we don't have email yet (so header shows email, not ID)
  useEffect(() => {
    if (!selectedTicket?.user_id) return;
    const details = userDetailsMap[selectedTicket.user_id];
    if (details?.email) return;
    let cancelled = false;
    adminApi
      .get<{ email?: string; name?: string | null }>(`/admin/users/${encodeURIComponent(selectedTicket.user_id)}`)
      .then((res) => {
        if (cancelled) return;
        const data = res.data as { email?: string; name?: string | null };
        setUserDetailsMap((prev) => ({
          ...prev,
          [selectedTicket.user_id]: { email: data?.email ?? "", name: data?.name ?? null },
        }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedTicket?.user_id]);

  const getUserDisplay = (userId: string) => {
    const details = userDetailsMap[userId];
    if (details?.name?.trim()) return details.name;
    if (details?.email?.trim()) return details.email;
    return null;
  };

  const getUserSubtext = (userId: string) => {
    const details = userDetailsMap[userId];
    if (details?.name?.trim() && details?.email?.trim()) return details.email;
    if (details?.email?.trim()) return null;
    return null;
  };

  const displayedTickets = (() => {
    if (!userFilter.trim()) return tickets;
    const q = userFilter.trim().toLowerCase();
    return tickets.filter(
      (t) =>
        t.user_id.toLowerCase().includes(q) ||
        getUserDisplay(t.user_id)?.toLowerCase().includes(q) ||
        userDetailsMap[t.user_id]?.email?.toLowerCase().includes(q)
    );
  })();

  const openDetail = async (ticket: TicketRecord) => {
    setSelectedTicket(ticket);
    setEditStatus(ticket.status);
    setEditPriority(ticket.priority);
    setReplyBody("");
    setCommentsLoading(true);
    setComments([]);
    try {
      const res = await adminApi.get<{ comments: TicketCommentRecord[] }>(
        `/admin/tickets/${ticket.id}/comments`
      );
      setComments(res.data.comments ?? []);
    } catch {
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  };

  useEffect(() => {
    const el = messagesScrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [comments, selectedTicket, commentsLoading]);

  const handleUpdateTicket = async () => {
    if (!selectedTicket) return;
    setUpdating(true);
    try {
      await adminApi.put(`/admin/tickets/${selectedTicket.id}`, {
        status: editStatus,
        priority: editPriority,
      });
      setSelectedTicket((prev) =>
        prev ? { ...prev, status: editStatus, priority: editPriority } : null
      );
      await fetchTickets();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to update ticket");
    } finally {
      setUpdating(false);
    }
  };

  const handleAddReply = async () => {
    if (!selectedTicket || !replyBody.trim()) return;
    setUpdating(true);
    setError(null);
    try {
      await adminApi.post(`/admin/tickets/${selectedTicket.id}/comments`, {
        body: replyBody.trim(),
      });
      const res = await adminApi.get<{ comments: TicketCommentRecord[] }>(
        `/admin/tickets/${selectedTicket.id}/comments`
      );
      setComments(res.data.comments ?? []);
      setReplyBody("");
      await fetchTickets();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to add reply");
    } finally {
      setUpdating(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "bg-primary/10 text-primary";
      case "in_progress":
        return "bg-amber-100 text-amber-800";
      case "resolved":
        return "bg-green-100 text-green-800";
      case "closed":
        return "bg-zinc-100 text-zinc-600";
      default:
        return "bg-zinc-100 text-zinc-700";
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] min-h-[500px]">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-zinc-900 flex items-center gap-2">
          <Ticket className="h-5 w-5" />
          Support tickets
        </h1>
        <Button variant="outline" size="sm" onClick={fetchTickets} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="flex gap-2 items-center mb-3">
        <Input
          placeholder="Filter by user ID, name or email"
          className="max-w-[200px] h-8 text-sm"
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
        />
        <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-[140px] h-8 text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-zinc-500 ml-auto">
          {userFilter.trim() ? `${displayedTickets.length} of ` : ""}{total} tickets
        </span>
      </div>

      {error && (
        <p className="text-xs text-red-600 mb-2 px-2">{error}</p>
      )}

      <div className="flex flex-1 min-h-0 border border-zinc-200 rounded-lg bg-white overflow-hidden">
        {/* Left: ticket list */}
        <div className="w-[320px] sm:w-[360px] border-r border-zinc-200 flex flex-col bg-zinc-50/50">
          <div className="p-2 border-b border-zinc-200 bg-white">
            <p className="text-xs font-medium text-zinc-500 px-2">Conversations</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center text-sm text-zinc-500">Loading tickets…</div>
            ) : displayedTickets.length === 0 ? (
              <div className="p-6 text-center text-sm text-zinc-500">No tickets found.</div>
            ) : (
              <ul className="p-1">
                {displayedTickets.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => openDetail(t)}
                      className={`w-full text-left rounded-lg p-3 transition-colors ${
                        selectedTicket?.id === t.id
                          ? "bg-primary/10 border border-primary/20"
                          : "hover:bg-zinc-100 border border-transparent"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-zinc-900 truncate flex-1" title={t.subject}>
                          {t.subject || "No subject"}
                        </p>
                        <span
                          className={`shrink-0 inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${getStatusColor(
                            t.status
                          )}`}
                        >
                          {t.status.replace("_", " ")}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 mt-1 truncate" title={userDetailsMap[t.user_id]?.email || getUserDisplay(t.user_id) || t.user_id}>
                        {userDetailsMap[t.user_id]?.email || getUserDisplay(t.user_id) || (
                          <span className="font-mono">{t.user_id}</span>
                        )}
                      </p>
                      {getUserSubtext(t.user_id) && (
                        <p className="text-[11px] text-zinc-400 truncate" title={getUserSubtext(t.user_id) ?? undefined}>
                          {getUserSubtext(t.user_id)}
                        </p>
                      )}
                      <p className="text-xs text-zinc-400 mt-0.5">{formatDate(t.updated_at)}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right: chat */}
        <div className="flex-1 flex flex-col min-w-0 bg-white">
          {!selectedTicket ? (
            <div className="flex-1 flex items-center justify-center text-zinc-400">
              <div className="text-center">
                <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm font-medium">Select a ticket</p>
                <p className="text-xs mt-1">Choose a conversation from the list to view and reply.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="shrink-0 border-b border-zinc-200 px-4 py-3 bg-white">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-zinc-900 truncate">
                      {selectedTicket.subject}
                    </h2>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      User: {userDetailsMap[selectedTicket.user_id]?.email ? (
                        <span>{userDetailsMap[selectedTicket.user_id].email}</span>
                      ) : getUserDisplay(selectedTicket.user_id) ? (
                        getUserDisplay(selectedTicket.user_id)
                      ) : (
                        <span className="font-mono">{selectedTicket.user_id}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Select value={editStatus} onValueChange={setEditStatus}>
                      <SelectTrigger className="w-[130px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s.replace("_", " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={editPriority} onValueChange={setEditPriority}>
                      <SelectTrigger className="w-[100px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRIORITIES.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" onClick={handleUpdateTicket} disabled={updating}>
                      {updating ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Messages - scrollable container only */}
              <div
                ref={messagesScrollRef}
                className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 space-y-4 bg-zinc-50/30"
              >
                {/* Initial message: ticket description from user */}
                <div className="flex gap-3">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-zinc-200 flex items-center justify-center">
                    <User className="h-4 w-4 text-zinc-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="rounded-lg rounded-tl-none bg-white border border-zinc-200 p-3 shadow-sm">
                      <p className="text-xs text-zinc-500 mb-1">
                        {userDetailsMap[selectedTicket.user_id]?.email ?? "User"} · {formatDate(selectedTicket.created_at)}
                      </p>
                      <p className="text-sm text-zinc-800 whitespace-pre-wrap">
                        {selectedTicket.description}
                      </p>
                    </div>
                  </div>
                </div>

                {commentsLoading ? (
                  <p className="text-sm text-zinc-500">Loading messages…</p>
                ) : (
                  comments.map((c) => (
                    <div
                      key={c.id}
                      className={`flex gap-3 ${c.author_type === "admin" ? "flex-row-reverse" : ""}`}
                    >
                      <div
                        className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                          c.author_type === "admin" ? "bg-primary/20" : "bg-zinc-200"
                        }`}
                      >
                        {c.author_type === "admin" ? (
                          <Ticket className="h-4 w-4 text-primary" />
                        ) : (
                          <User className="h-4 w-4 text-zinc-600" />
                        )}
                      </div>
                      <div
                        className={`min-w-0 flex-1 max-w-[85%] ${
                          c.author_type === "admin" ? "text-right" : ""
                        }`}
                      >
                        <div
                          className={`inline-block rounded-lg px-3 py-2 shadow-sm ${
                            c.author_type === "admin"
                              ? "bg-primary text-primary-foreground rounded-tr-none"
                              : "bg-white border border-zinc-200 rounded-tl-none"
                          }`}
                        >
                          <p className="text-[10px] opacity-80 mb-1">
                            {c.author_type === "admin" ? "Admin" : (userDetailsMap[selectedTicket.user_id]?.email ?? "User")} · {formatTime(c.created_at)}
                          </p>
                          <p className="text-sm whitespace-pre-wrap text-left">{c.body}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Reply box */}
              <div className="shrink-0 border-t border-zinc-200 p-4 bg-white">
                <Label className="text-xs text-zinc-500 mb-2 block">Reply as admin</Label>
                <div className="flex gap-2">
                  <Textarea
                    placeholder="Type your reply..."
                    rows={2}
                    className="min-h-[60px] resize-none"
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleAddReply();
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={handleAddReply}
                    disabled={!replyBody.trim() || updating}
                    className="shrink-0 self-end"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
