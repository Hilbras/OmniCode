import { describe, expect, it } from 'vitest';

import { countLineDelta, countTextLines, isBinaryText, turnDiffPath } from '#/agent/turnDiff/turnDiffOps';
import { TurnDiffTracker } from '#/agent/turnDiff/turnDiffTracker';

describe('turnDiffPath', () => {
  it('relativizes absolute paths inside the workspace', () => {
    expect(turnDiffPath('/ws/src/a.ts', '/ws')).toEqual({
      key: 'src/a.ts',
      absolute: '/ws/src/a.ts',
    });
  });

  it('keeps outside absolute paths and resolves relative paths against the workspace', () => {
    expect(turnDiffPath('/tmp/a.ts', '/ws').key).toBe('/tmp/a.ts');
    expect(turnDiffPath('src/a.ts', '/ws')).toEqual({
      key: 'src/a.ts',
      absolute: '/ws/src/a.ts',
    });
  });
});

describe('turn diff line counting', () => {
  it('counts lines without treating a trailing newline as an extra line', () => {
    expect(countTextLines('')).toBe(0);
    expect(countTextLines('a\n')).toBe(1);
    expect(countTextLines('a\nb')).toBe(2);
  });

  it('reports additions and deletions from a line diff', () => {
    expect(countLineDelta('one\n', 'ONE\n')).toEqual({ additions: 1, deletions: 1 });
    expect(countLineDelta('one\ntwo\n', 'one\ntwo\nthree\n')).toEqual({
      additions: 1,
      deletions: 0,
    });
  });

  it('detects binary text', () => {
    expect(isBinaryText('a\u0000b')).toBe(true);
    expect(isBinaryText('plain')).toBe(false);
  });
});

describe('TurnDiffTracker', () => {
  it('records added, modified, and deleted files per turn', () => {
    const tracker = new TurnDiffTracker();
    tracker.begin(1);
    tracker.noteBefore(1, 'a.txt', '/ws/a.txt', { captured: true, content: 'one\n' });
    tracker.noteAfter(1, 'a.txt', '/ws/a.txt', { captured: true, content: 'ONE\n' });
    tracker.noteBefore(1, 'b.txt', '/ws/b.txt', { captured: true });
    tracker.noteAfter(1, 'b.txt', '/ws/b.txt', { captured: true, content: 'two\nlines\n' });
    tracker.noteBefore(1, 'c.txt', '/ws/c.txt', { captured: true, content: 'bye\n' });
    tracker.noteAfter(1, 'c.txt', '/ws/c.txt', { captured: true });

    const snapshot = tracker.snapshot(1);
    expect(snapshot).toMatchObject({ turnId: 1, state: 'open', additions: 3, deletions: 2 });
    expect(snapshot?.files).toEqual([
      { path: 'a.txt', status: 'modified', additions: 1, deletions: 1 },
      { path: 'b.txt', status: 'added', additions: 2, deletions: 0 },
      { path: 'c.txt', status: 'deleted', additions: 0, deletions: 1 },
    ]);
  });

  it('omits a file whose content did not change', () => {
    const tracker = new TurnDiffTracker();
    tracker.noteBefore(1, 'a.txt', '/ws/a.txt', { captured: true, content: 'same\n' });
    tracker.noteAfter(1, 'a.txt', '/ws/a.txt', { captured: true, content: 'same\n' });
    expect(tracker.snapshot(1)?.files).toEqual([]);
  });

  it('keeps the first pre-write capture and flags binary and oversize files', () => {
    const tracker = new TurnDiffTracker();
    tracker.noteBefore(1, 'a.txt', '/ws/a.txt', { captured: true, content: 'before\n' });
    tracker.noteBefore(1, 'a.txt', '/ws/a.txt', { captured: true, content: 'later\n' });
    tracker.noteAfter(1, 'a.txt', '/ws/a.txt', { captured: true, content: 'after\n' });
    tracker.noteBefore(1, 'b.bin', '/ws/b.bin', { captured: true, content: 'a\u0000b' });
    tracker.noteAfter(1, 'b.bin', '/ws/b.bin', { captured: true, content: 'a\u0000c' });
    tracker.noteBefore(1, 'big.txt', '/ws/big.txt', { captured: true, oversize: true });
    tracker.noteAfter(1, 'big.txt', '/ws/big.txt', { captured: true, oversize: true });

    const files = tracker.snapshot(1)?.files ?? [];
    expect(files.find((file) => file.path === 'a.txt')).toMatchObject({ additions: 1, deletions: 1 });
    expect(files.find((file) => file.path === 'b.bin')).toMatchObject({ binary: true });
    expect(files.find((file) => file.path === 'big.txt')).toMatchObject({ oversize: true });
  });

  it('closes a turn and retains bounded history', () => {
    const tracker = new TurnDiffTracker();
    tracker.begin(1);
    tracker.noteBefore(1, 'a.txt', '/ws/a.txt', { captured: true, content: 'a\n' });
    tracker.noteAfter(1, 'a.txt', '/ws/a.txt', { captured: true, content: 'b\n' });
    expect(tracker.activeTurn()).toBe(1);
    const closed = tracker.close(1);
    expect(closed?.state).toBe('closed');
    expect(tracker.activeTurn()).toBeUndefined();
    expect(tracker.closedSnapshots()).toEqual([closed]);
    expect(tracker.latestTurn()).toBe(1);
  });
});

