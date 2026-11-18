import { describe, expect, it } from 'vitest';

import { parseShellAliases, shellSnapshotEnv } from '#/app/shellSnapshot/shellSnapshot';

describe('shell snapshot', () => {
  it('keeps alias definitions and drops everything else', () => {
    const output = [
      "alias ll='ls -alF'",
      'alias gs=git-status',
      'function deploy() { echo hi; }',
      'export SECRET=1',
      '',
      "alias ls='ls --color=auto'",
    ].join('\n');
    expect(parseShellAliases(output)).toEqual([
      "alias ll='ls -alF'",
      'alias gs=git-status',
      "alias ls='ls --color=auto'",
    ]);
  });

  it('exposes nothing until a snapshot exists', () => {
    expect(shellSnapshotEnv()).toEqual({});
  });
});
