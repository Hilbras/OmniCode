import { useNavigate } from 'react-router-dom';
import { SquarePen } from 'lucide-react';
import { useCreateSession } from '../hooks/useSessions';

/** Empty state / landing inside the main pane. */
export function HomePage() {
  const navigate = useNavigate();
  const createSession = useCreateSession();

  const startNew = async () => {
    try {
      const created = await createSession.mutateAsync();
      navigate(`/sessions/${created.id}`);
    } catch {
      // The create failure is visible via the button state; no dialog here.
    }
  };

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="flex max-w-sm flex-col items-center gap-5 text-center">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-2xl"
          style={{
            background: 'linear-gradient(135deg, var(--gold) 0%, var(--gold-bright) 55%, var(--gold) 100%)',
            boxShadow: '0 8px 24px var(--glow)',
          }}
        >
          <span className="text-2xl font-bold" style={{ color: 'var(--gold-ink)' }}>
            O
          </span>
        </div>
        <h1 className="section-title">
          Agent sessions, <span className="gold-text">anywhere</span>
        </h1>
        <p className="text-sm leading-relaxed muted">
          Pick a session from the rail, or start a new one. The transcript streams
          live from your local daemon.
        </p>
        <button
          type="button"
          className="btn-gold"
          onClick={startNew}
          disabled={createSession.isPending}
        >
          <SquarePen size={15} />
          {createSession.isPending ? 'Creating…' : 'Start new session'}
        </button>
      </div>
    </div>
  );
}
