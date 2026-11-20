import { describe, expect, it } from 'vitest';

import {
  resolveEvictionPaths,
  type ToolCallIdentity,
} from '#/agent/contextMemory/microcompactionIdentity';

const call = (overrides: Partial<ToolCallIdentity> = {}): ToolCallIdentity => ({
  id: 'c1', name: 'Read', parseable: true, paths: ['a.ts'], ...overrides,
});

describe('resolveEvictionPaths', () => {
  it('accumulates and deduplicates all parseable paths', () => {
    const result = resolveEvictionPaths([
      call({ paths: ['a.ts', 'b.ts'] }),
      call({ id: 'c2', paths: ['b.ts'] }),
    ]);
    expect(result.paths).toEqual(['a.ts', 'b.ts']);
    expect(result.failedClosed).toBe(false);
  });

  it('fails closed when a reused id has an unparseable sibling', () => {
    const result = resolveEvictionPaths([
      call({ paths: ['a.ts'] }),
      call({ parseable: false, paths: [] }),
    ]);
    expect(result.failedClosed).toBe(true);
    expect(result.paths).toEqual([]);
    expect(result.reason).toContain('unparseable sibling');
  });

  it('returns no paths for no calls or calls without paths', () => {
    expect(resolveEvictionPaths([]).paths).toEqual([]);
    expect(resolveEvictionPaths([call({ paths: [] })]).reason).toContain('no file paths');
  });
});
