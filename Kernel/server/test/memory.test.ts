import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { resumeSessionById } from '@hilbras/omnicode-core';
import {
  IAgentMemoryContextService,
  IMemoryService,
  type MemoryCaptureInput,
  type MemoryScopeTier,
} from '@hilbras/omnicode-memory';

import { type RunningServer, startServer } from '../src/start';
import { ensureMainAgent } from '../src/transport/mainAgent';
import { TEST_HOST_IDENTITY } from './helpers/hostIdentity';

const MEMORY_FLAG_ENV = 'OMNICODE_EXPERIMENTAL_MEMORY';
const SESSION_NOT_FOUND = 40401;
const MEMORY_DISABLED = 40925;
const MEMORY_NOT_FOUND = 40421;
const MEMORY_NOT_ACTIVE = 40930;

let home: string;
let server: RunningServer | undefined;
let previousFlag: string | undefined;

beforeAll(async () => {
  previousFlag = process.env[MEMORY_FLAG_ENV];
  process.env[MEMORY_FLAG_ENV] = '1';
  home = mkdtempSync(join(tmpdir(), 'omnicode-server-memory-'));
  server = await startServer({
    hostIdentity: TEST_HOST_IDENTITY,
    host: '127.0.0.1',
    port: 0,
    homeDir: home,
    logLevel: 'silent',
  });
});

