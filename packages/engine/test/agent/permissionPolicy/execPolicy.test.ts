import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { Error2, isError2 } from '@hilbras/omnicode-base/errors/errors';

import {
  EMPTY_EXEC_POLICY,
  EXEC_POLICY_ALLOWED_HOSTS_KEY,
  ExecPolicyLoadError,
  canonicalTokenText,
  execPolicyAllowedHostsFromMetadata,
  loadExecPolicy,
  matchExecPolicy,
  type ExecPolicyFile,
} from '#/agent/permissionPolicy/execPolicy/execPolicy';
import {
  loadExecPolicyFromConfig,
  readExecPolicyFile,
  resolveExecPolicyPath,
} from '#/agent/permissionPolicy/execPolicy/execPolicyLoader';

function policy(file: Omit<ExecPolicyFile, 'version'> & { readonly version?: 1 }) {
  return loadExecPolicy({ version: 1, ...file });
}

describe('execPolicyAllowedHostsFromMetadata', () => {
  it('reads a well-formed amendment and rejects everything else', () => {
    expect(execPolicyAllowedHostsFromMetadata({ [EXEC_POLICY_ALLOWED_HOSTS_KEY]: ['api.example.com'] })).toEqual([
      'api.example.com',
    ]);
    expect(execPolicyAllowedHostsFromMetadata(undefined)).toBeUndefined();
    expect(execPolicyAllowedHostsFromMetadata('execPolicyAllowedHosts')).toBeUndefined();
    expect(execPolicyAllowedHostsFromMetadata({ [EXEC_POLICY_ALLOWED_HOSTS_KEY]: [] })).toBeUndefined();
    expect(
      execPolicyAllowedHostsFromMetadata({ [EXEC_POLICY_ALLOWED_HOSTS_KEY]: ['api.example.com', 3] }),
    ).toBeUndefined();
    expect(execPolicyAllowedHostsFromMetadata({ other: ['api.example.com'] })).toBeUndefined();
  });
});

describe('loadExecPolicy', () => {
  it('rejects malformed files with a path', () => {
    expect(() => loadExecPolicy(null, 'p')).toThrow(ExecPolicyLoadError);
    expect(() => loadExecPolicy({ version: 2, rules: [] }, 'p')).toThrow(/version must be 1/);
    expect(() => loadExecPolicy({ version: 1, rules: [{}] }, 'p')).toThrow(
      /p\.rules\[0\]: decision must be one of/,
    );
    expect(() => loadExecPolicy({ version: 1, rules: [{ decision: 'allow' }] }, 'p')).toThrow(
      /rule needs prefix or alternatives/,
    );
    expect(() =>
      loadExecPolicy({ version: 1, rules: [{ decision: 'allow', prefix: 'git', examples: [{ command: 'ls', matches: true }] }] }, 'p'),
    ).toThrow(/does not match its rule/);
    expect(() =>
      loadExecPolicy({ version: 1, rules: [{ decision: 'allow', prefix: 'git', examples: [{ command: 'git status', matches: false }] }] }, 'p'),
    ).toThrow(/matches but is marked not-matching/);
  });

  it('rejects a hosts amendment that would be silently dropped', () => {
    for (const hosts of [[], [''], ['   '], ['api.example.com', ''], [3]]) {
      expect(() =>
        loadExecPolicy({ version: 1, rules: [{ decision: 'allow', prefix: 'curl', hosts }] }, 'p'),
      ).toThrow(/hosts must be a non-empty array of non-empty strings/);
    }
    for (const decision of ['prompt', 'prompt-user', 'forbidden'] as const) {
      expect(() =>
        loadExecPolicy(
          { version: 1, rules: [{ decision, prefix: 'curl', hosts: ['api.example.com'] }] },
          'p',
        ),
      ).toThrow(new RegExp(`hosts requires an allow decision, not ${decision}`));
    }
    expect(() =>
      loadExecPolicy(
        { version: 1, rules: [{ decision: 'allow', prefix: 'curl', hosts: ['api.example.com'] }] },
        'p',
      ),
    ).not.toThrow();
  });

  it('rejects an example shadowed by a more specific rule', () => {
    expect(() =>
      loadExecPolicy(
        {
          version: 1,
          rules: [
            { decision: 'allow', prefix: 'git' },
            { decision: 'forbidden', alternatives: [['git', 'push']] },
          ],
        },
        'p',
      ),
    ).not.toThrow();
    expect(() =>
      loadExecPolicy(
        {
          version: 1,
          rules: [
            {
              decision: 'allow',
              prefix: 'git',
              examples: [{ command: 'git push origin main', matches: true }],
            },
            { decision: 'forbidden', alternatives: [['git', 'push']] },
          ],
        },
        'p',
      ),
    ).toThrow(/shadowed by another rule/);
  });
});

