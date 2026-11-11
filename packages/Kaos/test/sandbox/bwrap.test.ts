import { describe, expect, it } from 'vitest';

import { buildBwrapArgv } from '#/sandbox/bwrap';
import type { SandboxPolicy, SandboxResult } from '#/sandbox/types';

function requireArgs(result: SandboxResult<readonly string[]>): readonly string[] {
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

const WORKSPACE: SandboxPolicy = { workspace: '/workspace' };

describe('buildBwrapArgv', () => {
  it('builds an argv array with workspace writable, system paths read-only, and network denied', () => {
    const argv = requireArgs(
      buildBwrapArgv({ command: ['node', '-e', 'console.log(1)'] }, WORKSPACE),
    );

    expect(argv.slice(0, 4)).toEqual([
      '--die-with-parent',
      '--new-session',
      '--unshare-user',
      '--unshare-uts',
    ]);
    expect(argv).toContain('--unshare-pid');
    expect(argv).toContain('--unshare-ipc');
    expect(argv).toContain('--unshare-net');
    expect(argv).toContain('--proc');
    expect(argv).toContain('--dev');
    expect(argv).toContain('--ro-bind-try');
    expect(argv).toContain('/usr');
    expect(argv).toContain('--bind');
    expect(argv.slice(-4)).toEqual(['--', 'node', '-e', 'console.log(1)']);
  });

  it('keeps a shell-like argument as one argv element instead of a shell string', () => {
    const argv = requireArgs(
      buildBwrapArgv({ command: ['echo', 'a; rm -rf /'] }, WORKSPACE),
    );
    expect(argv.at(-1)).toBe('a; rm -rf /');
    expect(argv.at(-2)).toBe('echo');
    expect(argv.at(-3)).toBe('--');
  });

  it('shares namespaces only when explicitly configured', () => {
    const argv = requireArgs(
      buildBwrapArgv(
        { command: ['true'] },
        {
          workspace: '/workspace',
          shareNetwork: true,
          sharePid: true,
          shareIpc: true,
        },
      ),
    );
    expect(argv).not.toContain('--unshare-net');
    expect(argv).not.toContain('--unshare-pid');
    expect(argv).not.toContain('--unshare-ipc');
  });

  it('binds the workspace read-write after read-only system paths', () => {
    const argv = requireArgs(buildBwrapArgv({ command: ['true'] }, WORKSPACE));
    const readOnlyBind = argv.indexOf('--ro-bind-try');
    const workspaceBind = argv.indexOf('--bind');
    expect(readOnlyBind).toBeGreaterThan(-1);
    expect(workspaceBind).toBeGreaterThan(readOnlyBind);
  });

  it('normalizes and de-duplicates system paths and skips paths inside the workspace', () => {
    const argv = requireArgs(
      buildBwrapArgv(
        { command: ['true'] },
        {
          workspace: '/workspace',
          systemPaths: ['/usr/', '/usr', '/workspace/vendor', '/lib'],
        },
      ),
    );
    const bindIndexes: number[] = [];
    for (let index = 0; index < argv.length; index += 1) {
      if (argv[index] === '--ro-bind-try') bindIndexes.push(index);
    }
    expect(bindIndexes).toHaveLength(2);
    expect(argv).not.toContain('/workspace/vendor');
  });

  it('adds tmpfs mounts and explicit environment entries', () => {
    const argv = requireArgs(
      buildBwrapArgv(
        { command: ['true'] },
        {
          workspace: '/workspace',
          tmpfsPaths: ['/tmp', '/run'],
          env: { SANDBOX: '1' },
        },
      ),
    );
    expect(argv).toContain('--tmpfs');
    expect(argv).toContain('/run');
    const setenv = argv.indexOf('--setenv');
    expect(argv.slice(setenv, setenv + 3)).toEqual(['--setenv', 'SANDBOX', '1']);
    const chdir = argv.indexOf('--chdir');
    expect(argv[chdir + 1]).toBe('/workspace');
  });

  it('resolves a relative cwd inside the workspace', () => {
    const argv = requireArgs(
      buildBwrapArgv({ command: ['true'] }, { workspace: '/workspace', cwd: 'sub' }),
    );
    const chdir = argv.indexOf('--chdir');
    expect(chdir).toBeGreaterThan(-1);
    expect(argv[chdir + 1]).toBe('/workspace/sub');
  });

  it('rejects a cwd outside the workspace', () => {
    const result = buildBwrapArgv({ command: ['true'] }, { workspace: '/workspace', cwd: '/etc' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('path-escape');
  });

  it('rejects an empty command, a NUL argument, and invalid workspace paths', () => {
    const empty = buildBwrapArgv({ command: [] }, WORKSPACE);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.code).toBe('invalid-request');

    const nul = buildBwrapArgv({ command: ['true', 'bad\0arg'] }, WORKSPACE);
    expect(nul.ok).toBe(false);
    if (!nul.ok) expect(nul.code).toBe('invalid-request');

    const rooted = buildBwrapArgv({ command: ['true'] }, { workspace: '/' });
    expect(rooted.ok).toBe(false);
    if (!rooted.ok) expect(rooted.code).toBe('invalid-request');

    const relative = buildBwrapArgv({ command: ['true'] }, { workspace: 'workspace' });
    expect(relative.ok).toBe(false);
    if (!relative.ok) expect(relative.code).toBe('invalid-request');
  });

  it('rejects invalid mount paths and environment entries', () => {
    const system = buildBwrapArgv(
      { command: ['true'] },
      { workspace: '/workspace', systemPaths: ['relative'] },
    );
    expect(system.ok).toBe(false);

    const tmpfs = buildBwrapArgv(
      { command: ['true'] },
      { workspace: '/workspace', tmpfsPaths: ['/tmp\nbad'] },
    );
    expect(tmpfs.ok).toBe(false);

    const envKey = buildBwrapArgv(
      { command: ['true'] },
      { workspace: '/workspace', env: { 'BAD-KEY': '1' } },
    );
    expect(envKey.ok).toBe(false);

    const envValue = buildBwrapArgv(
      { command: ['true'] },
      { workspace: '/workspace', env: { GOOD: 'line\nbreak' } },
    );
    expect(envValue.ok).toBe(false);
  });
});
