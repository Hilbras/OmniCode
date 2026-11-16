import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessions, useCreateSession } from '../hooks/useSessions';
import type { AppSession } from '../api';

export function HomePage() {
  const navigate = useNavigate();
  const { data: sessions, isPending, isError, error } = useSessions();
  const createSession = useCreateSession();

  const handleCreate = useCallback(async () => {
    try {
      const s = await createSession.mutateAsync();
      navigate(`/sessions/${s.id}`);
    } catch {
      // silent
    }
  }, [createSession, navigate]);

  return (
    <div className="flex h-full" style={{ background: 'var(--color-background)' }}>
      <aside
        className="w-[280px] shrink-0 overflow-y-auto border-r"
        style={{
          background: 'var(--color-sidebar)',
          borderColor: 'var(--color-border)',
          borderRightWidth: 1,
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <span className="text-xs font-semibold tracking-wide" style={{ color: 'var(--color-foreground-subtle)' }}>
            SESSIONS
          </span>
          <button
            onClick={handleCreate}
            disabled={createSession.isPending}
            className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50"
            style={{
              background: 'var(--color-interaction-ask-surface)',
              color: 'var(--color-interaction-ask-foreground)',
              border: '1px solid var(--color-interaction-ask-foreground)',
              cursor: 'pointer',
              animation: 'fade-up 0.2s var(--wf-ease)',
            }}
          >
            {createSession.isPending ? '…' : '+ New'}
          </button>
        </div>

        <ul className="p-1.5">
          {isPending && (
            <li className="px-3 py-2 text-xs" style={{ color: 'var(--color-foreground-subtlest)' }}>
              Loading…
            </li>
          )}
          {isError && (
            <li className="px-3 py-2 text-xs" style={{ color: 'var(--color-destructive)' }}>
              {(error as Error)?.message ?? 'Failed to load sessions'}
            </li>
          )}
          {(sessions ?? []).map((s: AppSession) => (
            <SessionItem key={s.id} session={s} onClick={() => navigate(`/sessions/${s.id}`)} />
          ))}
          {(sessions ?? []).length === 0 && !isPending && !isError && (
            <li className="px-3 py-6 text-center text-xs" style={{ color: 'var(--color-foreground-subtlest)' }}>
              No sessions yet
            </li>
          )}
        </ul>
      </aside>

      <section className="flex flex-1 items-center justify-center">
        <div
          className="flex flex-col items-center gap-5"
          style={{ animation: 'wf-unfold 0.2s var(--wf-ease)' }}
        >
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{
              background: 'var(--highspeed-model-gradient)',
              boxShadow: '0 8px 24px -8px color-mix(in srgb, var(--highspeed-model-icon) 40%, transparent)',
              animation: 'breathe var(--wf-beat) infinite',
            }}
          >
            <span className="text-2xl font-bold text-white">O</span>
          </div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-foreground)' }}>
            Omnicode Web
          </h1>
          <p className="max-w-[260px] text-center text-sm leading-relaxed" style={{ color: 'var(--color-foreground-subtle)' }}>
            Connect to your agent daemon. Select a session or start a new one.
          </p>
          <button
            onClick={handleCreate}
            disabled={createSession.isPending}
            className="rounded-lg px-5 py-2.5 text-sm font-medium transition-all disabled:opacity-50"
            style={{
              background: 'var(--color-interaction-ask-surface)',
              color: 'var(--color-interaction-ask-foreground)',
              border: '1px solid var(--color-interaction-ask-foreground)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-surface-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-interaction-ask-surface)')}
          >
            {createSession.isPending ? 'Creating…' : 'Start new session'}
          </button>
        </div>
      </section>
    </div>
  );
}

function SessionItem({ session, onClick }: { session: AppSession; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const title = session.title || session.id.slice(0, 8);
  return (
    <li>
      <button
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className="block w-full rounded-lg px-3 py-2.5 text-left transition-colors"
        style={{
          background: hover ? 'var(--color-hover)' : 'transparent',
          cursor: 'pointer',
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{
              background: session.busy ? 'var(--color-trajectory-tool-call)' : 'var(--color-foreground-subtlest)',
            }}
            title={session.busy ? 'Active' : 'Idle'}
          />
          <span className="truncate text-sm font-medium" style={{ color: 'var(--color-foreground)' }}>
            {title}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 pl-3.5">
          <span className="text-xs" style={{ color: 'var(--color-foreground-subtlest)' }}>
            {new Date(session.updatedAt).toLocaleString()}
          </span>
          {session.lastTurnReason === 'failed' && (
            <span
              className="rounded px-1 text-[10px] font-medium"
              style={{
                background: 'var(--color-destructive-surface)',
                color: 'var(--color-destructive-surface-foreground)',
              }}
            >
              failed
            </span>
          )}
          {session.archived && (
            <span
              className="rounded px-1 text-[10px] font-medium"
              style={{
                background: 'var(--color-surface-hover)',
                color: 'var(--color-foreground-subtle)',
              }}
            >
              archived
            </span>
          )}
        </div>
      </button>
    </li>
  );
}
