import { describe, expect, it } from 'vitest';

import type { LlmErrorMessage } from '#human/llm/errors';
import {
  DEFAULT_MAX_RETRY_ATTEMPTS,
  isRetryableError,
  resolveMaxAttempts,
  retryErrorFields,
  shouldRetry,
} from '#human/llm/requester/retry';

function status(kind: 'status' | 'rate_limit', statusCode: number): LlmErrorMessage<'status' | 'rate_limit'> {
  return {
    kind,
    message: String(statusCode),
    statusCode,
    requestId: null,
    retryAfterMs: null,
    headers: null,
  };
}

describe('LLM retry taxonomy', () => {
  it.each([408, 409, 429, 500, 502, 503, 504, 529])('retries transient status %s', (code) => {
    expect(isRetryableError(status('status', code))).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])('does not retry client status %s', (code) => {
    expect(isRetryableError(status('status', code))).toBe(false);
  });

  it('does not retry aborts, syntax, quota, context overflow, oversized requests, or unknown errors', () => {
    for (const error of [
      { kind: 'abort', message: 'aborted' },
      { kind: 'syntax', message: 'bad', code: 'request_format' },
      { kind: 'quota_exhausted', message: 'quota', statusCode: 429, requestId: null, retryAfterMs: null, headers: null },
      { kind: 'context_overflow', message: 'context', statusCode: 400, requestId: null, retryAfterMs: null, headers: null },
      { kind: 'request_too_large', message: 'large', statusCode: 413, requestId: null, retryAfterMs: null, headers: null },
      { kind: 'content_filter', message: 'input rejected by content safety screening', statusCode: 422, requestId: null, retryAfterMs: null, headers: null },
      { kind: 'unknown', message: 'unknown' },
    ] as LlmErrorMessage[]) {
      expect(isRetryableError(error), error.kind).toBe(false);
    }
  });

  it('retries transport failures and incomplete streams', () => {
    for (const error of [
      { kind: 'connection', message: 'connection reset' },
      { kind: 'timeout', message: 'timeout' },
      { kind: 'provider', message: 'provider' },
      { kind: 'incomplete_stream', message: 'truncated' },
      { kind: 'empty_response', message: 'empty', finishReason: 'length', rawFinishReason: null },
    ] as LlmErrorMessage[]) {
      expect(isRetryableError(error), error.kind).toBe(true);
    }
  });

  it('does not retry filtered empty responses', () => {
    expect(
      isRetryableError({
        kind: 'empty_response',
        message: 'filtered',
        finishReason: 'filtered',
        rawFinishReason: 'content_filter',
      }),
    ).toBe(false);
  });

  it('honours max attempts and infinite retry', () => {
    const error = status('status', 503);
    expect(resolveMaxAttempts(undefined)).toBe(DEFAULT_MAX_RETRY_ATTEMPTS);
    expect(resolveMaxAttempts({ maxAttemptsPerStep: 0 })).toBe(1);
    expect(shouldRetry({ maxAttemptsPerStep: 2 }, 1, error)).toBe(true);
    expect(shouldRetry({ maxAttemptsPerStep: 2 }, 2, error)).toBe(false);
    expect(shouldRetry({ infiniteRetry: true }, 100, error)).toBe(true);
    expect(shouldRetry({ infiniteRetry: true }, 100, { kind: 'abort', message: 'stop' })).toBe(true);
  });

  it('returns structured retry error fields', () => {
    expect(retryErrorFields(status('rate_limit', 429))).toEqual({
      errorName: 'rate_limit',
      errorMessage: '429',
      statusCode: 429,
    });
  });
});
