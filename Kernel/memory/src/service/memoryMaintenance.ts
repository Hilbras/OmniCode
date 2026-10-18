import type { IDisposable } from '@hilbras/omnicode-core/_base/di/lifecycle';
import type { ILogger } from '@hilbras/omnicode-core/_base/log/log';

import type { IMemoryService, MemoryReviewJob, MemoryReviewReport } from '#/contracts/memoryContract';


export const REVIEW_BATCH = 25;
export const REVIEW_DEBOUNCE_MS = 250;
export const REVIEW_POLL_MS = 60_000;
export const RETENTION_SWEEP_MS = 60 * 60_000;
export const WORKING_GRACE_MS = 24 * 60 * 60_000;
export const EVIDENCE_SWEEP_MS = 15 * 60_000;

export interface MemoryTimers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemTimers: MemoryTimers = {
  setTimeout: (handler, ms) => {
    const handle = setTimeout(handler, ms);
    handle.unref?.();
    return handle;
  },
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export interface MemoryMaintenanceOptions {
  readonly memory: IMemoryService;
  readonly log: ILogger;
  readonly enabled: () => boolean;
  readonly now?: () => number;
  readonly timers?: MemoryTimers;
  readonly reviewDebounceMs?: number;
  readonly reviewPollMs?: number;
  readonly retentionSweepMs?: number;
  readonly workingGraceMs?: number;
  readonly evidenceSweepMs?: number;
  readonly evidenceProjectId?: () => string | undefined;
}

/**
 * Drives the durable review queue and the retention sweep. Both are persisted,
 * so recovery after a crash is just draining again; nothing here is required
 * for correctness of an individual capture, only for queued work to complete.
 */
export class MemoryMaintenanceScheduler implements IDisposable {
  private readonly memory: IMemoryService;
  private readonly log: ILogger;
  private readonly enabled: () => boolean;
  private readonly now: () => number;
  private readonly timers: MemoryTimers;
  private readonly reviewDebounceMs: number;
  private readonly reviewPollMs: number;
  private readonly retentionSweepMs: number;
  private readonly workingGraceMs: number;
  private readonly evidenceSweepMs: number;
  private readonly evidenceProjectId: () => string | undefined;

  private debounceHandle: unknown;
  private pollHandle: unknown;
  private retentionHandle: unknown;
  private inFlight: Promise<MemoryReviewReport | undefined> | undefined;
  private retentionInFlight: Promise<void> | undefined;
  private evidenceInFlight: Promise<void> | undefined;
  private evidenceHandle: unknown;
  private disposed = false;
  private lastReport: MemoryReviewReport | undefined;

  constructor(options: MemoryMaintenanceOptions) {
    this.memory = options.memory;
    this.log = options.log.child({ memory: 'maintenance' });
    this.enabled = options.enabled;
    this.now = options.now ?? (() => Date.now());
    this.timers = options.timers ?? systemTimers;
    this.reviewDebounceMs = options.reviewDebounceMs ?? REVIEW_DEBOUNCE_MS;
    this.reviewPollMs = options.reviewPollMs ?? REVIEW_POLL_MS;
    this.retentionSweepMs = options.retentionSweepMs ?? RETENTION_SWEEP_MS;
    this.workingGraceMs = options.workingGraceMs ?? WORKING_GRACE_MS;
    this.evidenceSweepMs = options.evidenceSweepMs ?? EVIDENCE_SWEEP_MS;
    this.evidenceProjectId = options.evidenceProjectId ?? (() => undefined);
  }

  get lastReview(): MemoryReviewReport | undefined {
    return this.lastReport;
  }

  start(): void {
    this.schedule(this.reviewDebounceMs, this.startupDrain);
    this.pollHandle = this.timers.setTimeout(this.onPoll, this.reviewPollMs);
    this.retentionHandle = this.timers.setTimeout(this.onRetention, this.retentionSweepMs);
    this.evidenceHandle = this.timers.setTimeout(this.onEvidence, this.evidenceSweepMs);
  }

  private readonly startupDrain = (): void => {
    void this.runNow('startup');
  };

  private readonly enqueueDrain = (): void => {
    void this.runNow('enqueue');
  };

