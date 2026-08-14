import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { CreateDomainRequest, Domain } from '@/types/api';
import { toast } from 'sonner';

export function useDomains(enabled = true) {
  return useQuery({
    queryKey: ['domains'],
    queryFn: () => api.domains.list(),
    enabled,
    staleTime: 0, // Always fetch fresh data - no caching
    gcTime: 0, // Don't keep in cache
    refetchOnWindowFocus: false, // Disabled - use manual refresh button instead
    refetchInterval: false, // Disabled - no background refresh
  });
}

export function useDomain(domainId: string) {
  return useQuery({
    queryKey: ['domain', domainId],
    queryFn: () => api.domains.get(domainId),
    enabled: !!domainId,
    staleTime: 0, // Always fetch fresh data - no caching
    gcTime: 0, // Don't keep in cache
    refetchOnWindowFocus: false, // Disabled - use manual refresh button instead
  });
}

export function useCreateDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateDomainRequest) => api.domains.create(data),
    onSuccess: async (createdDomain: Domain) => {
      // Optimistically reflect the new domain in any visible tables.
      queryClient.setQueryData<Domain[]>(['domains'], (previous = []) => {
        if (!createdDomain?.id) return previous;
        const alreadyExists = previous.some((domain) => domain.id === createdDomain.id);
        if (alreadyExists) return previous;
        return [createdDomain, ...previous];
      });

      queryClient.invalidateQueries({ queryKey: ['domains'] });
      await queryClient.refetchQueries({ queryKey: ['domains'], type: 'active' });
      toast.success('Domain created successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create domain');
    },
  });
}

export function useVerifyDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (domainId: string) => api.domains.verify(domainId),
    onSuccess: (_, domainId) => {
      queryClient.invalidateQueries({ queryKey: ['domain', domainId] });
      queryClient.invalidateQueries({ queryKey: ['domains'] });
    },
  });
}

export function useDeleteDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (domainId: string) => api.domains.delete(domainId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domains'] });
      toast.success('Domain deleted');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to delete domain');
    },
  });
}

export function useDNSRecords(domainId: string) {
  return useQuery({
    queryKey: ['dns-records', domainId],
    queryFn: () => api.domains.getDNSRecords(domainId),
    enabled: !!domainId,
    staleTime: 0, // Always fetch fresh data - no caching
    gcTime: 0, // Don't keep in cache
    refetchOnWindowFocus: false, // Disabled - DNS records refresh on manual verification
  });
}

// Hook to prefetch DNS records for multiple domains
export function usePrefetchDNSRecords() {
  const queryClient = useQueryClient();
  
  const prefetchDNSRecords = async (domainIds: string[]) => {
    const promises = domainIds.map(domainId =>
      queryClient.prefetchQuery({
        queryKey: ['dns-records', domainId],
        queryFn: () => api.domains.getDNSRecords(domainId),
        staleTime: 0, // Always fetch fresh data
      })
    );
    
    await Promise.allSettled(promises);
  };
  
  return { prefetchDNSRecords };
}
