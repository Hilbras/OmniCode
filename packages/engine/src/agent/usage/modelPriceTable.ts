import type { TokenUsage } from '#human/llm/usage';

/**
 * Minimal per-model price table for the pre-call cost gate.
 *
 * The full pricing surface lives in the standalone `llm` package, which the
 * engine does not depend on (it talks to providers through the compatibility
 * adapter). This is the engine-side subset the gate needs: input/output rates
 * plus the cache rates, so a priced call is never under-reported just because
 * the cache discount is unmodelled.
 */
export interface ModelPriceRates {
  readonly inputPerMillionUsd: number;
  readonly outputPerMillionUsd: number;
  readonly cacheReadPerMillionUsd?: number;
  readonly cacheWritePerMillionUsd?: number;
}

export class ModelPriceTable {
  private readonly prices: ReadonlyMap<string, ModelPriceRates>;

  constructor(entries: Readonly<Record<string, ModelPriceRates>> | ReadonlyMap<string, ModelPriceRates>) {
    this.prices = entries instanceof Map ? new Map(entries) : new Map(Object.entries(entries));
  }

  get(modelId: string): ModelPriceRates | undefined {
    return this.prices.get(modelId);
  }

  /** USD for one usage record; `undefined` when the model has no price. */
  cost(modelId: string, usage: TokenUsage): number | undefined {
    const rates = this.prices.get(modelId);
    if (rates === undefined) return undefined;
    const cacheRead = rates.cacheReadPerMillionUsd ?? rates.inputPerMillionUsd;
    const cacheWrite = rates.cacheWritePerMillionUsd ?? rates.inputPerMillionUsd;
    return (
      (usage.inputOther / 1_000_000) * rates.inputPerMillionUsd +
      (usage.output / 1_000_000) * rates.outputPerMillionUsd +
      (usage.inputCacheRead / 1_000_000) * cacheRead +
      (usage.inputCacheCreation / 1_000_000) * cacheWrite
    );
  }
}
