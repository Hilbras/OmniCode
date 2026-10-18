import type { ILogger, LogLevel } from '@hilbras/omnicode-core/_base/log/log';

import { MemoryError, MemoryErrors } from '#/contracts/errors';
import type { MemoryCaptureInput } from '#/contracts/memoryContract';
import type { MemoryScope, MemorySourceType } from '#/contracts/memoryTypes';
import type { LabelledMemory } from '#/retrieval/evaluation';
import type { MemoryMaintenanceScheduler, MemoryTimers } from '#/service/memoryMaintenance';
import { MemoryService } from '#/service/memoryService';
import { DEFAULT_MEMORY_SETTINGS, type MemoryPolicySettings } from '#/service/memorySettings';
import {
  InMemoryMemoryStore,
  type MemoryStoreOp,
  type MemoryStorePort,
  type MemoryTextSearchOptions,
  type MemoryTextSearchResult,
} from '#/storage/memoryStore';

export { InMemoryMemoryStore };

export class FakeTimers implements MemoryTimers {
  private next = 1;
  private readonly pending = new Map<number, () => void>();

  setTimeout(handler: () => void, _ms: number): unknown {
    const handle = this.next;
    this.next += 1;
    this.pending.set(handle, handler);
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  get size(): number {
    return this.pending.size;
  }

  async fireAll(scheduler?: MemoryMaintenanceScheduler): Promise<void> {
    const entries = [...this.pending.entries()];
    this.pending.clear();
    for (const [, handler] of entries) handler();
    await scheduler?.whenIdle();
  }
}


export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly context: unknown;
}

export class RecordingLogger implements ILogger {
  readonly entries: LogEntry[] = [];

  error(message: string, payload?: unknown): void {
    this.entries.push({ level: 'error', message, context: payload });
  }

  warn(message: string, payload?: unknown): void {
    this.entries.push({ level: 'warn', message, context: payload });
  }

  info(message: string, payload?: unknown): void {
    this.entries.push({ level: 'info', message, context: payload });
  }

  debug(message: string, payload?: unknown): void {
    this.entries.push({ level: 'debug', message, context: payload });
  }

  child(ctx: Record<string, unknown>): ILogger {
    return this;
  }

  entriesAt(level: LogLevel): readonly LogEntry[] {
    return this.entries.filter((entry) => entry.level === level);
  }

  contexts(): string {
    return this.entries.map((entry) => JSON.stringify(entry.context)).join('\n');
  }
}

export class Clock {
  constructor(private value: number) {}

  now = (): number => {
    this.value += 1;
    return this.value;
  };

  set(value: number): void {
    this.value = value;
  }
}

export class FailingStore implements MemoryStorePort {
  constructor(private readonly inner: MemoryStorePort) {}

  failOn: 'commit' | 'get' | 'searchText' | 'prefixKeys' | undefined;
  unavailable = false;

  private fail(operation: string): never {
    if (this.unavailable) {
      throw new MemoryError(MemoryErrors.codes.STORAGE_UNAVAILABLE, `memory store ${operation} unavailable`);
    }
    throw new Error(`injected ${operation} failure`);
  }

  async get(key: string): Promise<unknown> {
    if (this.failOn === 'get') this.fail('read');
    return this.inner.get(key);
  }

  async getMany(keys: readonly string[]): Promise<ReadonlyMap<string, unknown>> {
    if (this.failOn === 'get') this.fail('read');
    return this.inner.getMany(keys);
  }

  async commit(ops: MemoryStoreOp[]): Promise<void> {
    if (this.failOn === 'commit') this.fail('write');
    await this.inner.commit(ops);
  }

  async prefixKeys(prefix: string, limit: number): Promise<readonly string[]> {
    if (this.failOn === 'prefixKeys') this.fail('scan');
    return this.inner.prefixKeys(prefix, limit);
  }

  async searchText(options: MemoryTextSearchOptions): Promise<MemoryTextSearchResult> {
    if (this.failOn === 'searchText') this.fail('search');
    return this.inner.searchText(options);
  }

  async textIndexState() {
    return this.inner.textIndexState();
  }

  async close(): Promise<void> {
    await this.inner.close();
  }
}

