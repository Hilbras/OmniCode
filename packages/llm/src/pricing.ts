import type { TokenUsage } from './usage';

export interface ModelPricing {
  readonly inputPerMillionUsd: number;
  readonly outputPerMillionUsd: number;
  readonly cacheReadPerMillionUsd?: number;
  readonly cacheWritePerMillionUsd?: number;
}

export interface CostBreakdown {
  readonly inputUsd: number;
  readonly outputUsd: number;
  readonly cacheReadUsd: number;
  readonly cacheWriteUsd: number;
  readonly totalUsd: number;
  readonly unknownPricing: boolean;
}

export interface CostBudgetSnapshot {
  readonly limitUsd: number;
  readonly spentUsd: number;
  readonly remainingUsd: number;
  readonly exceeded: boolean;
}

export class ModelPricingTable {
  private readonly prices: ReadonlyMap<string, ModelPricing>;

  constructor(entries: Readonly<Record<string, ModelPricing>> | ReadonlyMap<string, ModelPricing>) {
    this.prices = entries instanceof Map ? new Map(entries) : new Map(Object.entries(entries));
  }

  get(modelId: string): ModelPricing | undefined {
    return this.prices.get(modelId);
  }

  cost(modelId: string, usage: TokenUsage): CostBreakdown {
    const pricing = this.prices.get(modelId);
    return pricing === undefined ? unknownCost() : costOfUsage(usage, pricing);
  }
}

export function costOfUsage(usage: TokenUsage, pricing: ModelPricing): CostBreakdown {
  const inputUsd = (usage.inputOther / 1_000_000) * pricing.inputPerMillionUsd;
  const outputUsd = (usage.output / 1_000_000) * pricing.outputPerMillionUsd;
  const cacheReadUsd =
    (usage.inputCacheRead / 1_000_000) * (pricing.cacheReadPerMillionUsd ?? pricing.inputPerMillionUsd);
  const cacheWriteUsd =
    (usage.inputCacheCreation / 1_000_000) *
    (pricing.cacheWritePerMillionUsd ?? pricing.inputPerMillionUsd);
  return {
    inputUsd,
    outputUsd,
    cacheReadUsd,
    cacheWriteUsd,
    totalUsd: inputUsd + outputUsd + cacheReadUsd + cacheWriteUsd,
    unknownPricing: false,
  };
}

export function unknownCost(): CostBreakdown {
  return {
    inputUsd: 0,
    outputUsd: 0,
    cacheReadUsd: 0,
    cacheWriteUsd: 0,
    totalUsd: 0,
    unknownPricing: true,
  };
}

export function addCost(left: CostBreakdown, right: CostBreakdown): CostBreakdown {
  return {
    inputUsd: left.inputUsd + right.inputUsd,
    outputUsd: left.outputUsd + right.outputUsd,
    cacheReadUsd: left.cacheReadUsd + right.cacheReadUsd,
    cacheWriteUsd: left.cacheWriteUsd + right.cacheWriteUsd,
    totalUsd: left.totalUsd + right.totalUsd,
    unknownPricing: left.unknownPricing || right.unknownPricing,
  };
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(value < 0.01 ? 6 : 4)}`;
}

export class CostBudget {
  private spent = 0;
  private readonly limitUsd: number;

  constructor(limitUsd: number) {
    if (!Number.isFinite(limitUsd) || limitUsd < 0) {
      throw new Error(`Cost budget must be a non-negative finite number, got ${String(limitUsd)}`);
    }
    this.limitUsd = limitUsd;
  }

  add(cost: CostBreakdown): CostBudgetSnapshot {
    this.spent += cost.totalUsd;
    return this.snapshot();
  }

  wouldExceed(cost: CostBreakdown): boolean {
    return this.spent + cost.totalUsd > this.limitUsd;
  }

  snapshot(): CostBudgetSnapshot {
    return {
      limitUsd: this.limitUsd,
      spentUsd: this.spent,
      remainingUsd: Math.max(0, this.limitUsd - this.spent),
      exceeded: this.spent > this.limitUsd,
    };
  }
}
