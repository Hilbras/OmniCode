import { useEffect, useReducer, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useApi } from '../api/provider';
import { idleLiveTurn, reduceLiveTurn, type LiveTurnState } from '../api/sessionEvents';

/**
 * One daemon event connection per mounted session view. Projects the live
 * turn (streaming assistant text, thinking indicator) and refetches the
 * transcript whenever the event stream touches persisted data.
 */
export function useSessionEvents(sessionId: string | undefined): LiveTurnState {
  const api = useApi();
  const queryClient = useQueryClient();
  const [live, dispatchEvent] = useReducer(
    (prev: LiveTurnState, event: Parameters<Parameters<typeof api.connectEvents>[0]['onEvent']>[0]) =>
      reduceLiveTurn(prev, event, sessionId ?? ''),
    idleLiveTurn,
  );
  const connectionRef = useRef<ReturnType<typeof api.connectEvents> | undefined>(undefined);

  useEffect(() => {
    if (sessionId === undefined) return;
    const connection = api.connectEvents({
      onEvent: (event) => dispatchEvent(event),
      onResync: () => undefined,
      onConnectionChange: () => undefined,
      onError: () => undefined,
    });
    connection.subscribe(sessionId);
    connectionRef.current = connection;
    return () => {
      connection.unsubscribe(sessionId);
      connection.close();
      connectionRef.current = undefined;
    };
  }, [api, sessionId]);

  useEffect(() => {
    if (sessionId === undefined) return;
    if (live.refetch) {
      void queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    }
  }, [live.refetch, queryClient, sessionId]);

  return live;
}
