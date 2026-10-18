import { tokenize } from '@hilbras/omnicode-minidb';

export type TextIndexState = 'ready' | 'building' | 'absent';

export interface MemoryTextSearchOptions {
  readonly query: string;
  readonly op: 'AND' | 'OR';
  readonly limit: number;
  readonly maxVisits: number;
  readonly allowedKeys?: ReadonlySet<string>;
}

export interface MemoryTextHit {
  readonly key: string;
  readonly score: number;
  readonly value: unknown;
}

export interface MemoryTextSearchResult {
  readonly hits: readonly MemoryTextHit[];
  readonly visits: number;
  readonly truncated: boolean;
}

export type MemoryStoreOp =
  | { readonly op: 'set'; readonly key: string; readonly value: unknown }
  | { readonly op: 'del'; readonly key: string };

export interface MemoryStorePort {
  get(key: string): Promise<unknown>;
  getMany(keys: readonly string[]): Promise<ReadonlyMap<string, unknown>>;
  commit(ops: readonly MemoryStoreOp[]): Promise<void>;
  prefixKeys(prefix: string, limit: number): Promise<readonly string[]>;
  searchText(options: MemoryTextSearchOptions): Promise<MemoryTextSearchResult>;
  textIndexState(): Promise<TextIndexState>;
  readonly readOnly?: boolean;
  close(): Promise<void>;
}

export class MemoryStoreUnavailableError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message);
    this.name = 'MemoryStoreUnavailableError';
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

interface Posting {
  readonly key: string;
  readonly frequency: number;
  readonly length: number;
}

export class InMemoryMemoryStore implements MemoryStorePort {
  readonly readOnly = false;

  private readonly data = new Map<string, unknown>();
  private postings: Map<string, Map<string, Posting>> | undefined;
  private closed = false;

  constructor(initial?: Iterable<readonly [string, unknown]>) {
    if (initial !== undefined) {
      for (const [key, value] of initial) this.data.set(key, value);
    }
  }

  async get(key: string): Promise<unknown> {
    this.assertOpen();
    return this.data.get(key);
  }

  async getMany(keys: readonly string[]): Promise<ReadonlyMap<string, unknown>> {
    this.assertOpen();
    const found = new Map<string, unknown>();
    for (const key of keys) {
      const value = this.data.get(key);
      if (value !== undefined) found.set(key, value);
    }
    return found;
  }

  async commit(ops: readonly MemoryStoreOp[]): Promise<void> {
    this.assertOpen();
    for (const op of ops) {
      if (op.op === 'set') this.data.set(op.key, op.value);
      else this.data.delete(op.key);
    }
    this.postings = undefined;
  }

  async prefixKeys(prefix: string, limit: number): Promise<readonly string[]> {
    this.assertOpen();
    const matched: string[] = [];
    for (const key of this.data.keys()) {
      if (key.startsWith(prefix)) matched.push(key);
    }
    return matched.toSorted().slice(0, Math.max(0, limit));
  }

  async searchText(options: MemoryTextSearchOptions): Promise<MemoryTextSearchResult> {
    this.assertOpen();
    const terms = [...new Set(tokenize(options.query))];
    if (terms.length === 0) return { hits: [], visits: 0, truncated: false };
    const index = this.buildPostings();
    const documents = index.size;

    const buckets: { term: string; postings: Map<string, Posting>; df: number }[] = [];
    for (const term of terms) {
      const postings = index.get(term);
      if (postings === undefined) {
        if (options.op === 'AND') return { hits: [], visits: 0, truncated: false };
        continue;
      }
      buckets.push({ term, postings, df: postings.size });
    }

    let visits = 0;
    let truncated = false;
    const accumulated = new Map<string, number>();
    const matched = new Set<string>();

    for (const bucket of buckets) {
      for (const [key, posting] of bucket.postings) {
        if (options.allowedKeys !== undefined && !options.allowedKeys.has(key)) continue;
        visits += 1;
        if (visits > options.maxVisits) {
          truncated = true;
          break;
        }
        matched.add(key);
        const idf = Math.log(1 + documents / Math.max(1, bucket.df));
        accumulated.set(key, (accumulated.get(key) ?? 0) + (posting.frequency / Math.max(1, posting.length)) * idf);
      }
      if (truncated) break;
    }

    if (truncated) return { hits: [], visits, truncated: true };

    const keys = options.op === 'AND' ? [...matched].filter((key) => buckets.every((b) => b.postings.has(key))) : [...matched];
    const hits = keys
      .map((key) => ({ key, score: accumulated.get(key) ?? 0, value: this.data.get(key) }))
      .toSorted((a, b) => (b.score === a.score ? a.key.localeCompare(b.key) : b.score - a.score));
    return { hits: hits.slice(0, Math.max(0, options.limit)), visits, truncated: false };
  }

  async textIndexState(): Promise<TextIndexState> {
    return 'ready';
  }

  async close(): Promise<void> {
    this.closed = true;
    this.data.clear();
    this.postings = undefined;
  }

  private assertOpen(): void {
    if (this.closed) throw new MemoryStoreUnavailableError('memory store is closed');
  }

  private buildPostings(): Map<string, Map<string, Posting>> {
    if (this.postings !== undefined) return this.postings;
    const index = new Map<string, Map<string, Posting>>();
    for (const [key, value] of this.data) {
      const record = asRecord(value);
      if (record === undefined) continue;
      const searchable = record['searchText'];
      const content = record['content'];
      const text =
        typeof searchable === 'string' && searchable.length > 0
          ? `${searchable} ${typeof content === 'string' ? content : ''}`
          : typeof content === 'string'
            ? content
            : undefined;
      if (text === undefined || text.length === 0) continue;
      const terms = tokenize(text);
      const length = terms.length;
      const frequencies = new Map<string, number>();
      for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
      for (const [term, frequency] of frequencies) {
        let bucket = index.get(term);
        if (bucket === undefined) {
          bucket = new Map<string, Posting>();
          index.set(term, bucket);
        }
        bucket.set(key, { key, frequency, length });
      }
    }
    this.postings = index;
    return index;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}