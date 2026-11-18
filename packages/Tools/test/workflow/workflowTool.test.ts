import { describe, expect, it } from 'vitest';

import type { IAgentToolExecutorService } from '@hilbras/omnicode-engine/agent/toolExecutor/toolExecutor';
import type { ExecutableToolContext, RunnableToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';

import { WorkflowTool } from '#/workflow/workflowTool';

function compose() {
  const seen: string[] = [];
  const tools = {
    async *execute(batch: readonly { id: string; name: string }[]) {
      for (const call of batch) {
        seen.push(call.name);
        yield {
          toolCallId: call.id,
          toolName: call.name,
          result: { output: `${call.name} ok` },
          durationMs: 1,
        };
      }
    },
  } as unknown as IAgentToolExecutorService;
  return { tool: new WorkflowTool(tools), seen };
}

const context = {
  turnId: 1,
  toolCallId: 'workflow-call',
  signal: new AbortController().signal,
} as ExecutableToolContext;

function run(tool: WorkflowTool, input: Parameters<WorkflowTool['resolveExecution']>[0]) {
  const execution = tool.resolveExecution(input) as RunnableToolExecution;
  return execution.execute(context);
}

describe('Workflow tool', () => {
  it('runs a dependency-ordered read-only workflow through the tool executor', async () => {
    const { tool, seen } = compose();
    const result = await run(tool, {
      id: 'explore',
      steps: [
        { id: 'a', tool: 'Read', args: { path: 'a.ts' } },
        { id: 'b', tool: 'Grep', args: { pattern: 'x' }, dependsOn: ['a'] },
      ],
    });
    expect(result.isError).not.toBe(true);
    expect(seen).toEqual(['Read', 'Grep']);
    expect(text(result)).toContain('a: ok');
    expect(text(result)).toContain('b: ok');
  });

  it('fails closed when a step names a tool outside the read-only allowlist', async () => {
    const { tool, seen } = compose();
    const result = await run(tool, {
      id: 'unsafe',
      steps: [{ id: 'a', tool: 'Bash', args: { command: 'rm -rf /' } }],
    });
    expect(result.isError).toBe(true);
    expect(seen).toEqual([]);
    expect(text(result)).toContain('refused');
  });

  it('rejects a dependency cycle before running anything', async () => {
    const { tool, seen } = compose();
    const result = await run(tool, {
      id: 'cycle',
      steps: [
        { id: 'a', tool: 'Read', args: { path: 'a' }, dependsOn: ['b'] },
        { id: 'b', tool: 'Read', args: { path: 'b' }, dependsOn: ['a'] },
      ],
    });
    expect(result.isError).toBe(true);
    expect(seen).toEqual([]);
    expect(text(result)).toContain('dependency cycle');
  });
});

function text(result: { readonly output: string | readonly unknown[] }): string {
  return typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
}
