import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MemoryErrors } from '#/contracts/errors';
import { MemoryService } from '#/service/memoryService';
import { MiniDbMemoryStore } from '#/storage/miniDbMemoryStore';

import { captureInput, Clock, evidenceFor, REPO_A, RecordingLogger } from './helpers';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omnicode-memory-conc-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }
});

function serviceFor(store: MiniDbMemoryStore, log: RecordingLogger): MemoryService {
  return new MemoryService({ store, log, now: new Clock(1_700_000_000_000).now });
}

describe('single-writer assumption', () => {
  it('lets a second opener read, and refuses its writes loudly', async () => {
    const dir = await tempDir();
    const first = await MiniDbMemoryStore.open({ dir });
    await first.commit([
      { op: 'set', key: 'm:mem_a', value: { id: 'mem_a', content: 'written by the first owner' } },
    ]);

    const second = await MiniDbMemoryStore.open({ dir });
    expect(second.readOnly).toBe(true);
    expect(first.readOnly).toBe(false);

    expect(await second.get('m:mem_a')).toEqual({ id: 'mem_a', content: 'written by the first owner' });
    await expect(second.commit([{ op: 'set', key: 'm:mem_b', value: { id: 'mem_b' } }])).rejects.toMatchObject({
      code: MemoryErrors.codes.STORAGE_WRITE_FAILED,
    });

    expect(await first.get('m:mem_b')).toBeUndefined();
    expect(await second.get('m:mem_b')).toBeUndefined();

    await first.close();
    await second.close();
  });

  it('reports a failed capture instead of pretending it stored anything', async () => {
    const dir = await tempDir();
    const owner = await MiniDbMemoryStore.open({ dir });
    const contender = await MiniDbMemoryStore.open({ dir });
    const log = new RecordingLogger();
    const service = serviceFor(contender, log);

    const result = await service.capture(
      captureInput('a fact the second instance wants to store', { evidence: evidenceFor('docs/a.md') }),
    );
    expect(result.status).toBe('failed');
    expect(result.id).toBeUndefined();

    const diagnostics = await service.diagnostics();
    expect(diagnostics.readOnly).toBe(true);
    expect(diagnostics.counts.distilled).toBe(0);

    await owner.close();
    await contender.close();
  });

  it("serves reads from the committed data without building its own index", async () => {
    const dir = await tempDir();
    const log = new RecordingLogger();
    const owner = await MiniDbMemoryStore.open({ dir });
    const ownerService = serviceFor(owner, log);
    const stored = await ownerService.capture(
      captureInput('this repository bundles the cli with tsup', {
        evidence: evidenceFor('package.json'),
      }),
    );
    expect(stored.status).toBe('stored');

    const contender = await MiniDbMemoryStore.open({ dir });
    const contenderService = serviceFor(contender, new RecordingLogger());
    const found = await contenderService.search({ query: 'bundle the cli tsup', projectId: REPO_A });
    expect(found.status).toBe('complete');
    expect(found.memories.map((memory) => memory.record.id)).toEqual([stored.id]);

    await owner.close();
    await contender.close();
  });

  it('takes the write lock back once the previous owner is gone', async () => {
    const dir = await tempDir();
    const first = await MiniDbMemoryStore.open({ dir });
    await first.commit([{ op: 'set', key: 'm:mem_a', value: { id: 'mem_a', content: 'first' } }]);
    const contender = await MiniDbMemoryStore.open({ dir });
    expect(contender.readOnly).toBe(true);

    await first.close();

    const successor = await MiniDbMemoryStore.open({ dir });
    expect(successor.readOnly).toBe(false);
    await successor.commit([{ op: 'set', key: 'm:mem_b', value: { id: 'mem_b', content: 'second' } }]);
    expect(await successor.get('m:mem_a')).toEqual({ id: 'mem_a', content: 'first' });
    expect(await successor.get('m:mem_b')).toEqual({ id: 'mem_b', content: 'second' });

    await contender.close();
    await successor.close();
  });

  it('survives concurrent readers hammering the same directory', async () => {
    const dir = await tempDir();
    const owner = await MiniDbMemoryStore.open({ dir });
    const ownerService = serviceFor(owner, new RecordingLogger());
    for (let index = 0; index < 5; index += 1) {
      await ownerService.capture(
        captureInput(`a stored convention number ${index} about commit messages`, {
          evidence: evidenceFor(`docs/c-${index}.md`),
        }),
      );
    }

    const readers = await Promise.all([
      MiniDbMemoryStore.open({ dir }),
      MiniDbMemoryStore.open({ dir }),
      MiniDbMemoryStore.open({ dir }),
    ]);
    const results = await Promise.all(
      readers.map(async (store) => {
        const service = serviceFor(store, new RecordingLogger());
        const found = await service.search({ query: 'stored convention commit messages', projectId: REPO_A });
        return { status: found.status, count: found.memories.length, readOnly: store.readOnly };
      }),
    );
    for (const result of results) {
      expect(result.status).toBe('complete');
      expect(result.count).toBe(5);
      expect(result.readOnly).toBe(true);
    }

    await owner.close();
    for (const reader of readers) await reader.close();
  });
});