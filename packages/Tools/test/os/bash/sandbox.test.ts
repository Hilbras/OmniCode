import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IAgentPermissionModeService } from '@hilbras/omnicode-engine/agent/permissionMode/permissionMode';
import type { SandboxAvailability } from '@hilbras/omnicode-kaos/sandbox';

import {
  BashSandboxService,
  sandboxBackendPreference,
  sandboxDenyReadPaths,
  sandboxNetworkShared,
  sandboxWriteAllowlist,
  type BashSandboxRequest,
} from '#/os/bash/sandbox';

function modeService(mode: 'manual' | 'auto' | 'yolo' = 'auto'): IAgentPermissionModeService {
  return { mode } as IAgentPermissionModeService;
}

function availabilityEntry(
  backend: SandboxAvailability['backend'],
  available: boolean,
): SandboxAvailability {
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

function availability(available: boolean): readonly SandboxAvailability[] {
  return [
    availabilityEntry('bwrap', available),
    availabilityEntry('landlock', false),
    availabilityEntry('seatbelt', false),
  ];
}

const request: BashSandboxRequest = {
  command: 'echo ok && pwd',
  cwd: '/workspace',
  workspace: '/workspace',
  shellPath: '/bin/bash',
  env: { NO_COLOR: '1' },
};

describe('BashSandboxService', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps direct execution when sandbox mode is off', async () => {
    const service = new BashSandboxService(modeService(), {
      mode: () => 'off',
      probe: async () => availability(true),
    });
    await expect(service.prepare(request)).resolves.toEqual({ kind: 'direct' });
  });

  it('fails closed when required and no backend is available', async () => {
    const service = new BashSandboxService(modeService(), {
      mode: () => 'required',
      probe: async () => availability(false),
    });
    const result = await service.prepare(request);
    expect(result.kind).toBe('denied');
  });

  it('falls back to direct execution in auto mode when unavailable', async () => {
    const service = new BashSandboxService(modeService(), {
      mode: () => 'auto',
      probe: async () => availability(false),
    });
    const result = await service.prepare(request);
    expect(result).toMatchObject({ kind: 'direct', reason: expect.stringContaining('no OS sandbox') });
  });

  it('builds a bwrap shell plan when available', async () => {
    const service = new BashSandboxService(modeService(), {
      mode: () => 'auto',
      probe: async () => availability(true),
    });
    const result = await service.prepare(request);
    expect(result.kind).toBe('sandbox');
    if (result.kind !== 'sandbox') throw new Error('expected sandbox plan');
    expect(result.plan.command).toBe('bwrap');
    expect(result.plan.args).toEqual(expect.arrayContaining(['--bind', '/workspace', '/workspace']));
    expect(result.plan.args).toEqual(expect.arrayContaining(['--chdir', '/workspace', '--', '/bin/bash', '-c', request.command]));
    expect(result.plan.args).toContain('--unshare-net');
  });

  it('passes a configured write allowlist into the sandbox plan', async () => {
    const service = new BashSandboxService(modeService(), {
      mode: () => 'auto',
      probe: async () => availability(true),
    });
    const result = await service.prepare({ ...request, writeAllowlist: ['/workspace/src'] });
    if (result.kind !== 'sandbox') throw new Error('expected sandbox plan');
    expect(result.plan.args).toEqual(expect.arrayContaining(['--ro-bind', '/workspace', '/workspace']));
    expect(result.plan.args).toEqual(expect.arrayContaining(['--bind-try', '/workspace/src', '/workspace/src']));
  });

  it('parses write roots without dropping non-absolute entries', () => {
    const previous = process.env['OMNICODE_SANDBOX_WRITE_ROOTS'];
    process.env['OMNICODE_SANDBOX_WRITE_ROOTS'] = '/workspace/src, relative, /workspace/test';
    expect(sandboxWriteAllowlist()).toEqual(['/workspace/src', 'relative', '/workspace/test']);
    if (previous === undefined) delete process.env['OMNICODE_SANDBOX_WRITE_ROOTS'];
    else process.env['OMNICODE_SANDBOX_WRITE_ROOTS'] = previous;
  });

  it('fails the plan closed when a write root is not absolute', async () => {
    vi.stubEnv('OMNICODE_SANDBOX_WRITE_ROOTS', 'relative');
    const service = new BashSandboxService(modeService(), {
      mode: () => 'auto',
      probe: async () => availability(true),
    });
    const result = await service.prepare(request);
    expect(result.kind).toBe('direct');
    if (result.kind === 'direct') {
      expect(result.reason).toContain('must be an absolute path: relative');
    }
    const required = new BashSandboxService(modeService(), {
      mode: () => 'required',
      probe: async () => availability(true),
    });
    await expect(required.prepare(request)).resolves.toMatchObject({ kind: 'denied' });
  });

  it('can share the network only through an explicit env switch', () => {
    const previous = process.env['OMNICODE_SANDBOX_NETWORK'];
    process.env['OMNICODE_SANDBOX_NETWORK'] = 'shared';
    expect(sandboxNetworkShared()).toBe(true);
    if (previous === undefined) delete process.env['OMNICODE_SANDBOX_NETWORK'];
    else process.env['OMNICODE_SANDBOX_NETWORK'] = previous;
  });

  it('refuses a request carrying an exec-policy host restriction even when the sandbox is off', async () => {
    const service = new BashSandboxService(modeService(), {
      mode: () => 'off',
      probe: async () => availability(true),
    });
    const result = await service.prepare({ ...request, allowedHosts: ['api.example.com'] });
    expect(result).toMatchObject({ kind: 'denied' });
    if (result.kind !== 'denied') throw new Error('expected denial');
    expect(result.message).toContain('api.example.com');
    expect(result.message).toContain('exec policy');
  });

  it('refuses a host-restricted request even when a backend could sandbox it', async () => {
    const service = new BashSandboxService(modeService(), {
      mode: () => 'auto',
      probe: async () => availability(true),
    });
    const result = await service.prepare({ ...request, allowedHosts: ['a.example.com', 'b.example.com'] });
    expect(result).toMatchObject({ kind: 'denied' });
    if (result.kind !== 'denied') throw new Error('expected denial');
    expect(result.message).toContain('a.example.com, b.example.com');
  });

  it('executes without refusal when no host restriction is attached', async () => {
    const service = new BashSandboxService(modeService(), {
      mode: () => 'off',
      probe: async () => availability(true),
    });
    await expect(service.prepare({ ...request, allowedHosts: [] })).resolves.toEqual({ kind: 'direct' });
  });

  it('parses the backend preference and deny-read paths from env', () => {
    expect(sandboxBackendPreference({ OMNICODE_SANDBOX_BACKEND: 'SEATBELT' })).toBe('seatbelt');
    expect(sandboxBackendPreference({ OMNICODE_SANDBOX_BACKEND: 'Windows' })).toBe('windows');
    expect(sandboxBackendPreference({ OMNICODE_SANDBOX_BACKEND: 'nope' })).toBeUndefined();
    expect(sandboxBackendPreference({})).toBeUndefined();
    expect(sandboxDenyReadPaths({ OMNICODE_SANDBOX_DENY_READ: '/w/.env*, /secrets' })).toEqual([
      '/w/.env*',
      '/secrets',
    ]);
    expect(sandboxDenyReadPaths({})).toBeUndefined();
  });

  it('uses the preferred backend when it is available', async () => {
    vi.stubEnv('OMNICODE_SANDBOX_BACKEND', 'seatbelt');
    const service = new BashSandboxService(modeService(), {
      mode: () => 'auto',
      probe: async () => [availabilityEntry('seatbelt', true), availabilityEntry('bwrap', true)],
    });
    const result = await service.prepare(request);
    expect(result.kind).toBe('sandbox');
    if (result.kind !== 'sandbox') return;
    expect(result.plan.command).toBe('/usr/bin/sandbox-exec');
    expect(result.plan.backend).toBe('seatbelt');
  });

  it('refuses to substitute another backend when the preferred one is unavailable', async () => {
    vi.stubEnv('OMNICODE_SANDBOX_BACKEND', 'seatbelt');
    const service = new BashSandboxService(modeService(), {
      mode: () => 'auto',
      probe: async () => [availabilityEntry('seatbelt', false), availabilityEntry('bwrap', true)],
    });
    const result = await service.prepare(request);
    expect(result).toMatchObject({ kind: 'direct', reason: expect.stringContaining('refuses to substitute') });
  });

  it('denies a host-preferred backend that is unavailable in required mode', async () => {
    vi.stubEnv('OMNICODE_SANDBOX_BACKEND', 'seatbelt');
    const service = new BashSandboxService(modeService(), {
      mode: () => 'required',
      probe: async () => [availabilityEntry('seatbelt', false), availabilityEntry('bwrap', true)],
    });
    const result = await service.prepare(request);
    expect(result.kind).toBe('denied');
  });

  it('falls back to direct with an explicit reason when deny-read cannot be expressed', async () => {
    vi.stubEnv('OMNICODE_SANDBOX_DENY_READ', '/workspace/.env');
    const service = new BashSandboxService(modeService(), {
      mode: () => 'auto',
      probe: async () => availability(true),
    });
    const result = await service.prepare(request);
    expect(result.kind).toBe('direct');
    if (result.kind === 'direct') {
      expect(result.reason).toContain('bwrap cannot express read denial');
    }
  });

  it('carries deny-read rules into a seatbelt plan', async () => {
    const service = new BashSandboxService(modeService(), {
      mode: () => 'auto',
      probe: async () => [availabilityEntry('seatbelt', true)],
    });
    const result = await service.prepare({ ...request, denyReadPaths: ['/workspace/.env'] });
    expect(result.kind).toBe('sandbox');
    if (result.kind !== 'sandbox') return;
    expect(result.plan.args[2]).toContain('(deny file-read* (subpath "/workspace/.env"))');
  });
});
