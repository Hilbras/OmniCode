import { describe, expect, it } from 'vitest';

import {
  EMPTY_EXEC_POLICY,
  ExecPolicyLoadError,
  canonicalTokenText,
  loadExecPolicy,
  matchExecPolicy,
  type ExecPolicyFile,
} from '#/agent/permissionPolicy/execPolicy/execPolicy';

function policy(file: Omit<ExecPolicyFile, 'version'> & { readonly version?: 1 }) {
  return loadExecPolicy({ version: 1, ...file });
}

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
      { decision: 'prompt-user', prefix: 'curl', hosts: ['API.Example.COM'] },
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
    expect(result.decision).toBe('prompt-user');
    expect(result.rule?.hosts).toEqual(['api.example.com']);
  });

  it('does not match a different executable with the same argument shape', () => {
    const p = policy({ rules: [{ decision: 'allow', prefix: 'ls' }] });
    expect(matchExecPolicy('lsfoo', p).reason).toBe('default');
    expect(matchExecPolicy('ls -la', p).decision).toBe('allow');
  });
});
