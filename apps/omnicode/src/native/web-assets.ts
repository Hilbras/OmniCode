import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { OMNICODE_BUILD_INFO } from '#/cli/build-info';

import {
  WEB_ASSET_MANIFEST_VERSION as MANIFEST_VERSION,
  buildWebManifestKey,
} from '../../scripts/native/manifest.mjs';
import { getNativeCacheBase, getSeaAssetSource, type NativeAssetSource } from './native-assets';

export const WEB_ASSET_MANIFEST_VERSION = MANIFEST_VERSION;

export interface WebAssetFile {
  readonly assetKey: string;
  readonly relativePath: string;
  readonly sha256: string;
}

export interface WebAssetManifest {
  readonly version: typeof WEB_ASSET_MANIFEST_VERSION;
  readonly target: string;
  readonly root: 'dist-web';
  readonly files: readonly WebAssetFile[];
}

export type WebAssetSource = NativeAssetSource;

export interface WebAssetOptions {
  readonly source?: WebAssetSource | null;
  readonly manifest?: WebAssetManifest | null;
  readonly cacheBase?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly homeDir?: string;
  readonly version?: string;
}

type RawWebAssetManifest = Omit<WebAssetManifest, 'version' | 'root'> & {
  readonly version: number;
  readonly root: string;
};

function currentTarget(): string {
  return OMNICODE_BUILD_INFO.buildTarget ?? `${process.platform}-${process.arch}`;
}

function toBuffer(value: ArrayBuffer | ArrayBufferView | Buffer | string): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return Buffer.from(value);
}

function sha256(bytes: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sanitizeSegment(value: string): string {
  const sanitized = value.replaceAll(/[^a-zA-Z0-9._-]/g, '_');
  return sanitized.length > 0 ? sanitized : 'unknown';
}

function readFileSha256(path: string): string | null {
  try {
    return sha256(readFileSync(path));
  } catch {
    return null;
  }
}

function ensureFile(path: string, bytes: Buffer, expectedSha256: string): void {
  if (readFileSha256(path) === expectedSha256) return;

  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, bytes, { mode: 0o644 });

  try {
    renameSync(tempPath, path);
    return;
  } catch {
    if (readFileSha256(path) === expectedSha256) {
      rmSync(tempPath, { force: true });
      return;
    }
  }

  try {
    rmSync(path, { force: true });
    renameSync(tempPath, path);
  } catch (error) {
    rmSync(tempPath, { force: true });
    if (readFileSha256(path) === expectedSha256) return;
    throw error;
  }
}

const MATERIALIZED_SENTINEL = '.materialized.json';
const MATERIALIZED_SENTINEL_VERSION = 1;
const VERIFY_ENV = 'OMNICODE_VERIFY_WEB_ASSETS';

interface MaterializedEntry {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
}

interface MaterializedSentinel {
  readonly version: typeof MATERIALIZED_SENTINEL_VERSION;
  readonly manifestHash: string;
  readonly files: readonly MaterializedEntry[];
}

function materializedSentinelPath(cacheRoot: string): string {
  return join(dirname(cacheRoot), MATERIALIZED_SENTINEL);
}

function readMaterializedSentinel(path: string): MaterializedSentinel | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (record['version'] !== MATERIALIZED_SENTINEL_VERSION) return null;
    if (typeof record['manifestHash'] !== 'string') return null;
    if (!Array.isArray(record['files'])) return null;
    return parsed as MaterializedSentinel;
  } catch {
    return null;
  }
}

function statOrNull(path: string): { size: number; mtimeMs: number } | null {
  try {
    const info = statSync(path);
    return info.isFile() ? { size: info.size, mtimeMs: info.mtimeMs } : null;
  } catch {
    return null;
  }
}

function cacheMatchesManifest(
  cacheRoot: string,
  manifest: WebAssetManifest,
  sentinel: MaterializedSentinel | null,
): boolean {
  if (sentinel === null || sentinel.manifestHash !== sha256(JSON.stringify(manifest))) return false;
  if (sentinel.files.length !== manifest.files.length) return false;
  const recorded = new Map(sentinel.files.map((entry) => [entry.path, entry]));
  for (const file of manifest.files) {
    const expected = recorded.get(file.relativePath);
    if (expected === undefined) return false;
    const actual = statOrNull(join(cacheRoot, file.relativePath));
    if (actual === null || actual.size !== expected.size || actual.mtimeMs !== expected.mtimeMs) {
      return false;
    }
  }
  return true;
}

function writeMaterializedSentinel(cacheRoot: string, manifest: WebAssetManifest): void {
  const files: MaterializedEntry[] = [];
  for (const file of manifest.files) {
    const info = statOrNull(join(cacheRoot, file.relativePath));
    if (info === null) return;
    files.push({ path: file.relativePath, size: info.size, mtimeMs: info.mtimeMs });
  }
  const sentinel: MaterializedSentinel = {
    version: MATERIALIZED_SENTINEL_VERSION,
    manifestHash: sha256(JSON.stringify(manifest)),
    files,
  };
  const path = materializedSentinelPath(cacheRoot);
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tempPath, JSON.stringify(sentinel), { mode: 0o644 });
    renameSync(tempPath, path);
  } catch {
    rmSync(tempPath, { force: true });
  }
}

function verificationForced(options: WebAssetOptions): boolean {
  return (options.env ?? process.env)[VERIFY_ENV] === '1';
}

function assertSafeRelativePath(relativePath: string): void {
  if (
    relativePath.length === 0 ||
    relativePath.startsWith('/') ||
    relativePath.includes('\\') ||
    relativePath.split('/').includes('..') ||
    /^[A-Za-z]:/.test(relativePath)
  ) {
    throw new Error(`Invalid web asset relative path: ${relativePath}`);
  }
}

