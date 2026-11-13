import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearChildSandboxProbeCache,
  childSandboxDenyReadPaths,
  childSandboxNetworkShared,
  childSandboxWriteRoots,
  prepareChildSandboxSpawn,
  resolveChildSandboxBackendPreference,
  resolveChildSandboxMode,
} from '#/os/sandbox/childSandbox';
import type { SandboxAvailability } from '@hilbras/omnicode-kaos/sandbox';

function availability(backend: SandboxAvailability['backend'], available: boolean): SandboxAvailability {
  return {
    backend,
    available,
    version: available ? '1.0.0' : null,
    reason: available ? null : `${backend} unavailable`,
    fallback: null,
    probes: [],
    checkedAt: 1,
  };
}

const bwrapAvailable = (): Promise<readonly SandboxAvailability[]> =>
  Promise.resolve([availability('bwrap', true), availability('landlock', false), availability('seatbelt', false)]);

const nothingAvailable = (): Promise<readonly SandboxAvailability[]> =>
  Promise.resolve([availability('bwrap', false), availability('landlock', false), availability('seatbelt', false)]);

const request = { argv: ['node', 'server.js'], cwd: '/workspace', workspace: '/workspace' };

afterEach(() => {
  clearChildSandboxProbeCache();
});

describe('child sandbox env parsing', () => {
  it('defaults to off and ignores junk modes', () => {
    expect(resolveChildSandboxMode({})).toBe('off');
    expect(resolveChildSandboxMode({ OMNICODE_SANDBOX_MODE: 'REQUIRED' })).toBe('required');
    expect(resolveChildSandboxMode({ OMNICODE_SANDBOX_MODE: 'sometimes' })).toBe('off');
  });

  it('parses the backend preference, write roots, deny-read paths, and network switch', () => {
    expect(resolveChildSandboxBackendPreference({ OMNICODE_SANDBOX_BACKEND: 'Seatbelt' })).toBe('seatbelt');
    expect(resolveChildSandboxBackendPreference({ OMNICODE_SANDBOX_BACKEND: 'nope' })).toBeUndefined();
    expect(childSandboxWriteRoots({ OMNICODE_SANDBOX_WRITE_ROOTS: '/w/src, relative, /w/test' })).toEqual([
      '/w/src',
      'relative',
      '/w/test',
    ]);
    expect(childSandboxDenyReadPaths({ OMNICODE_SANDBOX_DENY_READ: '/w/.env*, /home/x/.aws' })).toEqual([
      '/w/.env*',
      '/home/x/.aws',
    ]);
    expect(childSandboxNetworkShared({ OMNICODE_SANDBOX_NETWORK: 'shared' })).toBe(true);
    expect(childSandboxNetworkShared({})).toBe(false);
  });
});

