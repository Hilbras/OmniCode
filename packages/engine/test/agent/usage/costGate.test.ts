import { describe, expect, it } from 'vitest';

import { UsageError } from '#/agent/usage/usage';
import {
  assertPreCallCost,
  checkPreCallCost,
  projectedCallCost,
  type PreCallCostCheck,
} from '#/agent/usage/costGate';

const pricing = { inputPerMillionUsd: 3, outputPerMillionUsd: 15 };

function check(overrides: Partial<PreCallCostCheck> = {}): PreCallCostCheck {
  return {
    modelId: 'model-x',
    pricing,
    promptTokens: 1_000_000,
    spent: { spentUsd: 0, unknownPricing: false },
    limitUsd: 10,
    ...overrides,
  };
}

describe('projectedCallCost', () => {
  it('prices prompt tokens plus a one-token output floor', () => {
    expect(projectedCallCost(pricing, 1_000_000)).toBeCloseTo(3.000015, 6);
    expect(projectedCallCost(pricing, 0)).toBeCloseTo(0.000015, 6);
    expect(projectedCallCost(pricing, -5)).toBeCloseTo(0.000015, 6);
  });
});

describe('checkPreCallCost', () => {
  it('allows a call that fits and reports the remainder', () => {
    const verdict = checkPreCallCost(check({ spent: { spentUsd: 2, unknownPricing: false } }));
    expect(verdict.allowed).toBe(true);
    expect(verdict.remainingUsd).toBeCloseTo(8, 6);
    expect(verdict.reason).toBeUndefined();
  });

  it('refuses before the call when spend plus projection is already over', () => {
    const verdict = checkPreCallCost(check({ spent: { spentUsd: 9, unknownPricing: false }, limitUsd: 10 }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('over-budget');
    expect(verdict.remainingUsd).toBeCloseTo(1, 6);
  });

  it('refuses at exactly the limit because of the output floor', () => {
    const verdict = checkPreCallCost(check({ spent: { spentUsd: 7, unknownPricing: false }, limitUsd: 10 }));
    expect(verdict.allowed).toBe(false);
  });

  it('never blocks an unknown model but says so', () => {
    const verdict = checkPreCallCost(check({ pricing: undefined, limitUsd: 0 }));
    expect(verdict).toEqual({
      allowed: true,
      projectedUsd: 0,
      remainingUsd: 0,
      reason: 'unknown-pricing',
    });
  });
});

describe('assertPreCallCost', () => {
  it('throws a typed usage error with the numbers', () => {
    expect(() =>
      assertPreCallCost(check({ spent: { spentUsd: 20, unknownPricing: false }, limitUsd: 10 })),
    ).toThrow(UsageError);
    try {
      assertPreCallCost(check({ spent: { spentUsd: 20, unknownPricing: false }, limitUsd: 10 }));
    } catch (error) {
      const usage = error as UsageError;
      expect(usage.code).toBe('usage.budget_exceeded');
      expect(usage.message).toContain('model-x');
      expect(usage.details).toMatchObject({ spentUsd: 20, limitUsd: 10 });
    }
  });

  it('returns the verdict when the call may proceed', () => {
    expect(assertPreCallCost(check()).allowed).toBe(true);
  });
});
