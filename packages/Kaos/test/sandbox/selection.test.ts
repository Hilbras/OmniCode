import { describe, expect, it } from 'vitest';

import { selectSandboxBackend } from '#/sandbox/selection';
import { createSandboxStatus, summarizeSandboxPolicy } from '#/sandbox/status';
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
    fallback: null,
    probes: [],
    checkedAt: 1,
    ...overrides,
  };
}

describe('selectSandboxBackend', () => {
  it('prefers bwrap and selects it for every permission mode', () => {
    for (const permissionMode of ['manual', 'auto', 'yolo'] as const) {
      const selection = selectSandboxBackend({
        permissionMode,
        availability: [availability('landlock', true), availability('bwrap', true)],
      });
      expect(selection.backend).toBe('bwrap');
      expect(selection.enabled).toBe(true);
      expect(selection.reason).toBe('sandbox-available');
      expect(selection.permissionMode).toBe(permissionMode);
    }
  });

  it('falls back to landlock when bwrap is unavailable', () => {
    const selection = selectSandboxBackend({
      permissionMode: 'auto',
      availability: [availability('bwrap', false), availability('landlock', true)],
    });
    expect(selection.backend).toBe('landlock');
    expect(selection.enabled).toBe(true);
  });

  it('records an explicit fallback when the default order downgrades', () => {
    const selection = selectSandboxBackend({
      permissionMode: 'auto',
      availability: [
        availability('bwrap', false, { reason: 'bwrap not found' }),
        availability('seatbelt', false, { reason: 'seatbelt requires darwin' }),
        availability('landlock', true),
      ],
    });
    expect(selection.backend).toBe('landlock');
    expect(selection.fallback).toEqual({
      from: 'bwrap',
      to: 'landlock',
      reason: 'bwrap not found',
    });
  });

  it('reports no fallback when the first preference is selected', () => {
    const selection = selectSandboxBackend({
      permissionMode: 'auto',
      availability: [availability('bwrap', true)],
    });
    expect(selection.fallback).toBeNull();
  });

  it('selects exactly the preferred backend when it is available', () => {
    const selection = selectSandboxBackend({
      permissionMode: 'auto',
      preferredBackend: 'seatbelt',
      availability: [availability('bwrap', true), availability('seatbelt', true)],
    });
    expect(selection.backend).toBe('seatbelt');
    expect(selection.enabled).toBe(true);
    expect(selection.reason).toBe('sandbox-available');
    expect(selection.fallback).toBeNull();
  });

  it('refuses to substitute another backend for an unavailable preferred backend', () => {
    const selection = selectSandboxBackend({
      permissionMode: 'auto',
      preferredBackend: 'seatbelt',
      availability: [
        availability('seatbelt', false, { reason: 'sandbox-exec probe failed' }),
        availability('bwrap', true),
      ],
    });
    expect(selection.backend).toBeNull();
    expect(selection.enabled).toBe(false);
    expect(selection.reason).toBe('preferred-backend-unavailable');
    expect(selection.message).toContain('seatbelt');
    expect(selection.message).toContain('sandbox-exec probe failed');
    expect(selection.message).toContain('refuses to substitute');
    expect(selection.fallback).toEqual({
      from: 'seatbelt',
      to: null,
      reason: 'sandbox-exec probe failed',
    });
  });

  it('reports a preferred backend that was never probed', () => {
    const selection = selectSandboxBackend({
      permissionMode: 'manual',
      preferredBackend: 'landlock',
      availability: [availability('bwrap', true)],
    });
    expect(selection.enabled).toBe(false);
    expect(selection.reason).toBe('preferred-backend-unavailable');
    expect(selection.fallback).toEqual({ from: 'landlock', to: null, reason: 'no availability probe ran for landlock' });
  });

  it('returns an explicit unsandboxed selection when nothing is available', () => {
    const manual = selectSandboxBackend({
      permissionMode: 'manual',
      availability: [availability('bwrap', false), availability('landlock', false)],
    });
    expect(manual.backend).toBeNull();
    expect(manual.enabled).toBe(false);
    expect(manual.reason).toBe('sandbox-unavailable');
    expect(manual.message).toContain('manual mode');
    expect(manual.fallback).toEqual({ from: 'bwrap', to: null, reason: 'bwrap unavailable' });

    const auto = selectSandboxBackend({
      permissionMode: 'auto',
      availability: [availability('bwrap', false)],
    });
    expect(auto.message).toContain('auto mode');

    const yolo = selectSandboxBackend({
      permissionMode: 'yolo',
      availability: [availability('bwrap', false)],
    });
    expect(yolo.message).toContain('yolo mode');
    expect(yolo.message).toContain('without OS isolation');
  });

  it('ignores availability entries that are unavailable or for unknown ordering', () => {
    const selection = selectSandboxBackend({
      permissionMode: 'auto',
      availability: [availability('bwrap', false), availability('landlock', false)],
    });
    expect(selection.availability).toBeNull();
  });
});

describe('createSandboxStatus', () => {
  it('reports backend, version, probes, policy, and fallback details', () => {
    const bwrap = availability('bwrap', true, {
      version: '0.9.2',
      probes: [
        {
          label: 'bwrap-version',
          command: 'bwrap',
          args: ['--version'],
          ok: true,
          exitCode: 0,
          stdout: 'bubblewrap 0.9.2',
          stderr: '',
          error: null,
        },
      ],
    });
    const selection = selectSandboxBackend({
      permissionMode: 'yolo',
      availability: [bwrap],
    });
    const status = createSandboxStatus({
      availability: bwrap,
      selection,
      policy: {
        workspace: '/workspace',
        cwd: '/workspace/sub',
        shareNetwork: true,
        sharePid: false,
        shareIpc: true,
      },
    });

    expect(status.backend).toBe('bwrap');
    expect(status.available).toBe(true);
    expect(status.version).toBe('0.9.2');
    expect(status.probes).toHaveLength(1);
    expect(status.permissionMode).toBe('yolo');
    expect(status.selection.backend).toBe('bwrap');
    expect(status.activePolicy).toMatchObject({
      workspace: '/workspace',
      cwd: '/workspace/sub',
      network: 'shared',
      pidNamespace: 'isolated',
      ipcNamespace: 'shared',
    });
  });

  it('reports fallback and reason for unavailable backends', () => {
    const landlock = availability('landlock', false, {
      reason: 'landlock needs a native bridge',
      fallback: 'bwrap',
    });
    const selection = selectSandboxBackend({
      permissionMode: 'auto',
      availability: [landlock],
    });
    const status = createSandboxStatus({ availability: landlock, selection });
    expect(status.available).toBe(false);
    expect(status.reason).toBe('landlock needs a native bridge');
    expect(status.fallback).toBe('bwrap');
    expect(status.activePolicy).toBeNull();
  });

  it('summarizes default policy mounts and namespace choices', () => {
    const summary = summarizeSandboxPolicy({ workspace: '/workspace' });
    expect(summary.network).toBe('denied');
    expect(summary.pidNamespace).toBe('isolated');
    expect(summary.ipcNamespace).toBe('isolated');
    expect(summary.systemPaths).toContain('/usr');
    expect(summary.tmpfsPaths).toEqual(['/tmp']);
    expect(summary.denyReadPaths).toEqual([]);
  });

  it('summarizes deny-read paths', () => {
    const summary = summarizeSandboxPolicy({
      workspace: '/workspace',
      denyReadPaths: ['/workspace/.env', '/workspace/.env'],
    });
    expect(summary.denyReadPaths).toEqual(['/workspace/.env']);
  });
});
