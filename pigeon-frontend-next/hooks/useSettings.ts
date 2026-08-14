import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => api.settings.get(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      notifications?: Record<string, boolean>;
      compliance?: {
        spam_words?: string;
        max_links_per_email?: number;
        max_images_per_email?: number;
        require_unsubscribe_link?: boolean;
      };
      email_infra?: { enabled?: boolean };
      default_reply_to_type?: string | null;
      default_reply_to_id?: string | null;
    }) => api.settings.update(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Settings saved");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    },
  });
}

export function useGmailOAuthStatus(enabled = true) {
  return useQuery({
    queryKey: ["settings", "gmail-oauth-status"],
    queryFn: () => api.settings.getGmailOAuthStatus(),
    enabled,
  });
}

export function useGoogleOAuthConfig(enabled = true) {
  return useQuery({
    queryKey: ["settings", "google-oauth"],
    queryFn: () => api.settings.getGoogleOAuthConfig(),
    enabled,
  });
}

export function useUpdateGoogleOAuthConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      google_client_id?: string;
      google_client_secret?: string;
      use_app_google_oauth?: boolean;
    }) => api.settings.updateGoogleOAuthConfig(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "google-oauth"] });
      queryClient.invalidateQueries({ queryKey: ["settings", "gmail-oauth-status"] });
      toast.success("Google OAuth credentials saved");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to save Google OAuth credentials");
    },
  });
}

export function useSerperSettings(enabled = true) {
  return useQuery({
    queryKey: ["settings", "serper"],
    queryFn: () => api.settings.getSerper(),
    enabled,
  });
}

export function useUpdateSerperSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { serper_api_key?: string | null }) => api.settings.updateSerper(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "serper"] });
      toast.success("Serper settings saved");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to save Serper settings");
    },
  });
}

export function useZeroBounceSettings(enabled = true) {
  return useQuery({
    queryKey: ["settings", "zerobounce"],
    queryFn: () => api.settings.getZeroBounce(),
    enabled,
  });
}

export function useUpdateZeroBounceSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { zerobounce_api_key?: string | null }) => api.settings.updateZeroBounce(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "zerobounce"] });
      toast.success("ZeroBounce settings saved");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to save ZeroBounce settings");
    },
  });
}
