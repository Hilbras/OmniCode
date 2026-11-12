import { describe, expect, it } from 'vitest';

import { RecentlyTouchedFilesTracker } from '#/agent/fullCompaction/touchedFilesTracker';

describe('RecentlyTouchedFilesTracker', () => {
  it('records reads and writes and lists most recent first', () => {
    const tracker = new RecentlyTouchedFilesTracker();
    expect(tracker.record('Read', { file_path: '/a.ts' }, false)).toBe(true);
    expect(tracker.record('Write', { file_path: '/b.ts' }, false)).toBe(true);
    expect(tracker.list()).toEqual([
      { path: '/b.ts', lastOperation: 'write' },
      { path: '/a.ts', lastOperation: 'read' },
    ]);
  });

  it('ignores failed calls, unrelated tools, and missing paths', () => {
    const tracker = new RecentlyTouchedFilesTracker();
    expect(tracker.record('Read', { file_path: '/a.ts' }, true)).toBe(false);
    expect(tracker.record('Grep', { pattern: 'x' }, false)).toBe(false);
    expect(tracker.record('Read', {}, false)).toBe(false);
    expect(tracker.record('Read', { path: '  ' }, false)).toBe(false);
    expect(tracker.list()).toEqual([]);
  });

  it('keeps a write when a later read touches the same file', () => {
    const tracker = new RecentlyTouchedFilesTracker();
    tracker.record('Write', { file_path: '/a.ts' }, false);
    tracker.record('Read', { file_path: '/a.ts' }, false);
    expect(tracker.list()).toEqual([{ path: '/a.ts', lastOperation: 'write' }]);
  });

  it('accepts Edit and notebook paths', () => {
    const tracker = new RecentlyTouchedFilesTracker();
    tracker.record('Edit', { path: '/a.ts' }, false);
    tracker.record('NotebookEdit', { notebook_path: '/n.ipynb' }, false);
    expect(tracker.list().map((file) => file.lastOperation)).toEqual(['write', 'write']);
  });

  it('bounds the number of tracked paths, dropping the least recent', () => {
    const tracker = new RecentlyTouchedFilesTracker(2);
    tracker.record('Read', { file_path: '/a' }, false);
    tracker.record('Read', { file_path: '/b' }, false);
    tracker.record('Read', { file_path: '/c' }, false);
    expect(tracker.list().map((file) => file.path)).toEqual(['/c', '/b']);
  });

  it('clear empties the tracker', () => {
    const tracker = new RecentlyTouchedFilesTracker();
    tracker.record('Read', { file_path: '/a' }, false);
    tracker.clear();
    expect(tracker.list()).toEqual([]);
  });
});
