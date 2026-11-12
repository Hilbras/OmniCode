import { describe, expect, it } from 'vitest';

import type { IConfigService } from '#/app/config/config';
import { ModelPriceTable } from '#/agent/usage/modelPriceTable';
import { AgentCostGateService } from '#/agent/usage/costGateService';

function service(config: Record<string, unknown>): AgentCostGateService {
  const configService = { get: (key: string) => config[key] } as unknown as IConfigService;
  return new AgentCostGateService(configService);
}

const priced = service({
  costLimits: {
    limitUsd: 5,
    modelPrices: { 'model-a': { inputPerMillionUsd: 1, outputPerMillionUsd: 10 } },
  },
});

describe('ModelPriceTable', () => {
  it('prices cache reads and writes, falling back to the input rate', () => {
    const table = new ModelPriceTable({ m: { inputPerMillionUsd: 2, outputPerMillionUsd: 8 } });
    expect(
      table.cost('m', { inputOther: 1_000_000, output: 1_000_000, inputCacheRead: 1_000_000, inputCacheCreation: 1_000_000 }),
    ).toBeCloseTo(2 + 8 + 2 + 2, 6);
    expect(table.cost('unknown', { inputOther: 1, output: 1, inputCacheRead: 0, inputCacheCreation: 0 })).toBeUndefined();
  });
});

describe('AgentCostGateService', () => {
  it('lets calls through when no limit is configured', () => {
    const gate = service({});
    expect(gate.limitUsd).toBeUndefined();
    expect(gate.assertCanAfford('model-a', 1_000_000, 1_000).allowed).toBe(true);
  });

  it('treats a zero or negative limit as disabled', () => {
    expect(service({ costLimits: { limitUsd: 0 } }).limitUsd).toBeUndefined();
    expect(service({ costLimits: { limitUsd: -3 } }).limitUsd).toBeUndefined();
  });

  it('refuses a priced call once spend reaches the limit', () => {
    expect(priced.assertCanAfford('model-a', 1_000_000, 0).allowed).toBe(true);
    expect(priced.assertCanAfford('model-a', 1_000_000, 4.5).allowed).toBe(false);
    expect(priced.assertCanAfford('model-a', 1_000_000, 4.5).reason).toBe('over-budget');
  });

  it('allows an unpriced model but reports unknown pricing', () => {
    const verdict = priced.assertCanAfford('unpriced', 1_000_000, 4.9);
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toBe('unknown-pricing');
  });

  it('prices usage and leaves unknown models unpriced', () => {
    expect(
      priced.priceUsage('model-a', { inputOther: 1_000_000, output: 0, inputCacheRead: 0, inputCacheCreation: 0 }),
    ).toBeCloseTo(1, 6);
    expect(priced.priceUsage('other', { inputOther: 1, output: 0, inputCacheRead: 0, inputCacheCreation: 0 })).toBeUndefined();
  });
});
