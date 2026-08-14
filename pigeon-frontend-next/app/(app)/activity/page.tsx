"use client";

import { Activity, Mail, MousePointer, MessageSquare, Send, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useUserActivity, type ActivityItem } from "@/hooks/useAnalytics";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  send: Send,
  open: Mail,
  click: MousePointer,
  reply: MessageSquare,
  default: Activity,
};

export default function ActivityPage() {
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const { data: activities = [], isLoading, isError } = useUserActivity(userId, 50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Activity</h1>
        <p className="text-muted-foreground mt-1">
          Recent activity across campaigns and inboxes.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Recent activity
          </CardTitle>
          <CardDescription>
            Sends, opens, clicks, and other events
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : isError ? (
            <p className="text-destructive text-sm py-4">Failed to load activity.</p>
          ) : activities.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">
              No recent activity. Send campaigns to see events here.
            </p>
          ) : (
            <ul className="space-y-3">
              {activities.map((activity: ActivityItem, index: number) => {
                const Icon = iconMap[activity.icon] ?? iconMap.default;
                return (
                  <li
                    key={`${activity.id}-${index}`}
                    className="flex items-start gap-3 rounded-lg border p-3"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{activity.title}</p>
                      {activity.description && (
                        <p className="text-sm text-muted-foreground mt-0.5">{activity.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
