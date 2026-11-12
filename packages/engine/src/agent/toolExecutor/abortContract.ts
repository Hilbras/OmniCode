/**
 * Terminal latch for one abortable unit (a tool call, or a whole batch).
 *
 * An abort fan-out can touch the same unit from several directions: the turn
 * signal firing, a queued task finally starting, a handler that was already
 * running, and a late finish arriving after the grace window. Without a latch
 * each of those emits its own "aborted" result and the model sees duplicates,
 * lock accounting sees several releases, and duration stats get credited to a
 * handler that never really ran.
 *
 * The latch makes exactly one outcome observable:
 *
 * - the first caller that wins decides the outcome (completed or aborted);
 * - an abort that arrives after the unit finished changes nothing;
 * - a late finish from the handler is discarded, not reported;
 * - an abort that won before the handler started marks it never-handled;
 * - lock accounting returns released-once and attributed time separately.
 *
 * The latch is pure and synchronous; the caller owns listeners, timers, and
 * any events it wants to emit.
 */

export type AbortContractState = 'idle' | 'running' | 'completed' | 'aborted';

export type AbortContractOutcome =
  | { readonly kind: 'completed'; readonly value: unknown }
  | { readonly kind: 'aborted'; readonly reason: unknown; readonly handled: boolean };

export interface AbortContractAccounting {
  /** True only on the call that actually released the locks. */
  readonly released: boolean;
  /** Time the handler was running; 0 when the handler never started or lost to abort. */
  readonly handlerMs: number;
  /** Time from abort to terminal latch; 0 when no abort preceded the terminal state. */
  readonly drainMs: number;
}

export interface AbortContractOptions {
  readonly now?: () => number;
}

export class AbortContract<Value = unknown> {
  private current: AbortContractState = 'idle';
  private outcome: AbortContractOutcome | undefined;
  private startedAt: number | undefined;
  private abortedAt: number | undefined;
  private settledAt: number | undefined;
  private released = false;
  private readonly now: () => number;

  constructor(options: AbortContractOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  get state(): AbortContractState {
    return this.current;
  }

  /** True once nothing more can be observed from this unit. */
  get terminal(): boolean {
    return this.current === 'completed' || this.current === 'aborted';
  }

  /** The handler is about to run. Ignored when the unit already terminated. */
  markStarted(): boolean {
    if (this.current !== 'idle') return false;
    this.current = 'running';
    this.startedAt = this.now();
    return true;
  }

  /**
   * Abort wins only before completion. A completed unit is immutable, so a
   * late abort is a no-op. `handled` records whether the handler had started,
   * which is what distinguishes "never ran" from "ran and was cut short".
   */
  abort(reason: unknown): boolean {
    if (this.terminal) return false;
    const handled = this.current === 'running';
    this.current = 'aborted';
    this.abortedAt = this.now();
    this.settledAt = this.abortedAt;
    this.outcome = { kind: 'aborted', reason, handled };
    return true;
  }

  /** The handler produced a value. Discarded when an abort already won. */
  complete(value: Value): boolean {
    if (this.terminal) return false;
    this.current = 'completed';
    this.settledAt = this.now();
    this.outcome = { kind: 'completed', value };
    return true;
  }

  /**
   * The handler threw. While running this is a completion carrying an error
   * value; after an abort it is a late failure and is discarded.
   */
  fail(error: unknown): boolean {
    return this.complete({ error } as unknown as Value);
  }

  /** Releases the locks at most once across repeated or late abort paths. */
  release(): boolean {
    if (this.released) return false;
    this.released = true;
    return true;
  }

  accounting(): AbortContractAccounting {
    const at =
      this.settledAt ??
      (this.current === 'running' && this.startedAt !== undefined ? this.now() : undefined);
    const handlerMs =
      !this.abortedBeforeStart() && this.startedAt !== undefined && at !== undefined
        ? Math.max(0, at - this.startedAt)
        : 0;
    const drainMs =
      this.abortedAt !== undefined && this.settledAt !== undefined
        ? Math.max(0, this.settledAt - this.abortedAt)
        : 0;
    return { released: this.released, handlerMs, drainMs };
  }

  settledOutcome(): AbortContractOutcome | undefined {
    return this.outcome;
  }

  reset(): void {
    this.current = 'idle';
    this.outcome = undefined;
    this.startedAt = undefined;
    this.abortedAt = undefined;
    this.settledAt = undefined;
    this.released = false;
  }

  private abortedBeforeStart(): boolean {
    const outcome = this.outcome;
    return outcome !== undefined && outcome.kind === 'aborted' && !outcome.handled;
  }
}
