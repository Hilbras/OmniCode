import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ToolAccesses } from '#/tool/toolContract';
import type { ToolCall } from '#human/llm/message';

import { IAgentGoalService } from '#/features/goal/goalService';
import { IAgentToolExecutorService } from '#/agent/toolExecutor/toolExecutor';
import type { ToolDidExecuteContext } from '#/agent/toolExecutor/toolHooks';
import {
  evidenceFromToolObservation,
  type RuntimeToolObservation,
} from '#/features/goal/goalEvidence';
import { IAgentGoalEvidenceService } from '#/features/goal/goalEvidence';
import { GOAL_EVIDENCE_MAX_RECORDS } from '#/features/goal/goalEvidence';

import { createTestAgent, type TestAgentContext } from '../../harness';

const NOW = 5_000;

function observation(overrides: Partial<RuntimeToolObservation> & { toolName: string }): RuntimeToolObservation {
  return {
    args: {},
    output: 'ok',
    isError: false,
    ...overrides,
  };
}

describe('evidenceFromToolObservation', () => {
  it('attests a successful shell command with exit code 0 and command provenance', () => {
    const evidence = evidenceFromToolObservation(
      observation({ toolName: 'Bash', args: { command: 'vitest run test/goal' } }),
      NOW,
      0,
    );
    expect(evidence).toMatchObject({
      id: 'ev-0',
      source: 'command_run',
      provenance: 'vitest run test/goal',
      exitCode: 0,
      observer: 'runtime',
      observedAt: NOW,
    });
  });

  it('attests a failed shell command with the parsed exit code', () => {
    const evidence = evidenceFromToolObservation(
      observation({
        toolName: 'Bash',
        args: { command: 'vitest run' },
        output: 'Command failed with exit code: 3.',
        isError: true,
      }),
      NOW,
      1,
    );
    expect(evidence).toMatchObject({ source: 'command_run', exitCode: 3 });
  });

  it('drops a failed shell command whose exit code cannot be observed', () => {
    const evidence = evidenceFromToolObservation(
      observation({
        toolName: 'Bash',
        args: { command: 'make test' },
        output: 'spawn git ENOENT',
        isError: true,
      }),
      NOW,
      2,
    );
    expect(evidence).toBeUndefined();
  });

  it('attests a file read with the resolved access path', () => {
    const accesses: ToolAccesses = [{ kind: 'file', operation: 'read', path: '/ws/src/a.ts' }];
    const evidence = evidenceFromToolObservation(
      observation({ toolName: 'Read', args: { path: 'src/a.ts' }, accesses }),
      NOW,
      3,
    );
    expect(evidence).toMatchObject({
      source: 'file_read',
      provenance: '/ws/src/a.ts',
    });
    expect(evidence?.exitCode).toBeUndefined();
  });

  it('ignores tools that are not observations', () => {
    expect(
      evidenceFromToolObservation(observation({ toolName: 'Grep', args: { pattern: 'x' } }), NOW, 4),
    ).toBeUndefined();
  });
});

describe('AgentGoalEvidenceService', () => {
  let ctx: TestAgentContext;
  let goals: IAgentGoalService;
  let evidence: IAgentGoalEvidenceService;
  let executor: IAgentToolExecutorService;

  beforeEach(() => {
    ctx = createTestAgent();
    goals = ctx.get(IAgentGoalService);
    evidence = ctx.get(IAgentGoalEvidenceService);
    executor = ctx.get(IAgentToolExecutorService);
  });

  afterEach(async () => {
    await ctx.dispose();
  });

  function fireDidExecute(toolName: string, args: unknown, result: { output: string; isError?: boolean }, accesses?: ToolAccesses): Promise<void> {
    const toolCall: ToolCall = {
      type: 'function',
      id: `call_${toolName.toLowerCase()}`,
      name: toolName,
      arguments: JSON.stringify(args),
    };
    return executor.hooks.onDidExecuteTool.run({
      turnId: 1,
      signal: new AbortController().signal,
      toolCall,
      toolCalls: [toolCall],
      args,
      outcome: 'executed',
      accesses,
      result: { output: result.output, isError: result.isError },
    });
  }

  it('captures shell commands run while a goal is active, tagged with the goal id', async () => {
    const goal = await goals.createGoal({ objective: 'verify the build' });
    await fireDidExecute('Bash', { command: 'vitest run' }, { output: 'all passed' });

    expect(evidence.list()).toHaveLength(1);
    expect(evidence.list()[0]).toMatchObject({
      goalId: goal.goalId,
      source: 'command_run',
      exitCode: 0,
      provenance: 'vitest run',
    });
    expect(evidence.latest()?.goalId).toBe(goal.goalId);
  });

  it('captures nothing when no goal is active and clears on demand', async () => {
    await fireDidExecute('Bash', { command: 'vitest run' }, { output: 'all passed' });
    expect(evidence.list()).toHaveLength(0);

    await goals.createGoal({ objective: 'work' });
    await fireDidExecute('Read', { path: 'src/a.ts' }, { output: 'content' }, [
      { kind: 'file', operation: 'read', path: '/ws/src/a.ts' },
    ]);
    expect(evidence.list()).toHaveLength(1);
    evidence.clear();
    expect(evidence.list()).toHaveLength(0);
  });

  it('ignores synthetic outcomes and keeps the store bounded', async () => {
    const goal = await goals.createGoal({ objective: 'work' });
    const toolCall: ToolCall = { type: 'function', id: 'c1', name: 'Bash', arguments: '{"command":"x"}' };
    await executor.hooks.onDidExecuteTool.run({
      turnId: 1,
      signal: new AbortController().signal,
      toolCall,
      toolCalls: [toolCall],
      args: { command: 'x' },
      outcome: 'vetoed',
      result: { output: 'refused', isError: true },
    });
    expect(evidence.list()).toHaveLength(0);

    for (let index = 0; index < GOAL_EVIDENCE_MAX_RECORDS + 5; index += 1) {
      evidence.record({
        goalId: goal.goalId,
        source: 'file_read',
        claim: `read ${String(index)}`,
        provenance: `src/${String(index)}.ts`,
      });
    }
    expect(evidence.list()).toHaveLength(GOAL_EVIDENCE_MAX_RECORDS);
    expect(evidence.list()[0]?.claim).toBe(`read 5`);
    expect(evidence.list().at(-1)?.claim).toBe(`read ${String(GOAL_EVIDENCE_MAX_RECORDS + 4)}`);
  });
});
