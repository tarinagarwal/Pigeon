import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export function useGmailStatus(userId: string, enabled = true) {
  return useQuery({
    queryKey: ['gmail-status', userId],
    queryFn: () => api.gmail.getStatus(userId),
    enabled: !!userId && enabled,
  });
}

const GMAIL_CREDENTIALS_MESSAGE =
  'Google OAuth credentials not set. Add your Google Client ID and Secret in Settings → Integrations to connect Gmail.';

export function useGmailAuth() {
  return useMutation({
    mutationFn: ({ userId, credentialId }: { userId: string; credentialId?: string }) =>
      api.gmail.getAuthUrl(userId, credentialId),
    onError: (error: any) => {
      const msg = error?.message ?? '';
      const display =
        !msg || msg === 'Failed to fetch' || msg.includes('Google OAuth credentials not set')
          ? GMAIL_CREDENTIALS_MESSAGE
          : msg;
      toast.error(display);
    },
  });
}

export function useDisconnectGmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      credentialId,
      inboxId,
    }: {
      userId: string;
      credentialId?: string;
      inboxId?: string;
    }) => {
      if (inboxId) return api.gmail.disconnectByInboxId(userId, inboxId);
      if (credentialId) return api.gmail.disconnect(userId, credentialId);
      return Promise.reject(new Error('Provide credentialId or inboxId'));
    },
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['gmail-status', userId] });
      queryClient.invalidateQueries({ queryKey: ['inboxes', userId] });
      toast.success('Gmail disconnected');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to disconnect Gmail');
    },
  });
}

export function useAddGmailAppPassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      email,
      password,
    }: {
      userId: string;
      email: string;
      password: string;
    }) => api.inboxes.addGmailAppPassword({ email, password }),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['gmail-status', userId] });
      queryClient.invalidateQueries({ queryKey: ['inboxes', userId] });
      toast.success('Gmail account added');
    },
    onError: (error: any) => {
      const msg = error?.message ?? '';
      const detail = typeof msg === 'string' ? msg : msg.detail || msg;
      toast.error(detail || 'Could not add account. Check email and password.');
    },
  });
}
