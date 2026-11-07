import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { TelegramConnectorService } from '#/app/telegram/telegramService';
import type { IBootstrapService } from '#/app/bootstrap/bootstrap';

const TOKEN = '123456:ABC-DEF';
const CONFIG_FILE = 'telegram.json';
const STATE_FILE = 'telegram-state.json';

let homeDir: string;
let service: TelegramConnectorService;
const originalTokenEnv = process.env['TELEGRAM_BOT_TOKEN'];

function configPath(): string {
  return join(homeDir, CONFIG_FILE);
}

function statePath(): string {
  return join(homeDir, STATE_FILE);
}

async function writeConfig(value: Record<string, unknown>): Promise<void> {
  await writeFile(configPath(), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeState(value: Record<string, unknown>): Promise<void> {
  await writeFile(statePath(), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readConfig(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(configPath(), 'utf8')) as Record<string, unknown>;
}

function makeService(home: string): TelegramConnectorService {
  return new TelegramConnectorService({ homeDir: home } as unknown as IBootstrapService);
}

function botResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeAll(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'omnicode-telegram-'));
  delete process.env['TELEGRAM_BOT_TOKEN'];
});

beforeEach(async () => {
  await rm(configPath(), { force: true });
  await rm(statePath(), { force: true });
  service = makeService(homeDir);
});

afterAll(async () => {
  if (originalTokenEnv === undefined) delete process.env['TELEGRAM_BOT_TOKEN'];
  else process.env['TELEGRAM_BOT_TOKEN'] = originalTokenEnv;
  await rm(homeDir, { recursive: true, force: true });
});

describe('TelegramConnectorService status', () => {
  it('reports not configured without a config file', async () => {
    const status = await service.status();

    expect(status).toEqual({
      state: 'not-configured',
      configPath: configPath(),
      hasToken: false,
      allowedChatIds: [],
      running: false,
      pid: undefined,
      heartbeatAt: undefined,
    });
  });

  it('awaits a chat when a token is set but no chat id is allowed', async () => {
    await writeConfig({ botToken: TOKEN, allowedChatIds: [] });

    const status = await service.status();

    expect(status.state).toBe('awaiting-chat');
    expect(status.hasToken).toBe(true);
    expect(status.allowedChatIds).toEqual([]);
  });

  it('reports ready with a token and an allowed chat', async () => {
    await writeConfig({ botToken: TOKEN, allowedChatIds: [42] });

    const status = await service.status();

    expect(status.state).toBe('ready');
    expect(status.allowedChatIds).toEqual([42]);
  });
});

describe('TelegramConnectorService saveSettings', () => {
  it('writes the token and numeric chat ids while preserving unrelated keys', async () => {
    await writeConfig({ note: 'keep me', botToken: 'old' });

    const status = await service.saveSettings({ botToken: TOKEN, allowedChatIds: [1, 2] });

    expect(status.state).toBe('ready');
    expect(await readConfig()).toEqual({ note: 'keep me', botToken: TOKEN, allowedChatIds: [1, 2] });
  });

  it('keeps an existing token when only chat ids are saved', async () => {
    await writeConfig({ botToken: TOKEN });

    await service.saveSettings({ allowedChatIds: [7] });

    const config = await readConfig();
    expect(config['botToken']).toBe(TOKEN);
    expect(config['allowedChatIds']).toEqual([7]);
  });
});

describe('TelegramConnectorService running detection', () => {
  it('reports running for the current process with a fresh heartbeat', async () => {
    await writeState({ pid: process.pid, heartbeatAt: Date.now() });

    const status = await service.status();

    expect(status.running).toBe(true);
    expect(status.pid).toBe(process.pid);
  });

  it('reports not running for a stale heartbeat', async () => {
    await writeState({ pid: process.pid, heartbeatAt: Date.now() - 10 * 60_000 });

    const status = await service.status();

    expect(status.running).toBe(false);
  });

  it('reports not running for a zero pid', async () => {
    await writeState({ pid: 0, heartbeatAt: Date.now() });

    const status = await service.status();

    expect(status.running).toBe(false);
  });
});

describe('TelegramConnectorService probe', () => {
  it('populates the bot identity when Telegram accepts the token', async () => {
    await writeConfig({ botToken: TOKEN, allowedChatIds: [42] });
    const fetchMock = vi.fn(async () =>
      botResponse({ ok: true, result: { id: 42, username: 'my_bot', first_name: 'My Bot' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const status = await service.status({ probe: true });

      expect(status.bot).toEqual({ id: '42', username: 'my_bot', name: 'My Bot' });
      expect(status.error).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports the failure description when Telegram rejects the token', async () => {
    await writeConfig({ botToken: TOKEN, allowedChatIds: [42] });
    vi.stubGlobal('fetch', vi.fn(async () => botResponse({ ok: false, description: 'Unauthorized' }, 401)));

    try {
      const status = await service.status({ probe: true });

      expect(status.error).toBe('Unauthorized');
      expect(status.bot).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not call Telegram without an explicit probe', async () => {
    await writeConfig({ botToken: TOKEN, allowedChatIds: [42] });
    const fetchMock = vi.fn(async () => botResponse({ ok: true, result: {} }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      await service.status();

      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
