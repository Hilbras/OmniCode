import { describe, expect, it } from 'vitest';

import {
  probeBwrap,
  probeLandlock,
  probeSandboxBackends,
} from '#/sandbox/availability';
import {
  BwrapSandboxBackend,
  LandlockSandboxBackend,
  createSandboxBackend,
} from '#/sandbox/backends';
import type { SandboxProbeCommand, SandboxProbeOutput } from '#/sandbox/types';

function probeOutput(overrides: Partial<SandboxProbeOutput> = {}): SandboxProbeOutput {
  return {
    ok: true,
    exitCode: 0,
    stdout: '',
    stderr: '',
    error: null,
    ...overrides,
  };
}

describe('probeBwrap', () => {
  it('probes --version and --unshare-all without running user commands', async () => {
    const calls: SandboxProbeCommand[] = [];
    const availability = await probeBwrap({
      platform: 'linux',
      exec: async (command) => {
        calls.push(command);
        if (command.args[0] === '--version') {
          return probeOutput({ stdout: 'bubblewrap 0.9.0\n' });
        }
        return probeOutput({ stdout: '' });
      },
    });

    expect(availability.available).toBe(true);
    expect(availability.version).toBe('0.9.0');
    expect(availability.reason).toBeNull();
    expect(availability.probes.map((probe) => probe.label)).toEqual([
      'bwrap-version',
      'bwrap-unshare-all',
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.file).toBe('bwrap');
    expect(calls[0]?.args).toEqual(['--version']);
    expect(calls[1]?.args).toEqual([
      '--unshare-all',
      '--ro-bind',
      '/',
      '/',
      '--',
      '/bin/true',
    ]);
    expect(calls.every((call) => call.file === 'bwrap')).toBe(true);
  });

  it('reports unavailable when --version fails', async () => {
    const availability = await probeBwrap({
      platform: 'linux',
      exec: async () =>
        probeOutput({
          ok: false,
          exitCode: 127,
          stderr: 'bwrap: command not found',
        }),
    });
    expect(availability.available).toBe(false);
    expect(availability.version).toBeNull();
    expect(availability.reason).toContain('bwrap --version failed');
    expect(availability.reason).toContain('command not found');
    expect(availability.probes).toHaveLength(1);
  });

  it('converts a thrown probe into a structured unavailable result', async () => {
    const availability = await probeBwrap({
      platform: 'linux',
      exec: async () => {
        throw new Error('spawn EACCES');
      },
    });
    expect(availability.available).toBe(false);
    expect(availability.reason).toContain('spawn EACCES');
    expect(availability.probes).toHaveLength(1);
    expect(availability.probes[0]?.ok).toBe(false);
  });

  it('reports unavailable when --unshare-all cannot create namespaces', async () => {
    const availability = await probeBwrap({
      platform: 'linux',
      exec: async (command) =>
        command.args[0] === '--version'
          ? probeOutput({ stdout: 'bubblewrap 0.10.0' })
          : probeOutput({
              ok: false,
              exitCode: 1,
              stderr: 'No permissions to create new namespace',
            }),
    });
    expect(availability.available).toBe(false);
    expect(availability.version).toBe('0.10.0');
    expect(availability.reason).toContain('--unshare-all is unavailable');
    expect(availability.probes).toHaveLength(2);
  });

  it('does not probe on non-Linux hosts', async () => {
    let called = false;
    const availability = await probeBwrap({
      platform: 'darwin',
      exec: async () => {
        called = true;
        return probeOutput();
      },
    });
    expect(called).toBe(false);
    expect(availability.available).toBe(false);
    expect(availability.reason).toContain('requires Linux');
    expect(availability.probes).toEqual([]);
  });

  it('exposes bwrap through the backend abstraction', async () => {
    const backend = new BwrapSandboxBackend({
      platform: 'linux',
      exec: async (command) =>
        command.args[0] === '--version'
          ? probeOutput({ stdout: 'bubblewrap 0.9.1' })
          : probeOutput(),
    });
    expect(backend.kind).toBe('bwrap');
    const availability = await backend.probe();
    expect(availability.available).toBe(true);
    expect(availability.version).toBe('0.9.1');
  });
});

describe('probeLandlock', () => {
  it('reports unavailable with a precise reason and bwrap fallback on Linux', async () => {
    const availability = await probeLandlock({ platform: 'linux' });
    expect(availability.backend).toBe('landlock');
    expect(availability.available).toBe(false);
    expect(availability.reason).toContain('landlock_create_ruleset');
    expect(availability.reason).toContain('falls back to bwrap');
    expect(availability.fallback).toBe('bwrap');
    expect(availability.probes[0]?.ok).toBe(false);
  });

  it('reports the host-platform reason on non-Linux hosts', async () => {
    const availability = await probeLandlock({ platform: 'darwin' });
    expect(availability.available).toBe(false);
    expect(availability.reason).toContain('requires Linux');
    expect(availability.fallback).toBe('bwrap');
  });

  it('refuses to fabricate enforcement from the landlock backend', () => {
    const backend = new LandlockSandboxBackend();
    expect(backend.kind).toBe('landlock');
    const result = backend.buildArgv(
      { command: ['true'] },
      { workspace: '/workspace' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('backend-unavailable');
      expect(result.detail?.['fallback']).toBe('bwrap');
    }
  });
});

describe('createSandboxBackend', () => {
  it('creates the requested backend', () => {
    expect(createSandboxBackend('bwrap').kind).toBe('bwrap');
    expect(createSandboxBackend('landlock').kind).toBe('landlock');
  });
});

describe('probeSandboxBackends', () => {
  it('probes every backend with injected seams', async () => {
    const availability = await probeSandboxBackends({
      bwrap: {
        platform: 'linux',
        exec: async (command) =>
          command.args[0] === '--version'
            ? probeOutput({ stdout: 'bubblewrap 0.9.0' })
            : probeOutput(),
      },
      landlock: { platform: 'linux' },
      seatbelt: { platform: 'linux' },
    });
    expect(availability.map((item) => item.backend)).toEqual(['bwrap', 'landlock', 'seatbelt']);
    expect(availability[0]?.available).toBe(true);
    expect(availability[1]?.available).toBe(false);
    expect(availability[1]?.fallback).toBe('bwrap');
    expect(availability[2]?.available).toBe(false);
    expect(availability[2]?.reason).toContain('darwin');
  });

  it('reports seatbelt as available on darwin through the injected probe', async () => {
    const availability = await probeSandboxBackends({
      bwrap: { platform: 'darwin' },
      landlock: { platform: 'darwin' },
      seatbelt: {
        platform: 'darwin',
        probe: async () => probeOutput(),
      },
    });
    expect(availability[2]?.backend).toBe('seatbelt');
    expect(availability[2]?.available).toBe(true);
  });
});
