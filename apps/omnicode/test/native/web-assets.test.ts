import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  getNativeWebAssetsDir,
  getWebAssetCacheRoot,
  WEB_ASSET_MANIFEST_VERSION,
  type WebAssetManifest,
  type WebAssetSource,
} from '#/native/web-assets';

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function fakeWebAssets(files: Record<string, string>): {
  manifest: WebAssetManifest;
  source: WebAssetSource;
} {
  const manifest: WebAssetManifest = {
    version: WEB_ASSET_MANIFEST_VERSION,
    target: 'test-target',
    root: 'dist-web',
    files: Object.entries(files).map(([relativePath, content]) => ({
      assetKey: `web/test-target/dist-web/${relativePath}`,
      relativePath,
      sha256: sha256(content),
    })),
  };
  const assets = new Map<string, Buffer>([
    ['web/test-target/manifest.json', Buffer.from(JSON.stringify(manifest))],
    ...Object.entries(files).map(([relativePath, content]) => [
      `web/test-target/dist-web/${relativePath}`,
      Buffer.from(content),
    ] as const),
  ]);
  return {
    manifest,
    source: {
      getAssetKeys: () => [...assets.keys()],
      getRawAsset: (assetKey) => {
        const asset = assets.get(assetKey);
        if (asset === undefined) throw new Error(`missing test asset: ${assetKey}`);
        return asset;
      },
    },
  };
}

describe('web assets', () => {
  it('extracts embedded web assets into a dist-web cache directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omnicode-web-assets-runtime-'));
    try {
      const { manifest, source } = fakeWebAssets({
        'index.html': '<div id="app"></div>\n',
        'assets/app.js': 'console.log("ok");\n',
      });

      const webDir = getNativeWebAssetsDir({
        cacheBase: dir,
        manifest,
        source,
        version: 'test',
      });

      expect(webDir).toBe(getWebAssetCacheRoot(manifest, { cacheBase: dir, version: 'test' }));
      expect(readFileSync(join(webDir ?? '', 'index.html'), 'utf-8')).toBe('<div id="app"></div>\n');
      expect(readFileSync(join(webDir ?? '', 'assets', 'app.js'), 'utf-8')).toBe(
        'console.log("ok");\n',
      );
      expect(existsSync(join(dir, 'web', 'test', 'test-target'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('repairs corrupted extracted files on the next lookup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omnicode-web-assets-repair-'));
    try {
      const { manifest, source } = fakeWebAssets({
        'index.html': '<html></html>',
      });

      const webDir = getNativeWebAssetsDir({
        cacheBase: dir,
        manifest,
        source,
        version: 'test',
      });
      writeFileSync(join(webDir ?? '', 'index.html'), 'broken');

      const repairedDir = getNativeWebAssetsDir({
        cacheBase: dir,
        manifest,
        source,
        version: 'test',
      });

      expect(repairedDir).toBe(webDir);
      expect(readFileSync(join(repairedDir ?? '', 'index.html'), 'utf-8')).toBe('<html></html>');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips re-reading embedded assets once the cache is materialized', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omnicode-web-assets-sentinel-'));
    try {
      const { manifest, source } = fakeWebAssets({
        'index.html': '<div id="app"></div>\n',
        'assets/app.js': 'console.log("ok");\n',
      });
      let reads = 0;
      const counting: WebAssetSource = {
        getAssetKeys: () => source.getAssetKeys(),
        getRawAsset: (assetKey) => {
          reads += 1;
          return source.getRawAsset(assetKey);
        },
      };

      const first = getNativeWebAssetsDir({
        cacheBase: dir,
        manifest,
        source: counting,
        version: 'test',
      });
      expect(reads).toBeGreaterThan(0);

      const readsAfterFirst = reads;
      const second = getNativeWebAssetsDir({
        cacheBase: dir,
        manifest,
        source: counting,
        version: 'test',
      });

      expect(second).toBe(first);
      expect(reads).toBe(readsAfterFirst);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('re-reads embedded assets when verification is forced', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omnicode-web-assets-verify-'));
    try {
      const { manifest, source } = fakeWebAssets({ 'index.html': '<html></html>' });
      let reads = 0;
      const counting: WebAssetSource = {
        getAssetKeys: () => source.getAssetKeys(),
        getRawAsset: (assetKey) => {
          reads += 1;
          return source.getRawAsset(assetKey);
        },
      };

      getNativeWebAssetsDir({ cacheBase: dir, manifest, source: counting, version: 'test' });
      const readsAfterFirst = reads;

      getNativeWebAssetsDir({
        cacheBase: dir,
        manifest,
        source: counting,
        version: 'test',
        env: { OMNICODE_VERIFY_WEB_ASSETS: '1' },
      });

      expect(reads).toBeGreaterThan(readsAfterFirst);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when no SEA web asset source is available', () => {
    expect(getNativeWebAssetsDir({ source: null })).toBeNull();
  });
});
