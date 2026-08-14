"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, CheckCircle, Info, AlertCircle, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useAlerts, useMarkAlertRead, useDeleteAlert } from "@/hooks/useAlerts";
import type { Alert } from "@/types/api";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { HelpLinks } from "@/components/HelpLinks";

/** Re-renders periodically so relative time (e.g. "less than a minute ago") updates. */
function useLiveRelativeTime(intervalMs = 60_000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

function AlertIcon({ type }: { type: Alert["type"] }) {
  switch (type) {
    case "success":
      return <CheckCircle className="w-5 h-5 text-green-600" />;
    case "warning":
      return <AlertTriangle className="w-5 h-5 text-amber-600" />;
    case "error":
      return <AlertCircle className="w-5 h-5 text-destructive" />;
    default:
      return <Info className="w-5 h-5 text-primary" />;
  }
}

export default function AlertsPage() {
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const { data: alerts = [], isLoading, isError } = useAlerts(userId);
  const markRead = useMarkAlertRead();
  const deleteAlert = useDeleteAlert();
  useLiveRelativeTime(60_000); // update relative time every 60s

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Alerts</h1>
        <p className="text-muted-foreground mt-1">
          Deliverability and system alerts.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All alerts</CardTitle>
          <CardDescription>
            Important alerts about your domains, inboxes, or campaigns.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : isError ? (
            <p className="text-destructive text-sm py-4">Failed to load alerts.</p>
          ) : alerts.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">
              No alerts. You're all set.
            </p>
          ) : (
            <ul className="space-y-3">
              {alerts.map((alert) => (
                <li
                  key={alert.id}
                  className={`flex items-start gap-3 rounded-lg border p-4 ${!alert.is_read ? "bg-muted/50" : ""}`}
                >
                  <AlertIcon type={alert.type} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{alert.title}</p>
                    <p className="text-sm text-muted-foreground mt-1">{alert.message}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {formatDistanceToNow(new Date(alert.time), { addSuffix: true })}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {!alert.is_read && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => markRead.mutate({ alertId: alert.id, userId })}
                        disabled={markRead.isPending}
                      >
                        Mark read
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => deleteAlert.mutate({ alertId: alert.id, userId })}
                      disabled={deleteAlert.isPending}
                      title="Dismiss alert"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <HelpLinks slugs={["understanding-alerts-deliverability-system-notifications"]} className="mt-6" />
    </div>
  );
}
