import { request } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type RunningServer, startServer } from '../src/start';
import { TEST_HOST_IDENTITY } from './helpers/hostIdentity';
import { bearerToken } from './helpers/auth';

interface Envelope<T> {
  code: number;
  msg: string;
  data: T;
  request_id: string;
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

describe('response compression', () => {
  let server: RunningServer | undefined;
  let home: string | undefined;
  let token = '';

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'omnicode-server-compression-'));
    await writeFile(
      join(home, 'config.toml'),
      Array.from(
        { length: 400 },
        (_, i) => `[models."alias-${i}"]\nprovider = "openai"\nmodel = "gpt-4o"\n`,
      ).join(''),
      'utf-8',
    );
    server = await startServer({
      hostIdentity: TEST_HOST_IDENTITY,
      host: '127.0.0.1',
      port: 0,
      homeDir: home,
      logLevel: 'silent',
    });
    token = bearerToken(server);
  }, 60_000);

  afterAll(async () => {
    if (server !== undefined) {
      await server.close();
      server = undefined;
    }
    if (home !== undefined) {
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 } as never);
      home = undefined;
    }
  });

  function get(path: string, acceptEncoding: string): Promise<RawResponse> {
    const port = (server as RunningServer).port;
    return new Promise((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path,
          method: 'GET',
          headers: { authorization: `Bearer ${token}`, 'accept-encoding': acceptEncoding },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  it.each(['/api/v1/config', '/api/v1/meta'])(
    'gzip-decodes the envelope body of %s to the same JSON as the identity response',
    async (path) => {
      const plain = await get(path, 'identity');
      expect(plain.status).toBe(200);
      const plainBody = JSON.parse(plain.body.toString('utf-8')) as Envelope<unknown>;
      expect(plainBody.code).toBe(0);

      const compressed = await get(path, 'gzip');
      expect(compressed.status).toBe(200);
      expect(compressed.headers['content-encoding']).toBe('gzip');
      expect(compressed.body.length).toBeGreaterThan(0);
      const decoded = JSON.parse(gunzipSync(compressed.body).toString('utf-8')) as Envelope<unknown>;
      expect(decoded.data).toEqual(plainBody.data);
    },
    30_000,
  );

  it('compresses a large envelope to a third of its plain size', async () => {
    const plain = await get('/api/v1/config', 'identity');
    const compressed = await get('/api/v1/config', 'gzip');
    expect(plain.body.length).toBeGreaterThan(10_000);
    expect(compressed.body.length).toBeLessThan(plain.body.length / 3);
  });
});