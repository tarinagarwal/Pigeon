import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ContactUploadError } from '@/lib/api';
import type { Contact, ContactList } from '@/types/api';
import { toast } from 'sonner';

export function useContacts(userId: string, skip?: number, limit?: number) {
  return useQuery({
    queryKey: ['contacts', userId, skip, limit],
    queryFn: () => api.contacts.list(userId, skip, limit),
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
}

export function useContactLists(userId: string) {
  return useQuery({
    queryKey: ['contact-lists', userId],
    queryFn: () => api.contactLists.list(userId),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useAudiencePreview(userId: string, listId: string | undefined) {
  return useQuery({
    queryKey: ['audience-preview', userId, listId],
    queryFn: () => api.contactLists.getAudiencePreview(listId!, userId),
    enabled: !!userId && !!listId,
  });
}

export function useContactListContacts(listId: string | undefined) {
  return useQuery({
    queryKey: ['contact-lists-contacts', listId],
    queryFn: () => api.contactLists.getContacts(listId!, 0, 500),
    enabled: !!listId,
  });
}

export function useUploadContacts() {
  return useMutation({
    mutationFn: ({ userId, file }: { userId: string; file: File }) =>
      api.contacts.upload(userId, file),
    onError: (error: unknown) => {
      if (error instanceof ContactUploadError) {
        toast.error(error.message, { description: error.fix, duration: 8000 });
      } else {
        toast.error(error instanceof Error ? error.message : 'Failed to upload contacts');
      }
    },
  });
}

export function useSaveContacts() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ 
      userId, 
      contactsData, 
      fieldMapping, 
      listName,
      listId 
    }: { 
      userId: string; 
      contactsData: any[]; 
      fieldMapping: Record<string, string>; 
      listName?: string;
      listId?: string;
    }) => api.contacts.save(userId, contactsData, fieldMapping, listName, listId),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['contacts', userId] });
      queryClient.invalidateQueries({ queryKey: ['contact-lists', userId] });
      toast.success('Contacts saved successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to save contacts');
    },
  });
}

export function useDeleteContact() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ contactId, userId }: { contactId: string; userId: string }) =>
      api.contacts.delete(contactId, userId),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['contacts', userId] });
      queryClient.invalidateQueries({ queryKey: ['contact-lists', userId] });
      toast.success('Contact deleted');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to delete contact');
    },
  });
}

export function useDeleteContacts() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ userId, contactIds }: { userId: string; contactIds: string[] }) =>
      api.contacts.deleteMultiple(userId, contactIds),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['contacts', userId] });
      queryClient.invalidateQueries({ queryKey: ['contact-lists', userId] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to delete contacts');
    },
  });
}

export function useUnblockContacts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, contactIds }: { userId: string; contactIds?: string[] }) =>
      api.contacts.unblock(userId, contactIds),
    onSuccess: (data, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['contacts', userId] });
      queryClient.invalidateQueries({ queryKey: ['contact-lists', userId] });
      toast.success(data.message);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to unblock contacts');
    },
  });
}

export function useContactHistory(contactId: string | null) {
  return useQuery({
    queryKey: ['contact-history', contactId],
    queryFn: () => api.contacts.getHistory(contactId!),
    enabled: !!contactId,
  });
}

export function useBlockContacts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, contactIds }: { userId: string; contactIds: string[] }) =>
      api.contacts.block(userId, contactIds),
    onSuccess: (data, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['contacts', userId] });
      queryClient.invalidateQueries({ queryKey: ['contact-lists', userId] });
      toast.success(data.message);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to block contacts');
    },
  });
}

export type RemoveRiskyEmailsStatus = {
  job_id: string;
  status: string;
  total_to_check: number;
  checked_so_far: number;
  risky_count: number;
  deleted: number;
  stats: { invalid_syntax: number; mx_fail: number; stop_forum_spam_block: number; catch_all?: number };
  include_catch_all?: boolean;
  error?: string;
  updated_at?: string;
};

/** Fetch latest risky-emails job for the user (used on page load to restore running job after refresh). */
export function useRemoveRiskyEmailsLatestJob(userId: string) {
  return useQuery({
    queryKey: ['remove-risky-emails-latest', userId],
    queryFn: () => api.contacts.getRemoveRiskyEmailsStatus(undefined),
    enabled: !!userId,
    staleTime: 0,
  });
}

export function useRemoveRiskyEmailsStatus(jobId: string | null) {
  return useQuery({
    queryKey: ['remove-risky-emails-status', jobId],
    queryFn: () => api.contacts.getRemoveRiskyEmailsStatus(jobId ?? undefined),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const data = query.state.data as RemoveRiskyEmailsStatus | { status: string } | undefined;
      if (data && typeof data === 'object' && 'status' in data && data.status === 'running') {
        return 1500;
      }
      return false;
    },
  });
}

export function useRemoveRiskyContacts() {
  return useMutation({
    mutationFn: ({
      userId,
      listId,
      includeCatchAll,
    }: {
      userId: string;
      listId?: string;
      includeCatchAll?: boolean;
    }) => api.contacts.removeRiskyEmails(userId, listId, includeCatchAll),
    onError: (error: any) => {
      toast.error(error.message || 'Failed to start remove risky emails');
    },
  });
}

export function useStopRiskyEmailsJob() {
  return useMutation({
    mutationFn: (jobId: string) => api.contacts.stopRemoveRiskyEmails(jobId),
    onError: (error: any) => {
      toast.error(error.message || 'Failed to stop job');
    },
  });
}

export function useRemoveRiskyEmailsHistory(userId: string, skip: number = 0, limit: number = 50) {
  return useQuery({
    queryKey: ['remove-risky-emails-history', userId, skip, limit],
    queryFn: () => api.contacts.getRemoveRiskyEmailsHistory(skip, limit),
    enabled: !!userId,
  });
}
