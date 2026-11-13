import { describe, expect, it } from 'vitest';

import {
  DEFAULT_QUOTA_CIRCUIT_COOLDOWN_MS,
  QuotaCircuit,
  quotaCircuitFailureKind,
} from '#/agent/usage/quotaCircuit';
import {
  APIProviderQuotaExhaustedError,
  APIProviderRateLimitError,
  APIStatusError,
  ChatProviderError,
} from '#/llm-adapter/contract/errors';

function quotaError(): APIProviderQuotaExhaustedError {
  return new APIProviderQuotaExhaustedError('quota exhausted');
}

describe('quotaCircuitFailureKind', () => {
  it('counts quota exhaustion and auth rejections only', () => {
    expect(quotaCircuitFailureKind(quotaError())).toBe('quota');
    expect(quotaCircuitFailureKind(new APIStatusError(401, 'unauthorized'))).toBe('auth');
    expect(quotaCircuitFailureKind(new APIStatusError(403, 'forbidden'))).toBe('auth');
    expect(quotaCircuitFailureKind(new APIProviderRateLimitError('slow down'))).toBeUndefined();
    expect(quotaCircuitFailureKind(new APIStatusError(503, 'unavailable'))).toBeUndefined();
    expect(quotaCircuitFailureKind(new ChatProviderError('bad request'))).toBeUndefined();
  });

  it('classifies a wrapped provider error by its cause', () => {
    const wrapped = new Error('request failed', { cause: quotaError() });
    expect(quotaCircuitFailureKind(wrapped)).toBe('quota');
  });
});

describe('QuotaCircuit', () => {
  it('opens after repeated quota failures and reports the state honestly', () => {
    let now = 1_000;
    const circuit = new QuotaCircuit({ openAfterFailures: 3, cooldownMs: 5_000, now: () => now });

    expect(circuit.recordFailure('p', 'quota')).toMatchObject({
      scope: 'p',
      state: 'closed',
      consecutiveFailures: 1,
      lastFailureKind: 'quota',
    });
    expect(circuit.allows('p')).toBe(true);

    circuit.recordFailure('p', 'auth');
    const opened = circuit.recordFailure('p', 'quota');

    expect(opened).toEqual({
      scope: 'p',
      state: 'open',
      consecutiveFailures: 3,
      lastFailureKind: 'quota',
      openedAt: now,
      reopensAt: now + 5_000,
    });
    expect(circuit.allows('p')).toBe(false);
    expect(circuit.snapshots()).toEqual([opened]);
  });

  it('leaves unrelated failures out of the count', () => {
    const circuit = new QuotaCircuit({ openAfterFailures: 2 });

    expect(circuit.recordError('p', new APIProviderRateLimitError('slow down'))).toBeUndefined();
    expect(circuit.recordError('p', new APIStatusError(500, 'server error'))).toBeUndefined();
    expect(circuit.state('p')).toMatchObject({ state: 'closed', consecutiveFailures: 0 });
  });

  it('resets on success', () => {
    const circuit = new QuotaCircuit({ openAfterFailures: 2 });
    circuit.recordFailure('p', 'quota');
    circuit.recordFailure('p', 'quota');
    expect(circuit.allows('p')).toBe(false);

    expect(circuit.recordSuccess('p')).toEqual({
      scope: 'p',
      state: 'closed',
      consecutiveFailures: 0,
    });
    expect(circuit.allows('p')).toBe(true);
  });

  it('closes after the cooldown but re-opens on the next counted failure', () => {
    let now = 0;
    const circuit = new QuotaCircuit({ openAfterFailures: 2, cooldownMs: 5_000, now: () => now });
    circuit.recordFailure('p', 'quota');
    circuit.recordFailure('p', 'quota');
    expect(circuit.allows('p')).toBe(false);

    now = 5_000;
    expect(circuit.state('p')).toMatchObject({ state: 'closed', consecutiveFailures: 2 });
    expect(circuit.allows('p')).toBe(true);

    const reopened = circuit.recordFailure('p', 'auth');
    expect(reopened).toMatchObject({
      state: 'open',
      consecutiveFailures: 3,
      lastFailureKind: 'auth',
      openedAt: 5_000,
      reopensAt: 10_000,
    });
  });

  it('keeps scopes independent and supports a full reset', () => {
    const circuit = new QuotaCircuit({
      openAfterFailures: 1,
      cooldownMs: DEFAULT_QUOTA_CIRCUIT_COOLDOWN_MS,
    });
    circuit.recordFailure('p-a', 'quota');
    circuit.recordFailure('p-b', 'quota');

    expect(circuit.allows('p-a')).toBe(false);
    expect(circuit.allows('p-b')).toBe(false);

    circuit.reset('p-a');
    expect(circuit.allows('p-a')).toBe(true);
    expect(circuit.allows('p-b')).toBe(false);

    circuit.reset();
    expect(circuit.snapshots()).toEqual([]);
  });

  it('treats a non-positive threshold as one failure', () => {
    const circuit = new QuotaCircuit({ openAfterFailures: 0 });
    expect(circuit.recordFailure('p', 'quota').state).toBe('open');
  });
});