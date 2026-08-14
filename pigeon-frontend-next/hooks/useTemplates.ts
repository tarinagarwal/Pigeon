import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { EmailTemplate } from "@/types/api";
import { toast } from "sonner";

export function useTemplates(userId: string) {
  return useQuery({
    queryKey: ["templates", userId],
    queryFn: () => api.templates.list(userId),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: EmailTemplate) => api.templates.create(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["templates", variables.user_id],
      });
      toast.success("Template created successfully");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to create template");
    },
  });
}

export function useUpdateTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, data }: { templateId: string; data: EmailTemplate }) =>
      api.templates.update(templateId, data),
    onSuccess: (_, { templateId, data }) => {
      queryClient.invalidateQueries({ queryKey: ["templates", data.user_id] });
      queryClient.invalidateQueries({ queryKey: ["template", templateId] });
      toast.success("Template updated successfully");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to update template");
    },
  });
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) => api.templates.delete(templateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast.success("Template deleted");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete template");
    },
  });
}

export function useDeleteTemplates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateIds: string[]) => api.templates.deleteMultiple(templateIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast.success("Templates deleted");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete templates");
    },
  });
}
