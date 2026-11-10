import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ErrorCode } from '../src/protocol/error-codes';
import {
  connectorsListResponseSchema,
  telegramStatusResponseSchema,
} from '../src/protocol/rest-connector';
import { type RunningServer, startServer } from '../src/start';
import { authHeaders } from './helpers/auth';
import { TEST_HOST_IDENTITY } from './helpers/hostIdentity';

interface Envelope<T> {
  code: number;
  msg: string;
  data: T | null;
  request_id: string;
}

const BOT_TOKEN = '123456:ABC-DEF';

describe('server-v2 /api/v1/connectors', () => {
  let server: RunningServer | undefined;
  let home: string | undefined;
  let base: string;
  const originalTokenEnv = process.env['TELEGRAM_BOT_TOKEN'];

  beforeAll(async () => {
    delete process.env['TELEGRAM_BOT_TOKEN'];
    home = await mkdtemp(join(tmpdir(), 'omnicode-server-v2-connectors-'));
    server = await startServer({
      hostIdentity: TEST_HOST_IDENTITY,
      host: '127.0.0.1',
      port: 0,
      homeDir: home,
      logLevel: 'silent',
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  beforeEach(async () => {
    if (home !== undefined) {
      await rm(join(home, 'telegram.json'), { force: true });
      await rm(join(home, 'telegram-state.json'), { force: true });
    }
  });

  afterAll(async () => {
    if (originalTokenEnv === undefined) delete process.env['TELEGRAM_BOT_TOKEN'];
    else process.env['TELEGRAM_BOT_TOKEN'] = originalTokenEnv;
    if (server !== undefined) {
      await server.close();
      server = undefined;
    }
    if (home !== undefined) {
      await rm(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  async function listConnectors() {
    const res = await fetch(`${base}/api/v1/connectors`, {
      headers: authHeaders(server as RunningServer),
    } as never);
    const body = (await res.json()) as Envelope<unknown>;
    expect(body.code).toBe(0);
    return connectorsListResponseSchema.parse(body.data).connectors;
  }

  async function getTelegram() {
    const res = await fetch(`${base}/api/v1/connectors/telegram`, {
      headers: authHeaders(server as RunningServer),
    } as never);
    const body = (await res.json()) as Envelope<unknown>;
    expect(body.code).toBe(0);
    return telegramStatusResponseSchema.parse(body.data).telegram;
  }

  async function saveTelegram(payload: Record<string, unknown>): Promise<Envelope<unknown>> {
    const res = await fetch(`${base}/api/v1/connectors/telegram`, {
      method: 'PUT',
      headers: authHeaders(server as RunningServer, { 'content-type': 'application/json' }),
      body: JSON.stringify(payload),
    } as never);
    return (await res.json()) as Envelope<unknown>;
  }

  it('lists the connectors including the telegram service', async () => {
    const connectors = await listConnectors();

    expect(Array.isArray(connectors)).toBe(true);
    const telegram = connectors.find((entry) => entry.id === 'telegram');
    expect(telegram?.kind).toBe('service');
    expect(telegram?.status).toBe('not-configured');
  });

  it('reports the telegram connector as not configured on a clean home', async () => {
    const telegram = await getTelegram();

    expect(telegram.state).toBe('not-configured');
    expect(telegram.has_token).toBe(false);
    expect(telegram.allowed_chat_ids).toEqual([]);
    expect(telegram.running).toBe(false);
  });

  it('writes the bot token and chat ids to the home directory', async () => {
    const body = await saveTelegram({ botToken: BOT_TOKEN, allowedChatIds: [7, 8] });

    expect(body.code).toBe(0);
    const telegram = telegramStatusResponseSchema.parse(body.data).telegram;
    expect(telegram.state).toBe('ready');
    expect(telegram.has_token).toBe(true);
    expect(telegram.allowed_chat_ids).toEqual([7, 8]);

    const written = JSON.parse(
      await readFile(join(home as string, 'telegram.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(written['botToken']).toBe(BOT_TOKEN);
    expect(written['allowedChatIds']).toEqual([7, 8]);
  });

  it('keeps the existing token when only chat ids are saved', async () => {
    await saveTelegram({ botToken: BOT_TOKEN });

    const body = await saveTelegram({ allowedChatIds: [7] });

    expect(body.code).toBe(0);
    const telegram = telegramStatusResponseSchema.parse(body.data).telegram;
    expect(telegram.has_token).toBe(true);
    expect(telegram.state).toBe('ready');

    const written = JSON.parse(
      await readFile(join(home as string, 'telegram.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(written['botToken']).toBe(BOT_TOKEN);
  });

  it('rejects an empty settings body', async () => {
    const body = await saveTelegram({});

    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('verifies without throwing when no token is configured', async () => {
    const res = await fetch(`${base}/api/v1/connectors/telegram/verify`, {
      method: 'POST',
      headers: authHeaders(server as RunningServer, { 'content-type': 'application/json' }),
      body: JSON.stringify({}),
    } as never);
    const body = (await res.json()) as Envelope<unknown>;

    expect(body.code).toBe(0);
    expect(telegramStatusResponseSchema.parse(body.data).telegram.state).toBe('not-configured');
  });
});
