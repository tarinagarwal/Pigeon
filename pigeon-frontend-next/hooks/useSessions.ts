import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";

export interface Session {
  id: string;
  jti?: string;
  device: string;
  location: string;
  last_active: string;
  current?: boolean;
}

export function useSessions(enabled = true) {
  return useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: () => api.auth.getSessions() as Promise<Session[]>,
    enabled,
  });
}

export function useRevokeOtherSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.auth.revokeOtherSessions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] });
      toast.success("Other sessions have been revoked");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to revoke sessions");
    },
  });
}

/** Format ISO last_active as relative time (e.g. "Just now", "2 hours ago"). */
export function formatLastActive(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
    return date.toLocaleDateString();
  } catch {
    return iso;
  }
}
