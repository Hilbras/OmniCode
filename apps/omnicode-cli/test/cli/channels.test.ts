import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { OmnicodeHarness } from '@hilbras/omnicode-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startConfiguredChannelRuntime } from '../../src/cli/channels';

interface FakeSession {
  readonly id: string;
  readonly workDir: string;
  isClosed: boolean;
  readonly prompts: string[];
  prompt(text: string): Promise<void>;
  onEvent(listener: (event: { readonly [key: string]: unknown }) => void): () => void;
  close(): Promise<void>;
  emit(event: { readonly [key: string]: unknown }): void;
}

function createFakeSession(id: string, workDir: string): FakeSession {
  const listeners = new Set<(event: { readonly [key: string]: unknown }) => void>();
  return {
    id,
    workDir,
    isClosed: false,
    prompts: [],
    async prompt(text: string) {
      this.prompts.push(text);
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      this.isClosed = true;
    },
    emit(event) {
      for (const listener of [...listeners]) listener(event);
    },
  };
}

function createFakeHarness(homeDir: string) {
  const sessions = new Map<string, FakeSession>();
  let counter = 0;
  const create = (workDir: string): FakeSession => {
    counter += 1;
    const session = createFakeSession(`session-${counter}`, workDir);
    sessions.set(session.id, session);
    return session;
  };
  return {
    homeDir,
    sessions,
    async createSession(options: { readonly workDir: string }) {
      return create(options.workDir);
    },
    async resumeSession(input: { readonly id: string }) {
      const existing = sessions.get(input.id);
      if (existing !== undefined) return existing;
      counter += 1;
      const session = createFakeSession(input.id, homeDir);
      sessions.set(session.id, session);
      return session;
    },
  };
}

type FakeHarness = ReturnType<typeof createFakeHarness>;

const tempDirs: string[] = [];

async function makeHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omnicode-cli-channels-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('startConfiguredChannelRuntime', () => {
  it('returns undefined when no channels.json exists', async () => {
    const home = await makeHome();
    const harness = createFakeHarness(home);
    const runtime = await startConfiguredChannelRuntime(harness as unknown as OmnicodeHarness, {
      configPath: join(home, 'channels.json'),
      bindingsPath: join(home, 'channel-bindings.json'),
      env: {},
    });
    expect(runtime).toBeUndefined();
  });

  it('routes telegram commands and bound messages through harness sessions', async () => {
    const home = await makeHome();
    const configPath = join(home, 'channels.json');
    const bindingsPath = join(home, 'channel-bindings.json');
    await writeFile(
      configPath,
      JSON.stringify({ channels: [{ kind: 'telegram', adapter: 'telegram', enabled: true }] }),
      'utf8',
    );
    const fetchMock = vi.fn(async (_url: string, _init?: { readonly body?: string }) => ({
      status: 200,
      text: async () => JSON.stringify({ ok: true, result: { message_id: 7 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const harness = createFakeHarness(home);
    const started = await startConfiguredChannelRuntime(harness as unknown as OmnicodeHarness, {
      configPath,
      bindingsPath,
      env: { TELEGRAM_BOT_TOKEN: 'test-token', OMNICODE_CHANNELS_REQUIRE_SIGNATURE: '0' },
    });
    expect(started).toBeDefined();
    if (started === undefined) return;
    expect(started.runtime.status().adapters).toEqual(['telegram']);

    const inbound = (text: string, id: string) => ({
      id,
      channel: 'telegram' as const,
      conversationId: 'chat-1',
      user: { id: 'user-1' },
      text,
      timestamp: Date.now(),
    });

    const created = await started.runtime.handleInbound(inbound('/new /tmp/workspace', 'm1'));
    expect(created.handled).toBe(true);
    const session = [...harness.sessions.values()][0];
    expect(session?.workDir).toBe('/tmp/workspace');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const routed = await started.runtime.handleInbound(inbound('hello there', 'm2'));
    expect(routed.handled).toBe(true);
    expect(session?.prompts).toEqual(['hello there']);

    session?.emit({ type: 'assistant.delta', turnId: 1, delta: 'hi ' });
    session?.emit({ type: 'assistant.delta', turnId: 1, delta: 'there' });
    session?.emit({ type: 'turn.ended', turnId: 1 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const replyBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { readonly text: string };
    expect(replyBody.text).toBe('hi there');

    await started.stop();
    const persisted = JSON.parse(await readFile(bindingsPath, 'utf8')) as readonly { readonly sessionId: string }[];
    expect(persisted.some((binding) => binding.sessionId === session?.id)).toBe(true);
  });

  it('fails closed when an enabled channel has no credentials', async () => {
    const home = await makeHome();
    const configPath = join(home, 'channels.json');
    await writeFile(
      configPath,
      JSON.stringify({ channels: [{ kind: 'telegram', adapter: 'telegram', enabled: true }] }),
      'utf8',
    );
    const harness = createFakeHarness(home);
    await expect(
      startConfiguredChannelRuntime(harness as unknown as OmnicodeHarness, {
        configPath,
        bindingsPath: join(home, 'channel-bindings.json'),
        env: {},
      }),
    ).rejects.toThrow(/channel runtime failed/);
  });
});
