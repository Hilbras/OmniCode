import { describe, expect, it } from 'vitest';

import type { IAgentPermissionModeService } from '@hilbras/omnicode-engine/agent/permissionMode/permissionMode';
import type { SandboxAvailability } from '@hilbras/omnicode-kaos/sandbox';

import {
  BashSandboxService,
  sandboxNetworkShared,
  sandboxWriteAllowlist,
  type BashSandboxRequest,
} from '#/os/bash/sandbox';

function modeService(mode: 'manual' | 'auto' | 'yolo' = 'auto'): IAgentPermissionModeService {
  return { mode } as IAgentPermissionModeService;
}

function availability(available: boolean): readonly SandboxAvailability[] {
  return [
    {
      backend: 'bwrap',
      available,
      version: available ? '0.8.0' : null,
      reason: available ? null : 'bwrap not found',
      fallback: null,
      probes: [],
      checkedAt: 1,
    },
    {
      backend: 'landlock',
      available: false,
      version: null,
      reason: 'landlock unavailable in pure TypeScript',
      fallback: 'bwrap',
      probes: [],
      checkedAt: 1,
    },
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

  it('parses write roots only from absolute env entries', () => {
    const previous = process.env['OMNICODE_SANDBOX_WRITE_ROOTS'];
    process.env['OMNICODE_SANDBOX_WRITE_ROOTS'] = '/workspace/src, relative, /workspace/test';
    expect(sandboxWriteAllowlist()).toEqual(['/workspace/src', '/workspace/test']);
    if (previous === undefined) delete process.env['OMNICODE_SANDBOX_WRITE_ROOTS'];
    else process.env['OMNICODE_SANDBOX_WRITE_ROOTS'] = previous;
  });

  it('can share the network only through an explicit env switch', () => {
    const previous = process.env['OMNICODE_SANDBOX_NETWORK'];
    process.env['OMNICODE_SANDBOX_NETWORK'] = 'shared';
    expect(sandboxNetworkShared()).toBe(true);
    if (previous === undefined) delete process.env['OMNICODE_SANDBOX_NETWORK'];
    else process.env['OMNICODE_SANDBOX_NETWORK'] = previous;
  });
});
