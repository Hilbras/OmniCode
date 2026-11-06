import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import compress from '@fastify/compress';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerWebAssetRoutes } from '../src/routes/webAssets';

describe('web asset cache policy', () => {
  let app: FastifyInstance;
  let assetsDir: string;

  beforeEach(async () => {
    assetsDir = await mkdtemp(join(tmpdir(), 'omnicode-web-assets-'));
    await mkdir(join(assetsDir, 'assets'));
    await Promise.all([
      writeFile(join(assetsDir, 'index.html'), '<main>Omnicode</main>'),
      writeFile(join(assetsDir, 'assets', 'index-Dy7xs5tu.js'), 'export {};'),
      writeFile(join(assetsDir, 'assets', 'application-configuration.json'), '{}'),
      writeFile(join(assetsDir, 'favicon.svg'), '<svg></svg>'),
    ]);
    app = Fastify();
    await app.register(compress, { global: true, threshold: 1024 });
    await registerWebAssetRoutes(app, assetsDir);
  });

  afterEach(async () => {
    await app.close();
    await rm(assetsDir, { recursive: true, force: true });
  });

  it('caches content-hashed assets as immutable', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/index-Dy7xs5tu.js' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('serves a large asset compressed when the client accepts gzip', async () => {
    const body = 'export const payload = 1;\n'.repeat(200);
    await writeFile(join(assetsDir, 'assets', 'large-Dy7xs5tu.js'), body);

    const compressed = await app.inject({
      method: 'GET',
      url: '/assets/large-Dy7xs5tu.js',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(compressed.statusCode).toBe(200);
    expect(compressed.headers['content-encoding']).toBe('gzip');
    expect(compressed.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    const plain = await app.inject({ method: 'GET', url: '/assets/large-Dy7xs5tu.js' });
    expect(plain.statusCode).toBe(200);
    expect(plain.headers['content-encoding']).toBeUndefined();
  });

  it('leaves assets under the compression threshold uncompressed', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/assets/index-Dy7xs5tu.js',
      headers: { 'accept-encoding': 'gzip' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBeUndefined();
  });

  it.each([
    '/index.html',
    '/sessions/active',
    '/favicon.svg',
    '/assets/application-configuration.json',
  ])(
    'requires revalidation for %s',
    async (url) => {
      const response = await app.inject({ method: 'GET', url });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-cache');
    },
  );
});
