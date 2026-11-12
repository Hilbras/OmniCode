import { describe, expect, it } from 'vitest';

import { canonicalizeCommand } from '#/agent/permissionPolicy/commandCanonicalization';
import { actionFingerprint } from '#/agent/permissionPolicy/denialTracking';

describe('command canonicalization', () => {
  it('collapses shell wrappers with plain commands', () => {
    expect(canonicalizeCommand('/bin/bash -lc "ls -la"').canonical).toBe('ls -la');
    expect(canonicalizeCommand('bash -lc "ls -la"').canonical).toBe('ls -la');
    expect(canonicalizeCommand('ls -la').canonical).toBe('ls -la');
  });

  it('strips safe env prefixes but keeps unsafe ones', () => {
    expect(canonicalizeCommand('CI=1 NODE_ENV=test pnpm test').canonical).toBe('pnpm test');
    expect(canonicalizeCommand('LD_PRELOAD=/tmp/evil.so ls').canonical).toBe('LD_PRELOAD=/tmp/evil.so ls');
  });

  it('keeps complex scripts opaque and deterministic', () => {
    const first = canonicalizeCommand('echo ok && rm -rf /');
    const second = canonicalizeCommand('echo ok && rm -rf /');
    expect(first.kind).toBe('opaque');
    expect(first.canonical).toBe(second.canonical);
    expect(first.canonical).toMatch(/^opaque:[0-9a-f]{64}$/);
  });

  it('does not collapse distinct commands', () => {
    expect(canonicalizeCommand('ls a').canonical).not.toBe(canonicalizeCommand('ls b').canonical);
  });

  it('uses canonical form for Bash action fingerprints', () => {
    expect(actionFingerprint('Bash', { command: 'bash -lc "ls -la"' })).toBe(actionFingerprint('Bash', { command: 'ls -la' }));
    expect(actionFingerprint('Bash', { command: 'ls -la' })).not.toBe(actionFingerprint('Bash', { command: 'rm -rf x' }));
  });
});
