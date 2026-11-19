import { describe, expect, it } from 'vitest';

import type { IAgentProfileService } from '@hilbras/omnicode-engine/agent/profile/profile';
import type { IAgentScopeContext } from '@hilbras/omnicode-engine/agent/scopeContext/scopeContext';
import type {
  IModelCatalog,
  Model,
} from '@hilbras/omnicode-engine/llm-adapter/model/catalog';
import type { ISessionTokenCountingService } from '@hilbras/omnicode-engine/session/tokenCounting/sessionTokenCounting';
import type { ExecutableToolContext, RunnableToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';

import { GetContextRemainingTool } from '#/features/contextBudget/get-context-remaining/getContextRemainingTool';

const scope = { agentContext: { agentId: 'main' } } as unknown as IAgentScopeContext;

function counting(size: number, measured: number, estimated: number): ISessionTokenCountingService {
  return {
    strategy: 'measured+estimated',
    get: () => ({ size, measured, estimated }),
  } as unknown as ISessionTokenCountingService;
}

function profile(modelAlias: string): IAgentProfileService {
  return {
    resolveModelContext: () => ({ modelAlias, maxOutputSize: 8_192 }),
  } as unknown as IAgentProfileService;
}

function catalog(model: Model | undefined): IModelCatalog {
  return {
    get: () => {
      if (model === undefined) throw new Error('unknown model');
      return model;
    },
  } as unknown as IModelCatalog;
}

const context = {
  turnId: 1,
  toolCallId: 'context-call',
  signal: new AbortController().signal,
} as ExecutableToolContext;

async function text(tool: GetContextRemainingTool): Promise<string> {
  const execution = tool.resolveExecution({}) as RunnableToolExecution;
  const result = await execution.execute(context);
  expect(result.isError).not.toBe(true);
  return typeof result.output === 'string' ? result.output : '';
}

describe('GetContextRemaining tool', () => {
  it('reports context tokens, model limits, and the remaining budget', async () => {
    const tool = new GetContextRemainingTool(
      counting(84_213, 80_000, 4_213),
      scope,
      profile('claude-sonnet'),
      catalog({
        id: 'claude-sonnet',
        name: 'Claude Sonnet',
        aliases: [],
        protocol: 'anthropic',
        headers: {},
        capabilities: {},
        maxContextSize: 200_000,
        maxInputSize: 190_000,
        maxOutputSize: 8_192,
        alwaysThinking: false,
      } as unknown as Model),
    );
    const output = await text(tool);
    expect(output).toContain('context_tokens: 84213 (measured 80000, estimated 4213)');
    expect(output).toContain('model: claude-sonnet');
    expect(output).toContain('max_context 200000');
    expect(output).toContain('max_input 190000');
    expect(output).toContain('remaining_tokens: 105787');
    expect(output).toContain('token_counting_strategy: measured+estimated');
  });

  it('uses the smaller of the context and input limits as the binding limit', async () => {
    const tool = new GetContextRemainingTool(
      counting(50_000, 50_000, 0),
      scope,
      profile('m'),
      catalog({
        maxContextSize: 200_000,
        maxInputSize: 100_000,
      } as unknown as Model),
    );
    const output = await text(tool);
    expect(output).toContain('remaining_tokens: 50000');
  });

  it('reports unknown remaining when the model declares no limits', async () => {
    const tool = new GetContextRemainingTool(
      counting(10, 10, 0),
      scope,
      profile('local-model'),
      catalog({} as unknown as Model),
    );
    const output = await text(tool);
    expect(output).toContain('model_limits: max_output 8192');
    expect(output).toContain('remaining_tokens: unknown');
  });

  it('survives an unresolvable model record and falls back to profile limits', async () => {
    const tool = new GetContextRemainingTool(
      counting(10, 10, 0),
      scope,
      profile('missing-model'),
      catalog(undefined),
    );
    const output = await text(tool);
    expect(output).toContain('model_limits: max_output 8192');
    expect(output).toContain('remaining_tokens: unknown');
  });

  it('declares itself read-only through the approval rule', () => {
    const tool = new GetContextRemainingTool(
      counting(1, 1, 0),
      scope,
      profile('m'),
      catalog(undefined),
    );
    const execution = tool.resolveExecution({}) as RunnableToolExecution;
    expect(execution.approvalRule).toBe('GetContextRemaining');
    expect(execution.description).toBe('Checking remaining context budget');
  });

  it('exposes the name, description, and empty parameters schema', () => {
    const tool = new GetContextRemainingTool(
      counting(1, 1, 0),
      scope,
      profile('m'),
      catalog(undefined),
    );
    expect(tool.name).toBe('GetContextRemaining');
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.parameters).toEqual({
      $schema: 'http://json-schema.org/draft-07/schema#',
      additionalProperties: false,
      properties: {},
      type: 'object',
    });
  });
});
