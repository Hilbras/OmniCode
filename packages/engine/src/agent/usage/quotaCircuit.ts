import { classifyApiError } from '#/llm-adapter/contract/errors';

/**
 * Provider quota circuit.
 *
 * A provider that keeps answering "quota exhausted" or "invalid key" will keep
 * answering it until the operator changes something, so every request retrying
 * it is a wasted round trip. This circuit counts those failures per provider
 * and opens after a small number in a row: an open circuit is a signal that the
 * provider is unavailable *right now*, and the ordered fallback composition
 * skips providers whose circuit is open.
 *
 * The circuit deliberately does not refuse the primary model by itself. The
 * operator chose that model, and an outage that heals (quota reset, key fixed)
 * must not need a restart; the primary is always attempted, and the circuit
 * only informs selection and reporting. `reopensAt` makes the state honest:
 * the circuit is "open" only for the cooldown window, and the failure count is
 * kept so a single failure after the window re-opens it immediately.
 */

export type QuotaCircuitFailureKind = 'quota' | 'auth';

export type QuotaCircuitState = 'closed' | 'open';

export interface QuotaCircuitSnapshot {
  readonly scope: string;
  readonly state: QuotaCircuitState;
  readonly consecutiveFailures: number;
  readonly lastFailureKind?: QuotaCircuitFailureKind;
  readonly openedAt?: number;
  readonly reopensAt?: number;
}

export interface QuotaCircuitOptions {
  readonly openAfterFailures?: number;
  readonly cooldownMs?: number;
  readonly now?: () => number;
}

export const DEFAULT_QUOTA_CIRCUIT_OPEN_AFTER_FAILURES = 3;
export const DEFAULT_QUOTA_CIRCUIT_COOLDOWN_MS = 60_000;

interface QuotaCircuitEntry {
  readonly consecutiveFailures: number;
  readonly lastFailureKind?: QuotaCircuitFailureKind;
  readonly openedAt?: number;
}

const EMPTY_ENTRY: QuotaCircuitEntry = { consecutiveFailures: 0 };

export function quotaCircuitFailureKind(error: unknown): QuotaCircuitFailureKind | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth++) {
    const kind = classifyApiError(current).kind;
    if (kind === 'quota_exhausted') return 'quota';
    if (kind === 'auth') return 'auth';
    const cause = current instanceof Error ? current.cause : undefined;
    if (cause === undefined || cause === current) return undefined;
    current = cause;
  }
  return undefined;
}

export class QuotaCircuit {
  private readonly entries = new Map<string, QuotaCircuitEntry>();
  private readonly openAfterFailures: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(options: QuotaCircuitOptions = {}) {
    const threshold = options.openAfterFailures ?? DEFAULT_QUOTA_CIRCUIT_OPEN_AFTER_FAILURES;
    this.openAfterFailures = Number.isFinite(threshold) ? Math.max(1, Math.floor(threshold)) : 1;
    const cooldown = options.cooldownMs ?? DEFAULT_QUOTA_CIRCUIT_COOLDOWN_MS;
    this.cooldownMs = Number.isFinite(cooldown) ? Math.max(0, cooldown) : 0;
    this.now = options.now ?? Date.now;
  }

  allows(scope: string): boolean {
    return this.state(scope).state === 'closed';
  }

  state(scope: string): QuotaCircuitSnapshot {
    const entry = this.entries.get(scope) ?? EMPTY_ENTRY;
    const openedAt = entry.openedAt;
    if (openedAt === undefined) return this.snapshot(scope, entry, 'closed');
    const reopensAt = openedAt + this.cooldownMs;
    const open = this.now() < reopensAt;
    return this.snapshot(scope, entry, open ? 'open' : 'closed');
  }

  recordFailure(scope: string, kind: QuotaCircuitFailureKind): QuotaCircuitSnapshot {
    const previous = this.entries.get(scope) ?? EMPTY_ENTRY;
    const consecutiveFailures = previous.consecutiveFailures + 1;
    let openedAt: number | undefined;
    if (consecutiveFailures >= this.openAfterFailures) {
      const previousOpen = previous.openedAt;
      const stillCooling =
        previousOpen !== undefined && this.now() < previousOpen + this.cooldownMs;
      openedAt = stillCooling ? previousOpen : this.now();
    }
    const entry: QuotaCircuitEntry = {
      consecutiveFailures,
      lastFailureKind: kind,
      ...(openedAt === undefined ? {} : { openedAt }),
    };
    this.entries.set(scope, entry);
    return this.state(scope);
  }

  recordError(scope: string, error: unknown): QuotaCircuitSnapshot | undefined {
    const kind = quotaCircuitFailureKind(error);
    if (kind === undefined) return undefined;
    return this.recordFailure(scope, kind);
  }

  recordSuccess(scope: string): QuotaCircuitSnapshot {
    this.entries.delete(scope);
    return this.state(scope);
  }

  reset(scope?: string): void {
    if (scope === undefined) {
      this.entries.clear();
      return;
    }
    this.entries.delete(scope);
  }

  snapshots(): readonly QuotaCircuitSnapshot[] {
    return [...this.entries.keys()].map((scope) => this.state(scope));
  }

  private snapshot(
    scope: string,
    entry: QuotaCircuitEntry,
    state: QuotaCircuitState,
  ): QuotaCircuitSnapshot {
    return {
      scope,
      state,
      consecutiveFailures: entry.consecutiveFailures,
      ...(entry.lastFailureKind === undefined ? {} : { lastFailureKind: entry.lastFailureKind }),
      ...(entry.openedAt === undefined ? {} : { openedAt: entry.openedAt }),
      ...(entry.openedAt === undefined ? {} : { reopensAt: entry.openedAt + this.cooldownMs }),
    };
  }
}