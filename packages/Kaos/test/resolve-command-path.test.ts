import { mkdtempSync, chmodSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isInsideCwd, resolveCommandPath } from '../src/resolve-command-path';

function executable(dir: string, name: string): string {
  const path = join(dir, name);
  writeFileSync(path, '#!/bin/sh\necho ok\n');
  chmodSync(path, 0o755);
  return path;
}

describe('resolveCommandPath', () => {
  it('resolves a command from PATH', () => {
    const bin = mkdtempSync(join(tmpdir(), 'kaos-bin-'));
    const expected = executable(bin, 'tool');
    const cwd = mkdtempSync(join(tmpdir(), 'kaos-cwd-'));
    expect(resolveCommandPath('tool', cwd, 'linux', { PATH: bin })).toBe(expected);
  });

  it('refuses a PATH hit inside cwd (pre-trust binary planting)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'kaos-cwd-'));
    executable(cwd, 'planted');
    expect(resolveCommandPath('planted', cwd, 'linux', { PATH: cwd })).toBeUndefined();
    expect(isInsideCwd(join(cwd, 'planted'), cwd, 'linux')).toBe(true);
  });

  it('returns undefined for a missing command', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'kaos-cwd-'));
    expect(resolveCommandPath('missing', cwd, 'linux', { PATH: '/nonexistent' })).toBeUndefined();
  });
});
