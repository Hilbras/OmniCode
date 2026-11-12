import { describe, expect, it } from 'vitest';

import { summarizeSandboxPolicy } from '#/sandbox/status';

describe('sandbox policy summary', () => {
  it('reports whether the workspace is fully writable or write-allowlisted', () => {
    expect(summarizeSandboxPolicy({ workspace: '/workspace' }).writeAllowlist).toBeNull();
    expect(
      summarizeSandboxPolicy({ workspace: '/workspace', writeAllowlist: ['/workspace/src'] }).writeAllowlist,
    ).toEqual(['/workspace/src']);
  });
});
