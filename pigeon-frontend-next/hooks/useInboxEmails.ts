import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export function useInboxEmails(userId: string, filter?: string, enabled: boolean = true) {
  const queryClient = useQueryClient();
  const queryKey = ['inbox-emails', userId, filter];
  return useQuery({
    queryKey,
    queryFn: () =>
      api.inbox.getEmails(userId, filter, {
        queryKey,
        getCachedData: () => queryClient.getQueryData(queryKey),
      }),
    enabled: !!userId && enabled,
    staleTime: 30 * 1000,
  });
}

export function useMarkEmailAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ emailId, userId }: { emailId: string; userId: string }) =>
      api.inbox.markAsRead(emailId, userId),
    onMutate: async ({ emailId, userId }) => {
      await queryClient.cancelQueries({ queryKey: ['inbox-emails', userId] });
      queryClient.setQueriesData(
        { queryKey: ['inbox-emails', userId], exact: false },
        (old: Array<{ id: string; isRead?: boolean }> | undefined) =>
          old?.map((e) => (e.id === emailId ? { ...e, isRead: true } : e)) ?? old
      );
    },
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['inbox-emails', userId] });
      queryClient.refetchQueries({ queryKey: ['inbox-emails', userId] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to mark email as read');
    },
  });
}

export function useArchiveEmail() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ emailId, userId }: { emailId: string; userId: string }) =>
      api.inbox.archive(emailId, userId),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['inbox-emails', userId] });
      toast.success('Email archived');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to archive email');
    },
  });
}

export function useDeleteEmail() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ emailId, userId }: { emailId: string; userId: string }) =>
      api.inbox.delete(emailId, userId),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['inbox-emails', userId] });
      toast.success('Email deleted');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to delete email');
    },
  });
}

export function useTagEmail() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ emailId, userId, tag }: { emailId: string; userId: string; tag: string }) =>
      api.inbox.tag(emailId, userId, tag),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['inbox-emails', userId] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to tag email');
    },
  });
}

export function useToggleStarEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ emailId, userId }: { emailId: string; userId: string }) =>
      api.inbox.toggleStar(emailId, userId),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['inbox-emails', userId] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update star');
    },
  });
}

export function useMarkAllAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => api.inbox.markAllAsRead(userId),
    onMutate: async (userId) => {
      await queryClient.cancelQueries({ queryKey: ['inbox-emails', userId] });
      queryClient.setQueriesData(
        { queryKey: ['inbox-emails', userId], exact: false },
        (old: Array<{ isRead?: boolean }> | undefined) =>
          old?.map((e) => ({ ...e, isRead: true })) ?? old
      );
    },
    onSuccess: (data, userId) => {
      queryClient.invalidateQueries({ queryKey: ['inbox-emails', userId] });
      queryClient.refetchQueries({ queryKey: ['inbox-emails', userId] });
      const count = data?.modified_count;
      if (typeof count === 'number' && count >= 0) {
        toast.success(count === 0 ? 'All emails were already read' : `Marked ${count} email${count === 1 ? '' : 's'} as read`);
      } else {
        toast.success('All emails marked as read');
      }
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to mark all as read');
    },
  });
}

export function useArchiveAll() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (userId: string) => api.inbox.archiveAll(userId),
    onSuccess: (_, userId) => {
      queryClient.invalidateQueries({ queryKey: ['inbox-emails', userId] });
      toast.success('All emails archived');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to archive all emails');
    },
  });
}

export function useCheckReplies() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => api.emails.checkReplies(userId),
    onSuccess: (_, userId) => {
      queryClient.invalidateQueries({ queryKey: ['inbox-emails', userId] });
    },
    // Don't show error toast — reply sync is background; technical messages aren't user-friendly
  });
}

export function useSendReply() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      userId,
      emailLogId,
      subject,
      body,
      cc,
    }: {
      userId: string;
      emailLogId: string;
      subject: string;
      body: string;
      cc?: string;
    }) => api.emails.sendReply(userId, emailLogId, subject, body, cc),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['inbox-emails', userId] });
      toast.success('Reply sent');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to send reply');
    },
  });
}

export function useSendReceivedReply() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      messageId,
      userId,
      subject,
      body,
      cc,
    }: {
      messageId: string;
      userId: string;
      subject: string;
      body: string;
      cc?: string;
    }) => api.inbox.sendReceivedReply(messageId, userId, subject, body, cc),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['inbox-received-paged', userId] });
      queryClient.invalidateQueries({ queryKey: ['inbox-received-all', userId] });
      queryClient.invalidateQueries({ queryKey: ['inbox-received-thread', userId] });
      toast.success('Reply sent');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to send reply');
    },
  });
}
