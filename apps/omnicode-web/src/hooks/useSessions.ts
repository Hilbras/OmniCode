import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../api/provider';
import type { AppMessage, AppMessageContent, AppSession } from '../api';
import { fetchAllSessions, fetchMessages } from '../api/pagination';

export function useSessions() {
  const api = useApi();
  return useQuery({
    queryKey: ['sessions'],
    queryFn: (): Promise<readonly AppSession[]> => fetchAllSessions(api),
  });
}

export function useMessages(sessionId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ['messages', sessionId],
    queryFn: (): Promise<readonly AppMessage[]> => fetchMessages(api, sessionId),
    enabled: !!sessionId,
  });
}

export function useCreateSession() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.createSession({}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });
}

export function useSubmitPrompt(sessionId: string | undefined) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => {
      if (!sessionId) throw new Error('No session');
      const content: AppMessageContent[] = [{ type: 'text', text: message }];
      return api.submitPrompt(sessionId, { content });
    },
    onSuccess: () => {
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
      }
    },
  });
}

export function useAbortSession(sessionId: string | undefined) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!sessionId) throw new Error('No session');
      return api.abortSession(sessionId);
    },
    onSuccess: () => {
      if (sessionId) queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
    },
  });
}

export function useSessionStatus(sessionId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ['session-status', sessionId],
    queryFn: async () => {
      if (!sessionId) return null;
      return api.getSessionStatus(sessionId);
    },
    enabled: !!sessionId,
    refetchInterval: 2_000,
  });
}
