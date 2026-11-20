import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useApi } from '../api/provider';

const MODES = ['manual', 'auto', 'yolo'] as const;
type Mode = (typeof MODES)[number];

function isMode(value: string | null | undefined): value is Mode {
  return value !== null && value !== undefined && (MODES as readonly string[]).includes(value);
}

/**
 * Permission-mode pills (manual/auto/yolo). Writes through the daemon's
 * session patch; the live event stream and the next status poll reconcile the
 * active state.
 */
export function ModeSelector({
  sessionId,
  mode,
}: {
  sessionId: string;
  mode: string | null | undefined;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const active: Mode = isMode(mode) ? mode : 'manual';

  const setMode = useMutation({
    mutationFn: (next: Mode) => api.updateSession(sessionId, { permissionMode: next }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['session-status', sessionId] });
    },
  });

  return (
    <div className="flex items-center gap-1">
      {MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          disabled={setMode.isPending || mode === active}
          className="btn-quiet"
          style={
            mode === active
              ? { background: 'var(--gold-soft)', color: 'var(--gold-text)' }
              : undefined
          }
          onClick={() => setMode.mutate(mode)}
        >
          {mode}
        </button>
      ))}
    </div>
  );
}
