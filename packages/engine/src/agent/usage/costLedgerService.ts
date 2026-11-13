import { Service } from '@hilbras/omnicode-base/di/service';
import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { ISessionUsageService } from '#/session/usage/sessionUsage';

import { IAgentCostGateService } from './costGateService';
import { CostLedger, type CostLedgerStatus, type SessionCostTotals } from './costLedger';

/**
 * Agent-scope cost meter over recorded usage.
 *
 * Every record is priced through the pre-call gate's table so the meter and
 * the budget gate can never disagree about what a call cost. Session spend is
 * priced from the persisted per-model usage state instead of accumulated from
 * the live feed, so it survives replay exactly where session usage persists;
 * only the per-turn and per-goal breakdowns are live-session state.
 */

export interface IAgentCostLedgerService {
  readonly _serviceBrand: undefined;
  status(): CostLedgerStatus;
  /** Claims a turn's recorded and future spend for a goal. */
  attributeGoalTurn(goalId: string, turnId: number): void;
}

export const IAgentCostLedgerService = createDecorator<IAgentCostLedgerService>(
  'agentCostLedgerService',
);

export class AgentCostLedgerService extends Service implements IAgentCostLedgerService {
  declare readonly _serviceBrand: undefined;

  private readonly ledger = new CostLedger();

  constructor(
    @ISessionUsageService private readonly usage: ISessionUsageService,
    @IAgentScopeContext private readonly scopeContext: IAgentScopeContext,
    @IAgentCostGateService private readonly gate?: IAgentCostGateService,
  ) {
    super();
    this._register(
      usage.onDidRecord((e) => {
        if (e.agent.agentId !== this.scopeContext.agentId) return;
        this.ledger.record(e.source, this.gate?.priceUsage(e.model, e.usage));
      }),
    );
  }

  status(): CostLedgerStatus {
    return this.ledger.status(this.sessionTotals());
  }

  attributeGoalTurn(goalId: string, turnId: number): void {
    this.ledger.attributeGoalTurn(goalId, turnId);
  }

  private sessionTotals(): SessionCostTotals {
    const byModel = this.usage.status(this.scopeContext.agentContext).byModel ?? {};
    let spentUsd = 0;
    let unknownPricing = false;
    for (const [modelId, usage] of Object.entries(byModel)) {
      const cost = this.gate?.priceUsage(modelId, usage);
      if (cost === undefined) unknownPricing = true;
      else spentUsd += cost;
    }
    return { spentUsd, unknownPricing };
  }
}

registerScopedService(
  LifecycleScope.Agent,
  IAgentCostLedgerService,
  AgentCostLedgerService,
  ScopeActivation.OnScopeCreated,
  'costLedger',
);
