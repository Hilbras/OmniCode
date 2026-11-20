import { useNavigate, useParams } from 'react-router-dom';
import { SquarePen } from 'lucide-react';
import { useCreateSession, useSessions } from '../hooks/useSessions';
import type { AppSession } from '../api';

function sessionTitle(session: AppSession): string {
  return session.title || session.id.slice(0, 8);
}

/**
 * Left rail: new-chat action and the session list. Rendered inside the Shell
 * sidebar slot (persistent on ≥lg, slide-over below).
 */
export function SessionsRail() {
  const navigate = useNavigate();
  const { id: activeId } = useParams<{ id: string }>();
  const { data: sessions, isPending, isError, error } = useSessions();
  const createSession = useCreateSession();

  const openNew = async () => {
    try {
      const created = await createSession.mutateAsync();
      navigate(`/sessions/${created.id}`);
    } catch {
      // The rail keeps showing the list; the error is surfaced by the row state.
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 px-3 pt-3">
        <span className="mono-label">Sessions</span>
        <button
          type="button"
          className="btn-gold w-full"
          onClick={openNew}
          disabled={createSession.isPending}
        >
          <SquarePen size={15} />
          {createSession.isPending ? 'Creating…' : 'New chat'}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {isPending && <p className="px-3 py-2 text-xs muted">Loading…</p>}
        {isError && (
          <p className="px-3 py-2 text-xs" style={{ color: 'var(--danger)' }}>
            {(error as Error)?.message ?? 'Failed to load sessions'}
          </p>
        )}
        {(sessions ?? []).map((session) => (
          <SessionRow key={session.id} session={session} active={session.id === activeId} />
        ))}
        {(sessions ?? []).length === 0 && !isPending && !isError && (
          <p className="px-3 py-6 text-center text-xs muted">No sessions yet</p>
        )}
      </div>
    </div>
  );
}

function SessionRow({ session, active }: { session: AppSession; active: boolean }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(`/sessions/${session.id}`)}
      className="node mb-1 block w-full px-3 py-2.5 text-left"
      style={
        active
          ? { borderColor: 'var(--gold)', background: 'var(--gold-soft)' }
          : undefined
      }
    >
      <span className="flex items-center gap-2">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${session.busy ? 'soft-pulse' : ''}`}
          style={{ background: session.busy ? 'var(--gold)' : 'var(--line-strong)' }}
          title={session.busy ? 'Active' : 'Idle'}
        />
        <span className="truncate text-sm font-medium">{sessionTitle(session)}</span>
      </span>
      <span className="mt-0.5 flex items-center gap-2 pl-3.5">
        <span className="mono-label normal-case tracking-normal">
          {new Date(session.updatedAt).toLocaleString()}
        </span>
        {session.lastTurnReason === 'failed' && (
          <span
            className="rounded px-1 text-[10px] font-medium"
            style={{ background: 'var(--danger)', color: 'var(--bg)' }}
          >
            failed
          </span>
        )}
        {session.archived && <span className="mono-label">archived</span>}
      </span>
    </button>
  );
}
