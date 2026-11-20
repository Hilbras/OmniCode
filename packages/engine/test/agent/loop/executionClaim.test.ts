import { describe, expect, it } from 'vitest';

import {
  createExecutionClaim,
  decideExecutionClaim,
  DURABLE_CONTINUATION_INSTRUCTION,
  recoveryInstruction,
  type ClaimInput,
} from '#/agent/loop/executionClaim';

const input = (overrides: Partial<ClaimInput> = {}): ClaimInput => ({
  sessionId: 's1',
  turnId: 3,
  bootId: 'boot-a',
  now: 1000,
  leaseMs: 30_000,
  existing: undefined,
  ...overrides,
});

describe('decideExecutionClaim', () => {
  it('claims a fresh execution', () => {
    expect(decideExecutionClaim(input()).kind).toBe('claim');
  });

  it('holds a live claim in the same boot', () => {
    const existing = createExecutionClaim(input(), decideExecutionClaim(input()))!;
    expect(decideExecutionClaim(input({ existing })).kind).toBe('held');
  });

  it('reclaims an expired or previous-boot claim', () => {
    const existing = createExecutionClaim(input(), decideExecutionClaim(input()))!;
    expect(decideExecutionClaim(input({ existing, now: 31_000 })).kind).toBe('reclaim');
    expect(decideExecutionClaim(input({ existing, bootId: 'boot-b' })).kind).toBe('reclaim');
  });

  it('claims again for a different execution', () => {
    const existing = createExecutionClaim(input(), decideExecutionClaim(input()))!;
    expect(decideExecutionClaim(input({ existing, turnId: 4 })).kind).toBe('claim');
  });
});

describe('createExecutionClaim / recoveryInstruction', () => {
  it('records a durable lease and a recovery instruction', () => {
    const claim = createExecutionClaim(input(), decideExecutionClaim(input()))!;
    expect(claim).toMatchObject({
      sessionId: 's1', turnId: 3, bootId: 'boot-a', claimedAt: 1000, expiresAt: 31_000,
      toolCallDurable: true,
    });
    expect(recoveryInstruction(claim)).toBe(DURABLE_CONTINUATION_INSTRUCTION);
    expect(recoveryInstruction(undefined)).toBeUndefined();
    expect(recoveryInstruction({ ...claim, toolCallDurable: false })).toBeUndefined();
  });
});
