import { describe, expect, it, vi } from 'vitest';

import type { IAgentFullCompactionService } from '@hilbras/omnicode-engine/agent/fullCompaction/fullCompaction';
import type { IAgentScopeContext } from '@hilbras/omnicode-engine/agent/scopeContext/scopeContext';
import type { ISessionTokenCountingService } from '@hilbras/omnicode-engine/session/tokenCounting/sessionTokenCounting';
import type { ExecutableToolContext, RunnableToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';

import { NewContextWindowTool } from '#/features/contextBudget/new-context-window/newContextWindowTool';

const scope = { agentContext: { agentId: 'main' } } as unknown as IAgentScopeContext;

const counting = {
  get: () => ({ size: 150_000, measured: 140_000, estimated: 10_000 }),
} as unknown as ISessionTokenCountingService;

const context = {
  turnId: 1,
  toolCallId: 'window-call',
  signal: new AbortController().signal,
} as ExecutableToolContext;

function compaction(begin: () => boolean, compacting: unknown = null): IAgentFullCompactionService {
  return {
    compacting,
    begin: vi.fn(begin),
  } as unknown as IAgentFullCompactionService;
}

async function run(tool: NewContextWindowTool, instruction?: string) {
  const execution = tool.resolveExecution(instruction === undefined ? {} : { instruction }) as RunnableToolExecution;
  return execution.execute(context);
}

describe('NewContextWindow tool', () => {
  it('schedules an auto compaction and reports the pre-switch token count', async () => {
    const begin = vi.fn(() => true);
    const tool = new NewContextWindowTool(compaction(begin), counting, scope);
    const result = await run(tool, 'keep the open requirements and file paths');
    expect(result.isError).not.toBe(true);
    expect(typeof result.output === 'string' && result.output.includes('~150000 tokens')).toBe(true);
    expect(typeof result.output === 'string' && result.output.includes('when this turn ends')).toBe(true);
    expect(begin).toHaveBeenCalledWith({
      source: 'auto',
      instruction: 'keep the open requirements and file paths',
    });
  });

  it('reports an in-flight compaction without starting a second one', async () => {
    const begin = vi.fn(() => true);
    const tool = new NewContextWindowTool(
      compaction(begin, { trigger: 'auto' }),
      counting,
      scope,
    );
    const result = await run(tool);
    expect(result.isError).not.toBe(true);
    expect(typeof result.output === 'string' && result.output.includes('already running')).toBe(true);
    expect(begin).not.toHaveBeenCalled();
  });

  it('reports the per-turn limit without erroring when the slot is exhausted', async () => {
    const tool = new NewContextWindowTool(compaction(() => false), counting, scope);
    const result = await run(tool);
    expect(result.isError).not.toBe(true);
    expect(
      typeof result.output === 'string' && result.output.includes('per-turn compaction limit'),
    ).toBe(true);
  });

  it('returns an error result with the refusal reason when compaction cannot start', async () => {
    const tool = new NewContextWindowTool(
      compaction(() => {
        throw new Error('No messages to compact in current history.');
      }),
      counting,
      scope,
    );
    const result = await run(tool);
    expect(result.isError).toBe(true);
    expect(
      typeof result.output === 'string' && result.output.includes('No messages to compact'),
    ).toBe(true);
  });

  it('omits the instruction when the model passes none', async () => {
    const begin = vi.fn(() => true);
    const tool = new NewContextWindowTool(compaction(begin), counting, scope);
    await run(tool);
    expect(begin).toHaveBeenCalledWith({ source: 'auto', instruction: undefined });
  });

  it('declares the tool name as its approval rule', () => {
    const tool = new NewContextWindowTool(compaction(() => true), counting, scope);
    const execution = tool.resolveExecution({}) as RunnableToolExecution;
    expect(execution.approvalRule).toBe('NewContextWindow');
    expect(execution.description).toBe('Requesting a fresh context window');
  });
});
