import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RUNTIME_SHELL_POLICY,
  evaluateRuntimeShellPolicy,
} from '#/sandbox/shell-policy';

describe('evaluateRuntimeShellPolicy', () => {
  it('allows a normal executable and argv', () => {
    const result = evaluateRuntimeShellPolicy({
      command: '/usr/bin/node',
      args: ['-e', 'console.log(1)'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe('argv');
      expect(result.argv).toEqual(['/usr/bin/node', '-e', 'console.log(1)']);
    }
  });

  it('allows shell metacharacters inside arguments because argv mode has no shell', () => {
    const result = evaluateRuntimeShellPolicy({
      command: 'echo',
      args: ['a; rm -rf /', '$(whoami)', 'x|y'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.argv).toEqual(['echo', 'a; rm -rf /', '$(whoami)', 'x|y']);
  });

  it('rejects shell metacharacters in the command string', () => {
    for (const command of ['echo hello', 'echo; rm -rf /', 'cat file | wc -l', 'echo $(id)']) {
      const result = evaluateRuntimeShellPolicy({ command });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('shell-metacharacter');
    }
  });

  it('rejects inline shell execution even when args are separate', () => {
    for (const command of ['sh', 'bash', '/bin/bash', 'zsh']) {
      const result = evaluateRuntimeShellPolicy({ command, args: ['-c', 'rm -rf /'] });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('shell-mode-disabled');
    }
  });

  it('rejects shell execution hidden behind env', () => {
    const result = evaluateRuntimeShellPolicy({
      command: 'env',
      args: ['FOO=1', 'sh', '-c', 'id'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('shell-mode-disabled');
  });

  it('rejects shell mode unless explicitly allowed', () => {
    expect(DEFAULT_RUNTIME_SHELL_POLICY.allowShell).toBe(false);
    const result = evaluateRuntimeShellPolicy({
      command: 'echo hello',
      mode: 'shell',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('shell-mode-disabled');
  });

  it('returns an explicit /bin/sh argv when shell mode is allowed', () => {
    const result = evaluateRuntimeShellPolicy(
      { command: 'echo hello', mode: 'shell' },
      { mode: 'argv', allowShell: true, shellPath: '/bin/sh' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe('shell');
      expect(result.argv).toEqual(['/bin/sh', '-c', 'echo hello']);
    }
  });

  it('rejects separate arguments and unsafe shell paths in shell mode', () => {
    const args = evaluateRuntimeShellPolicy(
      { command: 'echo', args: ['x'], mode: 'shell' },
      { mode: 'argv', allowShell: true, shellPath: '/bin/sh' },
    );
    expect(args.ok).toBe(false);
    if (!args.ok) expect(args.code).toBe('shell-arguments-not-allowed');

    const path = evaluateRuntimeShellPolicy(
      { command: 'echo', mode: 'shell' },
      { mode: 'argv', allowShell: true, shellPath: 'sh;bad' },
    );
    expect(path.ok).toBe(false);
    if (!path.ok) expect(path.code).toBe('unsafe-shell-path');
  });

  it('rejects empty commands, NUL bytes, and environment assignments', () => {
    const empty = evaluateRuntimeShellPolicy({ command: '' });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.code).toBe('empty-command');

    const nul = evaluateRuntimeShellPolicy({ command: 'echo', args: ['a\0b'] });
    expect(nul.ok).toBe(false);
    if (!nul.ok) expect(nul.code).toBe('nul-byte');

    const assignment = evaluateRuntimeShellPolicy({ command: 'FOO=bar' });
    expect(assignment.ok).toBe(false);
    if (!assignment.ok) expect(assignment.code).toBe('environment-assignment');
  });

  it('honours an explicit argv mode over a shell policy default', () => {
    const result = evaluateRuntimeShellPolicy(
      { command: 'echo', mode: 'argv' },
      { mode: 'shell', allowShell: true, shellPath: '/bin/sh' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.argv).toEqual(['echo']);
  });
});
