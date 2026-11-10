import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MEMORY_SCHEMA_KEY } from '#/storage/memoryKeys';
import { MiniDbMemoryStore } from '#/storage/miniDbMemoryStore';
import { InMemoryMemoryStore, MemoryStoreUnavailableError } from '#/storage/memoryStore';

import {
  captureInput,
  createHarness,
  evidenceFor,
  FailingStore,
  REPO_A,
  repoScope,
  sessionScope,
  WORKSPACE,
} from './helpers';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omnicode-memory-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe('storage: record integrity', () => {
  it('creates, reads and updates a memory', async () => {
    const { service } = createHarness();
    const created = await service.capture(captureInput('the package manager is pnpm'));
    expect(created.status).toBe('stored');
    expect((await service.get(created.id as string))?.content).toBe('the package manager is pnpm');

    const updated = await service.update(created.id as string, { content: 'the package manager is pnpm@10' });
    expect(updated.status).toBe('updated');
    expect(updated.record?.revision).toBe(1);
    expect(updated.record?.updatedAt).toBeGreaterThan(created.record?.updatedAt ?? 0);
    expect((await service.get(created.id as string))?.content).toBe('the package manager is pnpm@10');
  });

  it('keeps an active scope index, a fingerprint index and a subject index in one write', async () => {
    const { service, store } = createHarness();
    const stored = await service.capture(
      captureInput('the default port is 5173', { subject: 'devserver.port', evidence: evidenceFor('vite.config.ts') }),
    );
    const id = stored.id as string;
    expect(await store.prefixKeys(`s:r:${REPO_A}:`, 10)).toEqual([`s:r:${REPO_A}:${id}`]);
    expect(await store.prefixKeys(`k:r:${REPO_A}:devserver.port:`, 10)).toEqual([
      `k:r:${REPO_A}:devserver.port:${id}`,
    ]);
    expect(await store.prefixKeys('f:', 10)).toHaveLength(1);
  });

  it('supersedes a memory only when the successor exists', async () => {
    const { service } = createHarness();
    const older = await service.capture(captureInput('the lint script runs oxlint'));
    const newer = await service.capture(captureInput('the lint script runs oxlint --type-aware'));

    const missing = await service.supersede(older.id as string, { successorId: 'mem_absent', reason: 'x' });
    expect(missing.status).toBe('rejected');
    expect((await service.get(older.id as string))?.lifecycle).toBe('active');

    const ok = await service.supersede(older.id as string, { successorId: newer.id as string, reason: 'updated' });
    expect(ok.status).toBe('updated');
    expect(ok.record?.lifecycle).toBe('superseded');
    expect(ok.record?.supersededBy).toBe(newer.id);
    expect((await service.get(older.id as string))?.supersededBy).toBe(newer.id);
    expect((await service.get(newer.id as string))?.supersedes).toBeUndefined();
  });

  it('removes superseded records from retrieval without deleting them', async () => {
    const { service } = createHarness();
    const older = await service.capture(captureInput('prettier formats the codebase', {
        subject: 'formatting.tool',
        evidence: evidenceFor('prettier.config.js'),
      }));
    await service.supersede(older.id as string, {
      successorId: (await service.capture(captureInput('oxfmt formats the codebase', { subject: 'formatting.tool', evidence: evidenceFor('.oxfmtrc.json') })))
        .id as string,
      reason: 'tool changed',
    });
    const result = await service.search({ query: 'formats the codebase', projectId: REPO_A });
    expect(result.memories.map((memory) => memory.record.content)).toEqual(['oxfmt formats the codebase']);
    expect(await service.get(older.id as string)).toBeDefined();
  });

  it('skips unreadable records instead of failing the whole search', async () => {
    const { service, store } = createHarness();
    const good = await service.capture(
      captureInput('a healthy memory about caching', { evidence: evidenceFor('docs/cache.md') }),
    );
    await store.commit([
      { op: 'set', key: 'm:mem_corrupt', value: { id: 'mem_corrupt', content: 'a caching record', trust: 999 } },
      { op: 'set', key: `s:r:${REPO_A}:mem_corrupt`, value: { id: 'mem_corrupt' } },
    ]);
    const result = await service.search({ query: 'caching', projectId: REPO_A });
    expect(result.memories.map((memory) => memory.record.id)).toEqual([good.id]);
    expect(result.diagnostics.rejected.some((gate) => gate.gate === 'integrity')).toBe(true);
  });

  it('refuses a record whose stored key does not match its id', async () => {
    const { service, store } = createHarness();
    await store.commit([
      { op: 'set', key: 'm:mem_a', value: { ...(await service.capture(captureInput('placeholder', { evidence: evidenceFor('a.md') })))?.record, id: 'mem_b' } },
      { op: 'set', key: `s:r:${REPO_A}:mem_a`, value: { id: 'mem_a' } },
    ]);
    const result = await service.search({ query: 'placeholder', projectId: REPO_A });
    expect(result.memories.map((memory) => memory.record.id)).not.toContain('mem_b');
    expect(result.diagnostics.rejected.some((gate) => gate.detail.includes('key mismatch'))).toBe(true);
  });

  it('reports a failed write instead of reporting success', async () => {
    const store = new FailingStore(new InMemoryMemoryStore());
    const { service, log } = createHarness({ store });
    store.failOn = 'commit';
    const result = await service.capture(captureInput('this write will fail'));
    expect(result.status).toBe('failed');
    expect(log.entriesAt('warn').length).toBeGreaterThan(0);
    store.failOn = undefined;
    expect(await service.get('mem_test_0001')).toBeUndefined();
  });

  it('keeps a session-scoped memory out of another session', async () => {
    const { service } = createHarness();
    const mine = await service.capture(
      captureInput('the failing test lives in retry.test.ts', {
          tier: 'working',
          scope: sessionScope('session-a'),
          evidence: evidenceFor('test/retry.test.ts'),
        }),
    );
    expect(mine.status).toBe('stored');
    const other = await service.search({ query: 'failing test', sessionId: 'session-b', projectId: REPO_A });
    expect(other.memories).toHaveLength(0);
    const mineFound = await service.search({ query: 'failing test', sessionId: 'session-a', projectId: REPO_A });
    expect(mineFound.memories.map((memory) => memory.record.id)).toEqual([mine.id]);
  });

  it('exposes workspace and project identity on stored scopes', async () => {
    const { service } = createHarness();
    const stored = await service.capture(captureInput('workspace scoped knowledge', { scope: repoScope(REPO_A) }));
    expect(stored.record?.scope).toEqual({ tier: 'repository', workspaceId: WORKSPACE, projectId: REPO_A });
  });
});

