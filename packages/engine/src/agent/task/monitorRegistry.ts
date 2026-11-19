/**
 * Background monitor registry (WS4.6).
 *
 * A monitor watches a command or file and appends matched lines. Lines are
 * capped per watcher and only surfaced as a durable `<task-notification>`
 * envelope when the loop is idle, so a noisy watch cannot interrupt a turn.
 */
export interface MonitorWatch {
  readonly id: string;
  readonly source: string;
  readonly intervalMs: number;
  readonly maxLines: number;
}

export interface MonitorLine {
  readonly text: string;
  readonly at: number;
}

export interface MonitorNotification {
  readonly watchId: string;
  readonly text: string;
  readonly droppedLines: number;
}

export const DEFAULT_MONITOR_INTERVAL_MS = 2_000;
export const DEFAULT_MONITOR_MAX_LINES = 200;
const MAX_LINE_CHARS = 2_000;

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  const raw = value ?? fallback;
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.trunc(raw), min), max);
}

export function formatTaskNotification(notification: MonitorNotification): string {
  const dropped =
    notification.droppedLines === 0
      ? ''
      : `\n[${String(notification.droppedLines)} line(s) dropped by the monitor cap]`;
  return (
    `<task-notification watch="${notification.watchId}">\n` +
    `${notification.text}${dropped}\n` +
    '</task-notification>'
  );
}

export class MonitorRegistry {
  private readonly watches = new Map<string, { config: MonitorWatch; lines: MonitorLine[]; dropped: number }>();
  private readonly pending: MonitorNotification[] = [];

  register(input: {
    id: string;
    source: string;
    intervalMs?: number;
    maxLines?: number;
  }): MonitorWatch {
    if (input.id.length === 0 || this.watches.has(input.id)) {
      throw new Error(`Monitor already registered or empty: ${input.id}`);
    }
    const config: MonitorWatch = {
      id: input.id,
      source: input.source,
      intervalMs: clamp(input.intervalMs, DEFAULT_MONITOR_INTERVAL_MS, 250, 60_000),
      maxLines: clamp(input.maxLines, DEFAULT_MONITOR_MAX_LINES, 1, 2_000),
    };
    this.watches.set(config.id, { config, lines: [], dropped: 0 });
    return config;
  }

  stop(id: string): boolean {
    return this.watches.delete(id);
  }

  get(id: string): MonitorWatch | undefined {
    return this.watches.get(id)?.config;
  }

  record(id: string, text: string, at: number = Date.now()): void {
    const entry = this.watches.get(id);
    if (entry === undefined) return;
    const line = text.slice(0, MAX_LINE_CHARS);
    if (entry.lines.length >= entry.config.maxLines) {
      entry.lines.shift();
      entry.dropped += 1;
    }
    entry.lines.push({ text: line, at });
  }

  /** Called only when the loop is idle; returns durable envelopes and clears them. */
  drainIdleNotifications(): readonly string[] {
    if (this.pending.length === 0) {
      for (const [id, entry] of this.watches) {
        if (entry.lines.length === 0) continue;
        this.pending.push({
          watchId: id,
          text: entry.lines.map((line) => line.text).join('\n'),
          droppedLines: entry.dropped,
        });
        entry.lines = [];
        entry.dropped = 0;
      }
    }
    const out = this.pending.map(formatTaskNotification);
    this.pending.length = 0;
    return out;
  }
}
