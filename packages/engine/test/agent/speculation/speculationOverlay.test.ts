import { describe, expect, it } from 'vitest';

import {
  applyOverlay,
  SpeculationOverlay,
  SpeculationOverlayFullError,
  type OverlayWriteTarget,
} from '#/agent/speculation/speculationOverlay';

describe('SpeculationOverlay', () => {
  it('records writes and reports them sorted by path', () => {
    const overlay = new SpeculationOverlay();
    overlay.write('/ws/b.txt', 'b', 2);
    overlay.write('/ws/a.txt', 'a', 1);

    expect(overlay.pendingPaths()).toEqual(['/ws/a.txt', '/ws/b.txt']);
    expect(overlay.entries()).toEqual([
      { kind: 'write', path: '/ws/a.txt', content: 'a', recordedAt: 1 },
      { kind: 'write', path: '/ws/b.txt', content: 'b', recordedAt: 2 },
    ]);
  });

  it('lets a later write win and a removal shadow an earlier write', () => {
    const overlay = new SpeculationOverlay();
    overlay.write('/ws/a.txt', 'first', 1);
    overlay.write('/ws/a.txt', 'second', 2);
    overlay.remove('/ws/a.txt', 3);
    overlay.write('/ws/b.txt', 'kept', 4);

    expect(overlay.entries()).toEqual([
      { kind: 'remove', path: '/ws/a.txt', recordedAt: 3 },
      { kind: 'write', path: '/ws/b.txt', content: 'kept', recordedAt: 4 },
    ]);
    expect(overlay.size()).toBe(2);
  });

  it('does not count rewriting the same path against the entry bound', () => {
    const overlay = new SpeculationOverlay(2);
    overlay.write('/ws/a.txt', 'one', 1);
    overlay.write('/ws/a.txt', 'two', 2);
    overlay.write('/ws/b.txt', 'b', 3);
    expect(() => overlay.write('/ws/c.txt', 'c', 4)).toThrow(SpeculationOverlayFullError);
  });

  it('refuses blank and oversized paths', () => {
    const overlay = new SpeculationOverlay();
    expect(() => overlay.write('   ', 'x')).toThrow(/empty/i);
    expect(() => overlay.write('x'.repeat(4097), 'x')).toThrow(/4096/);
  });

  it('forks a copy that inherits the parent operations without tracking the parent', () => {
    const parent = new SpeculationOverlay();
    parent.write('/ws/a.txt', 'base', 1);
    const child = parent.fork();
    child.write('/ws/b.txt', 'child', 2);

    expect(child.pendingPaths()).toEqual(['/ws/a.txt', '/ws/b.txt']);
    expect(parent.pendingPaths()).toEqual(['/ws/a.txt']);
    child.write('/ws/a.txt', 'overwritten-by-child', 3);
    expect(parent.entries()[0]).toMatchObject({ path: '/ws/a.txt', content: 'base' });
  });

  it('clears to empty', () => {
    const overlay = new SpeculationOverlay();
    overlay.write('/ws/a.txt', 'a');
    overlay.clear();
    expect(overlay.isEmpty()).toBe(true);
  });
});

describe('applyOverlay', () => {
  function target(): OverlayWriteTarget & { readonly files: Map<string, string>; readonly removed: string[] } {
    const files = new Map<string, string>();
    const removed: string[] = [];
    return {
      files,
      removed,
      writeFile: async (path, content) => {
        files.set(path, content);
      },
      removeFile: async (path) => {
        files.delete(path);
        removed.push(path);
      },
    };
  }

  it('copies writes and removals in sorted path order', async () => {
    const overlay = new SpeculationOverlay();
    overlay.write('/ws/b.txt', 'b', 1);
    overlay.write('/ws/a.txt', 'a', 2);
    overlay.remove('/ws/c.txt', 3);
    const store = target();

    const result = await applyOverlay(overlay, store);
    expect(result).toEqual({ applied: ['/ws/a.txt', '/ws/b.txt', '/ws/c.txt'] });
    expect(store.files.get('/ws/a.txt')).toBe('a');
    expect(store.files.get('/ws/b.txt')).toBe('b');
    expect(store.removed).toEqual(['/ws/c.txt']);
  });

  it('stops at the first failure and reports what was applied before it', async () => {
    const overlay = new SpeculationOverlay();
    overlay.write('/ws/1-ok.txt', 'ok', 1);
    overlay.write('/ws/2-broken.txt', 'broken', 2);
    overlay.write('/ws/3-never.txt', 'never', 3);
    const store = target();
    store.writeFile = async (path, content) => {
      if (path === '/ws/2-broken.txt') throw new Error('disk full');
      store.files.set(path, content);
    };

    const result = await applyOverlay(overlay, store);
    expect(result.applied).toEqual(['/ws/1-ok.txt']);
    expect(result.failed).toEqual({ path: '/ws/2-broken.txt', error: 'disk full' });
    expect(store.files.has('/ws/3-never.txt')).toBe(false);
  });

  it('applies an empty overlay as a no-op', async () => {
    const result = await applyOverlay(new SpeculationOverlay(), target());
    expect(result).toEqual({ applied: [] });
  });

  it('reports a failure instead of a silent success when the target cannot remove', async () => {
    const overlay = new SpeculationOverlay();
    overlay.remove('/ws/c.txt', 1);
    const store = target();
    const targetWithoutRemove: OverlayWriteTarget = { writeFile: store.writeFile };

    const result = await applyOverlay(overlay, targetWithoutRemove);
    expect(result).toEqual({
      applied: [],
      failed: { path: '/ws/c.txt', error: 'overlay target cannot remove files' },
    });
    expect(store.removed).toEqual([]);
  });

  it('applies writes before failing on a remove the target cannot perform', async () => {
    const overlay = new SpeculationOverlay();
    overlay.write('/ws/a.txt', 'a', 1);
    overlay.remove('/ws/b.txt', 2);
    const store = target();
    const targetWithoutRemove: OverlayWriteTarget = { writeFile: store.writeFile };

    const result = await applyOverlay(overlay, targetWithoutRemove);
    expect(result).toEqual({
      applied: ['/ws/a.txt'],
      failed: { path: '/ws/b.txt', error: 'overlay target cannot remove files' },
    });
    expect(store.files.get('/ws/a.txt')).toBe('a');
  });
});