export interface Harness {
  readonly service: MemoryService;
  readonly store: MemoryStorePort;
  readonly log: RecordingLogger;
  readonly clock: Clock;
}

export interface HarnessOptions {
  readonly settings?: Partial<MemoryPolicySettings>;
  readonly available?: () => boolean;
  readonly store?: MemoryStorePort;
  readonly readEvidence?: (ref: string) => Promise<string | undefined>;
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const log = new RecordingLogger();
  const clock = new Clock(1_700_000_000_000);
  const store = options.store ?? new InMemoryMemoryStore();
  const service = new MemoryService({
    store,
    log,
    settings: { ...DEFAULT_MEMORY_SETTINGS, ...options.settings },
    now: clock.now,
    newId: makeSequentialId(),
    available: options.available ?? (() => true),
    readEvidence: options.readEvidence,
  });
  return { service, store, log, clock };
}

function makeSequentialId(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `mem_test_${counter.toString().padStart(4, '0')}`;
  };
}

export const REPO_A = 'repo-alpha';
export const REPO_B = 'repo-beta';
export const WORKSPACE = 'workspace-1';
export const SESSION = 'session-1';
export const TASK = 'task-1';

export function repoScope(projectId: string): MemoryScope {
  return { tier: 'repository', workspaceId: WORKSPACE, projectId };
}

export function sessionScope(sessionId = SESSION, projectId = REPO_A): MemoryScope {
  return { tier: 'session', workspaceId: WORKSPACE, projectId, sessionId };
}

export function taskScope(taskId = TASK, projectId = REPO_A): MemoryScope {
  return { tier: 'task', workspaceId: WORKSPACE, projectId, taskId };
}

export function globalScope(): MemoryScope {
  return { tier: 'global' };
}

export interface CaptureOverrides {
  readonly tier?: MemoryCaptureInput['tier'];
  readonly category?: MemoryCaptureInput['category'];
  readonly sourceType?: MemorySourceType;
  readonly origin?: MemoryCaptureInput['origin'];
  readonly scope?: MemoryScope;
  readonly subject?: string;
  readonly evidence?: MemoryCaptureInput['evidence'];
  readonly derivedFrom?: readonly string[];
  readonly authority?: MemoryCaptureInput['authority'];
  readonly approval?: MemoryCaptureInput['approval'];
  readonly repoRevision?: string;
  readonly expiresAt?: number;
  readonly requestKey?: string;
  readonly review?: MemoryCaptureInput['review'];
}

export function captureInput(content: string, overrides: CaptureOverrides = {}): MemoryCaptureInput {
  return {
    content,
    tier: overrides.tier ?? 'distilled',
    category: overrides.category ?? 'fact',
    sourceType: overrides.sourceType ?? 'repository_file',
    origin: overrides.origin ?? 'application',
    scope: overrides.scope ?? repoScope(REPO_A),
    subject: overrides.subject,
    evidence: overrides.evidence,
    derivedFrom: overrides.derivedFrom,
    authority: overrides.authority,
    approval: overrides.approval,
    repoRevision: overrides.repoRevision,
    expiresAt: overrides.expiresAt,
    requestKey: overrides.requestKey,
    review: overrides.review,
  };
}

export function evidenceFor(ref: string, observedAt = 1): MemoryCaptureInput['evidence'] {
  return [{ kind: 'file', ref, state: 'present', fingerprint: `fp-${ref}`, observedAt }];
}

export async function seedCorpus(
  service: MemoryService,
  entries: readonly LabelledMemory[],
  resolveScope: (entry: LabelledMemory) => MemoryScope = () => repoScope(REPO_A),
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const entry of entries) {
    const result = await service.capture(
      captureInput(entry.content, {
        subject: entry.subject,
        category: entry.category,
        sourceType: entry.sourceType,
        origin: entry.origin,
        scope: entry.global ? globalScope() : resolveScope(entry),
        evidence: evidenceFor(`docs/${entry.subject}.md`),
      }),
    );
    if (result.status !== 'stored') {
      throw new Error(`corpus entry ${entry.corpusId} was not stored: ${result.reason ?? result.status}`);
    }
    ids.set(entry.corpusId, result.id as string);
  }
  return ids;
}
