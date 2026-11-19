/**
 * Unified exec process table (WS4.5).
 *
 * A supervised registry for long-running shell processes. Yield times are
 * clamped so a model cannot ask for a zero or unbounded wait; the live table
 * can be rendered as a context section; and an approval denied after a process
 * started kills that process instead of leaving it running unsupervised.
 */
export interface ExecProcess {
  readonly id: string;
  readonly command: string;
  readonly startedAt: number;
  readonly yieldMs: number;
  readonly networkApproval?: 'pending' | 'granted' | 'denied';
}

export const DEFAULT_MIN_YIELD_MS = 50;
export const DEFAULT_MAX_YIELD_MS = 30_000;

export function clampYieldMs(
  requested: number | undefined,
  min = DEFAULT_MIN_YIELD_MS,
  max = DEFAULT_MAX_YIELD_MS,
): number {
  if (requested === undefined || !Number.isFinite(requested)) return min;
  return Math.min(Math.max(Math.trunc(requested), min), max);
}

export class ExecProcessTable {
  private readonly processes = new Map<string, ExecProcess>();

  register(
    id: string,
    command: string,
    startedAt: number,
    requestedYieldMs: number | undefined,
    networkApproval?: ExecProcess['networkApproval'],
  ): ExecProcess {
    if (id.length === 0 || this.processes.has(id)) {
      throw new Error(`Process id already registered or empty: ${id}`);
    }
    const entry: ExecProcess = {
      id, command, startedAt,
      yieldMs: clampYieldMs(requestedYieldMs),
      ...(networkApproval === undefined ? {} : { networkApproval }),
    };
    this.processes.set(id, entry);
    return entry;
  }

  get(id: string): ExecProcess | undefined {
    return this.processes.get(id);
  }

  markExited(id: string): boolean {
    return this.processes.delete(id);
  }

  list(): readonly ExecProcess[] {
    return [...this.processes.values()].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  }

  /** Ids whose network approval was denied after they started. */
  lateDenied(): readonly string[] {
    return this.list()
      .filter((process) => process.networkApproval === 'denied')
      .map((process) => process.id);
  }

  renderSection(): string | undefined {
    const entries = this.list();
    if (entries.length === 0) return undefined;
    return [
      '## Live Processes',
      ...entries.map((entry) =>
        `- ${entry.id}: ${entry.command} (yield ${String(entry.yieldMs)}ms` +
        `${entry.networkApproval === undefined ? '' : `, network ${entry.networkApproval}`})`,
      ),
    ].join('\n');
  }
}
