import { connect } from 'node:net';
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import {
  EgressProxyService,
  egressProxyEnv,
  isEgressAllowed,
  parseEgressRule,
} from '#/app/egress/egressProxy';

const rules = ['api.example.com', '*.example.org', 'files.example.net:8443']
  .map(parseEgressRule)
  .filter((rule) => rule !== undefined);

describe('egress rules', () => {
  it('matches exact hosts, wildcards, and ports', () => {
    expect(isEgressAllowed('api.example.com', 443, rules, false)).toBe(true);
    expect(isEgressAllowed('a.example.org', 443, rules, false)).toBe(true);
    expect(isEgressAllowed('example.org', 443, rules, false)).toBe(true);
    expect(isEgressAllowed('evil.example.org', 443, rules, false)).toBe(true);
    expect(isEgressAllowed('example.com', 443, rules, false)).toBe(false);
    expect(isEgressAllowed('files.example.net', 8443, rules, false)).toBe(true);
    expect(isEgressAllowed('files.example.net', 443, rules, false)).toBe(false);
  });

  it('denies private and loopback destinations unless explicitly allowed', () => {
    expect(isEgressAllowed('10.0.0.5', 80, rules, false)).toBe(false);
    expect(isEgressAllowed('127.0.0.1', 80, rules, true)).toBe(false);
    const local = [parseEgressRule('127.0.0.1')!];
    expect(isEgressAllowed('127.0.0.1', 80, local, true)).toBe(true);
  });
});

describe('EgressProxyService', () => {
  it('forwards an allowed request and denies another host', async () => {
    const target = createServer((_req, res) => res.end('ok'));
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const address = target.address();
    if (address === null || typeof address === 'string') throw new Error('no address');
    const port = address.port;

    const service = new EgressProxyService(
      {
        get: () => ({ enabled: true, allow: [`127.0.0.1:${String(port)}`], allowPrivate: true }),
      } as never,
      { child: () => ({ info: vi.fn() }) } as never,
    );
    await service.ready();
    expect(service.url).toBeDefined();
    expect(egressProxyEnv()['HTTP_PROXY']).toBe(service.url);

    const ok = await get(service.url!, `http://127.0.0.1:${String(port)}/`);
    expect(ok).toBe('ok');
    const denied = await get(service.url!, 'http://denied.invalid/');
    expect(denied).toBe('403');

    service.dispose();
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });

  it('refuses a CONNECT to a host outside the allow list', async () => {
    const service = new EgressProxyService(
      { get: () => ({ enabled: true, allow: ['allowed.example'], allowPrivate: false }) } as never,
      { child: () => ({ info: vi.fn() }) } as never,
    );
    await service.ready();
    const response = await connectTo(service.url!, 'denied.invalid:443');
    expect(response).toContain('403');
    service.dispose();
  });
});

function get(proxyUrl: string, url: string): Promise<string> {
  const proxy = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: proxy.hostname, port: Number(proxy.port), path: url, method: 'GET' },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => resolve(res.statusCode === 200 ? body : String(res.statusCode)));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function connectTo(proxyUrl: string, target: string): Promise<string> {
  const proxy = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const socket = connect(Number(proxy.port), proxy.hostname, () => {
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    });
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      data += chunk;
      if (data.includes('\r\n')) {
        socket.destroy();
        resolve(data.split('\r\n')[0] ?? '');
      }
    });
    socket.on('error', reject);
  });
}
