"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import {
  Archive,
  ArchiveRestore,
  Building2,
  ChevronDown,
  ChevronUp,
  Mail,
  MessageSquare,
  Phone,
  RefreshCw,
  Search,
  Trash2,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type ContactSubmission = {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  company?: string;
  phone?: string;
  created_at: string;
  archived?: boolean;
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function matchesQuery(s: ContactSubmission, q: string) {
  if (!q.trim()) return true;
  const n = q.trim().toLowerCase();
  return (
    s.name.toLowerCase().includes(n) ||
    s.email.toLowerCase().includes(n) ||
    s.subject.toLowerCase().includes(n) ||
    s.message.toLowerCase().includes(n) ||
    (s.company && s.company.toLowerCase().includes(n)) ||
    (s.phone && s.phone.toLowerCase().includes(n))
  );
}

function CardGridSkeleton() {
  return (
    <div
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 motion-reduce:transition-none"
      aria-hidden
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-56 rounded-xl border border-border bg-muted/40 animate-pulse motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}

export default function AdminContactSubmissionsPage() {
  const [submissions, setSubmissions] = useState<ContactSubmission[]>([]);
  const [total, setTotal] = useState(0);
  const [totalActive, setTotalActive] = useState(0);
  const [totalArchived, setTotalArchived] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.get<{
        submissions: ContactSubmission[];
        total: number;
        total_active?: number;
        total_archived?: number;
      }>("/admin/contact-submissions", {
        params: { limit: 200, show_archived: showArchived },
      });
      setSubmissions(res.data.submissions ?? []);
      setTotal(res.data.total ?? 0);
      setTotalActive(res.data.total_active ?? res.data.total ?? 0);
      setTotalArchived(res.data.total_archived ?? 0);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load contact submissions");
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    void fetchSubmissions();
  }, [fetchSubmissions]);

  const activeSubmissions = useMemo(() => {
    return submissions.filter((s) => !s.archived).filter((s) => matchesQuery(s, search));
  }, [submissions, search]);

  const archivedSubmissions = useMemo(() => {
    return submissions.filter((s) => s.archived).filter((s) => matchesQuery(s, search));
  }, [submissions, search]);

  const visibleSubmissions = useMemo(() => {
    return showArchived
      ? [...activeSubmissions, ...archivedSubmissions]
      : activeSubmissions;
  }, [activeSubmissions, archivedSubmissions, showArchived]);

  const visibleIds = visibleSubmissions.map((s) => s.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected =
    visibleIds.some((id) => selectedIds.has(id)) && !allVisibleSelected;

  const toggleSelectSubmission = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    if (
      !window.confirm(
        `Permanently delete ${ids.length} selected submission${ids.length === 1 ? "" : "s"}? This cannot be undone.`,
      )
    ) {
      return;
    }

    setBulkDeleting(true);
    setError(null);
    try {
      const res = await adminApi.post<{ deleted: number; requested: number }>(
        "/admin/contact-submissions/bulk-delete",
        { submission_ids: ids },
      );
      setSelectedIds(new Set());
      setExpandedId(null);
      await fetchSubmissions();
      if (res.data.deleted < res.data.requested) {
        setError(
          `Deleted ${res.data.deleted} of ${res.data.requested} submissions. Some may no longer exist.`,
        );
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to delete selected submissions");
    } finally {
      setBulkDeleting(false);
    }
  };

  const setArchived = async (id: string, archived: boolean) => {
    setMutatingId(id);
    setError(null);
    try {
      await adminApi.patch(`/admin/contact-submissions/${id}`, { archived });
      await fetchSubmissions();
      if (!archived) setExpandedId((cur) => (cur === id ? null : cur));
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to update submission");
    } finally {
      setMutatingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (
      !window.confirm(
        "Permanently delete this submission? This cannot be undone."
      )
    ) {
      return;
    }
    setMutatingId(id);
    setError(null);
    try {
      await adminApi.delete(`/admin/contact-submissions/${id}`);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setExpandedId((cur) => (cur === id ? null : cur));
      await fetchSubmissions();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to delete");
    } finally {
      setMutatingId(null);
    }
  };

  const renderCard = (s: ContactSubmission) => {
    const expanded = expandedId === s.id;
    const busy = mutatingId === s.id || bulkDeleting;
    const isArchived = Boolean(s.archived);
    const selected = selectedIds.has(s.id);

    return (
      <Card
        key={s.id}
        className={cn(
          "flex flex-col transition-shadow duration-200 motion-reduce:transition-none",
          isArchived && "border-dashed bg-muted/30 opacity-95",
          selected && "ring-2 ring-primary/40 border-primary/30"
        )}
      >
        <CardHeader className="space-y-2 pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <input
                type="checkbox"
                checked={selected}
                onChange={() => toggleSelectSubmission(s.id)}
                disabled={bulkDeleting}
                className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300 text-primary focus:ring-primary"
                aria-label={`Select submission from ${s.name}`}
              />
              <div className="min-w-0 flex-1 space-y-1">
                <CardTitle className="text-base leading-snug line-clamp-2">
                  {s.subject || "(No subject)"}
                </CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <time dateTime={s.created_at}>{formatDate(s.created_at)}</time>
                  {isArchived && (
                    <Badge variant="secondary" className="text-[10px] font-medium">
                      Archived
                    </Badge>
                  )}
                </CardDescription>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 text-sm text-foreground">
            <div className="flex min-w-0 items-center gap-2">
              <User
                className="h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="truncate font-medium">{s.name}</span>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <Mail
                className="h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <a
                href={`mailto:${s.email}`}
                className="truncate text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              >
                {s.email}
              </a>
            </div>
            {(s.company || s.phone) && (
              <div className="flex flex-col gap-1 border-t border-border pt-2 text-xs text-muted-foreground">
                {s.company && (
                  <span className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {s.company}
                  </span>
                )}
                {s.phone && (
                  <a
                    href={`tel:${s.phone.replace(/\s/g, "")}`}
                    className="flex items-center gap-1.5 text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  >
                    <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {s.phone}
                  </a>
                )}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-1 pb-3">
          <div
            id={`submission-body-${s.id}`}
            className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm"
          >
            {expanded ? (
              <p className="whitespace-pre-wrap text-foreground">{s.message}</p>
            ) : (
              <p className="line-clamp-4 text-muted-foreground">{s.message}</p>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 h-8 px-2 text-xs text-primary"
              onClick={() => setExpandedId(expanded ? null : s.id)}
              aria-expanded={expanded}
              aria-controls={`submission-body-${s.id}`}
              id={`submission-toggle-${s.id}`}
            >
              {expanded ? (
                <>
                  <ChevronUp className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Read full message
                </>
              )}
            </Button>
          </div>
        </CardContent>
        <CardFooter className="mt-auto flex flex-wrap gap-2 border-t pt-4">
          {isArchived ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-9"
              disabled={busy}
              onClick={() => void setArchived(s.id, false)}
            >
              <ArchiveRestore className="mr-1.5 h-4 w-4" aria-hidden />
              Restore
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-9"
              disabled={busy}
              onClick={() => void setArchived(s.id, true)}
            >
              <Archive className="mr-1.5 h-4 w-4" aria-hidden />
              Archive
            </Button>
          )}
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="min-h-9"
            disabled={busy}
            onClick={() => void handleDelete(s.id)}
          >
            <Trash2 className="mr-1.5 h-4 w-4" aria-hidden />
            Delete
          </Button>
        </CardFooter>
      </Card>
    );
  };

  const showEmptyInbox =
    !loading && activeSubmissions.length === 0 && !search.trim();
  const showEmptyArchived =
    showArchived &&
    !loading &&
    archivedSubmissions.length === 0 &&
    !search.trim();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
          <MessageSquare className="h-6 w-6 text-primary" aria-hidden />
          Contact submissions
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Messages from the public contact form. Archive items you have handled;
          archived items stay hidden until you choose to show them.
        </p>
      </header>

      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1 min-w-[200px]">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Search name, email, subject, message…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            aria-label="Filter submissions"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {visibleSubmissions.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someVisibleSelected;
                }}
                onChange={toggleSelectAll}
                disabled={loading || bulkDeleting}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              Select all
            </label>
          )}
          {selectedIds.size > 0 && (
            <>
              <span className="text-sm text-muted-foreground">
                {selectedIds.size} selected
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-9"
                onClick={() => setSelectedIds(new Set())}
                disabled={bulkDeleting}
              >
                Clear
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="min-h-9"
                onClick={() => void handleBulkDelete()}
                disabled={bulkDeleting}
              >
                <Trash2 className="mr-1.5 h-4 w-4" aria-hidden />
                {bulkDeleting ? "Deleting..." : "Delete selected"}
              </Button>
            </>
          )}
          <Button
            type="button"
            variant={showArchived ? "default" : "outline"}
            size="sm"
            className="min-h-9"
            onClick={() => setShowArchived((v) => !v)}
            aria-pressed={showArchived}
            aria-controls="archived-submissions-section"
          >
            <Archive className="mr-1.5 h-4 w-4" aria-hidden />
            {showArchived ? "Hide archived" : "Show archived"}
            {totalArchived > 0 && (
              <Badge
                variant="secondary"
                className="ml-2 rounded-sm px-1.5 py-0 text-[10px]"
              >
                {totalArchived}
              </Badge>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-9"
            onClick={() => void fetchSubmissions()}
            disabled={loading}
          >
            <RefreshCw
              className={cn("mr-1.5 h-4 w-4", loading && "animate-spin motion-reduce:animate-none")}
              aria-hidden
            />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          Inbox:{" "}
          <strong className="text-foreground font-medium">{totalActive}</strong>
        </span>
        <span className="hidden sm:inline" aria-hidden>
          ·
        </span>
        <span>
          Archived:{" "}
          <strong className="text-foreground font-medium">{totalArchived}</strong>
        </span>
        {showArchived && (
          <>
            <span className="hidden sm:inline" aria-hidden>
              ·
            </span>
            <span>
              Showing{" "}
              <strong className="text-foreground font-medium">{total}</strong> in
              this view
            </span>
          </>
        )}
      </div>

      <div role="status" className="sr-only" aria-live="polite">
        {loading ? "Loading submissions." : `Loaded ${submissions.length} submissions.`}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {loading && submissions.length === 0 ? (
        <CardGridSkeleton />
      ) : (
        <>
          <section aria-labelledby="inbox-heading" className="space-y-3">
            <h2 id="inbox-heading" className="text-sm font-semibold text-foreground">
              Inbox
            </h2>
            {showEmptyInbox ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground">
                  <MessageSquare className="mb-2 h-10 w-10 opacity-40" aria-hidden />
                  <p>No active submissions right now.</p>
                  <p className="mt-1 max-w-sm text-xs">
                    New messages from the website will appear here. Use
                    &quot;Show archived&quot; if you need older, archived items.
                  </p>
                </CardContent>
              </Card>
            ) : activeSubmissions.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                No inbox items match your search.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {activeSubmissions.map(renderCard)}
              </div>
            )}
          </section>

          {showArchived && (
            <section
              id="archived-submissions-section"
              aria-labelledby="archived-heading"
              className="space-y-3 border-t border-border pt-8"
            >
              <h2
                id="archived-heading"
                className="text-sm font-semibold text-muted-foreground"
              >
                Archived
              </h2>
              {showEmptyArchived ? (
                <Card className="border-dashed bg-muted/20">
                  <CardContent className="flex flex-col items-center justify-center py-10 text-center text-sm text-muted-foreground">
                    <Archive className="mb-2 h-9 w-9 opacity-40" aria-hidden />
                    <p>No archived submissions yet.</p>
                    <p className="mt-1 max-w-sm text-xs">
                      Archive a card from the inbox when you are done with it.
                    </p>
                  </CardContent>
                </Card>
              ) : archivedSubmissions.length === 0 ? (
                search.trim() ? (
                  <p className="rounded-lg border border-dashed border-border bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
                    No archived items match your search.
                  </p>
                ) : null
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {archivedSubmissions.map(renderCard)}
                </div>
              )}
            </section>
          )}

        </>
      )}

      {loading && submissions.length > 0 && (
        <p className="text-center text-xs text-muted-foreground" aria-live="polite">
          Updating…
        </p>
      )}
    </div>
  );
}
