import { describe, expect, it } from 'vitest';

import {
  ForkedAgentContextCache,
  forkedContextCacheKey,
} from '#/agent/team/forkedAgentContextCache';

const KEY = {
  parentAgentId: 'parent-1',
  forkPoint: 'turn-7',
  taskFingerprint: 'task-hash',
};

describe('ForkedAgentContextCache', () => {
  it('prepares a context once and reuses it for the same parent, fork point, and fingerprint', async () => {
    const cache = new ForkedAgentContextCache<{ text: string }>();
    let prepared = 0;
    const prepare = (): { text: string } => {
      prepared += 1;
      return { text: 'prepared' };
    };

    const first = await cache.getOrPrepare(KEY, prepare);
    const second = await cache.getOrPrepare(KEY, prepare);

    expect(prepared).toBe(1);
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.context).toBe(first.context);
    expect(cache.size).toBe(1);
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1, size: 1 });
  });

  it('keys by every component and deduplicates concurrent preparation', async () => {
    const cache = new ForkedAgentContextCache<{ id: string }>();
    let prepared = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prepare = async (): Promise<{ id: string }> => {
      prepared += 1;
      await gate;
      return { id: `context-${String(prepared)}` };
    };

    const pendingFirst = cache.getOrPrepare(KEY, prepare);
    const pendingSecond = cache.getOrPrepare(KEY, prepare);
    release();
    const [first, second] = await Promise.all([pendingFirst, pendingSecond]);

    expect(prepared).toBe(1);
    expect(first.context).toBe(second.context);
    expect([first.reused, second.reused].sort()).toEqual([false, true]);

    await cache.getOrPrepare({ ...KEY, taskFingerprint: 'other' }, prepare);
    await cache.getOrPrepare({ ...KEY, forkPoint: 'turn-8' }, prepare);
    await cache.getOrPrepare({ ...KEY, parentAgentId: 'parent-2' }, prepare);
    expect(prepared).toBe(4);
    expect(cache.size).toBe(4);
  });

  it('invalidates individual keys and whole parents', async () => {
    const cache = new ForkedAgentContextCache<number>();
    let prepared = 0;
    const prepare = (): number => {
      prepared += 1;
      return prepared;
    };

    await cache.getOrPrepare(KEY, prepare);
    await cache.getOrPrepare({ ...KEY, taskFingerprint: 'two' }, prepare);
    await cache.getOrPrepare({ ...KEY, parentAgentId: 'parent-2' }, prepare);
    expect(cache.invalidate(KEY)).toBe(true);
    expect(cache.has(KEY)).toBe(false);
    expect(cache.invalidateParent('parent-1')).toBe(1);
    expect(cache.has({ ...KEY, taskFingerprint: 'two' })).toBe(false);
    expect(cache.invalidateParent('parent-1')).toBe(0);
  });

  it('bounds entries with LRU eviction', async () => {
    const cache = new ForkedAgentContextCache<number>({ maxEntries: 2 });
    const prepare = (key: { taskFingerprint: string }): number =>
      Number(key.taskFingerprint);

    await cache.getOrPrepare({ ...KEY, taskFingerprint: '1' }, prepare);
    await cache.getOrPrepare({ ...KEY, taskFingerprint: '2' }, prepare);
    await cache.getOrPrepare({ ...KEY, taskFingerprint: '1' }, prepare);
    await cache.getOrPrepare({ ...KEY, taskFingerprint: '3' }, prepare);

    expect(cache.size).toBe(2);
    expect(cache.has({ ...KEY, taskFingerprint: '2' })).toBe(false);
    expect(cache.has({ ...KEY, taskFingerprint: '1' })).toBe(true);
    expect(cache.stats().evictions).toBe(1);
  });

  it('does not cache with zero capacity and clears cached entries', async () => {
    const disabled = new ForkedAgentContextCache<number>({ maxEntries: 0 });
    let prepared = 0;
    const prepare = (): number => {
      prepared += 1;
      return prepared;
    };
    await disabled.getOrPrepare(KEY, prepare);
    await disabled.getOrPrepare(KEY, prepare);
    expect(prepared).toBe(2);
    expect(disabled.size).toBe(0);

    const cache = new ForkedAgentContextCache<number>();
    await cache.getOrPrepare(KEY, prepare);
    cache.clear();
    expect(cache.size).toBe(0);
    await cache.getOrPrepare(KEY, prepare);
    expect(prepared).toBe(4);
  });

  it('does not cache a context invalidated while it is being prepared', async () => {
    const cache = new ForkedAgentContextCache<number>();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = cache.getOrPrepare(KEY, async () => {
      await gate;
      return 1;
    });

    expect(cache.invalidate(KEY)).toBe(false);
    release();
    await pending;
    expect(cache.size).toBe(0);
    expect(await cache.getOrPrepare(KEY, () => 2)).toMatchObject({
      context: 2,
      reused: false,
    });
  });

  it('rejects empty key components', () => {
    expect(() => forkedContextCacheKey({ ...KEY, parentAgentId: ' ' })).toThrow(
      'Fork cache key field parentAgentId must not be empty.',
    );
  });
});
