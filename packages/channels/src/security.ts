import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type { ChannelKind } from './contracts';

export interface WebhookSignatureInput {
  readonly secret: string;
  readonly rawBody: string;
  readonly signature: string | undefined;
  readonly timestamp?: string | undefined;
  readonly maxSkewMs?: number;
  readonly now?: number;
}

export interface WebhookVerification {
  readonly ok: boolean;
  readonly reason?: 'missing_signature' | 'stale_timestamp' | 'invalid_signature' | 'missing_secret';
}

export function verifyWebhookSignature(input: WebhookSignatureInput): WebhookVerification {
  if (input.secret.length === 0) return { ok: false, reason: 'missing_secret' };
  if (input.signature === undefined || input.signature.length === 0) {
    return { ok: false, reason: 'missing_signature' };
  }
  const now = input.now ?? Date.now();
  if (input.timestamp !== undefined) {
    const timestamp = Number(input.timestamp);
    if (!Number.isFinite(timestamp)) return { ok: false, reason: 'invalid_signature' };
    const timestampMs = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
    if (Math.abs(now - timestampMs) > (input.maxSkewMs ?? 5 * 60_000)) {
      return { ok: false, reason: 'stale_timestamp' };
    }
  }
  const payload = input.timestamp === undefined ? input.rawBody : `${input.timestamp}.${input.rawBody}`;
  const expected = createHmac('sha256', input.secret).update(payload).digest();
  const received = decodeSignature(input.signature);
  if (received === undefined || received.length !== expected.length) {
    return { ok: false, reason: 'invalid_signature' };
  }
  return timingSafeEqual(expected, received)
    ? { ok: true }
    : { ok: false, reason: 'invalid_signature' };
}

export function verifySlackSignature(input: WebhookSignatureInput): WebhookVerification {
  if (input.secret.length === 0) return { ok: false, reason: 'missing_secret' };
  if (input.signature === undefined || input.timestamp === undefined) {
    return { ok: false, reason: 'missing_signature' };
  }
  const now = input.now ?? Date.now();
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: 'invalid_signature' };
  if (Math.abs(now - timestamp * 1000) > (input.maxSkewMs ?? 5 * 60_000)) {
    return { ok: false, reason: 'stale_timestamp' };
  }
  const expected = createHmac('sha256', input.secret)
    .update(`v0:${input.timestamp}:${input.rawBody}`)
    .digest('hex');
  const received = input.signature.replace(/^v0=/, '');
  const expectedBytes = Buffer.from(expected, 'utf8');
  const receivedBytes = Buffer.from(received, 'utf8');
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)
    ? { ok: true }
    : { ok: false, reason: 'invalid_signature' };
}

export class ChannelReplayGuard {
  private readonly seenKeys = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(options: { readonly ttlMs?: number; readonly maxKeys?: number; readonly now?: () => number } = {}) {
    this.ttlMs = Math.max(options.ttlMs ?? 10 * 60_000, 1);
    this.maxKeys = Math.max(options.maxKeys ?? 10_000, 1);
    this.now = options.now ?? (() => Date.now());
  }

  accept(key: string): boolean {
    const now = this.now();
    this.prune(now);
    if (this.seenKeys.has(key)) return false;
    this.seenKeys.set(key, now);
    while (this.seenKeys.size > this.maxKeys) {
      const oldest = this.seenKeys.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.seenKeys.delete(oldest);
    }
    return true;
  }

  clear(): void {
    this.seenKeys.clear();
  }

  private prune(now: number): void {
    for (const [key, at] of this.seenKeys) {
      if (now - at <= this.ttlMs) continue;
      this.seenKeys.delete(key);
    }
  }
}

export class ChannelRateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;

  constructor(options: { readonly capacity?: number; readonly refillPerSecond?: number; readonly now?: () => number } = {}) {
    this.capacity = Math.max(options.capacity ?? 30, 1);
    this.refillPerMs = Math.max(options.refillPerSecond ?? 1, 0) / 1000;
    this.now = options.now ?? (() => Date.now());
  }

  take(key: string): boolean {
    const now = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: now };
    bucket.tokens = Math.min(this.capacity, bucket.tokens + (now - bucket.updatedAt) * this.refillPerMs);
    bucket.updatedAt = now;
    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return true;
  }

  clear(): void {
    this.buckets.clear();
  }
}

function decodeSignature(signature: string): Buffer | undefined {
  const value = signature.replace(/^sha256=/, '').trim();
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  try {
    return Buffer.from(value, 'base64');
  } catch {
    return undefined;
  }
}


export interface ProviderWebhookInput {
  readonly kind: ChannelKind;
  readonly secret: string;
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly now?: number;
  readonly maxSkewMs?: number;
}

export function verifyProviderWebhook(input: ProviderWebhookInput): WebhookVerification {
  if (input.secret.length === 0) {
    return { ok: false, reason: 'missing_secret' };
  }
  switch (input.kind) {
    case 'telegram': {
      const received = input.headers['x-telegram-bot-api-secret-token'];
      return received === undefined || received.length === 0
        ? { ok: false, reason: 'invalid_signature' }
        : safeStringEqual(input.secret, received);
    }
    case 'slack':
      return verifySlackSignature({
        secret: input.secret,
        rawBody: input.rawBody,
        signature: input.headers['x-slack-signature'],
        timestamp: input.headers['x-slack-request-timestamp'],
        ...(input.now === undefined ? {} : { now: input.now }),
        ...(input.maxSkewMs === undefined ? {} : { maxSkewMs: input.maxSkewMs }),
      });
    case 'wechat':
      return verifyWeChatSignature(input);
    case 'dingtalk':
      return verifyDingTalkSignature(input);
    case 'feishu':
      return verifyFeishuSignature(input);
  }
}

function verifyWeChatSignature(input: ProviderWebhookInput): WebhookVerification {
  const timestamp = input.headers['timestamp'];
  const nonce = input.headers['nonce'];
  const signature = input.headers['signature'];
  if (timestamp === undefined || nonce === undefined || signature === undefined) {
    return { ok: false, reason: 'missing_signature' };
  }
  const expected = createHash('sha1').update([input.secret, timestamp, nonce].sort().join('')).digest('hex');
  return safeHexEqual(expected, signature);
}

function verifyDingTalkSignature(input: ProviderWebhookInput): WebhookVerification {
  const timestamp = input.headers['timestamp'];
  const signature = input.headers['sign'];
  if (timestamp === undefined || signature === undefined) return { ok: false, reason: 'missing_signature' };
  const expected = createHmac('sha256', input.secret).update(`${timestamp}\n${input.secret}`).digest('base64');
  return safeStringEqual(expected, signature);
}

function verifyFeishuSignature(input: ProviderWebhookInput): WebhookVerification {
  const timestamp = input.headers['x-lark-request-timestamp'];
  const nonce = input.headers['x-lark-request-nonce'];
  const signature = input.headers['x-lark-signature'];
  if (timestamp === undefined || nonce === undefined || signature === undefined) {
    return { ok: false, reason: 'missing_signature' };
  }
  const expected = createHash('sha256').update(`${timestamp}${nonce}${input.secret}${input.rawBody}`).digest('hex');
  return safeStringEqual(expected, signature);
}

function safeHexEqual(expected: string, received: string): WebhookVerification {
  return safeStringEqual(expected, received);
}

function safeStringEqual(expected: string, received: string): WebhookVerification {
  const expectedBytes = Buffer.from(expected, 'utf8');
  const receivedBytes = Buffer.from(received, 'utf8');
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)
    ? { ok: true }
    : { ok: false, reason: 'invalid_signature' };
}
