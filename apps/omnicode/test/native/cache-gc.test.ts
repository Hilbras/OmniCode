import {
  existsSync,
  mkdirSync,
  statSync,
  utimesSync,
  writeFileSync,
  readdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanupStaleNativeCache } from '#/native/native-assets';
import { cleanupStaleWebAssetCache } from '#/native/web-assets';

describe('cleanupStaleNativeCache', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'omnicode-cache-gc-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function makeHashDir(version: string, target: string, hash: string, mtimeOffset = 0): string {
    const dir = join(root, 'native', version, target, hash);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'marker.txt'), hash);
    const now = Math.floor(Date.now() / 1000);
    utimesSync(dir, now + mtimeOffset, now + mtimeOffset);
    return dir;
  }

  it('keeps currentRoot + most recently modified sibling, deletes the rest', () => {
    const v = '1.0.0';
    const t = 'darwin-arm64';
    const oldest = makeHashDir(v, t, 'aaaa', -300);
    const middle = makeHashDir(v, t, 'bbbb', -200);
    const recent = makeHashDir(v, t, 'cccc', -100);
    const current = makeHashDir(v, t, 'dddd', 0);

    const result = cleanupStaleNativeCache({
      cacheBase: root,
      version: v,
      target: t,
      currentRoot: current,
    });

    expect(result.kept.toSorted()).toEqual([recent, current].toSorted());
    expect(result.removed.toSorted()).toEqual([oldest, middle].toSorted());

    expect(readdirSync(join(root, 'native', v, t)).toSorted()).toEqual(['cccc', 'dddd']);
  });

  it('no-op when only currentRoot exists', () => {
    const v = '1.0.0';
    const t = 'darwin-arm64';
    const current = makeHashDir(v, t, 'dddd');

    const result = cleanupStaleNativeCache({
      cacheBase: root,
      version: v,
      target: t,
      currentRoot: current,
    });

    expect(result.kept).toEqual([current]);
    expect(result.removed).toEqual([]);
  });

  it('no-op when target dir does not exist', () => {
    const result = cleanupStaleNativeCache({
      cacheBase: root,
      version: '1.0.0',
      target: 'darwin-arm64',
      currentRoot: join(root, 'native', '1.0.0', 'darwin-arm64', 'absent'),
    });
    expect(result.kept).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('does not touch other targets or versions', () => {
    const current = makeHashDir('1.0.0', 'darwin-arm64', 'dddd');
    const otherTarget = makeHashDir('1.0.0', 'linux-x64', 'eeee');
    const otherVersion = makeHashDir('0.9.0', 'darwin-arm64', 'ffff');

    cleanupStaleNativeCache({
      cacheBase: root,
      version: '1.0.0',
      target: 'darwin-arm64',
      currentRoot: current,
    });

    expect(statSync(otherTarget).isDirectory()).toBe(true);
    expect(statSync(otherVersion).isDirectory()).toBe(true);
  });

  it('errors array is empty on clean run', () => {
    const current = makeHashDir('1.0.0', 'darwin-arm64', 'dddd');
    const result = cleanupStaleNativeCache({
      cacheBase: root,
      version: '1.0.0',
      target: 'darwin-arm64',
      currentRoot: current,
    });
    expect(result.errors).toEqual([]);
  });
});

describe('cleanupStaleWebAssetCache', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'omnicode-web-cache-gc-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function makeWebDir(version: string, hash: string, mtimeOffset = 0): string {
    const distWeb = join(root, 'web', version, 'linux-x64', hash, 'dist-web');
    mkdirSync(distWeb, { recursive: true });
    writeFileSync(join(distWeb, 'index.html'), hash);
    const now = Math.floor(Date.now() / 1000);
    utimesSync(join(root, 'web', version, 'linux-x64', hash), now + mtimeOffset, now + mtimeOffset);
    utimesSync(join(root, 'web', version), now + mtimeOffset, now + mtimeOffset);
    return distWeb;
  }

  it('keeps the current manifest dir plus the newest sibling', () => {
    const oldest = makeWebDir('1.0.0', 'aaaa', -300);
    const recent = makeWebDir('1.0.0', 'cccc', -100);
    const current = makeWebDir('1.0.0', 'dddd', 0);

    const result = cleanupStaleWebAssetCache({
      cacheBase: root,
      version: '1.0.0',
      currentRoot: current,
    });

    expect(result.removed).toEqual([join(oldest, '..')]);
    expect(result.kept).toContain(join(recent, '..'));
    expect(result.kept).toContain(join(current, '..'));
    expect(readdirSync(join(root, 'web', '1.0.0', 'linux-x64')).toSorted()).toEqual([
      'cccc',
      'dddd',
    ]);
  });

  it('prunes older version trees but keeps the current one', () => {
    const oldVersion = makeWebDir('0.9.0', 'aaaa', -400);
    const previousVersion = makeWebDir('0.9.5', 'bbbb', -200);
    const current = makeWebDir('1.0.0', 'cccc', 0);

    const result = cleanupStaleWebAssetCache({
      cacheBase: root,
      version: '1.0.0',
      currentRoot: current,
    });

    expect(result.removed).toContain(join(root, 'web', '0.9.0'));
    expect(existsSync(oldVersion)).toBe(false);
    expect(readdirSync(join(root, 'web')).toSorted()).toEqual(['0.9.5', '1.0.0']);
    expect(statSync(previousVersion).isDirectory()).toBe(true);
    expect(statSync(current).isDirectory()).toBe(true);
  });

  it('is a no-op when the web cache does not exist', () => {
    const result = cleanupStaleWebAssetCache({
      cacheBase: root,
      version: '1.0.0',
      currentRoot: join(root, 'web', '1.0.0', 'linux-x64', 'absent', 'dist-web'),
    });

    expect(result.kept).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('reports no errors on a clean run', () => {
    const current = makeWebDir('1.0.0', 'dddd');
    const result = cleanupStaleWebAssetCache({
      cacheBase: root,
      version: '1.0.0',
      currentRoot: current,
    });

    expect(result.errors).toEqual([]);
  });
});
