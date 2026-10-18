import { MiniDb, TextIndexBuildingError } from '@hilbras/omnicode-minidb';

import { MemoryError, MemoryErrors } from '#/contracts/errors';

import {
  MEMORY_SCHEMA_KEY,
  MEMORY_SCHEMA_VERSION,
} from './memoryKeys';
import {
  type MemoryStoreOp,
  type MemoryStorePort,
  type MemoryTextHit,
  type MemoryTextSearchOptions,
  type MemoryTextSearchResult,
  type TextIndexState,
} from './memoryStore';

const TEXT_INDEX_NAME = 'content';

export interface MiniDbMemoryStoreOptions {
  readonly dir: string;
  readonly onError?: (error: unknown) => void;
}

export class MiniDbMemoryStore implements MemoryStorePort {
  private db: MiniDb | undefined;
  private closed = false;
  private buildingReported = false;
  private lockedByOtherProcess = false;

  private constructor(
    private readonly dbHandle: MiniDb,
    private readonly options: MiniDbMemoryStoreOptions,
  ) {
    this.db = dbHandle;
    this.lockedByOtherProcess = dbHandle.readOnly;
  }

  static async open(options: MiniDbMemoryStoreOptions): Promise<MiniDbMemoryStore> {
    let db: MiniDb;
    try {
      db = await MiniDb.open({
        dir: options.dir,
        valueCodec: 'json',
        valueMode: 'disk',
        fsyncPolicy: 'everysec',
        deferOpenTextBuilds: false,
        onLockFail: 'readonly',
      });
    } catch (error) {
      throw new MemoryError(MemoryErrors.codes.STORAGE_UNAVAILABLE, 'memory store could not be opened', {
        cause: error,
        details: { dir: options.dir },
      });
    }
    const store = new MiniDbMemoryStore(db, options);
    await store.migrate();
    return store;
  }

  get readOnly(): boolean {
    return this.lockedByOtherProcess;
  }

  private async migrate(): Promise<void> {
    const db = this.require();
    const raw = await db.get(MEMORY_SCHEMA_KEY);
    if (raw === undefined) {
      if (this.lockedByOtherProcess) return;
      await db.set(MEMORY_SCHEMA_KEY, { version: MEMORY_SCHEMA_VERSION });
    } else {
      const version = asRecord(raw)?.['version'];
      if (typeof version !== 'number') {
        throw new MemoryError(MemoryErrors.codes.CORRUPT_RECORD, 'memory schema record is unreadable', {
          details: { dir: this.options.dir },
        });
      }
      if (version > MEMORY_SCHEMA_VERSION) {
        throw new MemoryError(
          MemoryErrors.codes.SCHEMA_TOO_NEW,
          `memory store schema v${version} is newer than supported v${MEMORY_SCHEMA_VERSION}`,
          { details: { found: version, supported: MEMORY_SCHEMA_VERSION } },
        );
      }
      if (version < MEMORY_SCHEMA_VERSION) {
        if (this.lockedByOtherProcess) return;
        await this.applyMigrations(db, version);
      }
    }
    if (this.lockedByOtherProcess) return;
    try {
      await db.createTextIndex(TEXT_INDEX_NAME, { fields: ['searchText', 'content'] });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('already exists')) throw error;
    }
  }

  private async applyMigrations(db: MiniDb, from: number): Promise<void> {
    let version = from;
    while (version < MEMORY_SCHEMA_VERSION) {
      version += 1;
      await db.set(MEMORY_SCHEMA_KEY, { version });
    }
  }

  async schemaVersion(): Promise<number> {
    const raw = await this.require().get(MEMORY_SCHEMA_KEY);
    const version = asRecord(raw)?.['version'];
    return typeof version === 'number' ? version : MEMORY_SCHEMA_VERSION;
  }

  async get(key: string): Promise<unknown> {
    try {
      return await this.require().getAsync(key);
    } catch (error) {
      throw this.wrap('read', key, error);
    }
  }

  async getMany(keys: readonly string[]): Promise<ReadonlyMap<string, unknown>> {
    const found = new Map<string, unknown>();
    for (const key of keys) {
      const value = await this.get(key);
      if (value !== undefined) found.set(key, value);
    }
    return found;
  }

  async commit(ops: readonly MemoryStoreOp[]): Promise<void> {
    if (ops.length === 0) return;
    try {
      await this.require().batch(ops);
    } catch (error) {
      throw this.wrap('write', ops[0]?.key ?? '', error);
    }
  }

  async prefixKeys(prefix: string, limit: number): Promise<readonly string[]> {
    try {
      return this.require()
        .prefix(prefix, Math.max(0, limit))
        .map((entry) => entry.key);
    } catch (error) {
      throw this.wrap('scan', prefix, error);
    }
  }

  async searchText(options: MemoryTextSearchOptions): Promise<MemoryTextSearchResult> {
    const db = this.require();
    let raw;
    try {
      raw = await db.searchBoundedAsync(TEXT_INDEX_NAME, options.query, {
        op: options.op,
        limit: options.limit,
        maxVisits: options.maxVisits,
      });
    } catch (error) {
      if (error instanceof TextIndexBuildingError) {
        this.buildingReported = true;
        return { hits: [], visits: 0, truncated: true };
      }
      throw this.wrap('search', TEXT_INDEX_NAME, error);
    }
    const hits: MemoryTextHit[] = [];
    for (const hit of raw.hits) {
      if (options.allowedKeys !== undefined && !options.allowedKeys.has(hit.key)) continue;
      hits.push({ key: hit.key, score: hit.score, value: hit.value });
    }
    return { hits, visits: raw.visits, truncated: raw.truncated };
  }

  async textIndexState(): Promise<TextIndexState> {
    const db = this.require();
    try {
      if (db.textIndexBuilding(TEXT_INDEX_NAME)) return 'building';
    } catch {
      return 'absent';
    }
    if (this.buildingReported) return 'building';
    return 'ready';
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const db = this.db;
    this.db = undefined;
    if (db !== undefined) await db.close().catch(() => undefined);
  }

  private require(): MiniDb {
    if (this.closed || this.db === undefined) {
      throw new MemoryError(MemoryErrors.codes.STORAGE_UNAVAILABLE, 'memory store is closed');
    }
    return this.db;
  }

  private wrap(operation: string, key: string, error: unknown): MemoryError {
    if (error instanceof MemoryError) return error;
    this.options.onError?.(error);
    const code =
      operation === 'write' || operation === 'delete'
        ? MemoryErrors.codes.STORAGE_WRITE_FAILED
        : MemoryErrors.codes.STORAGE_UNAVAILABLE;
    return new MemoryError(code, `memory store ${operation} failed`, {
      cause: error,
      details: { operation, key },
    });
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}