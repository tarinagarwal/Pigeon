import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AnalyticsData } from "@/types/api";

export function useAnalytics(userId: string, campaignId?: string, days?: number) {
  return useQuery({
    queryKey: ["analytics", userId, campaignId, days],
    queryFn: () => api.analytics.get(userId, campaignId, days),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useAnalyticsTimeline(userId: string, days: number = 7, campaignId?: string) {
  return useQuery({
    queryKey: ["analytics-timeline", userId, days, campaignId],
    queryFn: () => api.analytics.getTimeline(userId, days, campaignId),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export interface ActivityItem {
  id: string;
  type: string;
  title: string;
  description: string;
  timestamp: string;
  icon: string;
}

export function useUserActivity(userId: string, limit: number = 10) {
  return useQuery({
    queryKey: ["activity", userId, limit],
    queryFn: async () => {
      const response = await api.activity.getActivity(userId, limit);
      return (response as { activities: ActivityItem[] }).activities;
    },
    enabled: !!userId,
  });
}

export function useSendingHourly(userId: string, days: number = 7) {
  return useQuery({
    queryKey: ["sending-hourly", userId, days],
    queryFn: () => api.analytics.getSendingHourly(userId, days),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useSendingByInbox(userId: string, days: number = 7) {
  return useQuery({
    queryKey: ["sending-by-inbox", userId, days],
    queryFn: () => api.analytics.getSendingByInbox(userId, days),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useSendingByCampaign(userId: string, days: number = 7) {
  return useQuery({
    queryKey: ["sending-by-campaign", userId, days],
    queryFn: () => api.analytics.getSendingByCampaign(userId, days),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useSendingInsights(userId: string, days: number = 7) {
  return useQuery({
    queryKey: ["sending-insights", userId, days],
    queryFn: () => api.analytics.getSendingInsights(userId, days),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}
