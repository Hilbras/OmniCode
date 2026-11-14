import { describe, expect, it, vi } from 'vitest';

import { createSandboxBackend } from '#/sandbox/backends';
import { createSandboxExecutionPlan } from '#/sandbox/execution';
import { selectSandboxBackend } from '#/sandbox/selection';
import type { SandboxAvailability, SandboxBackendKind } from '#/sandbox/types';
import {
  WindowsSandboxBackend,
  buildWindowsSandboxArgv,
  buildWindowsSandboxProfile,
  probeWindowsSandbox,
  WINDOWS_SANDBOX_INTERNET_CAPABILITY,
} from '#/sandbox/windows';

const workspace = 'C:/dev/project';

function policy(overrides: Record<string, unknown> = {}) {
  return { workspace, ...overrides };
}

function availability(backend: SandboxBackendKind, available: boolean, overrides: Partial<SandboxAvailability> = {}): SandboxAvailability {
  return {
    backend,
    available,
    version: null,
    reason: available ? null : 'windows unavailable',
    fallback: null,
    probes: [],
    checkedAt: 1,
    ...overrides,
  };
}

describe('buildWindowsSandboxProfile', () => {
  it('denies the network by default and grants the whole workspace read-write', () => {
    const built = buildWindowsSandboxProfile(policy());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.appContainer.capabilities).toEqual([]);
    expect(built.value.jobObject).toEqual({ killOnJobClose: true, breakawayAllowed: false });
    expect(built.value.pathRules).toEqual([{ path: workspace, access: 'read-write' }]);
  });

  it('grants the internetClient capability only when the policy shares the network', () => {
    const shared = buildWindowsSandboxProfile(policy({ shareNetwork: true }));
    expect(shared.ok && shared.value.appContainer.capabilities).toEqual([WINDOWS_SANDBOX_INTERNET_CAPABILITY]);
    const denied = buildWindowsSandboxProfile(policy({ shareNetwork: false }));
    expect(denied.ok && denied.value.appContainer.capabilities).toEqual([]);
  });

  it('binds the workspace read-only when a write allowlist is set', () => {
    const built = buildWindowsSandboxProfile(policy({ writeAllowlist: [`${workspace}/out`] }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.pathRules).toEqual([
      { path: workspace, access: 'read' },
      { path: `${workspace}/out`, access: 'read-write' },
    ]);
  });

  it('refuses a write allowlist entry outside the workspace', () => {
    const built = buildWindowsSandboxProfile(policy({ writeAllowlist: ['C:/Windows/Temp'] }));
    expect(built.ok).toBe(false);
    expect(built.ok === false ? built.message : '').toContain('escapes the workspace');
  });

  it('turns literal deny-read paths into deny-read rules', () => {
    const built = buildWindowsSandboxProfile(policy({ denyReadPaths: [`${workspace}/.env`, 'C:/etc/ssh'] }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.pathRules).toContainEqual({ path: `${workspace}/.env`, access: 'deny-read' });
    expect(built.value.pathRules).toContainEqual({ path: 'C:/etc/ssh', access: 'deny-read' });
  });

  it('refuses glob deny-read entries because AppContainer ACLs are literal paths', () => {
    const built = buildWindowsSandboxProfile(policy({ denyReadPaths: [`${workspace}/.env*`] }));
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.code).toBe('unsupported-operation');
    expect(built.message).toContain('literal paths');
  });

  it('refuses explicit tmpfs paths because AppContainer cannot express tmpfs mounts', () => {
    const built = buildWindowsSandboxProfile(policy({ tmpfsPaths: ['C:/tmp'] }));
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.code).toBe('unsupported-operation');
  });

  it('keeps explicit system paths as read rules and drops workspace-contained ones', () => {
    const built = buildWindowsSandboxProfile(
      policy({ systemPaths: ['C:/Windows/System32', `${workspace}/vendor`] }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.pathRules).toContainEqual({ path: 'C:/Windows/System32', access: 'read' });
    expect(built.value.pathRules.some((rule) => rule.path === `${workspace}/vendor`)).toBe(false);
  });

  it('rejects a relative workspace and unsafe path characters', () => {
    expect(buildWindowsSandboxProfile({ workspace: 'relative/path' }).ok).toBe(false);
    expect(buildWindowsSandboxProfile({ workspace: `${workspace}\n(x)` }).ok).toBe(false);
    expect(
      buildWindowsSandboxProfile(policy({ denyReadPaths: [`${workspace}\0.env`] })).ok,
    ).toBe(false);
  });
});

