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