describe('TurnDiffTracker render inputs', () => {
  it('feeds the renderer only changed, renderable files with empty strings for missing sides', () => {
    const tracker = new TurnDiffTracker();
    tracker.begin(1);
    tracker.noteBefore(1, 'a.txt', '/ws/a.txt', { captured: true, content: 'one\n' });
    tracker.noteAfter(1, 'a.txt', '/ws/a.txt', { captured: true, content: 'ONE\n' });
    tracker.noteBefore(1, 'b.bin', '/ws/b.bin', { captured: true, content: 'a\u0000b' });
    tracker.noteAfter(1, 'b.bin', '/ws/b.bin', { captured: true, content: 'a\u0000c' });
    tracker.noteBefore(1, 'big.txt', '/ws/big.txt', { captured: true, oversize: true });
    tracker.noteAfter(1, 'big.txt', '/ws/big.txt', { captured: true, oversize: true });
    tracker.noteBefore(1, 'same.txt', '/ws/same.txt', { captured: true, content: 'equal\n' });
    tracker.noteAfter(1, 'same.txt', '/ws/same.txt', { captured: true, content: 'equal\n' });
    tracker.noteBefore(1, 'd.txt', '/ws/d.txt', { captured: true });
    tracker.noteAfter(1, 'd.txt', '/ws/d.txt', { captured: true, content: 'new\n' });
    tracker.noteBefore(1, 'e.txt', '/ws/e.txt', { captured: true, content: 'gone\n' });
    tracker.noteAfter(1, 'e.txt', '/ws/e.txt', { captured: true });

    expect(tracker.diffInputs('latest')).toEqual([
      { path: 'a.txt', before: 'one\n', after: 'ONE\n' },
      { path: 'd.txt', before: '', after: 'new\n' },
      { path: 'e.txt', before: 'gone\n', after: '' },
    ]);
  });

  it('merges the session scope across turns: first pre-image wins, last post-image wins', () => {
    const tracker = new TurnDiffTracker();
    tracker.begin(1);
    tracker.noteBefore(1, 'a.txt', '/ws/a.txt', { captured: true, content: 'one\n' });
    tracker.noteAfter(1, 'a.txt', '/ws/a.txt', { captured: true, content: 'two\n' });
    tracker.close(1);
    tracker.begin(2);
    tracker.noteBefore(2, 'a.txt', '/ws/a.txt', { captured: true, content: 'two\n' });
    tracker.noteAfter(2, 'a.txt', '/ws/a.txt', { captured: true, content: 'three\n' });
    tracker.close(2);

    expect(tracker.diffInputs('session')).toEqual([
      { path: 'a.txt', before: 'one\n', after: 'three\n' },
    ]);
    expect(tracker.diffInputs('latest')).toEqual([
      { path: 'a.txt', before: 'two\n', after: 'three\n' },
    ]);
  });

  it('a path reverted to its original content drops out of the session scope', () => {
    const tracker = new TurnDiffTracker();
    tracker.begin(1);
    tracker.noteBefore(1, 'a.txt', '/ws/a.txt', { captured: true, content: 'p\n' });
    tracker.noteAfter(1, 'a.txt', '/ws/a.txt', { captured: true, content: 'q\n' });
    tracker.close(1);
    tracker.begin(2);
    tracker.noteBefore(2, 'a.txt', '/ws/a.txt', { captured: true, content: 'q\n' });
    tracker.noteAfter(2, 'a.txt', '/ws/a.txt', { captured: true, content: 'p\n' });
    tracker.close(2);

    expect(tracker.diffInputs('session')).toEqual([]);
    expect(tracker.diffInputs('latest')).toEqual([
      { path: 'a.txt', before: 'q\n', after: 'p\n' },
    ]);
  });

  it('files() keeps binary and oversize entries that diffInputs omits', () => {
    const tracker = new TurnDiffTracker();
    tracker.begin(1);
    tracker.noteBefore(1, 'b.bin', '/ws/b.bin', { captured: true, content: 'a\u0000b' });
    tracker.noteAfter(1, 'b.bin', '/ws/b.bin', { captured: true, content: 'a\u0000c' });
    tracker.noteBefore(1, 'big.txt', '/ws/big.txt', { captured: true, oversize: true });
    tracker.noteAfter(1, 'big.txt', '/ws/big.txt', { captured: true, oversize: true });
    tracker.noteBefore(1, 'a.txt', '/ws/a.txt', { captured: true, content: 'one\n' });
    tracker.noteAfter(1, 'a.txt', '/ws/a.txt', { captured: true, content: 'ONE\n' });

    expect(tracker.files('latest')).toEqual([
      { path: 'a.txt', status: 'modified', additions: 1, deletions: 1 },
      { path: 'b.bin', status: 'modified', additions: 0, deletions: 0, binary: true },
      { path: 'big.txt', status: 'modified', additions: 0, deletions: 0, oversize: true },
    ]);
  });

  it('excludes a path whose changed region exceeds the line-delta budget, so the oversize note stays truthful', () => {
    const tracker = new TurnDiffTracker();
    tracker.begin(1);
    // 2600 x 1700 changed-middle cells (4.42M) exceeds the tracker's 4M-cell
    // LCS budget while the file itself is far below the 1MB capture cap —
    // `files()` flags it oversize, so the renderer must not also render it.
    tracker.noteBefore(
      1,
      'big-delta.txt',
      '/ws/big-delta.txt',
      {
        captured: true,
        content: [
          ...Array.from({ length: 10 }, (_, index) => `head ${String(index)}`),
          ...Array.from({ length: 2600 }, (_, index) => `old ${String(index)}`),
          ...Array.from({ length: 10 }, (_, index) => `tail ${String(index)}`),
        ].join('\n'),
      },
    );
    tracker.noteAfter(
      1,
      'big-delta.txt',
      '/ws/big-delta.txt',
      {
        captured: true,
        content: [
          ...Array.from({ length: 10 }, (_, index) => `head ${String(index)}`),
          ...Array.from({ length: 1700 }, (_, index) => `new ${String(index)}`),
          ...Array.from({ length: 10 }, (_, index) => `tail ${String(index)}`),
        ].join('\n'),
      },
    );

    expect(tracker.diffInputs('latest')).toEqual([]);
    expect(tracker.files('latest')).toEqual([
      { path: 'big-delta.txt', status: 'modified', additions: 0, deletions: 0, oversize: true },
    ]);
  });

  it('returns empty inputs and files when nothing was tracked', () => {
    const tracker = new TurnDiffTracker();
    expect(tracker.diffInputs('latest')).toEqual([]);
    expect(tracker.diffInputs('session')).toEqual([]);
    expect(tracker.files('latest')).toEqual([]);
    expect(tracker.files('session')).toEqual([]);
  });
});