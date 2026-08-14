import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { LLMConfig } from "@/types/api";
import { toast } from "sonner";

export function useLLMConfigs(userId: string, enabled = true) {
  return useQuery({
    queryKey: ["llm-configs", userId],
    queryFn: () => api.llm.getConfigs(userId),
    enabled: !!userId && enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCheckLLMConfig(userId: string) {
  return useQuery({
    queryKey: ["llm-config-check", userId],
    queryFn: () => api.llm.checkConfig(userId),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useSaveLLMConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: LLMConfig) => api.llm.saveConfig(config),
    onSuccess: (_, config) => {
      queryClient.invalidateQueries({ queryKey: ["llm-configs", config.user_id] });
      toast.success("LLM configuration saved");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to save LLM configuration");
    },
  });
}

export function useDeleteLLMConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, provider }: { userId: string; provider: string }) =>
      api.llm.deleteConfig(userId, provider),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ["llm-configs", userId] });
      toast.success("LLM configuration deleted");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete LLM configuration");
    },
  });
}

export function useGenerateTemplate() {
  return useMutation({
    mutationFn: ({ userId, provider, prompt }: { userId: string; provider: string; prompt: string }) =>
      api.llm.generateTemplate(userId, provider, prompt),
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to generate template");
    },
  });
}
