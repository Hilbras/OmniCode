import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { resolveLegacySourceHome, sameLegacyPath } from '#/migration/legacy-source';

const HOME = '/home/user';
const CWD = '/work/project';

describe('resolveLegacySourceHome', () => {
  it('defaults to ~/.omnicode when OMNICODE_SHARE_DIR is unset', () => {
    const r = resolveLegacySourceHome({}, HOME, CWD);
    expect(r).toEqual({ sourceHome: join(HOME, '.omnicode'), origin: 'default' });
  });

  it('defaults to ~/.omnicode when OMNICODE_SHARE_DIR is empty or blank', () => {
    expect(resolveLegacySourceHome({ OMNICODE_SHARE_DIR: '' }, HOME, CWD).origin).toBe('default');
    expect(resolveLegacySourceHome({ OMNICODE_SHARE_DIR: '   ' }, HOME, CWD).origin).toBe('default');
  });

  it('uses an absolute OMNICODE_SHARE_DIR verbatim', () => {
    const r = resolveLegacySourceHome({ OMNICODE_SHARE_DIR: '/data/omnicode' }, HOME, CWD);
    expect(r.sourceHome).toBe('/data/omnicode');
    expect(r.origin).toBe('share-dir');
  });

  it('resolves a relative OMNICODE_SHARE_DIR against the process CWD (old-CLI rule)', () => {
    const r = resolveLegacySourceHome({ OMNICODE_SHARE_DIR: 'relative/omnicode' }, HOME, CWD);
    expect(r.sourceHome).toBe(join(CWD, 'relative', 'omnicode'));
    expect(r.origin).toBe('share-dir');
  });

  it('does not expand ~ in OMNICODE_SHARE_DIR (old-CLI rule)', () => {
    const r = resolveLegacySourceHome({ OMNICODE_SHARE_DIR: '~/custom' }, HOME, CWD);
    expect(r.sourceHome).toBe(join(CWD, '~/custom'));
  });

  it('resolves skills from ~/.omnicode when the share dir is redirected', () => {
    const r = resolveLegacySourceHome({ OMNICODE_SHARE_DIR: '/data/omnicode' }, HOME, CWD);
    expect(r.skillsSourceHome).toBe(join(HOME, '.omnicode'));
  });

  it('keeps a single source when OMNICODE_SHARE_DIR points at ~/.omnicode itself', () => {
    const r = resolveLegacySourceHome({ OMNICODE_SHARE_DIR: join(HOME, '.omnicode') }, HOME, CWD);
    expect(r.skillsSourceHome).toBeUndefined();
  });
});

describe('sameLegacyPath', () => {
  it('matches identical and redundant forms', () => {
    expect(sameLegacyPath('/a/b', '/a/b')).toBe(true);
    expect(sameLegacyPath('/a/b/', '/a/b')).toBe(true);
    expect(sameLegacyPath('/a/./b', '/a/b')).toBe(true);
  });

  it('rejects different paths', () => {
    expect(sameLegacyPath('/a/b', '/a/c')).toBe(false);
  });
});