describe('buildWindowsSandboxArgv', () => {
  it('refuses with backend-unavailable when no helper is configured', () => {
    const argv = buildWindowsSandboxArgv({ command: ['cmd.exe', '/c', 'dir'] }, policy());
    expect(argv.ok).toBe(false);
    if (argv.ok) return;
    expect(argv.code).toBe('backend-unavailable');
    expect(argv.message).toContain('no windows sandbox helper');
    expect(argv.message).toContain('unconfined');
  });

  it('emits helper + profile JSON + child argv through the run protocol when a helper is set', () => {
    const argv = buildWindowsSandboxArgv(
      { command: ['cmd.exe', '/c', 'dir'] },
      policy(),
      { helperPath: 'C:/tools/omnicode-sandbox-helper.exe' },
    );
    expect(argv.ok).toBe(true);
    if (!argv.ok) return;
    expect(argv.value[0]).toBe('C:/tools/omnicode-sandbox-helper.exe');
    expect(argv.value[1]).toBe('run');
    expect(argv.value[2]).toBe('--profile');
    const profile = JSON.parse(argv.value[3] ?? '{}') as { appContainer: { capabilities: string[] } };
    expect(profile.appContainer.capabilities).toEqual([]);
    expect(argv.value[4]).toBe('--');
    expect(argv.value.slice(5)).toEqual(['cmd.exe', '/c', 'dir']);
  });

  it('refuses a relative helper path', () => {
    const argv = buildWindowsSandboxArgv({ command: ['cmd.exe'] }, policy(), { helperPath: 'helper.exe' });
    expect(argv.ok).toBe(false);
    if (argv.ok) return;
    expect(argv.code).toBe('invalid-request');
    expect(argv.message).toContain('absolute');
  });

  it('rejects empty commands and NUL/newline injection in the command', () => {
    expect(buildWindowsSandboxArgv({ command: [] }, policy(), { helperPath: 'C:/tools/helper.exe' }).ok).toBe(false);
    const injected = buildWindowsSandboxArgv(
      { command: ['cmd.exe', '/c', 'dir\n& format'] },
      policy(),
      { helperPath: 'C:/tools/helper.exe' },
    );
    expect(injected.ok).toBe(false);
  });
});

describe('probeWindowsSandbox', () => {
  it('reports unavailable off win32 with the platform named and bwrap as fallback', async () => {
    const availability = await probeWindowsSandbox({ platform: 'linux' });
    expect(availability.backend).toBe('windows');
    expect(availability.available).toBe(false);
    expect(availability.reason).toContain('win32');
    expect(availability.reason).toContain('linux');
    expect(availability.fallback).toBe('bwrap');
    expect(availability.probes).toEqual([]);
  });

  it('reports unavailable on win32 without a helper', async () => {
    const availability = await probeWindowsSandbox({ platform: 'win32' });
    expect(availability.available).toBe(false);
    expect(availability.reason).toContain('no windows sandbox helper');
    expect(availability.fallback).toBeNull();
  });

  it('reports unavailable on win32 with a relative helper path', async () => {
    const availability = await probeWindowsSandbox({ platform: 'win32', helperPath: 'helper.exe' });
    expect(availability.available).toBe(false);
    expect(availability.reason).toContain('absolute');
    expect(availability.probes).toEqual([]);
  });

  it('reports unavailable on win32 with a helper but no probe', async () => {
    const availability = await probeWindowsSandbox({ platform: 'win32', helperPath: 'C:/tools/helper.exe' });
    expect(availability.available).toBe(false);
    expect(availability.reason).toBe('no windows sandbox probe configured');
    expect(availability.fallback).toBeNull();
  });

  it('reports the real probe outcome on win32 and probes through the run protocol', async () => {
    const probe = vi.fn(async () => ({ ok: true, exitCode: 0, stdout: '', stderr: '', error: null }));
    const availability = await probeWindowsSandbox({
      platform: 'win32',
      helperPath: 'C:/tools/helper.exe',
      probe,
    });
    expect(availability.available).toBe(true);
    expect(availability.reason).toBeNull();
    expect(availability.fallback).toBeNull();
    expect(probe).toHaveBeenCalledWith('C:/tools/helper.exe', [
      'run',
      '--profile',
      expect.any(String),
      '--',
      'cmd.exe',
      '/d',
      '/c',
      'exit 0',
    ]);
    expect(availability.probes[0]?.label).toBe('windows-sandbox-helper');
    expect(availability.probes[0]?.command).toBe('C:/tools/helper.exe');
  });

  it('carries the probe failure into the reason when the helper probe fails', async () => {
    const availability = await probeWindowsSandbox({
      platform: 'win32',
      helperPath: 'C:/tools/helper.exe',
      probe: async () => ({ ok: false, exitCode: 1, stdout: '', stderr: 'AppContainer creation denied', error: null }),
    });
    expect(availability.available).toBe(false);
    expect(availability.reason).toBe('AppContainer creation denied');
    expect(availability.fallback).toBeNull();
    expect(availability.probes[0]?.ok).toBe(false);
  });
});