describe('storage: minidb backend', () => {
  it('persists across reopen and rejects a newer schema', async () => {
    const dir = await tempDir();
    const first = await MiniDbMemoryStore.open({ dir });
    await first.commit([{ op: 'set', key: 'm:mem_1', value: { id: 'mem_1', content: 'persisted memory' } }]);
    expect(await first.schemaVersion()).toBe(1);
    await first.close();

    const second = await MiniDbMemoryStore.open({ dir });
    expect(await second.get('m:mem_1')).toEqual({ id: 'mem_1', content: 'persisted memory' });
    expect(await second.textIndexState()).toBe('ready');
    await second.commit([{ op: 'set', key: MEMORY_SCHEMA_KEY, value: { version: 99 } }]);
    await second.close();

    await expect(MiniDbMemoryStore.open({ dir })).rejects.toMatchObject({ code: 'memory.schema_too_new' });
  });

  it('runs the full memory service against the real backend', async () => {
    const dir = await tempDir();
    const store = await MiniDbMemoryStore.open({ dir });
    const { service } = createHarness({ store, settings: { dir } });
    const stored = await service.capture(
      captureInput('this repository uses vitest for unit tests', {
        subject: 'testing.runner',
        evidence: evidenceFor('package.json'),
      }),
    );
    expect(stored.status).toBe('stored');
    expect(stored.record?.trust).toBe('verified');

    const found = await service.search({ query: 'unit tests runner', projectId: REPO_A });
    expect(found.memories.map((memory) => memory.record.id)).toEqual([stored.id]);

    await store.close();
    expect(await service.diagnostics()).toMatchObject({ status: 'unavailable' });
  });

  it('surfaces a closed store instead of pretending memory is empty', async () => {
    const dir = await tempDir();
    const store = await MiniDbMemoryStore.open({ dir });
    await store.close();
    await expect(store.get('m:anything')).rejects.toMatchObject({ code: 'memory.storage_unavailable' });
    await expect(store.commit([{ op: 'del', key: 'x' }])).rejects.toMatchObject({
      code: 'memory.storage_unavailable',
    });
  });
});

describe('storage: in-memory backend contract', () => {
  it('rejects use after close rather than returning empty results', async () => {
    const store = new InMemoryMemoryStore();
    await store.close();
    await expect(store.get('m:x')).rejects.toBeInstanceOf(MemoryStoreUnavailableError);
  });
});