describe('prepareChildSandboxSpawn', () => {
  it('returns direct without probing when the mode is off', async () => {
    const probe = vi.fn(bwrapAvailable);
    const prepared = await prepareChildSandboxSpawn(request, { env: {}, probe });
    expect(prepared).toEqual({ kind: 'direct' });
    expect(probe).not.toHaveBeenCalled();
  });

  it('wraps the argv in a bwrap plan when available in auto mode', async () => {
    const prepared = await prepareChildSandboxSpawn(request, { env: { OMNICODE_SANDBOX_MODE: 'auto' }, probe: bwrapAvailable });
    expect(prepared.kind).toBe('sandbox');
    if (prepared.kind !== 'sandbox') return;
    expect(prepared.command).toBe('bwrap');
    expect(prepared.cwd).toBe('/workspace');
    expect(prepared.args).toContain('--unshare-net');
    expect(prepared.args.slice(-3)).toEqual(['--', 'node', 'server.js']);
  });

  it('carries write roots and deny-read paths from env into the policy', async () => {
    const prepared = await prepareChildSandboxSpawn(request, {
      env: {
        OMNICODE_SANDBOX_MODE: 'auto',
        OMNICODE_SANDBOX_WRITE_ROOTS: '/workspace/out',
      },
      probe: bwrapAvailable,
    });
    expect(prepared.kind).toBe('sandbox');
    if (prepared.kind !== 'sandbox') return;
    expect(prepared.args).toContain('--ro-bind');
    expect(prepared.args).toContain('--bind-try');
    expect(prepared.args).toEqual(expect.arrayContaining(['--bind-try', '/workspace/out', '/workspace/out']));
  });

  it('falls back to direct with the explicit selection reason when nothing is available', async () => {
    const prepared = await prepareChildSandboxSpawn(request, { env: { OMNICODE_SANDBOX_MODE: 'auto' }, probe: nothingAvailable });
    expect(prepared.kind).toBe('direct');
    if (prepared.kind !== 'direct') return;
    expect(prepared.reason).toContain('no OS sandbox backend is available');
  });

  it('denies in required mode when nothing is available', async () => {
    const prepared = await prepareChildSandboxSpawn(request, { env: { OMNICODE_SANDBOX_MODE: 'required' }, probe: nothingAvailable });
    expect(prepared.kind).toBe('denied');
    if (prepared.kind !== 'denied') return;
    expect(prepared.message).toContain('no OS sandbox backend is available');
  });

  it('uses the preferred backend when it is available', async () => {
    const probe = (): Promise<readonly SandboxAvailability[]> =>
      Promise.resolve([availability('seatbelt', true), availability('bwrap', true)]);
    const prepared = await prepareChildSandboxSpawn(request, {
      env: { OMNICODE_SANDBOX_MODE: 'auto', OMNICODE_SANDBOX_BACKEND: 'seatbelt' },
      probe,
    });
    expect(prepared.kind).toBe('sandbox');
    if (prepared.kind !== 'sandbox') return;
    expect(prepared.command).toBe('/usr/bin/sandbox-exec');
  });

  it('refuses to substitute another backend for an unavailable preferred backend', async () => {
    const probe = (): Promise<readonly SandboxAvailability[]> =>
      Promise.resolve([availability('seatbelt', false), availability('bwrap', true)]);
    const auto = await prepareChildSandboxSpawn(request, {
      env: { OMNICODE_SANDBOX_MODE: 'auto', OMNICODE_SANDBOX_BACKEND: 'seatbelt' },
      probe,
    });
    expect(auto.kind).toBe('direct');
    if (auto.kind === 'direct') expect(auto.reason).toContain('refuses to substitute');

    const required = await prepareChildSandboxSpawn(request, {
      env: { OMNICODE_SANDBOX_MODE: 'required', OMNICODE_SANDBOX_BACKEND: 'seatbelt' },
      probe,
    });
    expect(required.kind).toBe('denied');
  });

  it('falls back to direct with the plan failure reason when the policy cannot be expressed', async () => {
    const prepared = await prepareChildSandboxSpawn(
      { ...request, denyReadPaths: ['/workspace/.env'] },
      { env: { OMNICODE_SANDBOX_MODE: 'auto' }, probe: bwrapAvailable },
    );
    expect(prepared.kind).toBe('direct');
    if (prepared.kind === 'direct') {
      expect(prepared.reason).toContain('bwrap cannot express read denial');
    }
    const required = await prepareChildSandboxSpawn(
      { ...request, denyReadPaths: ['/workspace/.env'] },
      { env: { OMNICODE_SANDBOX_MODE: 'required' }, probe: bwrapAvailable },
    );
    expect(required.kind).toBe('denied');
  });

  it('fails closed when a configured write root is not absolute instead of dropping it', async () => {
    const env = { OMNICODE_SANDBOX_MODE: 'auto', OMNICODE_SANDBOX_WRITE_ROOTS: 'relative/path' };
    const auto = await prepareChildSandboxSpawn(request, { env, probe: bwrapAvailable });
    expect(auto.kind).toBe('direct');
    if (auto.kind === 'direct') {
      expect(auto.reason).toContain('must be an absolute path: relative/path');
    }
    const required = await prepareChildSandboxSpawn(request, {
      env: { ...env, OMNICODE_SANDBOX_MODE: 'required' },
      probe: bwrapAvailable,
    });
    expect(required.kind).toBe('denied');
  });
});
