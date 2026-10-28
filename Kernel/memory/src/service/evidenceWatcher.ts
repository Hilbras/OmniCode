import { watch } from 'node:fs';

import type { IDisposable } from '@hilbras/omnicode-core/_base/di/lifecycle';
import type { ILogger } from '@hilbras/omnicode-core/_base/log/log';

import type { MemoryEvidenceRefreshReport } from '#/contracts/memoryContract';

export interface EvidenceWatchPort {
  watch(directory: string, onChange: () => void): IDisposable;
}

export interface EvidenceWatcherTimers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const EVIDENCE_WATCH_DEBOUNCE_MS = 300;
export const EVIDENCE_WATCH_SYNC_MS = 60_000;
export const MAX_WATCHED_DIRECTORIES = 64;

const systemTimers: EvidenceWatcherTimers = {
  setTimeout: (handler, ms) => {
    const handle = setTimeout(handler, ms);
    handle.unref?.();
    return handle;
  },
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export interface EvidenceWatcherOptions {
  readonly listDirectories: () => Promise<readonly string[]>;
  readonly refresh: () => Promise<MemoryEvidenceRefreshReport>;
  readonly watch: EvidenceWatchPort;
  readonly log: ILogger;
  readonly enabled?: () => boolean;
  readonly debounceMs?: number;
  readonly syncMs?: number;
  readonly maxDirectories?: number;
  readonly timers?: EvidenceWatcherTimers;
}

/**
 * Watches the directories that hold files cited as evidence and refreshes
 * evidence when one of them changes, so a memory whose source moved is demoted
 * within a debounce window instead of waiting for the periodic sweep.
 *
 * The sweep stays in place as the fallback: a watcher misses everything that
 * happened while the process was not running, and it is bounded here (one watch
 * per directory, a fixed maximum) because the underlying inotify handles are a
 * finite system resource.
 */
export class EvidenceWatcher implements IDisposable {
  private readonly listDirectories: () => Promise<readonly string[]>;
  private readonly refresh: () => Promise<MemoryEvidenceRefreshReport>;
  private readonly watch: EvidenceWatchPort;
  private readonly log: ILogger;
  private readonly enabled: () => boolean;
  private readonly debounceMs: number;
  private readonly syncMs: number;
  private readonly maxDirectories: number;
  private readonly timers: EvidenceWatcherTimers;

  private readonly watched = new Map<string, IDisposable>();
  private debounceHandle: unknown;
  private syncDebounceHandle: unknown;
  private syncHandle: unknown;
  private inFlight: Promise<void> | undefined;
  private disposed = false;

  constructor(options: EvidenceWatcherOptions) {
    this.listDirectories = options.listDirectories;
    this.refresh = options.refresh;
    this.watch = options.watch;
    this.log = options.log.child({ memory: 'evidence-watch' });
    this.enabled = options.enabled ?? (() => true);
    this.debounceMs = options.debounceMs ?? EVIDENCE_WATCH_DEBOUNCE_MS;
    this.syncMs = options.syncMs ?? EVIDENCE_WATCH_SYNC_MS;
    this.maxDirectories = options.maxDirectories ?? MAX_WATCHED_DIRECTORIES;
    this.timers = options.timers ?? systemTimers;
  }

  get directories(): readonly string[] {
    return [...this.watched.keys()];
  }

  start(): void {
    if (this.disposed) return;
    void this.run(() => this.sync());
    this.syncHandle = this.timers.setTimeout(this.onSyncTick, this.syncMs);
  }

  whenIdle(): Promise<void> {
    return this.inFlight ?? Promise.resolve();
  }

  /** Re-reads the citations and reconciles the watched set. */
  async sync(): Promise<void> {
    if (this.disposed) return;
    const desired = await this.desiredDirectories();
    for (const [directory, handle] of Array.from(this.watched)) {
      if (desired.has(directory)) continue;
      handle.dispose();
      this.watched.delete(directory);
    }
    for (const directory of desired) {
      if (this.watched.size >= this.maxDirectories) break;
      if (this.watched.has(directory)) continue;
      try {
        this.watched.set(directory, this.watch.watch(directory, this.onFileChanged));
      } catch (error) {
        this.log.debug('memory evidence watch skipped a directory', { directory, error: String(error) });
      }
    }
  }

  /** Picks up a citation that was just stored, without waiting for the tick. */
  notify(): void {
    if (this.disposed) return;
    this.clear(this.syncDebounceHandle);
    this.syncDebounceHandle = this.timers.setTimeout(() => {
      this.syncDebounceHandle = undefined;
      void this.run(() => this.sync());
    }, this.debounceMs);
  }

  async refreshNow(): Promise<void> {
    try {
      const report = await this.refresh();
      if (report.status !== 'checked' || report.changed === 0) return;
      this.log.info('memory evidence changed on disk', {
        checked: report.checked,
        changed: report.changed,
        unreadable: report.unreadable,
        marked: report.report.marked,
      });
    } catch (error) {
      this.log.warn('memory evidence watch refresh failed', { error: String(error) });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear(this.debounceHandle);
    this.clear(this.syncDebounceHandle);
    this.clear(this.syncHandle);
    this.debounceHandle = undefined;
    this.syncDebounceHandle = undefined;
    this.syncHandle = undefined;
    for (const handle of this.watched.values()) handle.dispose();
    this.watched.clear();
  }

  private readonly onSyncTick = (): void => {
    if (this.disposed) return;
    this.syncHandle = this.timers.setTimeout(this.onSyncTick, this.syncMs);
    void this.run(() => this.sync());
  };

  private readonly onFileChanged = (): void => {
    if (this.disposed) return;
    this.clear(this.debounceHandle);
    this.debounceHandle = this.timers.setTimeout(() => {
      this.debounceHandle = undefined;
      void this.run(() => this.refreshNow());
    }, this.debounceMs);
  };

  private async desiredDirectories(): Promise<ReadonlySet<string>> {
    if (!this.enabled()) return new Set();
    try {
      return new Set((await this.listDirectories()).toSorted());
    } catch (error) {
      this.log.warn('memory evidence citations unavailable', { error: String(error) });
      return new Set();
    }
  }

  private run(task: () => Promise<void>): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const next = (this.inFlight ?? Promise.resolve())
      .then(task)
      .catch((error: unknown) => {
        this.log.warn('memory evidence watch task failed', { error: String(error) });
      });
    this.inFlight = next;
    void next.finally(() => {
      if (this.inFlight === next) this.inFlight = undefined;
    });
    return next;
  }

  private clear(handle: unknown): void {
    if (handle === undefined) return;
    this.timers.clearTimeout(handle);
  }
}

export function createNodeEvidenceWatchPort(): EvidenceWatchPort {
  return {
    watch(directory, onChange) {
      const handle = watch(directory, { persistent: false }, () => {
        onChange();
      });
      handle.on('error', () => {
        handle.close();
      });
      return {
        dispose: () => {
          handle.close();
        },
      };
    },
  };
}
