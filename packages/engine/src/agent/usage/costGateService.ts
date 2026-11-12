import { Service } from '@hilbras/omnicode-base/di/service';
import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import { registerScopedService, ScopeActivation } from '@hilbras/omnicode-base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import type { TokenUsage } from '#human/llm/usage';
import { ModelPriceTable, type ModelPriceRates } from './modelPriceTable';
import { IConfigService } from '#/app/config/config';

import { checkPreCallCost, type PreCallCostVerdict } from './costGate';

/**
 * Bridges operator-configured model prices into the pre-call gate.
 *
 * Prices live in config (`modelPrices`), never in code: a shipped table goes
 * stale, and silently wrong prices are worse than no prices. With no entry the
 * gate reports `unknown-pricing` and lets the call through, which keeps
 * behaviour unchanged for operators who have not opted into cost limits.
 *
 * A missing or `0` limit disables the gate entirely — `0` would otherwise
 * refuse the very first call, which is a trap, not a budget.
 */

export interface ModelPriceConfigEntry {
  readonly inputPerMillionUsd: number;
  readonly outputPerMillionUsd: number;
  readonly cacheReadPerMillionUsd?: number;
  readonly cacheWritePerMillionUsd?: number;
}

export interface CostGateConfig {
  readonly limitUsd?: number;
  readonly modelPrices?: Readonly<Record<string, ModelPriceConfigEntry>>;
}

export interface IAgentCostGateService {
  readonly _serviceBrand: undefined;
  /** Throws `usage.budget_exceeded` when the next call cannot start under budget. */
  assertCanAfford(modelId: string, promptTokens: number, spentUsd: number): PreCallCostVerdict;
  /** USD cost of one usage record, or `undefined` when the model has no price. */
  priceUsage(modelId: string, usage: TokenUsage): number | undefined;
  readonly limitUsd: number | undefined;
}

export const IAgentCostGateService = createDecorator<IAgentCostGateService>(
  'agentCostGateService',
);

export class AgentCostGateService extends Service implements IAgentCostGateService {
  declare readonly _serviceBrand: undefined;

  private readonly table: ModelPriceTable;
  private readonly limit: number | undefined;

  constructor(@IConfigService private readonly configService: IConfigService) {
    super();
    const section = this.configService.get<CostGateConfig>('costLimits') ?? {};
    this.limit = positiveLimit(section.limitUsd);
    this.table = new ModelPriceTable(pricesFromConfig(section.modelPrices));
  }

  get limitUsd(): number | undefined {
    return this.limit;
  }

  assertCanAfford(modelId: string, promptTokens: number, spentUsd: number): PreCallCostVerdict {
    const pricing = this.table.get(modelId);
    if (this.limit === undefined) {
      return {
        allowed: true,
        projectedUsd: 0,
        remainingUsd: Number.POSITIVE_INFINITY,
        reason: pricing === undefined ? 'unknown-pricing' : undefined,
      };
    }
    return checkPreCallCost({
      modelId,
      pricing,
      promptTokens,
      spent: { spentUsd, unknownPricing: pricing === undefined },
      limitUsd: this.limit,
    });
  }

  priceUsage(modelId: string, usage: TokenUsage): number | undefined {
    return this.table.cost(modelId, usage);
  }
}

function positiveLimit(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

function pricesFromConfig(
  entries: Readonly<Record<string, ModelPriceConfigEntry>> | undefined,
): Record<string, ModelPriceRates> {
  const out: Record<string, ModelPriceRates> = {};
  for (const [modelId, entry] of Object.entries(entries ?? {})) {
    out[modelId] = {
      inputPerMillionUsd: entry.inputPerMillionUsd,
      outputPerMillionUsd: entry.outputPerMillionUsd,
      ...(entry.cacheReadPerMillionUsd === undefined
        ? {}
        : { cacheReadPerMillionUsd: entry.cacheReadPerMillionUsd }),
      ...(entry.cacheWritePerMillionUsd === undefined
        ? {}
        : { cacheWritePerMillionUsd: entry.cacheWritePerMillionUsd }),
    };
  }
  return out;
}

registerScopedService(
  LifecycleScope.Agent,
  IAgentCostGateService,
  AgentCostGateService,
  ScopeActivation.OnScopeCreated,
  'costGate',
);
