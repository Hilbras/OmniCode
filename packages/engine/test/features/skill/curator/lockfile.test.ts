import { describe, expect, it } from 'vitest';

import { skillTrust } from '#/features/skill/enforcement';
import {
  MAX_CURATED_SET_NAME_LENGTH,
  buildCuratedSetLockfile,
  curatedSkillFingerprint,
  diffCuratedSet,
  isValidCuratedSetName,
  parseCuratedSetLockfile,
  type CuratedSetSkillRef,
} from '#/features/skill/curator/lockfile';

function skill(name: string, overrides?: { readonly content?: string; readonly source?: 'project' | 'user' | 'extra' | 'builtin'; readonly path?: string }): CuratedSetSkillRef {
  return {
    name,
    content: overrides?.content ?? `# ${name}`,
    source: overrides?.source ?? 'user',
    path: overrides?.path ?? `/skills/${name}/SKILL.md`,
  };
}

describe('curated set name validation', () => {
  it('accepts ordinary names and rejects path traversal and control shapes', () => {
    expect(isValidCuratedSetName('frontend-pack')).toBe(true);
    expect(isValidCuratedSetName('a')).toBe(true);
    expect(isValidCuratedSetName('set.1_x')).toBe(true);
    expect(isValidCuratedSetName('')).toBe(false);
    expect(isValidCuratedSetName('../escape')).toBe(false);
    expect(isValidCuratedSetName('a/b')).toBe(false);
    expect(isValidCuratedSetName('.hidden')).toBe(false);
    expect(isValidCuratedSetName('-lead')).toBe(false);
    expect(isValidCuratedSetName('..')).toBe(false);
    expect(isValidCuratedSetName('a'.repeat(MAX_CURATED_SET_NAME_LENGTH))).toBe(true);
    expect(isValidCuratedSetName('a'.repeat(MAX_CURATED_SET_NAME_LENGTH + 1))).toBe(false);
  });
});

describe('curatedSkillFingerprint', () => {
  it('is stable for the same content and sensitive to content changes', () => {
    const first = curatedSkillFingerprint(skill('deploy', { content: 'run deploy' }));
    const again = curatedSkillFingerprint(skill('deploy', { content: 'run deploy', path: '/elsewhere/SKILL.md' }));
    expect(again).toBe(first);
    const changed = curatedSkillFingerprint(skill('deploy', { content: 'run deploy --dry' }));
    expect(changed).not.toBe(first);
  });

  it('is key-order independent', () => {
    const a = curatedSkillFingerprint({ name: 'x', path: '/p', content: 'c', source: 'user' });
    const b = curatedSkillFingerprint({ content: 'c', path: '/p', name: 'x', source: 'user' });
    expect(b).toBe(a);
  });
});

describe('buildCuratedSetLockfile', () => {
  it('stores source and path provenance but never a trust label', () => {
    const lockfile = buildCuratedSetLockfile('pack', [skill('proj', { source: 'project' })], 5);
    const raw = JSON.parse(JSON.stringify(lockfile)) as Record<string, unknown>;
    expect(JSON.stringify(raw)).not.toContain('trust');
    expect(raw['version']).toBe(1);
    expect(lockfile.entries['proj']).toMatchObject({
      name: 'proj',
      source: 'project',
      path: '/skills/proj/SKILL.md',
    });
  });

  it('keys entries case-insensitively and keeps the display name', () => {
    const lockfile = buildCuratedSetLockfile('pack', [skill('Deploy')], 5);
    expect(lockfile.entries['deploy']?.name).toBe('Deploy');
    expect(lockfile.entries['Deploy']).toBeUndefined();
  });

  it('rejects invalid set names', () => {
    expect(() => buildCuratedSetLockfile('../escape', [skill('x')], 0)).toThrow();
  });
});

describe('diffCuratedSet', () => {
  it('reports missing, changed, and extra skills', () => {
    const lockfile = buildCuratedSetLockfile(
      'pack',
      [skill('kept'), skill('mutated', { content: 'v1' }), skill('vanished')],
      5,
    );
    const diff = diffCuratedSet(lockfile, [
      skill('kept'),
      skill('mutated', { content: 'v2' }),
      skill('newcomer'),
    ]);
    expect(diff.missing).toEqual(['vanished']);
    expect(diff.changed).toEqual([
      { name: 'mutated', lockfileFingerprint: curatedSkillFingerprint(skill('mutated', { content: 'v1' })), currentFingerprint: curatedSkillFingerprint(skill('mutated', { content: 'v2' })) },
    ]);
    expect(diff.extra).toEqual(['newcomer']);
  });

  it('is clean when the catalog matches the lockfile', () => {
    const skills = [skill('a'), skill('b')];
    const diff = diffCuratedSet(buildCuratedSetLockfile('pack', skills, 5), skills);
    expect(diff).toEqual({ missing: [], changed: [], extra: [] });
  });

  it('matches entries case-insensitively', () => {
    const lockfile = buildCuratedSetLockfile('pack', [skill('Deploy', { content: 'same' })], 5);
    const diff = diffCuratedSet(lockfile, [skill('deploy', { content: 'same' })]);
    expect(diff).toEqual({ missing: [], changed: [], extra: [] });
  });
});

describe('parseCuratedSetLockfile', () => {
  it('round-trips through JSON', () => {
    const lockfile = buildCuratedSetLockfile('pack', [skill('a'), skill('b', { source: 'project' })], 42);
    const restored = parseCuratedSetLockfile(JSON.parse(JSON.stringify(lockfile)) as unknown);
    expect(restored).toEqual(lockfile);
  });

  it('rejects malformed documents', () => {
    expect(() => parseCuratedSetLockfile({ version: 1 })).toThrow();
    expect(() =>
      parseCuratedSetLockfile({ version: 1, name: 'pack', createdAt: 5, entries: { a: { name: 'a' } } }),
    ).toThrow();
  });
});

describe('curator state and skill trust', () => {
  it('a pinned, archived, or lockfile-recorded project skill stays untrusted', () => {
    const lockfile = buildCuratedSetLockfile('pack', [skill('proj', { source: 'project' })], 5);
    for (const entry of Object.values(lockfile.entries)) {
      expect(skillTrust(entry.source)).toBe('untrusted');
    }
    expect(skillTrust('user')).toBe('trusted');
  });
});
