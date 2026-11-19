import { describe, expect, it } from 'vitest';

import type { IAgentToolExecutorService } from '#/agent/toolExecutor/toolExecutor';
import type { HostFileStat, IHostFileSystem } from '#/os/interface/hostFileSystem';

import { AgentFileReadCacheService } from '#/agent/fileReadCache/fileReadCacheService';

function compose() {
  let stat: HostFileStat = { isFile: true, isDirectory: false, size: 10, mtimeMs: 1 };
  let before: ((event: unknown) => void) | undefined;
  const executor = {
    onBeforeExecuteTool: (handler: (event: unknown) => void) => {
      before = handler;
      return { dispose: () => undefined };
    },
    hooks: { onDidExecuteTool: { register: () => ({ dispose: () => undefined }) } },
  } as unknown as IAgentToolExecutorService;
  const fs = {
    stat: async () => stat,
  } as unknown as IHostFileSystem;
  const cache = new AgentFileReadCacheService(fs, executor);
  return {
    cache,
    before: () => before,
    setStat: (next: HostFileStat) => {
      stat = next;
    },
  };
}

describe('AgentFileReadCacheService', () => {
  it('accepts a write when the file is unchanged since the read', async () => {
    const { cache } = compose();
    await cache.record('/workspace/a.ts');
    expect(await cache.verify('/workspace/a.ts')).toBeUndefined();
  });

  it('refuses a write when the file changed after the read', async () => {
    const { cache, setStat } = compose();
    await cache.record('/workspace/a.ts');
    setStat({ isFile: true, isDirectory: false, size: 11, mtimeMs: 2 });
    expect(await cache.verify('/workspace/a.ts')).toContain('FILE_CHANGED_SINCE_READ');
  });

  it('allows a write when the file was never read', async () => {
    const { cache } = compose();
    expect(await cache.verify('/workspace/new.ts')).toBeUndefined();
  });

  it('refuses a write after the read result was evicted from context', async () => {
    const { cache } = compose();
    await cache.record('/workspace/a.ts');
    cache.disarm('/workspace/a.ts');
    expect(await cache.verify('/workspace/a.ts')).toContain('FILE_READ_EVICTED');
  });

  it('re-arms on a fresh read after eviction', async () => {
    const { cache } = compose();
    await cache.record('/workspace/a.ts');
    cache.disarm('/workspace/a.ts');
    await cache.record('/workspace/a.ts');
    expect(await cache.verify('/workspace/a.ts')).toBeUndefined();
  });

  it('vetoes a write through the hook after eviction', async () => {
    const { cache, before } = compose();
    await cache.record('/workspace/a.ts');
    cache.disarm('/workspace/a.ts');

    const pending: (() => Promise<unknown>)[] = [];
    before()?.({
      execution: { accesses: [{ kind: 'file', operation: 'write', path: '/workspace/a.ts' }] },
      waitUntil: (factory: () => Promise<unknown>) => pending.push(factory),
    });
    const decision = (await pending[0]?.()) as { veto?: { output?: string } } | undefined;
    expect(decision?.veto?.output).toContain('FILE_READ_EVICTED');
  });

  it('vetoes a stale write through the executor hook', async () => {
    const { cache, before, setStat } = compose();
    await cache.record('/workspace/a.ts');
    setStat({ isFile: true, isDirectory: false, size: 12, mtimeMs: 3 });

    const pending: (() => Promise<unknown>)[] = [];
    before()?.({
      execution: { accesses: [{ kind: 'file', operation: 'write', path: '/workspace/a.ts' }] },
      waitUntil: (factory: () => Promise<unknown>) => pending.push(factory),
    });
    const decision = (await pending[0]?.()) as { veto?: { isError?: boolean } } | undefined;
    expect(decision?.veto?.isError).toBe(true);
  });
});
