import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { usePlanGate } from "@/hooks/usePlanGate";
import type { Campaign } from '@/types/api';
import { toast } from 'sonner';

export function useCampaigns(userId: string, params?: { archived?: boolean }) {
  return useQuery<Campaign[]>({
    queryKey: ['campaigns', userId, params],
    queryFn: () => api.campaigns.list(userId, params),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function usePaginatedCampaigns(
  userId: string,
  params: { archived?: boolean; skip: number; limit: number }
) {
  return useQuery<Campaign[]>({
    queryKey: ['campaigns', userId, params],
    queryFn: () => api.campaigns.list(userId, params),
    enabled: !!userId,
  });
}

export function useCampaign(campaignId: string) {
  return useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => api.campaigns.get(campaignId),
    enabled: !!campaignId,
  });
}

export type StartCampaignVariables = string | { campaignId: string; scheduled_at?: string };

export function useStartCampaign() {
  const queryClient = useQueryClient();
  const campaignGate = usePlanGate("campaigns");

  return useMutation({
    mutationFn: (variables: StartCampaignVariables) => {
      const campaignId = typeof variables === "string" ? variables : variables.campaignId;
      const options = typeof variables === "string" ? undefined : { scheduled_at: variables.scheduled_at };
      return api.campaigns.start(campaignId, options);
    },
    onMutate: async () => {
      if (campaignGate.atLimit) {
        throw new Error(
          campaignGate.reason ||
            "You have reached your plan limit for active campaigns. Pause or complete another campaign, or upgrade your plan."
        );
      }
    },
    onSuccess: async (_, variables) => {
      const campaignId = typeof variables === "string" ? variables : variables.campaignId;
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
      await queryClient.refetchQueries({ queryKey: ['campaigns'] });
      await queryClient.refetchQueries({ queryKey: ['campaign', campaignId] });
      toast.success('Campaign started');
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Failed to start campaign';
      toast.error(message, { duration: 8000 });
    },
  });
}

export function usePauseCampaign() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (campaignId: string) => api.campaigns.pause(campaignId),
    onSuccess: async (_, campaignId) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
      await queryClient.refetchQueries({ queryKey: ['campaigns'] });
      await queryClient.refetchQueries({ queryKey: ['campaign', campaignId] });
      toast.success('Campaign paused');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to pause campaign');
    },
  });
}

export function useSendCampaignBatch() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (campaignId: string) => api.campaigns.sendBatch(campaignId),
    onSuccess: (data, campaignId) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      toast.success(`Sent ${data.sent} emails`);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to send batch');
    },
  });
}

export function useCampaignStats(campaignId: string) {
  return useQuery({
    queryKey: ['campaign-stats', campaignId],
    queryFn: () => api.campaigns.getStats(campaignId),
    enabled: !!campaignId,
  });
}

export type CampaignComplianceStatus = Record<string, { ok: boolean; errors: string[] }>;

export function useCampaignComplianceStatus(campaignIds: string[]) {
  const ids = campaignIds.filter(Boolean);
  return useQuery({
    queryKey: ['campaign-compliance', ids.sort().join(",")],
    queryFn: () => api.campaigns.complianceStatus(ids),
    enabled: ids.length > 0,
  });
}

export function useCampaignStatsByTemplate(campaignId: string) {
  return useQuery({
    queryKey: ['campaign-stats-by-template', campaignId],
    queryFn: () => api.campaigns.getStatsByTemplate(campaignId),
    enabled: !!campaignId,
  });
}

export function useCampaignContacts(campaignId: string) {
  return useQuery({
    queryKey: ['campaign-contacts', campaignId],
    queryFn: () => api.campaigns.getContacts(campaignId),
    enabled: !!campaignId,
    refetchInterval: 5000,
  });
}

export function useCampaignLeads(
  campaignId: string,
  params?: { skip?: number; limit?: number; search?: string }
) {
  return useQuery({
    queryKey: ['campaign-leads', campaignId, params],
    queryFn: () => api.campaigns.getLeads(campaignId, params),
    enabled: !!campaignId,
  });
}

export function useUpdateCampaignLeadTracker(campaignId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      leadId: string;
      data: {
        tracker_status?: "new" | "contacted" | "in_progress" | "follow_up" | "qualified" | "disqualified";
        tracker_note?: string;
      };
    }) => api.campaigns.updateLeadTracker(campaignId, payload.leadId, payload.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign-leads", campaignId] });
    },
  });
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: Campaign) => api.campaigns.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign created successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create campaign');
    },
  });
}

export function useUpdateCampaign() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ campaignId, data }: { campaignId: string; data: Campaign }) =>
      api.campaigns.update(campaignId, data),
    onSuccess: (_, { campaignId }) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
      toast.success('Campaign updated successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update campaign');
    },
  });
}
