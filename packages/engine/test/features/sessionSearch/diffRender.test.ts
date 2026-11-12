import { describe, expect, it } from 'vitest';

import { diffLines, renderDiffs } from '#/features/sessionSearch/diffRender';

describe('diffLines', () => {
  it('keeps unchanged lines and pairs removals with additions', () => {
    const ops = diffLines(['a', 'b', 'c'], ['a', 'x', 'c'], 1000);
    expect(ops.map((op) => `${op.kind}:${op.line}`)).toEqual([
      'same:a',
      'remove:b',
      'add:x',
      'same:c',
    ]);
  });

  it('falls back to whole-region replacement above the cell budget', () => {
    const ops = diffLines(['a', 'b'], ['x', 'y'], 0);
    expect(ops.map((op) => op.kind)).toEqual(['remove', 'remove', 'add', 'add']);
  });
});

describe('renderDiffs', () => {
  it('reports no changes without a body', () => {
    const result = renderDiffs([{ path: 'a.ts', before: 'same\n', after: 'same\n' }]);
    expect(result.text).toBe('No changes.');
    expect(result.truncated).toBe(false);
  });

  it('renders a unified diff with a summary header', () => {
    const result = renderDiffs([{ path: 'a.ts', before: 'one\ntwo\n', after: 'one\nTWO\n' }]);
    expect(result.text).toContain('Diff: 1 file(s) changed, +1 -1');
    expect(result.text).toContain('--- a/a.ts');
    expect(result.text).toContain('-two');
    expect(result.text).toContain('+TWO');
    expect(result.summaries[0]).toEqual({ path: 'a.ts', added: 1, removed: 1, unchanged: false });
  });

  it('elides the middle of a hunk that exceeds the per-hunk cap', () => {
    // Replace every line so the whole file is one hunk.
    const before = Array.from({ length: 50 }, (_, index) => `line ${String(index)}`);
    const after = before.map((line) => `${line} changed`);
    const result = renderDiffs([{ path: 'big.ts', before: before.join('\n'), after: after.join('\n') }], {
      maxLinesPerHunk: 5,
    });
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('more line(s) in this hunk');
  });

  it('stops at the global line cap and says so', () => {
    const before = Array.from({ length: 100 }, () => 'x');
    const after = Array.from({ length: 100 }, () => 'y');
    const result = renderDiffs([{ path: 'a', before: before.join('\n'), after: after.join('\n') }], {
      maxLines: 20,
      maxLinesPerHunk: 200,
    });
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('(diff truncated at 20 lines)');
    expect(result.text.split('\n').length).toBeLessThanOrEqual(25);
  });

  it('clips extremely long lines', () => {
    const result = renderDiffs(
      [{ path: 'min.js', before: 'a\n', after: `${'z'.repeat(1000)}\n` }],
      { maxLineChars: 20 },
    );
    expect(result.text).toContain('(+980 chars)');
  });
});
