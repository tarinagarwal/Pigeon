import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { SmartLeadsRunCreateRequest } from '@/types/api';
import { toast } from 'sonner';

export function useSmartLeadsRuns(skip = 0, limit = 50) {
  return useQuery({
    queryKey: ['smart-leads', 'runs', skip, limit],
    queryFn: () => api.smartLeads.listRuns(skip, limit),
    // Keep History fresh while a run is in progress so “what’s happening” stays up to date.
    refetchInterval: (q) => {
      const runs = q.state.data?.runs ?? [];
      const hasActive = runs.some((r) => r.status === 'running' || r.status === 'queued');
      return hasActive ? 2500 : false;
    },
  });
}

export function useSmartLeadsRunDetail(runId: string | null, enabled = true, pollWhileRunning = true) {
  return useQuery({
    queryKey: ['smart-leads', 'run', runId],
    queryFn: () => api.smartLeads.getRunDetail(runId!),
    enabled: !!runId && enabled,
    refetchInterval: (q) => {
      if (!pollWhileRunning || !runId) return false;
      const s = q.state.data?.run?.status;
      if (s === 'running' || s === 'queued') return 2500;
      return false;
    },
  });
}

export function useSmartLeadsRunStatus(runId: string | null, pollWhileRunning = true) {
  return useQuery({
    queryKey: ['smart-leads', 'status', runId],
    queryFn: () => api.smartLeads.getRunStatus(runId!),
    enabled: !!runId,
    refetchInterval: (q) => {
      if (!pollWhileRunning || !runId) return false;
      const s = q.state.data?.status;
      if (s === undefined || s === 'running' || s === 'queued') return 2000;
      return false;
    },
  });
}

export function useCreateSmartLeadsRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SmartLeadsRunCreateRequest) => api.smartLeads.createRun(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smart-leads', 'runs'] });
      toast.success('Search started — we’ll find companies and people in the background.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not start search');
    },
  });
}

export function useContinueSmartLeadsRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => api.smartLeads.continueRun(runId),
    onSuccess: (_data, runId) => {
      queryClient.invalidateQueries({ queryKey: ['smart-leads', 'runs'] });
      queryClient.invalidateQueries({ queryKey: ['smart-leads', 'run', runId] });
      queryClient.invalidateQueries({ queryKey: ['smart-leads', 'status', runId] });
      toast.success('Resuming from saved progress…');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not continue run');
    },
  });
}

export function useStopSmartLeadsRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => api.smartLeads.stopRun(runId),
    onSuccess: (_data, runId) => {
      queryClient.invalidateQueries({ queryKey: ['smart-leads', 'runs'] });
      queryClient.invalidateQueries({ queryKey: ['smart-leads', 'run', runId] });
      queryClient.invalidateQueries({ queryKey: ['smart-leads', 'status', runId] });
      toast.success('Stop requested. Finishing current step and cancelling…');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not stop run');
    },
  });
}
