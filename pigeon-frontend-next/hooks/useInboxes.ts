import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { CreateInboxRequest } from '@/types/api';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { usePlanGate } from '@/hooks/usePlanGate';
import {
  outboundSubscriptionBlockMessage,
  userSubscriptionBlocksOutbound,
} from '@/lib/outboundSubscriptionGate';

export function useInboxes(userId: string, enabled = true) {
  return useQuery({
    queryKey: ['inboxes', userId],
    queryFn: () => api.inboxes.list(userId),
    enabled: !!userId && enabled,
    staleTime: 2 * 60 * 1000,
  });
}

export function useInboxSpamScores(userId: string) {
  return useQuery({
    queryKey: ['inbox-spam-scores', userId],
    queryFn: () => api.inboxes.spamScore(userId),
    // Run only when user explicitly triggers it from the UI
    enabled: false,
  });
}

export function useInbox(inboxId: string) {
  return useQuery({
    queryKey: ['inbox', inboxId],
    queryFn: () => api.inboxes.get(inboxId),
    enabled: !!inboxId,
  });
}

export function useCreateInbox() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateInboxRequest) => api.inboxes.create(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['inboxes', variables.user_id] });
      toast.success('Inbox created successfully');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create inbox');
    },
  });
}

export function useUpdateInbox() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ inboxId, data }: { inboxId: string; data: Partial<CreateInboxRequest> }) =>
      api.inboxes.update(inboxId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['inbox', variables.inboxId] });
      queryClient.invalidateQueries({ queryKey: ['inboxes'] });
      toast.success('Inbox updated successfully');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update inbox');
    },
  });
}

export function useSetInboxMailboxPassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ inboxId, password }: { inboxId: string; password: string }) =>
      api.inboxes.setMailboxPassword(inboxId, password),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['inbox', variables.inboxId] });
      queryClient.invalidateQueries({ queryKey: ['inboxes'] });
      toast.success('Mailbox login password saved');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to set mailbox password');
    },
  });
}

export function usePatchInboxStatus() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const warmupGate = usePlanGate('warmup');

  return useMutation({
    mutationFn: ({
      inboxId,
      status,
      warmup_engagement_mode,
    }: {
      inboxId: string;
      status: 'warming' | 'paused';
      warmup_engagement_mode?: 'pool' | 'network' | 'network_plus_shared' | 'hybrid' | 'shared_pool';
    }) =>
      status === 'paused'
        ? api.inboxes.pause(inboxId)
        : api.inboxes.resume(inboxId, warmup_engagement_mode ? { warmup_engagement_mode } : undefined),
    onMutate: async (variables) => {
      if (variables.status !== 'warming') return;
      if (warmupGate.atLimit) {
        throw new Error(
          warmupGate.reason ||
            'Your current plan does not include inbox warmup. Upgrade to resume.',
        );
      }
      if (user && userSubscriptionBlocksOutbound(user)) {
        throw new Error(
          outboundSubscriptionBlockMessage(user) ||
            'Fix your subscription in Settings → Billing before resuming warmup.',
        );
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['inbox', variables.inboxId] });
      queryClient.invalidateQueries({ queryKey: ['inboxes'] });
      toast.success(variables.status === 'paused' ? 'Warmup paused' : 'Warmup resumed');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update inbox status');
    },
  });
}

export function useTestInbox() {
  return useMutation({
    mutationFn: (inboxId: string) => api.inboxes.test(inboxId),
    onSuccess: (data) => {
      if (data.connected) {
        toast.success('Inbox connection test successful');
      } else {
        toast.error('Inbox connection test failed');
      }
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to test inbox connection');
    },
  });
}

export function useForceReadyInbox() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inboxId: string) => api.inboxes.forceReady(inboxId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inboxes'] });
      toast.success('Inbox forced to ready');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to force inbox ready');
    },
  });
}

export function useDeleteInbox() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inboxId: string) => api.inboxes.delete(inboxId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inboxes'] });
      toast.success('Inbox deleted');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete inbox');
    },
  });
}
