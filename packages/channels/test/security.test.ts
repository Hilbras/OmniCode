import { createHash, createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ChannelConfigStore,
  ChannelRateLimiter,
  ChannelReplayGuard,
  ChannelRuntimeService,
  verifyProviderWebhook,
  verifySlackSignature,
  verifyWebhookSignature,
} from '#/index';

function hmac(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('channel security', () => {
  it('verifies generic webhook HMAC signatures', () => {
    const body = '{"ok":true}';
    const signature = hmac('secret', body);
    expect(verifyWebhookSignature({ secret: 'secret', rawBody: body, signature })).toEqual({ ok: true });
    expect(verifyWebhookSignature({ secret: 'secret', rawBody: body, signature: `sha256=${signature}` })).toEqual({ ok: true });
    expect(verifyWebhookSignature({ secret: 'other', rawBody: body, signature })).toMatchObject({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects missing and stale signatures', () => {
    expect(verifyWebhookSignature({ secret: 'secret', rawBody: 'x', signature: undefined })).toMatchObject({
      ok: false,
      reason: 'missing_signature',
    });
    const now = 2_000_000;
    expect(
      verifyWebhookSignature({
        secret: 'secret',
        rawBody: 'x',
        signature: hmac('secret', `1000.x`),
        timestamp: '1000',
        now,
        maxSkewMs: 1000,
      }),
    ).toMatchObject({ ok: false, reason: 'stale_timestamp' });
  });

  it('verifies Slack v0 signatures', () => {
    const secret = 'slack-secret';
    const timestamp = '1700000000';
    const body = '{"event":{}}';
    const signature = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
    expect(
      verifySlackSignature({ secret, rawBody: body, timestamp, signature, now: 1_700_000_000_000 }),
    ).toEqual({ ok: true });
    expect(
      verifySlackSignature({ secret: 'wrong', rawBody: body, timestamp, signature, now: 1_700_000_000_000 }),
    ).toMatchObject({ ok: false, reason: 'invalid_signature' });
  });

  it('dedupes replay keys within the ttl and bounds memory', () => {
    let now = 100;
    const guard = new ChannelReplayGuard({ ttlMs: 50, maxKeys: 2, now: () => now });
    expect(guard.accept('a')).toBe(true);
    expect(guard.accept('a')).toBe(false);
    now = 200;
    expect(guard.accept('a')).toBe(true);
    expect(guard.accept('b')).toBe(true);
    expect(guard.accept('c')).toBe(true);
    expect(guard.accept('a')).toBe(true);
  });

  it('limits inbound traffic per conversation', () => {
    let now = 0;
    const limiter = new ChannelRateLimiter({ capacity: 2, refillPerSecond: 1, now: () => now });
    expect(limiter.take('chat')).toBe(true);
    expect(limiter.take('chat')).toBe(true);
    expect(limiter.take('chat')).toBe(false);
    expect(limiter.take('other')).toBe(true);
    now = 1000;
    expect(limiter.take('chat')).toBe(true);
    limiter.clear();
    expect(limiter.take('chat')).toBe(true);
  });

  it('enforces runtime signatures, replay protection, and rate limits', async () => {
    const configStore = new ChannelConfigStore();
    configStore.set({ kind: 'telegram', enabled: true });
    const runtime = new ChannelRuntimeService({
      configStore,
      security: {
        secrets: { telegram: 'secret' },
        requireSignature: true,
        maxSkewMs: 60_000,
        now: () => 1_700_000_000_000,
        replayGuard: new ChannelReplayGuard({ now: () => 1 }),
        rateLimiter: new ChannelRateLimiter({ capacity: 10, refillPerSecond: 0, now: () => 1 }),
      },
    });
    const message = {
      id: 'msg-1',
      channel: 'telegram' as const,
      conversationId: '42',
      user: { id: 'u' },
      text: 'hello',
      timestamp: 1,
    };
    await expect(runtime.handleInbound(message)).resolves.toMatchObject({ handled: false, reason: 'signature' });
    const rawBody = JSON.stringify(message);
    const signature = hmac('secret', rawBody);
    await expect(runtime.handleInbound(message, { rawBody, signature })).resolves.toMatchObject({ handled: true });
    await expect(runtime.handleInbound(message, { rawBody, signature })).resolves.toMatchObject({ handled: false, reason: 'replay' });
  });

  it('reports rate limiting before dispatching', async () => {
    const configStore = new ChannelConfigStore();
    configStore.set({ kind: 'telegram', enabled: true });
    const runtime = new ChannelRuntimeService({
      configStore,
      security: {
        rateLimiter: new ChannelRateLimiter({ capacity: 1, refillPerSecond: 0, now: () => 1 }),
        replayGuard: new ChannelReplayGuard({ now: () => 1 }),
      },
    });
    const message = {
      id: 'msg-2',
      channel: 'telegram' as const,
      conversationId: '42',
      user: { id: 'u' },
      text: 'hello',
      timestamp: 1,
    };
    await expect(runtime.handleInbound(message)).resolves.toMatchObject({ handled: true });
    await expect(runtime.handleInbound({ ...message, id: 'msg-3' })).resolves.toMatchObject({
      handled: false,
      reason: 'rate_limited',
    });
  });

  it('verifies Telegram secret-token headers', () => {
    expect(
      verifyProviderWebhook({
        kind: 'telegram',
        secret: 'telegram-secret',
        rawBody: '{}',
        headers: { 'x-telegram-bot-api-secret-token': 'telegram-secret' },
      }),
    ).toEqual({ ok: true });
    expect(
      verifyProviderWebhook({ kind: 'telegram', secret: 'telegram-secret', rawBody: '{}', headers: {} }),
    ).toMatchObject({ ok: false, reason: 'invalid_signature' });
  });

  it('verifies WeChat SHA1 signatures', () => {
    const timestamp = '1';
    const nonce = '2';
    const signature = createHash('sha1').update(['wx-secret', timestamp, nonce].sort().join('')).digest('hex');
    expect(
      verifyProviderWebhook({
        kind: 'wechat',
        secret: 'wx-secret',
        rawBody: '<xml/>',
        headers: { timestamp, nonce, signature },
      }),
    ).toEqual({ ok: true });
  });

  it('verifies DingTalk HMAC signatures', () => {
    const timestamp = '1';
    const sign = createHmac('sha256', 'ding-secret').update(`1\nding-secret`).digest('base64');
    expect(
      verifyProviderWebhook({
        kind: 'dingtalk',
        secret: 'ding-secret',
        rawBody: '{}',
        headers: { timestamp, sign },
      }),
    ).toEqual({ ok: true });
  });

  it('verifies Feishu request signatures', () => {
    const timestamp = '1';
    const nonce = '2';
    const signature = createHash('sha256').update('12feishu-secret{}').digest('hex');
    expect(
      verifyProviderWebhook({
        kind: 'feishu',
        secret: 'feishu-secret',
        rawBody: '{}',
        headers: {
          'x-lark-request-timestamp': timestamp,
          'x-lark-request-nonce': nonce,
          'x-lark-signature': signature,
        },
      }),
    ).toEqual({ ok: true });
  });

  it('uses provider-specific signature verification in the runtime', async () => {
    const configStore = new ChannelConfigStore();
    configStore.set({ kind: 'telegram', enabled: true });
    const runtime = new ChannelRuntimeService({
      configStore,
      security: {
        providerSecrets: { telegram: 'telegram-secret' },
        requireSignature: true,
        replayGuard: new ChannelReplayGuard({ now: () => 1 }),
        rateLimiter: new ChannelRateLimiter({ capacity: 10, refillPerSecond: 0, now: () => 1 }),
      },
    });
    const message = {
      id: 'msg-provider',
      channel: 'telegram' as const,
      conversationId: '42',
      user: { id: 'u' },
      text: 'hello',
      timestamp: 1,
    };
    await expect(
      runtime.handleInbound(message, {
        rawBody: '{}',
        headers: { 'x-telegram-bot-api-secret-token': 'telegram-secret' },
      }),
    ).resolves.toMatchObject({ handled: true });
  });
});
