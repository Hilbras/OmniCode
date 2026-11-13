import type { AgentLLMRequestSource } from '#/agent/llmRequester/llmRequester';

/**
 * Live per-turn and per-goal spend breakdowns over recorded usage.
 *
 * The session total is deliberately not kept here: the service prices the
 * persisted per-model usage state, so session spend survives replay exactly
 * where session usage persists. These breakdowns are live-session state, the
 * same durability class as `UsageStatus.currentTurn`, and `liveRecords` is the
 * signal that says so — after a replay it is 0 while `spentUsd` can be
 * non-zero, which means the empty turn/goal maps were reset, not that the
 * session spent nothing per turn or per goal.
 *
 * `unknownPricing` is a snapshot-wide honesty flag: one unpriced model makes
 * every number in the snapshot (session total, per turn, per goal) a lower
 * bound, so callers must not present them as complete spend.
 */

export interface SessionCostTotals {
  readonly spentUsd: number;
  readonly unknownPricing: boolean;
}

export interface CostLedgerStatus extends SessionCostTotals {
  /** Usage records this ledger observed live; 0 after a replay resets the maps. */
  readonly liveRecords: number;
  readonly currentTurn?: { readonly turnId: number; readonly spentUsd: number };
  /**
   * Priced spend per turn observed live. A turn is present once any of its
   * records was observed, even when the priced spend is 0 because the model
   * was unpriced — check `unknownPricing` before reading a 0 as "free".
   */
  readonly turns: Record<string, number>;
  readonly goals: Record<string, number>;
}

export class CostLedger {
  private readonly turnSpend = new Map<number, number>();
  private readonly turnGoal = new Map<number, string>();
  private currentTurnId: number | undefined;
  private liveRecords = 0;

  record(source: AgentLLMRequestSource | undefined, costUsd: number | undefined): void {
    this.liveRecords += 1;
    if (source?.type !== 'turn') return;
    this.currentTurnId = source.turnId;
    this.turnSpend.set(source.turnId, (this.turnSpend.get(source.turnId) ?? 0) + (costUsd ?? 0));
  }

  /**
   * Claims a turn for a goal. Safe to call before, after, or between the
   * turn's records: goal spend is derived from the turn map, so attribution
   * always covers what the turn has spent and will spend.
   */
  attributeGoalTurn(goalId: string, turnId: number): void {
    if (this.turnGoal.get(turnId) === goalId) return;
    this.turnGoal.set(turnId, goalId);
  }

  status(session: SessionCostTotals): CostLedgerStatus {
    const turns: Record<string, number> = {};
    for (const [turnId, spentUsd] of this.turnSpend) {
      turns[String(turnId)] = spentUsd;
    }
    const goals: Record<string, number> = {};
    for (const [turnId, goalId] of this.turnGoal) {
      const spentUsd = this.turnSpend.get(turnId);
      if (spentUsd === undefined) continue;
      goals[goalId] = (goals[goalId] ?? 0) + spentUsd;
    }
    return {
      spentUsd: session.spentUsd,
      unknownPricing: session.unknownPricing,
      liveRecords: this.liveRecords,
      currentTurn:
        this.currentTurnId === undefined
          ? undefined
          : { turnId: this.currentTurnId, spentUsd: this.turnSpend.get(this.currentTurnId) ?? 0 },
      turns,
      goals,
    };
  }
}
