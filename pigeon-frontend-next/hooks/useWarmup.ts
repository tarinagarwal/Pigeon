import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";
import type { WarmupSharedPoolState } from "@/types/api";

export function useWarmupTimeline() {
  return useQuery({
    queryKey: ["warmup-timeline"],
    queryFn: () => api.warmup.getTimeline(),
    staleTime: 2 * 60 * 1000,
  });
}

export function useWarmupStats() {
  return useQuery({
    queryKey: ["warmup-stats"],
    queryFn: () => api.warmup.getStats(),
    staleTime: 2 * 60 * 1000,
  });
}

export type WarmupSendTemplateItem = {
  id: string;
  subject: string;
  body: string;
  body_type: 'html' | 'plain' | 'rich';
  created_at: string;
};

export function useWarmupSendTemplates(enabled = true) {
  return useQuery({
    queryKey: ["warmup-send-templates"],
    queryFn: () => api.warmup.getSendTemplates(),
    enabled,
  });
}

export function useCreateWarmupSendTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { subject: string; body: string; body_type?: 'html' | 'plain' | 'rich' }) =>
      api.warmup.createSendTemplate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warmup-send-templates"] });
      toast.success("Warmup template created");
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed to create template");
    },
  });
}

export function useUpdateWarmupSendTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      templateId,
      subject,
      body,
      body_type,
    }: {
      templateId: string;
      subject?: string;
      body?: string;
      body_type?: 'html' | 'plain' | 'rich';
    }) => api.warmup.updateSendTemplate(templateId, { subject, body, body_type }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warmup-send-templates"] });
      toast.success("Warmup template updated");
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed to update template");
    },
  });
}

export function useDeleteWarmupSendTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) => api.warmup.deleteSendTemplate(templateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warmup-send-templates"] });
      toast.success("Warmup template deleted");
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed to delete template");
    },
  });
}

// ---------------------------------------------------------------------------
// Warmup Network contacts
// ---------------------------------------------------------------------------

export type WarmupNetworkContactItem = {
  id: string;
  user_id: string;
  email: string;
  label?: string;
  created_at: string;
  updated_at: string;
};

export function useWarmupNetworkContacts(enabled = true) {
  return useQuery({
    queryKey: ["warmup-network-contacts"],
    queryFn: () => api.warmup.getNetworkContacts(),
    enabled,
  });
}

export function useUpdateWarmupNetworkSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { contact_daily_limit: number }) => api.warmup.updateNetworkSettings(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warmup-network-contacts"] });
      toast.success("Daily limit saved");
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed to save daily limit");
    },
  });
}

export function useSendWarmupNetworkVerifyOtp() {
  return useMutation({
    mutationFn: (email: string) => api.warmup.sendNetworkContactVerify(email),
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed to send verification code");
    },
  });
}

export function useCreateWarmupNetworkContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { email: string; otp: string; label?: string }) => api.warmup.createNetworkContact(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warmup-network-contacts"] });
      queryClient.invalidateQueries({ queryKey: ["warmup-shared-pool"] });
      toast.success("Contact added to Warmup Network");
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed to add contact");
    },
  });
}

export function useDeleteWarmupNetworkContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (contactId: string) => api.warmup.deleteNetworkContact(contactId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warmup-network-contacts"] });
      queryClient.invalidateQueries({ queryKey: ["warmup-shared-pool"] });
      toast.success("Contact removed");
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed to remove contact");
    },
  });
}

export function useWarmupSharedPoolState(enabled = true) {
  return useQuery({
    queryKey: ["warmup-shared-pool"],
    queryFn: () => api.warmup.getSharedPoolState(),
    enabled,
  });
}

export function useUpdateWarmupSharedPoolEnrollment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => api.warmup.updateSharedPoolEnrollment(enabled),
    onSuccess: (data: WarmupSharedPoolState) => {
      queryClient.setQueryData(["warmup-shared-pool"], data);
      queryClient.invalidateQueries({ queryKey: ["warmup-shared-pool"] });
      toast.success(data.contributor.enabled ? "Renting to the pool is on" : "Renting to the pool is off");
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed to update shared pool");
    },
  });
}

export function useQuickEngagementSend() {
  return useMutation({
    mutationFn: ({ inbox_id, recipient_email }: { inbox_id: string; recipient_email: string }) =>
      api.warmup.quickSend(inbox_id, recipient_email),
    onSuccess: () => {
      toast.success("Warmup email sent successfully");
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed to send warmup email");
    },
  });
}

export type WarmupSentLogItem = {
  id: string;
  inbox_email: string;
  receiver_email: string;
  engagement_mode: 'pool' | 'network' | 'shared_pool' | 'quick';
  subject: string;
  sent_at: string;
  replied_at?: string | null;
};

export function useWarmupSentLogs(
  params?: { limit?: number; offset?: number; engagement_mode?: string; since_hours?: number },
  enabled = true
) {
  return useQuery({
    queryKey: ["warmup-sent-logs", params],
    queryFn: () => api.warmup.getSentLogs(params),
    enabled,
  });
}

export function useWarmupRecentSends(limit = 20, enabled = true) {
  return useQuery({
    queryKey: ["warmup-recent-sends", limit],
    queryFn: () => api.warmup.getRecentSends(limit),
    enabled,
  });
}
