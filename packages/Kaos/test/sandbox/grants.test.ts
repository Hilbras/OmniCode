import { describe, expect, it } from 'vitest';

import {
  evaluateSandboxPathGrants,
  intersectSandboxPathGrants,
  isSandboxDenyReadMatch,
  mergeSandboxPathGrants,
  normalizeSandboxPathGrants,
  sandboxDenyReadHasGlob,
  sandboxDenyReadToRegExp,
} from '#/sandbox/grants';

describe('normalizeSandboxPathGrants', () => {
  it('normalizes and dedupes entries', () => {
    const grants = normalizeSandboxPathGrants(
      {
        writeAllowlist: ['/workspace/src/', '/workspace/src', '/workspace/test'],
        denyReadPaths: ['/workspace/.env', '/workspace/.env'],
      },
      '/workspace',
    );
    expect(grants.ok).toBe(true);
    if (!grants.ok) return;
    expect(grants.value.writeAllowlist).toEqual(['/workspace/src', '/workspace/test']);
    expect(grants.value.denyReadPaths).toEqual(['/workspace/.env']);
  });

  it('keeps undefined write allowlist as whole-workspace writable', () => {
    const grants = normalizeSandboxPathGrants({ denyReadPaths: ['/secrets'] }, '/workspace');
    expect(grants.ok).toBe(true);
    if (!grants.ok) return;
    expect(grants.value.writeAllowlist).toBeNull();
    expect(grants.value.denyReadPaths).toEqual(['/secrets']);
  });

  it('rejects a write root outside the workspace', () => {
    const grants = normalizeSandboxPathGrants({ writeAllowlist: ['/etc'] }, '/workspace');
    expect(grants.ok).toBe(false);
    if (!grants.ok) expect(grants.code).toBe('path-escape');
  });

  it('rejects relative write roots and deny entries', () => {
    const relativeWrite = normalizeSandboxPathGrants({ writeAllowlist: ['src'] }, '/workspace');
    expect(relativeWrite.ok).toBe(false);

    const relativeDeny = normalizeSandboxPathGrants({ denyReadPaths: ['.env'] }, '/workspace');
    expect(relativeDeny.ok).toBe(false);
  });

  it('rejects unsafe characters', () => {
    const grants = normalizeSandboxPathGrants({ denyReadPaths: ['/workspace/a\nb'] }, '/workspace');
    expect(grants.ok).toBe(false);
    if (!grants.ok) expect(grants.code).toBe('invalid-request');
  });
});

describe('mergeSandboxPathGrants', () => {
  it('unions write roots and deny paths', () => {
    const merged = mergeSandboxPathGrants(
      { writeAllowlist: ['/workspace/src'], denyReadPaths: ['/workspace/.env'] },
      { writeAllowlist: ['/workspace/test'], denyReadPaths: ['/workspace/.env.local'] },
    );
    expect(merged.writeAllowlist).toEqual(['/workspace/src', '/workspace/test']);
    expect(merged.denyReadPaths).toEqual(['/workspace/.env', '/workspace/.env.local']);
  });

  it('a whole-workspace source widens the merged write grant', () => {
    const merged = mergeSandboxPathGrants(
      { writeAllowlist: ['/workspace/src'] },
      { denyReadPaths: ['/workspace/.env'] },
      { writeAllowlist: ['/workspace/build'] },
    );
    expect(merged.writeAllowlist).toBeUndefined();
    expect(merged.denyReadPaths).toEqual(['/workspace/.env']);
  });

  it('keeps deny paths from sources without a write allowlist', () => {
    const merged = mergeSandboxPathGrants(
      { denyReadPaths: ['/workspace/.env'] },
      { writeAllowlist: ['/workspace/src'] },
    );
    expect(merged.writeAllowlist).toBeUndefined();
    expect(merged.denyReadPaths).toEqual(['/workspace/.env']);
  });

  it('returns no grants for no sources', () => {
    expect(mergeSandboxPathGrants()).toEqual({});
  });
});

describe('intersectSandboxPathGrants', () => {
  it('keeps the write paths granted by every constraining source', () => {
    const intersected = intersectSandboxPathGrants(
      { writeAllowlist: ['/workspace/src', '/workspace/test'] },
      { writeAllowlist: ['/workspace/test', '/workspace/other'] },
    );
    expect(intersected.writeAllowlist).toEqual(['/workspace/test']);
  });

  it('a source without a write allowlist constrains nothing', () => {
    const intersected = intersectSandboxPathGrants(
      { writeAllowlist: ['/workspace/src'] },
      { denyReadPaths: ['/workspace/.env'] },
    );
    expect(intersected.writeAllowlist).toEqual(['/workspace/src']);
    expect(intersected.denyReadPaths).toEqual(['/workspace/.env']);
  });

  it('stays whole-workspace when no source constrains writes', () => {
    const intersected = intersectSandboxPathGrants({}, {});
    expect(intersected.writeAllowlist).toBeUndefined();
    expect(intersected.denyReadPaths).toBeUndefined();
  });

  it('unions deny paths so any denial holds', () => {
    const intersected = intersectSandboxPathGrants(
      { writeAllowlist: ['/workspace/src'], denyReadPaths: ['/workspace/a'] },
      { writeAllowlist: ['/workspace/src'], denyReadPaths: ['/workspace/b'] },
    );
    expect(intersected.writeAllowlist).toEqual(['/workspace/src']);
    expect(intersected.denyReadPaths).toEqual(['/workspace/a', '/workspace/b']);
  });

  it('an empty intersection denies every write', () => {
    const intersected = intersectSandboxPathGrants(
      { writeAllowlist: ['/workspace/src'] },
      { writeAllowlist: ['/workspace/build'] },
    );
    expect(intersected.writeAllowlist).toEqual([]);
  });
});