export function webAssetManifestKey(target: string = currentTarget()): string {
  return buildWebManifestKey(target);
}

export function getEmbeddedWebAssetManifest(
  source: WebAssetSource | null = getSeaAssetSource(),
  target = currentTarget(),
): WebAssetManifest | null {
  if (source === null) return null;
  const key = webAssetManifestKey(target);
  if (!source.getAssetKeys().includes(key)) return null;
  const raw = source.getRawAsset(key);
  const manifest = JSON.parse(toBuffer(raw).toString('utf-8')) as RawWebAssetManifest;
  if (manifest.version !== WEB_ASSET_MANIFEST_VERSION) {
    throw new Error(`Unsupported web asset manifest version: ${manifest.version}`);
  }
  if (manifest.target !== target) {
    throw new Error(`Web asset manifest target mismatch: ${manifest.target} !== ${target}`);
  }
  if (manifest.root !== 'dist-web') {
    throw new Error(`Unsupported web asset root: ${manifest.root}`);
  }
  return manifest as WebAssetManifest;
}

export function getWebAssetCacheRoot(
  manifest: WebAssetManifest,
  options: WebAssetOptions = {},
): string {
  const version = sanitizeSegment(options.version ?? OMNICODE_BUILD_INFO.version ?? 'dev');
  const manifestHash = sha256(JSON.stringify(manifest));
  return join(
    getNativeCacheBase({
      cacheBase: options.cacheBase,
      env: options.env,
      platform: options.platform,
      homeDir: options.homeDir,
    }),
    'web',
    version,
    sanitizeSegment(manifest.target),
    manifestHash,
    manifest.root,
  );
}

export interface WebCacheCleanupResult {
  readonly kept: string[];
  readonly removed: string[];
  readonly errors: Array<{ path: string; error: unknown }>;
}

export interface WebCacheCleanupOptions {
  readonly cacheBase: string;
  readonly version: string;
  readonly currentRoot: string;
}

function pruneDirectories(
  parentDir: string,
  keep: readonly string[],
  result: WebCacheCleanupResult,
): void {
  let entries: string[];
  try {
    entries = readdirSync(parentDir);
  } catch {
    return;
  }
  const candidates: Array<{ path: string; mtimeMs: number }> = [];
  for (const name of entries) {
    const path = join(parentDir, name);
    try {
      const info = statSync(path);
      if (!info.isDirectory()) continue;
      candidates.push({ path, mtimeMs: info.mtimeMs });
    } catch (error) {
      result.errors.push({ path, error });
    }
  }
  if (candidates.length === 0) return;

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const protectedPaths = new Set(keep);
  const newestOther = candidates.find((candidate) => !protectedPaths.has(candidate.path));
  if (newestOther !== undefined) protectedPaths.add(newestOther.path);

  for (const { path } of candidates) {
    if (protectedPaths.has(path)) {
      result.kept.push(path);
      continue;
    }
    try {
      rmSync(path, { recursive: true, force: true });
      result.removed.push(path);
    } catch (error) {
      result.errors.push({ path, error });
    }
  }
}

export function cleanupStaleWebAssetCache(options: WebCacheCleanupOptions): WebCacheCleanupResult {
  const result: WebCacheCleanupResult = { kept: [], removed: [], errors: [] };
  const webDir = join(options.cacheBase, 'web');
  const versionDir = join(webDir, sanitizeSegment(options.version));
  const currentManifestDir = dirname(options.currentRoot);

  pruneDirectories(dirname(currentManifestDir), [currentManifestDir], result);
  pruneDirectories(webDir, [versionDir], result);
  return result;
}

export function cleanupStaleWebAssetCacheForCurrent(
  options: WebAssetOptions = {},
): WebCacheCleanupResult | null {
  const source = options.source ?? getSeaAssetSource();
  if (source === null) return null;

  const manifest = options.manifest ?? getEmbeddedWebAssetManifest(source, currentTarget());
  if (manifest === null) return null;

  return cleanupStaleWebAssetCache({
    cacheBase: getNativeCacheBase({
      cacheBase: options.cacheBase,
      env: options.env,
      platform: options.platform,
      homeDir: options.homeDir,
    }),
    version: options.version ?? OMNICODE_BUILD_INFO.version ?? 'dev',
    currentRoot: getWebAssetCacheRoot(manifest, options),
  });
}

export function getNativeWebAssetsDir(options: WebAssetOptions = {}): string | null {
  const source = options.source ?? getSeaAssetSource();
  if (source === null) return null;

  const manifest = options.manifest ?? getEmbeddedWebAssetManifest(source, currentTarget());
  if (manifest === null) return null;

  const cacheRoot = getWebAssetCacheRoot(manifest, options);
  if (!verificationForced(options)) {
    const sentinel = readMaterializedSentinel(materializedSentinelPath(cacheRoot));
    if (cacheMatchesManifest(cacheRoot, manifest, sentinel)) return cacheRoot;
  }
  for (const file of manifest.files) {
    assertSafeRelativePath(file.relativePath);
    const bytes = toBuffer(source.getRawAsset(file.assetKey));
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== file.sha256) {
      throw new Error(
        `Web asset checksum mismatch for ${file.assetKey}: ${actualSha256} !== ${file.sha256}`,
      );
    }
    ensureFile(join(cacheRoot, file.relativePath), bytes, file.sha256);
  }
  writeMaterializedSentinel(cacheRoot, manifest);
  return cacheRoot;
}
