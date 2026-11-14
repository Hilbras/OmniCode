import { Disposable } from '@hilbras/omnicode-base/di/lifecycle';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { IAgentToolExecutorService } from '#/agent/toolExecutor/toolExecutor';
import type { ToolDidExecuteContext } from '#/agent/toolExecutor/toolHooks';

import { IAgentGoalService } from './goalService';
import {
  GOAL_EVIDENCE_MAX_RECORDS,
  IAgentGoalEvidenceService,
  evidenceFromToolObservation,
  type GoalEvidenceRecordInput,
  type RuntimeToolObservation,
  type StoredGoalEvidence,
} from './goalEvidence';

export class AgentGoalEvidenceService extends Disposable implements IAgentGoalEvidenceService {
  declare readonly _serviceBrand: undefined;

  private records: StoredGoalEvidence[] = [];

  constructor(
    @IAgentToolExecutorService private readonly toolExecutor: IAgentToolExecutorService,
    @IAgentGoalService private readonly goal: IAgentGoalService,
  ) {
    super();
    this._register(
      toolExecutor.hooks.onDidExecuteTool.register('goal-evidence', async (context, next) => {
        this.capture(context);
        await next();
      }),
    );
  }

  record(input: GoalEvidenceRecordInput): StoredGoalEvidence {
    return this.push({
      id: `ev-${String(nextRecordId(this.records))}`,
      goalId: input.goalId,
      claim: input.claim,
      source: input.source,
      provenance: input.provenance,
      exitCode: input.exitCode,
      observer: input.observer ?? 'runtime',
      observedAt: input.observedAt ?? Date.now(),
    });
  }

  list(): readonly StoredGoalEvidence[] {
    return this.records;
  }

  latest(): StoredGoalEvidence | undefined {
    return this.records.at(-1);
  }

  clear(): void {
    this.records = [];
  }

  private capture(context: ToolDidExecuteContext): void {
    if (context.outcome !== 'executed') return;
    const goalId = this.activeGoalId();
    if (goalId === undefined) return;
    const observation: RuntimeToolObservation = {
      toolName: context.toolCall.name,
      args: context.args,
      output: context.result.output,
      isError: context.result.isError,
      accesses: context.accesses,
    };
    const evidence = evidenceFromToolObservation(observation, Date.now(), nextRecordId(this.records));
    if (evidence === undefined) return;
    this.push({ ...evidence, goalId });
  }

  private push(record: StoredGoalEvidence): StoredGoalEvidence {
    this.records = [...this.records, record];
    if (this.records.length > GOAL_EVIDENCE_MAX_RECORDS) {
      this.records = this.records.slice(this.records.length - GOAL_EVIDENCE_MAX_RECORDS);
    }
    return record;
  }

  private activeGoalId(): string | undefined {
    try {
      const current = this.goal.getGoal().goal;
      return current !== null && current.status === 'active' ? current.goalId : undefined;
    } catch {
      return undefined;
    }
  }
}

function nextRecordId(records: readonly StoredGoalEvidence[]): number {
  const last = records.at(-1);
  if (last === undefined) return 0;
  const parsed = Number(last.id.replace('ev-', ''));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed + 1 : records.length;
}

registerScopedService(
  LifecycleScope.Agent,
  IAgentGoalEvidenceService,
  AgentGoalEvidenceService,
  ScopeActivation.OnScopeCreated,
  'goalEvidence',
);
