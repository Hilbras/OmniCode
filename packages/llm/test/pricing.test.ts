import { describe, expect, it } from 'vitest';

import {
  CostBudget,
  ModelPricingTable,
  addCost,
  costOfUsage,
  formatUsd,
  unknownCost,
} from '#/pricing';
import { emptyUsage } from '#/usage';

const usage = {
  inputOther: 1_000_000,
  output: 500_000,
  inputCacheRead: 2_000_000,
  inputCacheCreation: 500_000,
};

describe('model pricing', () => {
  it('prices input, output, cache reads, and cache writes', () => {
    const cost = costOfUsage(usage, {
      inputPerMillionUsd: 3,
      outputPerMillionUsd: 15,
      cacheReadPerMillionUsd: 0.3,
      cacheWritePerMillionUsd: 3.75,
    });
    expect(cost.inputUsd).toBe(3);
    expect(cost.outputUsd).toBe(7.5);
    expect(cost.cacheReadUsd).toBeCloseTo(0.6);
    expect(cost.cacheWriteUsd).toBeCloseTo(1.875);
    expect(cost.totalUsd).toBeCloseTo(12.975);
    expect(cost.unknownPricing).toBe(false);
  });

  it('falls back to input pricing for missing cache rates', () => {
    const cost = costOfUsage(usage, { inputPerMillionUsd: 2, outputPerMillionUsd: 8 });
    expect(cost.cacheReadUsd).toBe(4);
    expect(cost.cacheWriteUsd).toBe(1);
  });

  it('marks unknown models instead of reporting zero-priced success', () => {
    const table = new ModelPricingTable({ known: { inputPerMillionUsd: 1, outputPerMillionUsd: 2 } });
    expect(table.cost('unknown', usage)).toEqual(unknownCost());
    expect(table.cost('known', usage).unknownPricing).toBe(false);
  });

  it('adds costs and tracks hard budgets', () => {
    const left = costOfUsage(usage, { inputPerMillionUsd: 1, outputPerMillionUsd: 1 });
    const right = costOfUsage(emptyUsage(), { inputPerMillionUsd: 1, outputPerMillionUsd: 1 });
    expect(addCost(left, right).totalUsd).toBe(left.totalUsd);
    const budget = new CostBudget(10);
    expect(budget.add(left).remainingUsd).toBeCloseTo(6);
    expect(budget.wouldExceed(left)).toBe(false);
    expect(budget.add(left).remainingUsd).toBeCloseTo(2);
    expect(budget.wouldExceed(left)).toBe(true);
    expect(budget.add(left).exceeded).toBe(true);
    expect(() => new CostBudget(-1)).toThrow('non-negative');
  });

  it('formats small costs with more precision', () => {
    expect(formatUsd(0.001234)).toBe('$0.001234');
    expect(formatUsd(1.23456)).toBe('$1.2346');
  });
});
