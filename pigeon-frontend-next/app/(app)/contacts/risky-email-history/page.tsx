"use client";

import Link from "next/link";
import { AlertCircle, ArrowLeft, History, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useRemoveRiskyEmailsHistory } from "@/hooks/useContacts";

function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function getStatusBadge(status: string) {
  if (status === "completed") {
    return (
      <Badge variant="outline" className="bg-success/10 text-success border-success/20">
        Completed
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
        Failed
      </Badge>
    );
  }
  if (status === "running") {
    return (
      <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20">
        Running
      </Badge>
    );
  }
  if (status === "cancelled") {
    return <Badge variant="secondary">Cancelled</Badge>;
  }
  return <Badge variant="secondary">{status || "Unknown"}</Badge>;
}

export default function RiskyEmailHistoryPage() {
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const { data, isLoading, isError } = useRemoveRiskyEmailsHistory(userId, 0, 100);

  const jobs = data?.jobs || [];
  const total = data?.total || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Remove Risky Emails History</h1>
          <p className="text-muted-foreground mt-1">
            View when checks were run and how many contacts were deleted.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/contacts">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Contacts
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Job history
          </CardTitle>
          <CardDescription>{total.toLocaleString()} total job(s)</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="flex items-center gap-2 text-destructive py-6">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">Failed to load history.</span>
            </div>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No risky-email jobs yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created At</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Checked</TableHead>
                  <TableHead className="text-right">Risky Found</TableHead>
                  <TableHead className="text-right">Deleted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.job_id}>
                    <TableCell className="align-top">
                      <div className="text-sm">{formatDateTime(job.created_at)}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Updated: {formatDateTime(job.updated_at)}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <span className="text-sm">{job.list_name || "All contacts"}</span>
                    </TableCell>
                    <TableCell className="align-top">
                      {getStatusBadge(job.status)}
                      {job.error ? (
                        <p className="text-xs text-destructive mt-1 max-w-xs break-words">
                          {job.error}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {job.checked_so_far.toLocaleString()} / {job.total_to_check.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {job.risky_count.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {job.deleted.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
