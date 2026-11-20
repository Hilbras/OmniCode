import { describe, expect, it, vi } from 'vitest';

import type { OmnicodeHarness } from '@hilbras/omnicode-api';

import { ConnectorsController } from '#/tui/controllers/connectors';

interface StatusCapture {
  setStatus: (message: string) => void;
  status: string[];
}

function makeHost(): { readonly controller: ConnectorsController; readonly capture: StatusCapture } {
  const harness = {
    startTelegramBot: vi.fn(async () => undefined),
    createTelegramPairingCode: vi.fn(async () => ({ code: 'PAIR123', expiresAt: 0 })),
    getTelegramConnectorStatus: vi.fn(async () => ({
      hasToken: true,
      running: true,
      allowedChatIds: [],
    })),
  } as unknown as OmnicodeHarness;

  const capture: StatusCapture = { status: [], setStatus: () => {} };
  capture.setStatus = (message: string) => {
    capture.status.push(message);
  };
  const controller = new ConnectorsController({
    state: {} as never,
    harness,
    session: undefined,
    setSkillsBrowser: () => {},
    setSubagentsBrowser: () => {},
    setConnectorsBrowser: () => {},
  } as never);
  const original = (controller as unknown as { setStatus: (m: string) => void }).setStatus;
  (controller as unknown as { setStatus: (m: string) => void }).setStatus = (message: string) => {
    capture.setStatus(message);
    original.call(controller, message);
  };
  return { controller, capture };
}

function stubTelegramFetch(options: { photoOk: boolean }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.includes('/setMyProfilePhoto')) {
        if (!options.photoOk) {
          return new Response(JSON.stringify({ ok: false, description: 'photo not permitted' }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, result: { id: '1', username: 'bot', name: 'Bot' } }), {
        status: 200,
      });
    }),
  );
}

async function runSetup(controller: ConnectorsController): Promise<void> {
  await (controller as unknown as { setup: (token: string) => Promise<void> }).setup('token-1');
}

describe('Telegram setup flow', () => {
  it('continues the setup when the profile photo upload fails', async () => {
    const { controller, capture } = makeHost();
    stubTelegramFetch({ photoOk: false });

    await runSetup(controller);
    vi.unstubAllGlobals();

    const final = capture.status.at(-1) ?? '';
    expect(final).toContain('@bot is ready');
    expect(final).toContain('Logo not uploaded (photo not permitted)');
    expect(final).toContain('Pairing code: PAIR123');
  });

  it('reports the updated logo when the photo upload succeeds', async () => {
    const { controller, capture } = makeHost();
    stubTelegramFetch({ photoOk: true });

    await runSetup(controller);
    vi.unstubAllGlobals();

    const final = capture.status.at(-1) ?? '';
    expect(final).toContain('@bot is ready');
    expect(final).toContain('Logo updated.');
  });
});

describe('telegramSetupErrorMessage', () => {
  it('turns a raw Telegram 429 into an actionable wait message', async () => {
    const { telegramSetupErrorMessage } = await import('#/tui/controllers/connectors');
    const message = telegramSetupErrorMessage(
      new Error('Too Many Requests: retry after 25630'),
    );
    expect(message).toContain('Telegram rate limit');
    expect(message).toContain('7h 7m');
    expect(message).toContain('25630s');
    expect(message).toContain('Repeated setup attempts extend the limit');
  });

  it('leaves other errors untouched', async () => {
    const { telegramSetupErrorMessage } = await import('#/tui/controllers/connectors');
    expect(telegramSetupErrorMessage(new Error('bot token invalid'))).toBe('bot token invalid');
  });
});

describe('telegramRetryAfterSeconds', () => {
  it('extracts retry_after from Telegram 429 text', async () => {
    const { telegramRetryAfterSeconds } = await import('#/tui/controllers/connectors');
    expect(telegramRetryAfterSeconds(new Error('Too Many Requests: retry after 9980'))).toBe(9980);
    expect(telegramRetryAfterSeconds(new Error('bot token invalid'))).toBeUndefined();
  });
});