describe('matchExecPolicy', () => {
  const sample = policy({
    rules: [
      { decision: 'allow', prefix: 'git status' },
      { decision: 'allow', prefix: ['cargo', 'test'] },
      { decision: 'forbidden', prefix: 'rm', sticky: true },
      { decision: 'prompt', alternatives: [['git', 'push']] },
      { decision: 'allow', prefix: 'curl', hosts: ['API.Example.COM'] },
    ],
  });

  it('matches prefixes and argv alternatives', () => {
    expect(matchExecPolicy('git status --short', sample)).toMatchObject({ decision: 'allow', reason: 'rule' });
    expect(matchExecPolicy('cargo test --all', sample).decision).toBe('allow');
  });

  it('prefers the more specific alternative over a broader prefix', () => {
    const p = policy({
      rules: [
        { decision: 'allow', prefix: 'git' },
        { decision: 'prompt', alternatives: [['git', 'push']] },
      ],
    });
    expect(matchExecPolicy('git push origin main', p).decision).toBe('prompt');
    expect(matchExecPolicy('git fetch', p).decision).toBe('allow');
  });

  it('keeps a sticky rule when specificity ties', () => {
    const p = policy({
      rules: [
        { decision: 'allow', prefix: 'rm' },
        { decision: 'forbidden', prefix: 'rm', sticky: true },
      ],
    });
    expect(matchExecPolicy('rm -rf build', p).decision).toBe('forbidden');
  });

  it('treats shell metacharacters and unbalanced quoting as opaque', () => {
    expect(matchExecPolicy('git status && rm -rf /', sample)).toEqual({
      decision: 'forbidden',
      reason: 'opaque',
    });
    expect(matchExecPolicy('git status', { ...sample, opaque: 'prompt' }).decision).toBe('allow');
    expect(matchExecPolicy('echo "unbalanced', sample).reason).toBe('opaque');
  });

  it('canonicalizes NFD and case', () => {
    const p = policy({ rules: [{ decision: 'allow', prefix: 'MAKE' }] });
    expect(matchExecPolicy('make build', p).decision).toBe('allow');
    expect(canonicalTokenText('Cafe\u0301')).toBe('café');
  });

  it('defaults to prompt-user when nothing matches', () => {
    expect(matchExecPolicy('python script.py', sample)).toEqual({
      decision: 'prompt-user',
      reason: 'default',
    });
    expect(matchExecPolicy('anything', EMPTY_EXEC_POLICY).decision).toBe('prompt-user');
  });

  it('carries host restrictions on the matched rule', () => {
    const result = matchExecPolicy('curl https://api.example.com', sample);
    expect(result.decision).toBe('allow');
    expect(result.rule?.hosts).toEqual(['api.example.com']);
  });

  it('does not match a different executable with the same argument shape', () => {
    const p = policy({ rules: [{ decision: 'allow', prefix: 'ls' }] });
    expect(matchExecPolicy('lsfoo', p).reason).toBe('default');
    expect(matchExecPolicy('ls -la', p).decision).toBe('allow');
  });
});

describe('readExecPolicyFile', () => {
  let dir: string;

  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  it('loads a valid policy file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'exec-policy-'));
    const path = join(dir, 'exec-policy.json');
    await writeFile(path, JSON.stringify({ version: 1, rules: [{ decision: 'allow', prefix: 'git status' }] }));
    const loaded = readExecPolicyFile(path);
    expect(loaded.rules).toHaveLength(1);
    expect(matchExecPolicy('git status', loaded).decision).toBe('allow');
  });

  it('reports unreadable files as load errors carrying the path', () => {
    const missing = join(tmpdir(), 'exec-policy-does-not-exist.json');
    expect(() => readExecPolicyFile(missing)).toThrow(ExecPolicyLoadError);
    expect(() => readExecPolicyFile(missing)).toThrow(
      new RegExp(`${missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: cannot be read`),
    );
  });

  it('reports invalid JSON as a load error carrying the path', async () => {
    dir = await mkdtemp(join(tmpdir(), 'exec-policy-'));
    const path = join(dir, 'broken.json');
    await writeFile(path, '{ not json');
    expect(() => readExecPolicyFile(path)).toThrow(/broken\.json: is not valid JSON/);
  });
});

describe('resolveExecPolicyPath', () => {
  it('expands ~ and resolves relative paths against the Omnicode home, never the workspace', () => {
    expect(resolveExecPolicyPath('policies/exec-policy.json', '/home/omnicode', '/home/os')).toBe(
      '/home/omnicode/policies/exec-policy.json',
    );
    expect(resolveExecPolicyPath('~/policies/exec-policy.json', '/home/omnicode', '/home/os')).toBe(
      '/home/os/policies/exec-policy.json',
    );
    expect(resolveExecPolicyPath('~', '/home/omnicode', '/home/os')).toBe('/home/os');
    expect(resolveExecPolicyPath('/etc/exec-policy.json', '/home/omnicode', '/home/os')).toBe(
      '/etc/exec-policy.json',
    );
  });
});

describe('loadExecPolicyFromConfig', () => {
  let dir: string;

  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  it('loads a policy through the home-relative path', async () => {
    dir = await mkdtemp(join(tmpdir(), 'exec-policy-home-'));
    await writeFile(
      join(dir, 'policy.json'),
      JSON.stringify({ version: 1, rules: [{ decision: 'allow', prefix: 'make' }] }),
    );
    const loaded = loadExecPolicyFromConfig('policy.json', dir, tmpdir());
    expect(matchExecPolicy('make build', loaded).decision).toBe('allow');
  });

  it('wraps every load failure as a config.invalid error that names the file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'exec-policy-home-'));
    await writeFile(join(dir, 'broken.json'), '{"version": 9, "rules": []}');
    try {
      loadExecPolicyFromConfig('broken.json', dir, tmpdir());
      expect.unreachable('load should have failed');
    } catch (error) {
      expect(isError2(error)).toBe(true);
      expect((error as Error2).code).toBe('config.invalid');
      expect((error as Error).message).toContain('version must be 1');
      expect((error as Error).message).toContain('broken.json');
    }
  });
});
