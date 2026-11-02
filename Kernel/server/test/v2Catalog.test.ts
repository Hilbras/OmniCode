import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type RunningServer, startServer } from '../src/start';
import { authHeaders } from './helpers/auth';
import { TEST_HOST_IDENTITY } from './helpers/hostIdentity';

interface Envelope<T = unknown> {
  code: number;
  msg: string;
  data: T | null;
  request_id: string;
}

interface CatalogEntryWire {
  name: string;
  description: string;
  source: string;
  path: string;
  when_to_use?: string;
  disabled?: boolean;
}

interface DisabledListWire {
  disabled: string[];
}

interface ImportSummaryWire {
  imported: string[];
  skipped: string[];
  errors: string[];
}

describe('server /api/v2 catalog management', () => {
  let server: RunningServer | undefined;
  let home: string | undefined;
  let base: string;

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'omnicode-server-v2-catalog-'));
    server = await startServer({
      hostIdentity: TEST_HOST_IDENTITY,
      host: '127.0.0.1',
      port: 0,
      homeDir: home,
      logLevel: 'silent',
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    if (server !== undefined) {
      await server.close();
      server = undefined;
    }
    if (home !== undefined) {
      await rm(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 } as never);
      home = undefined;
    }
  });

  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; headers: Headers; body: Envelope<T> }> {
    const headers = authHeaders(server as RunningServer, {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...extraHeaders,
    });
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, headers: res.headers, body: (await res.json()) as Envelope<T> };
  }

  async function upload<T>(path: string, bytes: Buffer, fileName: string): Promise<Envelope<T>> {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'application/zip' }), fileName);
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: authHeaders(server as RunningServer),
      body: form,
    });
    return (await res.json()) as Envelope<T>;
  }

  it('creates, lists, exports and re-imports a skill', async () => {
    const created = await call<CatalogEntryWire>('POST', '/api/v2/skills', {
      name: 'release-notes',
      description: 'Draft release notes',
      content: 'Summarise the changes since the last tag.',
    });
    expect(created.status).toBe(200);
    expect(created.body.code).toBe(0);
    expect(created.body.data).toMatchObject({ name: 'release-notes', source: 'user' });

    const listed = await call<CatalogEntryWire[]>('GET', '/api/v2/skills');
    expect(listed.body.data?.map((entry) => entry.name)).toContain('release-notes');

    const duplicate = await call('POST', '/api/v2/skills', {
      name: 'release-notes',
      description: 'Again',
      content: 'Body',
    });
    expect(duplicate.body.code).toBe(40001);

    const exported = await fetch(`${base}/api/v2/skills:export`, {
      headers: authHeaders(server as RunningServer),
    });
    expect(exported.headers.get('content-type')).toContain('application/zip');
    const archive = Buffer.from(await exported.arrayBuffer());
    expect(archive.subarray(0, 2).toString('latin1')).toBe('PK');

    const imported = await upload<ImportSummaryWire>('/api/v2/skills:import', archive, 'skills.zip');
    expect(imported.code).toBe(0);
    expect(imported.data?.imported).toEqual([]);
    expect(imported.data?.skipped).toContain('release-notes');
  });

  it('validates skill names and content', async () => {
    const invalidName = await call('POST', '/api/v2/skills', {
      name: '../escape',
      description: 'x',
      content: 'Body',
    });
    expect(invalidName.body.code).toBe(40001);
    const emptyBody = await call('POST', '/api/v2/skills', {
      name: 'valid-name',
      description: 'x',
      content: '   ',
    });
    expect(emptyBody.body.code).toBe(40001);
  });

  it('rejects import payloads that are not archives', async () => {
    const result = await upload<ImportSummaryWire>('/api/v2/skills:import', Buffer.from('not a zip'), 'bad.zip');
    expect(result.code).toBe(40001);
  });

  it('disables and enables skills and reflects disabled in the list', async () => {
    const created = await call<CatalogEntryWire>('POST', '/api/v2/skills', {
      name: 'toggle-skill',
      description: 'Toggles',
      content: 'Body.',
    });
    expect(created.body.code).toBe(0);
    expect(created.body.data?.disabled).toBe(false);

    const listed0 = await call<CatalogEntryWire[]>('GET', '/api/v2/skills');
    expect(listed0.body.data?.find((entry) => entry.name === 'toggle-skill')?.disabled).toBe(false);

    const disabled = await call<DisabledListWire>('POST', '/api/v2/skills/toggle-skill/disable');
    expect(disabled.body.code).toBe(0);
    expect(disabled.body.data?.disabled).toEqual(['toggle-skill']);

    const listed = await call<CatalogEntryWire[]>('GET', '/api/v2/skills');
    expect(listed.body.data?.find((entry) => entry.name === 'toggle-skill')?.disabled).toBe(true);

    const again = await call<DisabledListWire>('POST', '/api/v2/skills/TOGGLE-SKILL/disable');
    expect(again.body.code).toBe(0);
    expect(again.body.data?.disabled).toEqual(['toggle-skill']);

    const unknown = await call('POST', '/api/v2/skills/no-such-skill/disable');
    expect(unknown.body.code).toBe(40415);

    const enabled = await call<DisabledListWire>('POST', '/api/v2/skills/toggle-skill/enable');
    expect(enabled.body.code).toBe(0);
    expect(enabled.body.data?.disabled).toEqual([]);

    const listed2 = await call<CatalogEntryWire[]>('GET', '/api/v2/skills');
    expect(listed2.body.data?.find((entry) => entry.name === 'toggle-skill')?.disabled).toBe(false);
  });

  it('creates, exports and imports agent profiles', async () => {
    const created = await call<CatalogEntryWire>('POST', '/api/v2/agents', {
      name: 'code-reviewer',
      description: 'Reviews diffs',
      when_to_use: 'Before merging',
      content: 'Review the diff and list issues.',
    });
    expect(created.body.data).toMatchObject({ name: 'code-reviewer', source: 'user' });

    const listed = await call<CatalogEntryWire[]>('GET', '/api/v2/agents');
    expect(listed.body.data?.find((entry) => entry.name === 'code-reviewer')?.when_to_use).toBe(
      'Before merging',
    );

    const exported = await fetch(`${base}/api/v2/agents:export`, {
      headers: authHeaders(server as RunningServer),
    });
    const archive = Buffer.from(await exported.arrayBuffer());
    const imported = await upload<ImportSummaryWire>('/api/v2/agents:import', archive, 'agents.zip');
    expect(imported.data).toEqual({ imported: [], skipped: ['code-reviewer'], errors: [] });
  });

  it('exports MCP servers with blanked secrets and imports with conflict skipping', async () => {
    const added = await call('POST', '/api/v2/mcp/servers', {
      name: 'catalog-remote',
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer super-secret' },
    });
    expect(added.body.code).toBe(0);

    const exported = await fetch(`${base}/api/v2/mcp/servers:export`, {
      headers: authHeaders(server as RunningServer),
    });
    const text = await exported.text();
    expect(text).not.toContain('super-secret');
    const parsed = JSON.parse(text) as {
      mcpServers: Record<string, { headers?: Record<string, string> }>;
    };
    expect(parsed.mcpServers['catalog-remote']?.headers).toEqual({ Authorization: '' });

    const imported = await call<ImportSummaryWire>('POST', '/api/v2/mcp/servers:import', {
      mcpServers: {
        'catalog-remote': {
          transport: 'http',
          url: 'https://example.com/mcp',
        },
        'catalog-fresh': { transport: 'stdio', command: 'serve-fresh' },
      },
    });
    expect(imported.body.code).toBe(0);
    expect(imported.body.data?.imported).toEqual(['catalog-fresh']);
    expect(imported.body.data?.skipped).toEqual(['catalog-remote']);
  });
});