describe('WindowsSandboxBackend', () => {
  it('refuses to fabricate enforcement from the windows backend without a helper', () => {
    const backend = new WindowsSandboxBackend();
    expect(backend.kind).toBe('windows');
    const result = backend.buildArgv({ command: ['cmd.exe'] }, policy());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('backend-unavailable');
      expect(result.detail?.['backend']).toBe('windows');
    }
  });

  it('is created by createSandboxBackend with helper deps', () => {
    const backend = createSandboxBackend('windows', { windows: { helperPath: 'C:/tools/helper.exe' } });
    expect(backend.kind).toBe('windows');
    const argv = backend.buildArgv({ command: ['cmd.exe'] }, policy());
    expect(argv.ok && argv.value[0]).toBe('C:/tools/helper.exe');
  });
});

describe('windows backend selection and planning', () => {
  it('refuses to substitute another backend for an unavailable preferred windows backend', () => {
    const selection = selectSandboxBackend({
      permissionMode: 'auto',
      preferredBackend: 'windows',
      availability: [availability('windows', false, { reason: 'no windows sandbox helper is configured' })],
    });
    expect(selection.backend).toBeNull();
    expect(selection.enabled).toBe(false);
    expect(selection.reason).toBe('preferred-backend-unavailable');
    expect(selection.message).toContain('windows');
    expect(selection.message).toContain('refuses to substitute');
    expect(selection.fallback).toEqual({
      from: 'windows',
      to: null,
      reason: 'no windows sandbox helper is configured',
    });
  });

  it('skips windows in the default order and records the explicit fallback', () => {
    const selection = selectSandboxBackend({
      permissionMode: 'auto',
      availability: [
        availability('bwrap', false, { reason: 'bwrap not found' }),
        availability('seatbelt', false, { reason: 'seatbelt requires darwin' }),
        availability('windows', false, { reason: 'windows sandbox requires win32' }),
      ],
    });
    expect(selection.backend).toBeNull();
    expect(selection.enabled).toBe(false);
    expect(selection.reason).toBe('sandbox-unavailable');
    expect(selection.fallback).toEqual({ from: 'bwrap', to: null, reason: 'bwrap not found' });
  });

  it('selects an available windows backend when preferred', () => {
    const selection = selectSandboxBackend({
      permissionMode: 'auto',
      preferredBackend: 'windows',
      availability: [availability('windows', true)],
    });
    expect(selection.backend).toBe('windows');
    expect(selection.enabled).toBe(true);
    expect(selection.fallback).toBeNull();
  });

  it('builds a windows plan that refuses without a helper instead of running unconfined', () => {
    const plan = createSandboxExecutionPlan({
      backend: 'windows',
      availability: availability('windows', true),
      permissionMode: 'manual',
      policy: { workspace },
      request: { command: 'cmd.exe', args: ['/c', 'dir'], mode: 'argv' },
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.code).toBe('backend-unavailable');
    expect(plan.message).toContain('no windows sandbox helper');
  });

  it('builds a windows plan through the helper when one is configured', () => {
    const plan = createSandboxExecutionPlan({
      backend: 'windows',
      availability: availability('windows', true),
      permissionMode: 'manual',
      policy: { workspace, shareNetwork: true },
      request: { command: 'cmd.exe', args: ['/c', 'dir'], mode: 'argv' },
      windowsHelperPath: 'C:/tools/omnicode-sandbox-helper.exe',
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.command).toBe('C:/tools/omnicode-sandbox-helper.exe');
    expect(plan.value.backend).toBe('windows');
    expect(plan.value.args[2]).toBe('--profile');
    const profile = JSON.parse(plan.value.args[3] ?? '{}') as { appContainer: { capabilities: string[] } };
    expect(profile.appContainer.capabilities).toEqual([WINDOWS_SANDBOX_INTERNET_CAPABILITY]);
  });
});
