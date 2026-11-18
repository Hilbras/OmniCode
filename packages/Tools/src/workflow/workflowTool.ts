import { z } from 'zod';

import { registerAgentToolService } from '@hilbras/omnicode-engine/agent/toolRegistry/toolContribution';

import { IWorkflowTool } from './workflow';
import { IAgentToolExecutorService } from '@hilbras/omnicode-engine/agent/toolExecutor/toolExecutor';
import {
  WorkflowRunner,
  type WorkflowRunSummary,
  type WorkflowStepExecutor,
} from '@hilbras/omnicode-engine/agents/runtime/workflow/runner';
import { parseWorkflowScript } from '@hilbras/omnicode-engine/agents/runtime/workflow/script';
import { READ_ONLY_TOOL_NAMES } from '@hilbras/omnicode-engine/tool/read-only-command';
import { toInputJsonSchema } from '@hilbras/omnicode-engine/tool/input-schema';
import type {
  ExecutableToolContext,
  ExecutableToolResult,
  ToolExecution,
} from '@hilbras/omnicode-engine/tool/toolContract';

export const WorkflowInputSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).optional(),
    steps: z
      .array(
        z
          .object({
            id: z.string().min(1),
            tool: z.string().min(1),
            args: z.record(z.string(), z.json()),
            dependsOn: z.array(z.string().min(1)).min(1).optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type WorkflowInput = z.infer<typeof WorkflowInputSchema>;

const WORKFLOW_ALLOWED_TOOLS: ReadonlySet<string> = new Set(READ_ONLY_TOOL_NAMES);

const MAX_CONCURRENT_STEPS = 3;
const MAX_SUMMARY_CHARS = 500;

export class WorkflowTool implements IWorkflowTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'Workflow' as const;
  readonly description =
    'Run a declarative workflow of read-only tool steps (a DAG). Each step names a tool and its arguments; dependencies run in order. Only read-only tools are allowed (Read, Grep, Glob, ReadMediaFile, TaskList, TaskOutput, CronList, Lsp, WorktreeList, TaskBoardList, TeamList, memory_search). Use it to fan out independent reads or chain searches without spending a model turn per step.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(WorkflowInputSchema);

  constructor(@IAgentToolExecutorService private readonly tools: IAgentToolExecutorService) {}

  resolveExecution(args: WorkflowInput): ToolExecution {
    return {
      description: `Running workflow "${args.label ?? args.id}"`,
      display: {
        kind: 'generic',
        summary: `Workflow: ${args.label ?? args.id} (${String(args.steps.length)} steps)`,
      },
      approvalRule: `Workflow(${args.id})`,
      execute: (context) => this.run(args, context),
    };
  }

  private async run(
    args: WorkflowInput,
    context: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    let script;
    try {
      script = parseWorkflowScript(args);
    } catch (error) {
      return {
        isError: true,
        output: `Workflow script is invalid: ${error instanceof Error ? error.message : 'unknown error'}`,
      };
    }

    const summaries = new Map<string, string>();
    const executor: WorkflowStepExecutor = async (step, stepContext) => {
      const call = {
        type: 'function' as const,
        id: `workflow_${args.id}_${step.id}`,
        name: step.tool,
        arguments: JSON.stringify(step.args),
      };
      let last;
      try {
        for await (const result of this.tools.execute([call], {
          turnId: context.turnId,
          signal: stepContext.signal,
        })) {
          last = result;
        }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'tool execution failed',
        };
      }
      if (last === undefined) return { ok: false, error: 'the tool produced no result' };
      const output = textOf(last.result.output).trim();
      summaries.set(step.id, output.slice(0, MAX_SUMMARY_CHARS));
      return last.result.isError === true
        ? { ok: false, error: output.length > 0 ? output : 'tool reported an error' }
        : { ok: true, summary: output };
    };

    const runner = new WorkflowRunner({
      script,
      executor,
      maxConcurrentSteps: MAX_CONCURRENT_STEPS,
      allowedTools: WORKFLOW_ALLOWED_TOOLS,
    });
    const summary = await runner.run();
    const output = renderSummary(summary, summaries);
    return summary.status === 'completed' ? { output } : { isError: true, output };
  }
}

function textOf(output: unknown): string {
  if (typeof output === 'string') return output;
  if (!Array.isArray(output)) return '';
  return output
    .filter((part): part is { readonly type: 'text'; readonly text: string } => {
      return (
        typeof part === 'object' &&
        part !== null &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string'
      );
    })
    .map((part) => part.text)
    .join('');
}

function renderSummary(
  summary: WorkflowRunSummary,
  stepSummaries: ReadonlyMap<string, string>,
): string {
  const lines = [
    `Workflow "${summary.workflowId}" ${summary.status} in ${String(summary.endedAt - summary.startedAt)} ms.`,
  ];
  for (const id of summary.completed) {
    const detail = stepSummaries.get(id);
    lines.push(`- ${id}: ok${detail === undefined || detail.length === 0 ? '' : ` — ${detail}`}`);
  }
  for (const id of summary.failed) lines.push(`- ${id}: failed`);
  if (summary.refused.length > 0) lines.push(`- refused: ${summary.refused.join(', ')}`);
  if (summary.skipped.length > 0) lines.push(`- skipped: ${summary.skipped.join(', ')}`);
  if (summary.error !== undefined) lines.push(`- error: ${summary.error.message}`);
  lines.push(`Allowed steps run through the normal permission checks.`);
  return lines.join('\n');
}

registerAgentToolService(IWorkflowTool, WorkflowTool, {
  name: 'Workflow',
  domain: 'agents',
});
