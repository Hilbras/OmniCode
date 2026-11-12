import { describe, expect, it } from 'vitest';

import {
  AUTO_MODE_DENIAL_LIMITS,
  actionFingerprint,
  consumePendingManualRetry,
  createDenialState,
  formatDenialStateLog,
  isDenialFallbackReason,
  recordAllow,
  recordBlock,
  recordFallbackApprove,
  recordUnavailable,
  resetDenialState,
  shouldFallback,
} from '#/agent/permissionPolicy/denialTracking';

describe('auto-mode denial tracking', () => {
  it('creates a zeroed state', () => {
    expect(createDenialState()).toEqual({
      consecutiveBlock: 0,
      consecutiveUnavailable: 0,
      totalBlock: 0,
      totalUnavailable: 0,
    });
  });

  it('records blocks and unavailability with cross-reset', () => {
    const blocked = recordBlock(createDenialState(), 'Bash(rm)');
    expect(blocked).toMatchObject({
      consecutiveBlock: 1,
      consecutiveUnavailable: 0,
      totalBlock: 1,
      pendingManualRetryFingerprint: 'Bash(rm)',
    });

    const unavailable = recordUnavailable(blocked);
    expect(unavailable).toMatchObject({
      consecutiveBlock: 0,
      consecutiveUnavailable: 1,
      totalBlock: 1,
      totalUnavailable: 1,
    });
  });

  it('records allows and clears pending retry', () => {
    const blocked = recordBlock(createDenialState(), 'Bash(rm)');
    const allowed = recordAllow(blocked, 'Bash(rm)');
    console.log('DEBUG blocked', JSON.stringify(blocked));
    console.log('DEBUG allowed', JSON.stringify(allowed));
    expect(allowed).toMatchObject({
      consecutiveBlock: 0,
      consecutiveUnavailable: 0,
    });
    expect(allowed.pendingManualRetryFingerprint).toBeUndefined();
  });

  it('falls back on consecutive blocks', () => {
    let state = createDenialState();
    for (let i = 0; i < AUTO_MODE_DENIAL_LIMITS.maxConsecutiveBlock; i += 1) {
      state = recordBlock(state, `Bash(${i})`);
    }
    expect(shouldFallback(state)).toEqual({
      fallback: true,
      reason: 'consecutive_block',
    });
  });

  it('falls back on consecutive unavailability', () => {
    let state = createDenialState();
    for (let i = 0; i < AUTO_MODE_DENIAL_LIMITS.maxConsecutiveUnavailable; i += 1) {
      state = recordUnavailable(state);
    }
    expect(shouldFallback(state)).toEqual({
      fallback: true,
      reason: 'consecutive_unavailable',
    });
  });

  it('falls back on total denial cap', () => {
    let state = createDenialState();
    for (let i = 0; i < AUTO_MODE_DENIAL_LIMITS.maxTotalDenials; i += 1) {
      state = i % 2 === 0 ? recordBlock(state) : recordUnavailable(state);
    }
    expect(shouldFallback(state)).toEqual({
      fallback: true,
      reason: 'total_denial',
    });
  });

  it('falls back on pending retry fingerprint', () => {
    const state = recordBlock(createDenialState(), 'Bash(rm)');
    expect(shouldFallback(state, 'Bash(rm)')).toEqual({
      fallback: true,
      reason: 'classifier_blocked_retry',
    });
  });

  it('consumes pending retry', () => {
    const state = recordBlock(createDenialState(), 'Bash(rm)');
    expect(consumePendingManualRetry(state).pendingManualRetryFingerprint).toBeUndefined();
  });

  it('records fallback approval', () => {
    let state = createDenialState();
    for (let i = 0; i < AUTO_MODE_DENIAL_LIMITS.maxConsecutiveBlock; i += 1) {
      state = recordBlock(state, `Bash(${i})`);
    }
    expect(recordFallbackApprove(state)).toMatchObject({
      consecutiveBlock: 0,
      consecutiveUnavailable: 0,
    });
  });

  it('resets all state', () => {
    const state = recordBlock(createDenialState(), 'Bash(rm)');
    expect(resetDenialState()).toEqual(createDenialState());
    expect(state.consecutiveBlock).toBe(1);
  });

  it('formats and fingerprints', () => {
    const state = recordBlock(createDenialState(), 'Bash(rm)');
    expect(formatDenialStateLog(state)).toContain('consecutiveBlock=1');
    expect(actionFingerprint('Bash', { command: 'rm' })).toBe('Bash:rm');
    expect(isDenialFallbackReason('total_denial')).toBe(true);
    expect(isDenialFallbackReason('nope')).toBe(false);
  });
});
