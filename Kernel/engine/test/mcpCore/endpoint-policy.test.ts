import { describe, expect, it } from 'vitest';

import { checkMcpEndpoint, isPrivateHost } from '#/mcpCore/endpoint-policy';
import { createMcpRedirectGuardFetch } from '#/mcpCore/remote-guard';

describe('checkMcpEndpoint', () => {
  it('accepts an https endpoint on a public host', () => {
    const check = checkMcpEndpoint('https://mcp.example.com/mcp');
    expect(check.ok).toBe(true);
  });

  it('accepts a loopback endpoint over plain http', () => {
    expect(checkMcpEndpoint('http://127.0.0.1:3000/mcp').ok).toBe(true);
    expect(checkMcpEndpoint('http://localhost:3000/mcp').ok).toBe(true);
  });

  it('rejects a scheme that is not http or https', () => {
    for (const url of [
      'file:///etc/passwd',
      'ftp://example.com/mcp',
      'javascript:alert(1)',
      'data:text/plain,hi',
    ]) {
      const check = checkMcpEndpoint(url);
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.reason).toContain('scheme');
    }
  });

  it('rejects plain http for a remote host', () => {
    const check = checkMcpEndpoint('http://mcp.example.com/mcp');
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain('https');
  });

  it('rejects private and link-local destinations', () => {
    for (const url of [
      'https://169.254.169.254/latest/meta-data',
      'https://10.0.0.5/mcp',
      'https://192.168.1.10/mcp',
      'https://172.16.4.4/mcp',
      'https://[fd00::1]/mcp',
      'https://[fe80::1]/mcp',
    ]) {
      const check = checkMcpEndpoint(url);
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.reason).toContain('allowPrivateNetwork');
    }
  });

  it('allows a private destination only when the server opts in', () => {
    const check = checkMcpEndpoint('https://10.0.0.5/mcp', { allowPrivateNetwork: true });
    expect(check.ok).toBe(true);
  });

  it('rejects an empty or malformed url', () => {
    expect(checkMcpEndpoint('   ').ok).toBe(false);
    expect(checkMcpEndpoint('not a url').ok).toBe(false);
  });
});

describe('isPrivateHost', () => {
  it('treats loopback as local, not private', () => {
    expect(isPrivateHost('127.0.0.1')).toBe(false);
    expect(isPrivateHost('localhost')).toBe(false);
  });

  it('treats private and link-local ranges as private', () => {
    expect(isPrivateHost('10.1.2.3')).toBe(true);
    expect(isPrivateHost('169.254.169.254')).toBe(true);
    expect(isPrivateHost('[fd00::1]')).toBe(true);
  });
});

describe('createMcpRedirectGuardFetch', () => {
  const base = new URL('https://mcp.example.com/mcp');

  it('passes a normal response through', async () => {
    const fetchImpl = (async () => new Response('ok', { status: 200 })) as typeof fetch;
    const guarded = createMcpRedirectGuardFetch(base, fetchImpl);

    const response = await guarded(base);

    expect(response.status).toBe(200);
  });

  it('never lets fetch follow a redirect on its own', async () => {
    let seenRedirect: string | undefined;
    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      seenRedirect = init?.redirect;
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;
    const guarded = createMcpRedirectGuardFetch(base, fetchImpl);

    await guarded(base);

    expect(seenRedirect).toBe('manual');
  });

  it('refuses a redirect to a different origin', async () => {
    const fetchImpl = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://attacker.example.net/steal' },
      })) as typeof fetch;
    const guarded = createMcpRedirectGuardFetch(base, fetchImpl);

    await expect(guarded(base)).rejects.toThrow(/different origin/);
  });

  it('follows a same-origin redirect manually', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      seen.push(String(input));
      if (seen.length === 1) {
        return new Response(null, {
          status: 307,
          headers: { location: 'https://mcp.example.com/mcp2' },
        });
      }
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;
    const guarded = createMcpRedirectGuardFetch(base, fetchImpl);

    const response = await guarded(base);

    expect(response.status).toBe(200);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe('https://mcp.example.com/mcp2');
  });
});
