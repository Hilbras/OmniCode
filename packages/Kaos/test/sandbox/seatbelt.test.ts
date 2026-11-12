import { describe, expect, it, vi } from 'vitest';

import {
  SeatbeltSandboxBackend,
  buildSeatbeltProfile,
  escapeSeatbeltString,
  probeSeatbelt,
} from '../../src/sandbox/seatbelt';

const workspace = '/Users/dev/project';

function policy(overrides: Record<string, unknown> = {}) {
  return { workspace, ...overrides };
}

describe('escapeSeatbeltString', () => {
  it('escapes quotes and backslashes', () => {
    expect(escapeSeatbeltString('/a"b\\c')).toBe('/a\\"b\\\\c');
  });
});

describe('buildSeatbeltProfile', () => {
  it('denies by default and grants writes only under the workspace', () => {
    const built = buildSeatbeltProfile(policy());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.profile).toContain('(deny default)');
    expect(built.value.profile).not.toContain('(allow default)');
    expect(built.value.profile).toContain(`(allow file-write* (subpath "${workspace}"))`);
    expect(built.value.profile).not.toContain('(allow network*)');
  });

  it('grants network only when the policy shares it', () => {
    const built = buildSeatbeltProfile(policy({ shareNetwork: true }));
    expect(built.ok && built.value.profile.includes('(allow network*)')).toBe(true);
  });

  it('refuses a write allowlist entry outside the workspace', () => {
    const built = buildSeatbeltProfile(policy({ writeAllowlist: ['/etc'] }));
    expect(built.ok).toBe(false);
    expect(built.ok === false ? built.message : '').toContain('escapes the workspace');
  });

  it('cannot be broken out of by a quote in a path', () => {
    const built = buildSeatbeltProfile({
      workspace: `${workspace}"(allow default)"`,
    });
    // The built string keeps the payload inside the literal, never as a rule.
    expect(built.ok && /"\/Users\/dev\/project\\"\(allow default\)\\""/.test(built.value.profile)).toBe(true);
  });

  it('accepts a contained write allowlist', () => {
    const built = buildSeatbeltProfile(policy({ writeAllowlist: [`${workspace}/out`] }));
    expect(built.ok && built.value.writableRoots).toEqual([`${workspace}/out`]);
  });
});

describe('probeSeatbelt', () => {
  it('reports unavailable off darwin', async () => {
    const availability = await probeSeatbelt({ platform: 'linux' });
    expect(availability.available).toBe(false);
    expect(availability.reason).toContain('darwin');
  });

  it('reports unavailable without a probe', async () => {
    const availability = await probeSeatbelt({ platform: 'darwin' });
    expect(availability.reason).toBe('no sandbox-exec probe configured');
  });

  it('reports available when the injected probe succeeds', async () => {
    const probe = vi.fn(async () => ({ ok: true, exitCode: 0, stdout: '', stderr: '', error: null }));
    const availability = await probeSeatbelt({ platform: 'darwin', probe });
    expect(availability.available).toBe(true);
    expect(probe).toHaveBeenCalledWith('/usr/bin/sandbox-exec', expect.any(Array));
  });
});

describe('SeatbeltSandboxBackend', () => {
  it('builds an argv with the profile inline', () => {
    const backend = new SeatbeltSandboxBackend();
    const argv = backend.buildArgv({ command: ['ls'] }, policy());
    expect(argv.ok).toBe(true);
    if (!argv.ok) return;
    expect(argv.value[0]).toBe('/usr/bin/sandbox-exec');
    expect(argv.value[2]).toContain('(deny default)');
    expect(argv.value.slice(-2)).toEqual(['--', 'ls']);
  });

  it('rejects newline injection in the command', () => {
    const backend = new SeatbeltSandboxBackend();
    const argv = backend.buildArgv({ command: ['ls', 'a\nb'] }, policy());
    expect(argv.ok).toBe(false);
  });
});
