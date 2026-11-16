import { describe, expect, it, vi } from 'vitest';

import { fetchAllSessions, fetchMessages, PAGE_SIZE } from '../src/api/pagination';
import type { AppSession, Page } from '../src/api';

function session(id: string): AppSession {
  return { id } as unknown as AppSession;
}

function page<T>(items: T[], hasMore: boolean): Page<T> {
  return { items, hasMore };
}

describe('fetchAllSessions', () => {
  it('walks cursor pages until the daemon says there are no more', async () => {
    const calls: Array<{ pageSize: number; beforeId?: string }> = [];
    const api = {
      listSessions: vi.fn((query: { pageSize: number; beforeId?: string }) => {
        calls.push(query);
        if (query.beforeId === undefined) return Promise.resolve(page([session('a'), session('b')], true));
        return Promise.resolve(page([session('c')], false));
      }),
    };

    const items = await fetchAllSessions(api);

    expect(items.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(calls).toEqual([
      { pageSize: PAGE_SIZE },
      { pageSize: PAGE_SIZE, beforeId: 'b' },
    ]);
  });

  it('returns one page when the daemon reports no more', async () => {
    const api = { listSessions: vi.fn(() => Promise.resolve(page([session('only')], false))) };
    await expect(fetchAllSessions(api)).resolves.toHaveLength(1);
    expect(api.listSessions).toHaveBeenCalledTimes(1);
  });

  it('stops when a page claims hasMore but carries no items', async () => {
    // Without this guard the cursor is undefined and the loop either re-requests the
    // first page or never ends, depending on how the daemon answers a missing cursor.
    const api = { listSessions: vi.fn(() => Promise.resolve(page([], true))) };
    await expect(fetchAllSessions(api)).resolves.toEqual([]);
    expect(api.listSessions).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list without a request when the first page is empty', async () => {
    const api = { listSessions: vi.fn(() => Promise.resolve(page([], false))) };
    await expect(fetchAllSessions(api)).resolves.toEqual([]);
  });
});

describe('fetchMessages', () => {
  it('requests one page for the session', async () => {
    const listMessages = vi.fn(() => Promise.resolve(page([{ id: 'm1' } as never], false)));
    const items = await fetchMessages({ listMessages }, 's1');
    expect(items).toHaveLength(1);
    expect(listMessages).toHaveBeenCalledWith('s1', { pageSize: PAGE_SIZE });
  });

  it('makes no request for an undefined session', async () => {
    const listMessages = vi.fn();
    await expect(fetchMessages({ listMessages }, undefined)).resolves.toEqual([]);
    expect(listMessages).not.toHaveBeenCalled();
  });
});