describe('deny-read matching', () => {
  it('flags glob patterns', () => {
    expect(sandboxDenyReadHasGlob('/ws/.env')).toBe(false);
    expect(sandboxDenyReadHasGlob('/ws/.env*')).toBe(true);
    expect(sandboxDenyReadHasGlob('/ws/**/id_rsa?')).toBe(true);
  });

  it('literal patterns deny their subtree', () => {
    expect(isSandboxDenyReadMatch('/ws/secrets', '/ws/secrets/key.pem')).toBe(true);
    expect(isSandboxDenyReadMatch('/ws/secrets', '/ws/secrets')).toBe(true);
    expect(isSandboxDenyReadMatch('/ws/secrets', '/ws/secretsome')).toBe(false);
    expect(isSandboxDenyReadMatch('/ws/secrets/', '/ws/secrets/key.pem')).toBe(true);
  });

  it('single-star globs stay inside one path segment', () => {
    expect(isSandboxDenyReadMatch('/ws/.env*', '/ws/.env.local')).toBe(true);
    expect(isSandboxDenyReadMatch('/ws/.env*', '/ws/sub/.env.local')).toBe(false);
  });

  it('double-star globs cross path segments', () => {
    expect(isSandboxDenyReadMatch('/ws/**/id_rsa', '/ws/a/b/id_rsa')).toBe(true);
    expect(isSandboxDenyReadMatch('/ws/**', '/ws/a/b')).toBe(true);
    expect(isSandboxDenyReadMatch('/ws/**', '/other/a/b')).toBe(false);
  });

  it('question marks match one non-separator character', () => {
    expect(isSandboxDenyReadMatch('/ws/key?', '/ws/key1')).toBe(true);
    expect(isSandboxDenyReadMatch('/ws/key?', '/ws/key12')).toBe(false);
    expect(isSandboxDenyReadMatch('/ws/key?', '/ws/key/1')).toBe(false);
  });

  it('regex metacharacters in patterns stay literal', () => {
    expect(isSandboxDenyReadMatch('/ws/a+b.c', '/ws/a+b.c')).toBe(true);
    expect(isSandboxDenyReadMatch('/ws/a+b.c', '/ws/aaabcc')).toBe(false);
  });

  it('the regex projection equals the matcher', () => {
    for (const [pattern, path] of [
      ['/ws/.env*', '/ws/.env.local'],
      ['/ws/**/id_rsa', '/ws/a/b/id_rsa'],
      ['/ws/key?', '/ws/key1'],
    ] as const) {
      const regex = sandboxDenyReadToRegExp(pattern);
      expect(regex.test(path)).toBe(isSandboxDenyReadMatch(pattern, path));
    }
  });
});

describe('evaluateSandboxPathGrants', () => {
  it('denies reads matching any deny pattern', () => {
    const decision = evaluateSandboxPathGrants(
      { writeAllowlist: null, denyReadPaths: ['/ws/.env', '/ws/secrets'] },
      '/ws/secrets/key.pem',
      'read',
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('/ws/secrets');
  });

  it('allows reads outside every deny pattern', () => {
    const decision = evaluateSandboxPathGrants(
      { writeAllowlist: null, denyReadPaths: ['/ws/.env*'] },
      '/ws/src/index.ts',
      'read',
    );
    expect(decision.allowed).toBe(true);
  });

  it('writes need a grant when the allowlist is set', () => {
    const grants = { writeAllowlist: ['/ws/out'], denyReadPaths: [] };
    expect(evaluateSandboxPathGrants(grants, '/ws/out/file.txt', 'write').allowed).toBe(true);
    const denied = evaluateSandboxPathGrants(grants, '/ws/src/index.ts', 'write');
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain('write allowlist');
  });

  it('writes anywhere are allowed without an allowlist', () => {
    const decision = evaluateSandboxPathGrants(
      { writeAllowlist: null, denyReadPaths: [] },
      '/ws/src/index.ts',
      'write',
    );
    expect(decision.allowed).toBe(true);
  });

  it('deny-read never blocks a write', () => {
    const decision = evaluateSandboxPathGrants(
      { writeAllowlist: null, denyReadPaths: ['/ws/.env'] },
      '/ws/.env',
      'write',
    );
    expect(decision.allowed).toBe(true);
  });
});
