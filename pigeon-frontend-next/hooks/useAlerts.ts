import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import type { Alert } from '@/types/api';

export function useAlerts(userId: string) {
  return useQuery({
    queryKey: ['alerts', userId],
    queryFn: () => api.alerts.list(userId),
    enabled: !!userId,
  });
}

export function useMarkAlertRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ alertId, userId }: { alertId: string; userId: string }) =>
      api.alerts.markRead(alertId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to mark alert as read');
    },
  });
}

function removeAlertFromCache(queryClient: QueryClient, userId: string, alertId: string) {
  queryClient.setQueriesData<Alert[]>({ queryKey: ['alerts', userId] }, (old) =>
    old ? old.filter((a) => a.id !== alertId) : old
  );
  queryClient.setQueriesData<Alert[]>({ queryKey: ['alerts'] }, (old) =>
    old ? old.filter((a) => a.id !== alertId) : old
  );
}

export function useDeleteAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ alertId, userId }: { alertId: string; userId: string }) =>
      api.alerts.delete(alertId, userId),
    onMutate: async ({ alertId, userId }) => {
      await queryClient.cancelQueries({ queryKey: ['alerts'] });
      removeAlertFromCache(queryClient, userId, alertId);
    },
    onSuccess: (_data, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['alerts', userId] });
    },
    onError: (error: any, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['alerts', userId] });
      const msg = error?.message ?? '';
      if (!msg.toLowerCase().includes('not found')) {
        toast.error(msg || 'Failed to delete alert');
      }
    },
  });
}
