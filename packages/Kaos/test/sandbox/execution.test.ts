import { describe, expect, it } from 'vitest';

import { createSandboxExecutionPlan } from '#/sandbox/execution';
import type { SandboxAvailability, SandboxBackendKind } from '#/sandbox/types';

function availability(
  backend: SandboxBackendKind,
  available: boolean,
  overrides: Partial<SandboxAvailability> = {},
): SandboxAvailability {
  return {
    backend,
    available,
    version: available ? '0.9.0' : null,
    reason: available ? null : `${backend} unavailable`,
    fallback: available ? null : 'bwrap',
    probes: [],
    checkedAt: 1,
    ...overrides,
  };
}

describe('createSandboxExecutionPlan', () => {
  it('combines shell policy and bwrap argv into an executable plan', () => {
    const result = createSandboxExecutionPlan({
      backend: 'bwrap',
      availability: availability('bwrap', true),
      permissionMode: 'auto',
      policy: { workspace: '/workspace' },
      request: { command: 'node', args: ['-e', 'console.log(1)'] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.backend).toBe('bwrap');
    expect(result.value.permissionMode).toBe('auto');
    expect(result.value.command).toBe('bwrap');
    expect(result.value.cwd).toBe('/workspace');
    expect(result.value.args).toContain('--unshare-net');
    expect(result.value.args).toContain('--bind');
    expect(result.value.args.slice(-4)).toEqual(['--', 'node', '-e', 'console.log(1)']);
  });

  it('rejects an unavailable backend with explicit fallback details', () => {
    const result = createSandboxExecutionPlan({
      backend: 'bwrap',
      availability: availability('bwrap', false),
      permissionMode: 'yolo',
      policy: { workspace: '/workspace' },
      request: { command: 'true' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('backend-unavailable');
      expect(result.detail?.['fallback']).toBe('bwrap');
      expect(result.message).toContain('bwrap unavailable');
    }
  });

  it('rejects a mismatch between the requested backend and availability', () => {
    const result = createSandboxExecutionPlan({
      backend: 'bwrap',
      availability: availability('landlock', true),
      permissionMode: 'auto',
      policy: { workspace: '/workspace' },
      request: { command: 'true' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid-request');
  });

  it('does not fake landlock enforcement', () => {
    const result = createSandboxExecutionPlan({
      backend: 'landlock',
      availability: availability('landlock', true),
      permissionMode: 'auto',
      policy: { workspace: '/workspace' },
      request: { command: 'true' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('backend-unavailable');
      expect(result.detail?.['fallback']).toBe('bwrap');
    }
  });

  it('denies shell metacharacters before building bwrap argv', () => {
    const result = createSandboxExecutionPlan({
      backend: 'bwrap',
      availability: availability('bwrap', true),
      permissionMode: 'manual',
      policy: { workspace: '/workspace' },
      request: { command: 'echo; id' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('policy-denied');
      expect(result.detail?.['denial']).toBe('shell-metacharacter');
    }
  });

  it('denies shell mode by default', () => {
    const result = createSandboxExecutionPlan({
      backend: 'bwrap',
      availability: availability('bwrap', true),
      permissionMode: 'auto',
      policy: { workspace: '/workspace' },
      request: { command: 'echo hi', mode: 'shell' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('policy-denied');
      expect(result.detail?.['denial']).toBe('shell-mode-disabled');
    }
  });

  it('allows shell mode only when explicitly enabled and still uses argv', () => {
    const result = createSandboxExecutionPlan({
      backend: 'bwrap',
      availability: availability('bwrap', true),
      permissionMode: 'auto',
      policy: { workspace: '/workspace' },
      request: { command: 'echo hi', mode: 'shell' },
      shellPolicy: { mode: 'argv', allowShell: true, shellPath: '/bin/sh' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.args.slice(-4)).toEqual(['--', '/bin/sh', '-c', 'echo hi']);
    }
  });

  it('rejects cwd escapes through the bwrap builder', () => {
    const result = createSandboxExecutionPlan({
      backend: 'bwrap',
      availability: availability('bwrap', true),
      permissionMode: 'auto',
      policy: { workspace: '/workspace', cwd: '/etc' },
      request: { command: 'true' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('path-escape');
  });

  it('maps NUL arguments to an invalid request', () => {
    const result = createSandboxExecutionPlan({
      backend: 'bwrap',
      availability: availability('bwrap', true),
      permissionMode: 'auto',
      policy: { workspace: '/workspace' },
      request: { command: 'echo', args: ['bad\0arg'] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid-request');
  });

  it('builds a seatbelt plan with the sandbox-exec command', () => {
    const result = createSandboxExecutionPlan({
      backend: 'seatbelt',
      availability: availability('seatbelt', true),
      permissionMode: 'auto',
      policy: { workspace: '/workspace' },
      request: { command: 'node', args: ['build.js'] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.command).toBe('/usr/bin/sandbox-exec');
    expect(result.value.backend).toBe('seatbelt');
    expect(result.value.cwd).toBe('/workspace');
    expect(result.value.args[0]).toBe('/usr/bin/sandbox-exec');
    expect(result.value.args[2]).toContain('(deny default)');
    expect(result.value.args.slice(-3)).toEqual(['--', 'node', 'build.js']);
  });

  it('builds a seatbelt plan that denies configured reads', () => {
    const result = createSandboxExecutionPlan({
      backend: 'seatbelt',
      availability: availability('seatbelt', true),
      permissionMode: 'auto',
      policy: { workspace: '/workspace', denyReadPaths: ['/workspace/.env'] },
      request: { command: 'cat', args: ['.env'] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.args.join('\n')).toContain('(deny file-read* (subpath "/workspace/.env"))');
  });

  it('rejects deny-read policies on the bwrap backend as unsupported', () => {
    const result = createSandboxExecutionPlan({
      backend: 'bwrap',
      availability: availability('bwrap', true),
      permissionMode: 'auto',
      policy: { workspace: '/workspace', denyReadPaths: ['/workspace/.env'] },
      request: { command: 'cat', args: ['.env'] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('unsupported-operation');
      expect(result.message).toContain('bwrap cannot express read denial');
    }
  });
});
