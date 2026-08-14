import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";

export function useReplyToImapConfigs(enabled = true) {
  return useQuery({
    queryKey: ["replyToImapConfigs"],
    queryFn: () => api.replyToImap.list(),
    enabled,
  });
}

export function useCreateReplyToImapConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      email: string;
      imap_host: string;
      imap_port?: number;
      imap_username: string;
      imap_password: string;
    }) => api.replyToImap.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["replyToImapConfigs"] });
      toast.success("Reply-To IMAP account added");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to add IMAP account");
    },
  });
}

export function useDeleteReplyToImapConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (configId: string) => api.replyToImap.delete(configId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["replyToImapConfigs"] });
      toast.success("Reply-To IMAP account removed");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to remove IMAP account");
    },
  });
}

export function useTestReplyToImapConfig() {
  return useMutation({
    mutationFn: (configId: string) => api.replyToImap.test(configId),
    onSuccess: () => toast.success("Connection successful"),
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Connection failed"),
  });
}
