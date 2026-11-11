import { Error2, ErrorCodes } from '#/errors';

import { TeamErrors } from './errors';

export interface ForkedContextCacheKey {
  readonly parentAgentId: string;
  readonly forkPoint: string;
  readonly taskFingerprint: string;
}

export interface ForkedAgentContextCacheOptions {
  readonly maxEntries?: number;
  readonly now?: () => number;
}

export interface ForkedAgentContextCacheResult<T> {
  readonly context: T;
  readonly reused: boolean;
  readonly key: string;
  readonly createdAt: number | undefined;
  readonly size: number;
}

export interface ForkedAgentContextCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly invalidations: number;
  readonly size: number;
  readonly inFlight: number;
}

interface CacheEntry<T> {
  readonly context: T;
  readonly createdAt: number;
  lastUsedAt: number;
}

function normalizePart(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error2(
      TeamErrors.codes.FORK_CACHE_KEY_INVALID,
      `Fork cache key field ${field} must not be empty.`,
      { details: { field } },
    );
  }
  return trimmed;
}

export function forkedContextCacheKey(key: ForkedContextCacheKey): string {
  const parent = normalizePart(key.parentAgentId, 'parentAgentId');
  const forkPoint = normalizePart(key.forkPoint, 'forkPoint');
  const fingerprint = normalizePart(key.taskFingerprint, 'taskFingerprint');
  return `${parent}\u0000${forkPoint}\u0000${fingerprint}`;
}

export class ForkedAgentContextCache<T> {
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly revisions = new Map<string, number>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private invalidations = 0;
  private generation = 0;

  constructor(options: ForkedAgentContextCacheOptions = {}) {
    const maxEntries = options.maxEntries ?? 64;
    if (!Number.isInteger(maxEntries) || maxEntries < 0) {
      throw new Error2(
        ErrorCodes.VALIDATION_FAILED,
        `Fork cache maxEntries must be a non-negative integer, got ${String(maxEntries)}.`,
        { details: { maxEntries } },
      );
    }
    this.maxEntries = maxEntries;
    this.now = options.now ?? (() => Date.now());
  }

  get capacity(): number {
    return this.maxEntries;
  }

  get size(): number {
    return this.entries.size;
  }

  has(key: ForkedContextCacheKey): boolean {
    return this.entries.has(forkedContextCacheKey(key));
  }

  peek(key: ForkedContextCacheKey): T | undefined {
    return this.entries.get(forkedContextCacheKey(key))?.context;
  }

  async getOrPrepare(
    key: ForkedContextCacheKey,
    prepare: (key: Readonly<ForkedContextCacheKey>) => T | Promise<T>,
  ): Promise<ForkedAgentContextCacheResult<T>> {
    const normalized = forkedContextCacheKey(key);
    const existing = this.entries.get(normalized);
    if (existing !== undefined) {
      this.hits += 1;
      existing.lastUsedAt = this.now();
      this.entries.delete(normalized);
      this.entries.set(normalized, existing);
      return {
        context: existing.context,
        reused: true,
        key: normalized,
        createdAt: existing.createdAt,
        size: this.entries.size,
      };
    }

    const pending = this.inFlight.get(normalized);
    if (pending !== undefined) {
      this.hits += 1;
      const context = await pending;
      return {
        context,
        reused: true,
        key: normalized,
        createdAt: this.entries.get(normalized)?.createdAt,
        size: this.entries.size,
      };
    }

    this.misses += 1;
    const generation = this.generation;
    const revision = this.revisions.get(normalized) ?? 0;
    const created = (async (): Promise<T> => {
      const context = await prepare(key);
      if (
        this.maxEntries > 0 &&
        generation === this.generation &&
        revision === (this.revisions.get(normalized) ?? 0)
      ) {
        const timestamp = this.now();
        this.entries.set(normalized, {
          context,
          createdAt: timestamp,
          lastUsedAt: timestamp,
        });
        this.evictOverflow();
      }
      return context;
    })();
    this.inFlight.set(normalized, created);
    try {
      const context = await created;
      return {
        context,
        reused: false,
        key: normalized,
        createdAt: this.entries.get(normalized)?.createdAt,
        size: this.entries.size,
      };
    } finally {
      this.inFlight.delete(normalized);
    }
  }

  invalidate(key: ForkedContextCacheKey): boolean {
    const normalized = forkedContextCacheKey(key);
    this.bumpRevision(normalized);
    const removed = this.entries.delete(normalized);
    if (removed) this.invalidations += 1;
    return removed;
  }

  invalidateParent(parentAgentId: string): number {
    const parent = normalizePart(parentAgentId, 'parentAgentId');
    const prefix = `${parent}\u0000`;
    for (const key of [...this.entries.keys(), ...this.inFlight.keys()]) {
      if (key.startsWith(prefix)) this.bumpRevision(key);
    }
    let removed = 0;
    for (const key of [...this.entries.keys()]) {
      if (!key.startsWith(prefix)) continue;
      this.entries.delete(key);
      removed += 1;
    }
    this.invalidations += removed;
    return removed;
  }

  clear(): void {
    this.entries.clear();
    this.generation += 1;
    this.invalidations += 1;
  }

  stats(): ForkedAgentContextCacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      invalidations: this.invalidations,
      size: this.entries.size,
      inFlight: this.inFlight.size,
    };
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
      this.evictions += 1;
    }
  }

  private bumpRevision(key: string): void {
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
  }
}
