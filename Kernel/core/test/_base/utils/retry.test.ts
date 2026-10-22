import { describe, expect, it } from 'vitest';

import { MAX_RETRY_AFTER_MS, retryBackoffDelay, retryDelayMs } from '#/_base/utils/retry';
import {
  MAX_RETRY_AFTER_MS as HUMAN_MAX_RETRY_AFTER_MS,
  retryBackoffDelay as humanRetryBackoffDelay,
  retryDelayMs as humanRetryDelayMs,
} from '#human/llm/requester/retry';

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 32_000;
const JITTER_FACTOR = 0.25;

function backoffEnvelope(attemptIndex: number): { min: number; max: number } {
  const base = Math.min(BASE_DELAY_MS * 2 ** attemptIndex, MAX_DELAY_MS);
  return { min: base, max: base * (1 + JITTER_FACTOR) };
}

describe('retryDelayMs', () => {
  it('stays inside the backoff envelope when the provider sends no Retry-After', () => {
    for (const attemptIndex of [0, 1, 2, 5, 9]) {
      const envelope = backoffEnvelope(attemptIndex);
      for (let i = 0; i < 50; i += 1) {
        const delayMs = retryDelayMs(attemptIndex, undefined);
        expect(delayMs).toBeGreaterThanOrEqual(envelope.min);
        expect(delayMs).toBeLessThanOrEqual(envelope.max);
      }
    }
  });

  it('takes a Retry-After as the whole delay instead of the backoff', () => {
    expect(retryDelayMs(0, 60_000)).toBe(60_000);
    expect(retryDelayMs(5, 1_000)).toBe(1_000);
    expect(retryDelayMs(9, 1)).toBe(1);
  });

  it('caps the delay a provider can ask for', () => {
    expect(MAX_RETRY_AFTER_MS).toBe(15 * 60_000);
    expect(retryDelayMs(0, 2 * 60 * 60_000)).toBe(MAX_RETRY_AFTER_MS);
    expect(retryDelayMs(20, MAX_RETRY_AFTER_MS * 100)).toBe(MAX_RETRY_AFTER_MS);
  });

  it('keeps the backoff itself well below the cap', () => {
    const ceiling = backoffEnvelope(20).max;
    expect(ceiling).toBeLessThan(MAX_RETRY_AFTER_MS);

    for (const attemptIndex of [0, 4, 12]) {
      for (let i = 0; i < 50; i += 1) {
        expect(retryBackoffDelay(attemptIndex)).toBeLessThanOrEqual(ceiling);
      }
    }
  });
});

describe('retry budget parity with the human kernel', () => {
  it('agrees on the Retry-After cap', () => {
    expect(HUMAN_MAX_RETRY_AFTER_MS).toBe(MAX_RETRY_AFTER_MS);
  });

  it('agrees on the backoff envelope for every attempt index', () => {
    for (const attemptIndex of [0, 1, 5, 9]) {
      const envelope = backoffEnvelope(attemptIndex);
      for (let i = 0; i < 50; i += 1) {
        const value = humanRetryBackoffDelay(attemptIndex);
        expect(value).toBeGreaterThanOrEqual(envelope.min);
        expect(value).toBeLessThanOrEqual(envelope.max);
      }
    }
  });

  it('agrees on how a Retry-After combines with the backoff', () => {
    for (const retryAfterMs of [1, 1_000, 60_000, MAX_RETRY_AFTER_MS * 100]) {
      for (const attemptIndex of [0, 5]) {
        expect(humanRetryDelayMs(attemptIndex, retryAfterMs)).toBe(
          retryDelayMs(attemptIndex, retryAfterMs),
        );
      }
    }
    expect(humanRetryDelayMs(0, MAX_RETRY_AFTER_MS * 100)).toBe(MAX_RETRY_AFTER_MS);
  });
});
