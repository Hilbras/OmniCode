export interface EvalToolCall {
  readonly name: string;
  readonly args?: unknown;
}

export interface EvalTurn {
  readonly toolCalls: readonly EvalToolCall[];
  readonly assistantText?: string;
}

export interface EvalTrajectory {
  readonly turns: readonly EvalTurn[];
  readonly costUsd?: number;
  readonly totalTokens?: number;
}

export interface EvalExpectation {
  readonly requiredTools?: readonly string[];
  readonly forbiddenTools?: readonly string[];
  readonly maxTurns?: number;
  readonly maxCostUsd?: number;
  readonly maxTotalTokens?: number;
  readonly finalTextIncludes?: readonly string[];
}

export interface EvalScore {
  readonly passed: boolean;
  readonly reasons: readonly string[];
  readonly usedTools: readonly string[];
  readonly turns: number;
  readonly costUsd: number;
  readonly totalTokens: number;
}

export function scoreTrajectory(trajectory: EvalTrajectory, expectation: EvalExpectation): EvalScore {
  const usedTools = [...new Set(trajectory.turns.flatMap((turn) => turn.toolCalls.map((call) => call.name)))];
  const reasons: string[] = [];
  for (const required of expectation.requiredTools ?? []) {
    if (!usedTools.includes(required)) reasons.push(`missing required tool: ${required}`);
  }
  for (const forbidden of expectation.forbiddenTools ?? []) {
    if (usedTools.includes(forbidden)) reasons.push(`used forbidden tool: ${forbidden}`);
  }
  if (expectation.maxTurns !== undefined && trajectory.turns.length > expectation.maxTurns) {
    reasons.push(`turn count ${trajectory.turns.length} exceeds ${expectation.maxTurns}`);
  }
  const costUsd = trajectory.costUsd ?? 0;
  if (expectation.maxCostUsd !== undefined && costUsd > expectation.maxCostUsd) {
    reasons.push(`cost ${costUsd} exceeds ${expectation.maxCostUsd}`);
  }
  const totalTokens = trajectory.totalTokens ?? 0;
  if (expectation.maxTotalTokens !== undefined && totalTokens > expectation.maxTotalTokens) {
    reasons.push(`tokens ${totalTokens} exceed ${expectation.maxTotalTokens}`);
  }
  const finalText = trajectory.turns.at(-1)?.assistantText ?? '';
  for (const needle of expectation.finalTextIncludes ?? []) {
    if (!finalText.includes(needle)) reasons.push(`final text missing: ${needle}`);
  }
  return { passed: reasons.length === 0, reasons, usedTools, turns: trajectory.turns.length, costUsd, totalTokens };
}
