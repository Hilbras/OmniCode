import { describe, expect, it } from 'vitest';

import { LazyMemoryStore } from '#/service/memoryRuntime';
import type { MemoryStoreOp, MemoryStorePort, MemoryTextSearchOptions, MemoryTextSearchResult } from '#/storage/memoryStore';

class CountingStore implements MemoryStorePort {
  closed = 0;

  get(key: string): Promise<unknown> {
    return Promise.resolve(key);
  }
  getMany(keys: readonly string[]): Promise<ReadonlyMap<string, unknown>> {
    return Promise.resolve(new Map(keys.map((key) => [key, key] as const)));
  }
  commit(_ops: readonly MemoryStoreOp[]): Promise<void> {
    return Promise.resolve();
  }
  prefixKeys(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }
  searchText(_options: MemoryTextSearchOptions): Promise<MemoryTextSearchResult> {
    return Promise.resolve({ hits: [], visits: 0, truncated: false });
  }
  textIndexState(): Promise<'ready'> {
    return Promise.resolve('ready');
  }
  close(): Promise<void> {
    this.closed += 1;
    return Promise.resolve();
  }
}

describe('LazyMemoryStore', () => {
  it('close is final: a later read neither reopens nor leaks an unclosed store', async () => {
    const opened: CountingStore[] = [];
    const lazy = new LazyMemoryStore(
      'close-is-final',
      () => {
        const store = new CountingStore();
        opened.push(store);
        return Promise.resolve(store);
      },
      () => true,
    );

    await lazy.get('a');
    expect(opened).toHaveLength(1);

    await lazy.close();
    expect(opened[0]?.closed).toBe(1);

    // A watcher tick that lands after dispose still reaches the store. It must not
    // reopen a fresh handle: that handle is never closed, so it keeps the exclusive
    // on-disk lock and the next agent in this process opens read-only.
    await expect(lazy.get('b')).rejects.toThrow();
    expect(opened).toHaveLength(1);
  });

  it('close while an open is in flight closes the store it produces', async () => {
    let release: (() => void) | undefined;
    const opened: CountingStore[] = [];
    const lazy = new LazyMemoryStore(
      'close-during-open',
      () => {
        const store = new CountingStore();
        opened.push(store);
        return new Promise<MemoryStorePort>((resolve) => {
          release = () => resolve(store);
        });
      },
      () => true,
    );

    const pending = lazy.get('a');
    const closing = lazy.close();
    await Promise.resolve();
    release?.();
    await closing;
    await pending.then(
      () => undefined,
      () => undefined,
    );

    expect(opened).toHaveLength(1);
    expect(opened[0]?.closed).toBe(1);
  });

  it('a close still waiting on an in-flight open keeps its place ahead of the next open', async () => {
    const dir = 'close-then-reopen';
    const first: CountingStore[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstOwner = new LazyMemoryStore(
      dir,
      () => {
        const store = new CountingStore();
        first.push(store);
        return new Promise<MemoryStorePort>((resolve) => {
          releaseFirst = () => resolve(store);
        });
      },
      () => true,
    );

    const openingFirst = firstOwner.get('a');
    const closingFirst = firstOwner.close();

    // The next scope opens the same directory while the previous close is still
    // blocked on its own in-flight open. It must not be served first: the close
    // reserved the directory slot synchronously, so opening now would produce a
    // handle that finds the previous lock still held — that is the read-only
    // degradation this contract exists to prevent.
    const second: CountingStore[] = [];
    const secondOrder: string[] = [];
    const secondOwner = new LazyMemoryStore(
      dir,
      () => {
        const store = new CountingStore();
        second.push(store);
        secondOrder.push(`open:${String(first[0]?.closed)}`);
        return Promise.resolve(store);
      },
      () => true,
    );

    const openingSecond = secondOwner.get('b');
    await Promise.resolve();
    expect(second).toHaveLength(0);

    releaseFirst?.();
    await closingFirst;
    await openingFirst.then(
      () => undefined,
      () => undefined,
    );
    await openingSecond;

    expect(first[0]?.closed).toBe(1);
    expect(secondOrder).toEqual(['open:1']);
    expect(second).toHaveLength(1);

    await secondOwner.close();
  });
});