  private readonly onPoll = (): void => {
    if (this.disposed) return;
    this.pollHandle = this.timers.setTimeout(this.onPoll, this.reviewPollMs);
    if (!this.enabled()) return;
    let pending: Promise<readonly MemoryReviewJob[]>;
    try {
      pending = this.memory.pendingReviews(this.now(), 1);
    } catch (error) {
      this.log.warn('memory review poll failed', { error: String(error) });
      return;
    }
    void pending
      .then((jobs) => (jobs.length === 0 ? undefined : this.runNow('poll')))
      .catch((error: unknown) => {
        this.log.warn('memory review poll failed', { error: String(error) });
      });
  };

  private readonly onRetention = (): void => {
    if (this.disposed) return;
    this.retentionHandle = this.timers.setTimeout(this.onRetention, this.retentionSweepMs);
    this.startRetention();
  };

  notifyQueued(): void {
    this.schedule(this.reviewDebounceMs, this.enqueueDrain);
  }

  drainNow(): Promise<MemoryReviewReport | undefined> {
    return this.runNow('explicit');
  }

  async whenIdle(): Promise<void> {
    while (
      this.inFlight !== undefined ||
      this.retentionInFlight !== undefined ||
      this.evidenceInFlight !== undefined
    ) {
      await this.inFlight;
      await this.retentionInFlight;
      await this.evidenceInFlight;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear(this.debounceHandle);
    this.clear(this.pollHandle);
    this.clear(this.retentionHandle);
    this.clear(this.evidenceHandle);
    this.debounceHandle = undefined;
    this.pollHandle = undefined;
    this.retentionHandle = undefined;
    this.evidenceHandle = undefined;
  }

  private readonly onEvidence = (): void => {
    if (this.disposed) return;
    this.evidenceHandle = this.timers.setTimeout(this.onEvidence, this.evidenceSweepMs);
    if (this.evidenceInFlight !== undefined) return;
    const run = this.sweepEvidence();
    this.evidenceInFlight = run.finally(() => {
      this.evidenceInFlight = undefined;
    });
  };

  private async sweepEvidence(): Promise<void> {
    if (!this.enabled()) return;
    try {
      const report = await this.memory.refreshEvidence({ projectId: this.evidenceProjectId() });
      if (report.status === 'checked' && report.changed > 0) {
        this.log.info('memory evidence changed on disk', {
          checked: report.checked,
          changed: report.changed,
          unreadable: report.unreadable,
          marked: report.report.marked,
        });
      }
    } catch (error) {
      this.log.warn('memory evidence sweep failed', { error: String(error) });
    }
  }

  private startRetention(): void {
    if (this.retentionInFlight !== undefined) return;
    const run = this.sweepRetention();
    this.retentionInFlight = run.finally(() => {
      this.retentionInFlight = undefined;
    });
  }

  private async sweepRetention(): Promise<void> {
    if (!this.enabled()) return;
    const now = this.now();
    try {
      const expired = await this.memory.expireDue(now);
      if (expired.length > 0) {
        this.log.info('memory retention expired records', { count: expired.length });
      }
    } catch (error) {
      this.log.warn('memory retention expire failed', { error: String(error) });
      return;
    }
    try {
      const purged = await this.memory.purgeWorking(now - this.workingGraceMs);
      if (purged.length > 0) {
        this.log.info('memory retention purged working records', { count: purged.length });
      }
    } catch (error) {
      this.log.warn('memory retention purge failed', { error: String(error) });
    }
  }

  private runNow(reason: string): Promise<MemoryReviewReport | undefined> {
    if (this.disposed || !this.enabled() || this.inFlight !== undefined) return Promise.resolve(undefined);
    const run = this.drain(reason);
    this.inFlight = run.finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async drain(reason: string): Promise<MemoryReviewReport | undefined> {
    try {
      const report = await this.memory.runReview(REVIEW_BATCH);
      this.lastReport = report;
      if (report.processed > 0) {
        this.log.info('memory review drained', {
          reason,
          processed: report.processed,
          stored: report.stored,
          deduplicated: report.deduplicated,
          skipped: report.skipped,
          retrying: report.retrying,
          failed: report.failed,
        });
      }
      return report;
    } catch (error) {
      this.log.warn('memory review drain failed', { reason, error: String(error) });
      return undefined;
    }
  }

  private schedule(ms: number, run: () => void): void {
    this.clear(this.debounceHandle);
    this.debounceHandle = this.timers.setTimeout(() => {
      this.debounceHandle = undefined;
      run();
    }, ms);
  }

  private clear(handle: unknown): void {
    if (handle === undefined) return;
    this.timers.clearTimeout(handle);
  }
}