afterAll(async () => {
  try {
    await server?.close();
  } catch {
  }
  server = undefined;
  rmSync(home, { recursive: true, force: true });
  if (previousFlag === undefined) delete process.env[MEMORY_FLAG_ENV];
  else process.env[MEMORY_FLAG_ENV] = previousFlag;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

interface Envelope<T = unknown> {
  code: number;
  msg: string;
  data: T | null;
}

interface WireMemory {
  id: string;
  content: string;
  trust: string;
  lifecycle: string;
  scope: { tier: string; workspace_id?: string; project_id?: string; session_id?: string };
  trust_reason: string;
  created_at: number;
  evidence: readonly unknown[];
}

function running(): RunningServer {
  if (server === undefined) throw new Error('server is not running');
  return server;
}

async function inject(request: {
  method: 'GET' | 'POST';
  url: string;
  payload?: Record<string, unknown>;
}): Promise<{ statusCode: number; envelope: Envelope }> {
  const r = running();
  const res = (await r.app.inject({
    ...request,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${r.authTokenService.getToken()}`,
    },
  })) as unknown as { statusCode: number; json(): unknown };
  return { statusCode: res.statusCode, envelope: res.json() as Envelope };
}

async function createSession(): Promise<string> {
  const r = running();
  const res = await r.app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    payload: { metadata: { cwd: home } },
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${r.authTokenService.getToken()}`,
    },
  });
  const envelope = res.json() as Envelope<{ id: string }>;
  if (envelope.code !== 0 || envelope.data === null) {
    throw new Error(`failed to create session: ${res.body}`);
  }
  return envelope.data.id;
}

async function memoryContext(sessionId: string) {
  const r = running();
  const session = await resumeSessionById(r.core.accessor, sessionId);
  if (session === undefined) throw new Error(`session ${sessionId} does not exist`);
  const agent = await ensureMainAgent(session);
  return agent.accessor.get(IAgentMemoryContextService);
}

async function capture(
  sessionId: string,
  content: string,
  options: { tier?: Exclude<MemoryScopeTier, 'task'>; extra?: Partial<MemoryCaptureInput> } = {},
): Promise<string> {
  const context = await memoryContext(sessionId);
  const scope = await context.scopeFor(options.tier ?? 'session');
  if (scope === undefined) throw new Error('memory scope is not available');
  const service = running().core.accessor.get(IMemoryService);
  const result = await service.capture({
    content,
    tier: 'working',
    category: 'observation',
    sourceType: 'agent_observation',
    origin: 'model',
    scope,
    ...options.extra,
  });
  if (result.record === undefined) {
    throw new Error(`capture failed: ${result.status} ${result.reason ?? ''}`);
  }
  return result.record.id;
}

describe('memory routes', () => {
  it('rejects every endpoint while the memory flag is off', async () => {
    vi.stubEnv(MEMORY_FLAG_ENV, '0');
    const sessionId = await createSession();
    const requests: { method: 'GET' | 'POST'; url: string; payload?: Record<string, unknown> }[] = [
      { method: 'GET', url: `/api/v1/memory?session_id=${sessionId}` },
      { method: 'GET', url: `/api/v1/memory/mem_0001?session_id=${sessionId}` },
      { method: 'POST', url: '/api/v1/memory/mem_0001/confirm', payload: { session_id: sessionId } },
      { method: 'POST', url: '/api/v1/memory/mem_0001/forget', payload: { session_id: sessionId } },
    ];
    for (const request of requests) {
      const { envelope } = await inject(request);
      expect(envelope.code).toBe(MEMORY_DISABLED);
      expect(envelope.data).toBeNull();
      expect(envelope.msg).toContain(MEMORY_FLAG_ENV);
    }
  });

  it('rejects a session that does not exist', async () => {
    const { envelope } = await inject({ method: 'GET', url: '/api/v1/memory?session_id=does-not-exist' });
    expect(envelope.code).toBe(SESSION_NOT_FOUND);
  });

  it('lists the memories visible to the session in wire shape', async () => {
    const sessionId = await createSession();
    const id = await capture(sessionId, 'the dev server runs on port 4310');
    const { envelope } = await inject({ method: 'GET', url: `/api/v1/memory?session_id=${sessionId}` });
    expect(envelope.code).toBe(0);
    const data = envelope.data as { enabled: boolean; memories: WireMemory[]; truncated: boolean };
    expect(data.enabled).toBe(true);
    expect(data.truncated).toBe(false);
    const listed = data.memories.find((memory) => memory.id === id);
    expect(listed).toBeDefined();
    expect(listed?.content).toBe('the dev server runs on port 4310');
    expect(listed?.trust).toBe('unverified');
    expect(listed?.scope.tier).toBe('session');
    expect(listed?.scope.session_id).toBe(sessionId);
    expect(typeof listed?.created_at).toBe('number');
  });

  it('filters the list by scope', async () => {
    const sessionId = await createSession();
    const sessionMemory = await capture(sessionId, 'session scoped fact');
    const repositoryMemory = await capture(sessionId, 'repository scoped fact', { tier: 'repository' });

    const sessionScoped = await inject({
      method: 'GET',
      url: `/api/v1/memory?session_id=${sessionId}&scope=session`,
    });
    const sessionIds = (sessionScoped.envelope.data as { memories: WireMemory[] }).memories.map((m) => m.id);
    expect(sessionIds).toContain(sessionMemory);
    expect(sessionIds).not.toContain(repositoryMemory);

    const repositoryScoped = await inject({
      method: 'GET',
      url: `/api/v1/memory?session_id=${sessionId}&scope=repository`,
    });
    const repositoryIds = (repositoryScoped.envelope.data as { memories: WireMemory[] }).memories.map((m) => m.id);
    expect(repositoryIds).toContain(repositoryMemory);
    expect(repositoryIds).not.toContain(sessionMemory);
  });

  it('shows one memory and hides memories outside the session scopes', async () => {
    const sessionId = await createSession();
    const id = await capture(sessionId, 'show me this memory');

    const shown = await inject({ method: 'GET', url: `/api/v1/memory/${id}?session_id=${sessionId}` });
    expect(shown.envelope.code).toBe(0);
    expect((shown.envelope.data as { memory: WireMemory }).memory.content).toBe('show me this memory');

    const hidden = await inject({
      method: 'GET',
      url: `/api/v1/memory/${id}?session_id=${await createSession()}`,
    });
    expect(hidden.envelope.code).toBe(MEMORY_NOT_FOUND);
  });

  it('confirms an unverified memory exactly once', async () => {
    const sessionId = await createSession();
    const id = await capture(sessionId, 'confirm this fact');

    const confirmed = await inject({
      method: 'POST',
      url: `/api/v1/memory/${id}/confirm`,
      payload: { session_id: sessionId },
    });
    expect(confirmed.envelope.code).toBe(0);
    const confirmedData = confirmed.envelope.data as { status: string; memory: WireMemory };
    expect(confirmedData.status).toBe('confirmed');
    expect(confirmedData.memory.trust).toBe('trusted');

    const again = await inject({
      method: 'POST',
      url: `/api/v1/memory/${id}/confirm`,
      payload: { session_id: sessionId },
    });
    expect(again.envelope.code).toBe(0);
    expect((again.envelope.data as { status: string }).status).toBe('unchanged');
  });

  it('refuses to confirm a memory outside the session scopes', async () => {
    const owner = await createSession();
    const id = await capture(owner, 'private to the owner session');
    const stranger = await createSession();

    const confirmed = await inject({
      method: 'POST',
      url: `/api/v1/memory/${id}/confirm`,
      payload: { session_id: stranger },
    });
    expect(confirmed.envelope.code).toBe(MEMORY_NOT_FOUND);

    const still = await inject({ method: 'GET', url: `/api/v1/memory/${id}?session_id=${owner}` });
    expect((still.envelope.data as { memory: WireMemory }).memory.trust).toBe('unverified');
  });

  it('forgets a memory by invalidating it and keeps it out of the active list', async () => {
    const sessionId = await createSession();
    const id = await capture(sessionId, 'forget this fact');

    const forgotten = await inject({
      method: 'POST',
      url: `/api/v1/memory/${id}/forget`,
      payload: { session_id: sessionId, reason: 'no longer true' },
    });
    expect(forgotten.envelope.code).toBe(0);
    const data = forgotten.envelope.data as { status: string; memory: WireMemory };
    expect(data.status).toBe('forgotten');
    expect(data.memory.lifecycle).toBe('invalidated');

    const active = await inject({ method: 'GET', url: `/api/v1/memory?session_id=${sessionId}` });
    expect((active.envelope.data as { memories: WireMemory[] }).memories.map((m) => m.id)).not.toContain(id);

    const all = await inject({ method: 'GET', url: `/api/v1/memory?session_id=${sessionId}&status=all` });
    const found = (all.envelope.data as { memories: WireMemory[] }).memories.find((m) => m.id === id);
    expect(found?.lifecycle).toBe('invalidated');
  });

  it('refuses to forget a memory outside the session scopes', async () => {
    const owner = await createSession();
    const id = await capture(owner, 'owner only');
    const stranger = await createSession();

    const forgotten = await inject({
      method: 'POST',
      url: `/api/v1/memory/${id}/forget`,
      payload: { session_id: stranger },
    });
    expect(forgotten.envelope.code).toBe(MEMORY_NOT_FOUND);

    const still = await inject({ method: 'GET', url: `/api/v1/memory/${id}?session_id=${owner}` });
    expect((still.envelope.data as { memory: WireMemory }).memory.lifecycle).toBe('active');
  });

  it('reports not_active when mutating an already forgotten memory', async () => {
    const sessionId = await createSession();
    const id = await capture(sessionId, 'forget twice');
    await inject({
      method: 'POST',
      url: `/api/v1/memory/${id}/forget`,
      payload: { session_id: sessionId },
    });

    const again = await inject({
      method: 'POST',
      url: `/api/v1/memory/${id}/forget`,
      payload: { session_id: sessionId },
    });
    expect(again.envelope.code).toBe(MEMORY_NOT_ACTIVE);
  });
});
