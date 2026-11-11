import { z } from 'zod';

import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import { toInputJsonSchema } from '#/tool/input-schema';
import { registerAgentToolService } from '#/agent/toolRegistry/toolContribution';
import type { AgentTool, ExecutableToolResult, ToolExecution } from '#/tool/toolContract';

import { ArenaService, IArenaService, type ArenaContender } from './arena';

export const ArenaToolInputSchema = z.object({
  prompt: z.string().trim().min(1).describe('The same task for every contender.'),
  contenders: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        model: z.string().trim().min(1),
        agent_id: z.string().trim().min(1).optional(),
        label: z.string().trim().min(1).optional(),
      }),
    )
    .min(2)
    .max(16),
});

export type ArenaToolInput = z.infer<typeof ArenaToolInputSchema>;

export interface IArenaTool extends AgentTool<ArenaToolInput> {
  readonly _serviceBrand: undefined;
}

export const IArenaTool = createDecorator<IArenaTool>('arenaTool');

export class ArenaTool implements IArenaTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'Arena' as const;
  readonly description =
    'Compare the same prompt across two or more model/agent contenders. Returns ranked structured results and isolates failures. The default host has no runner and returns described contenders only.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(ArenaToolInputSchema);

  constructor(@IArenaService private readonly arena: ArenaService) {}

  resolveExecution(args: ArenaToolInput): ToolExecution {
    return {
      accesses: [],
      description: `Comparing ${String(args.contenders.length)} arena contenders`,
      display: { kind: 'generic', summary: 'Arena comparison' },
      approvalRule: this.name,
      execute: async (): Promise<ExecutableToolResult> => {
        try {
          const contenders: ArenaContender[] = args.contenders.map((contender) => ({
            id: contender.id,
            model: contender.model,
            ...(contender.agent_id === undefined ? {} : { agentId: contender.agent_id }),
            ...(contender.label === undefined ? {} : { label: contender.label }),
          }));
          const comparison = await this.arena.compare({ prompt: args.prompt, contenders });
          return { output: JSON.stringify(comparison, null, 2), isError: false };
        } catch (error) {
          return { output: error instanceof Error ? error.message : String(error), isError: true };
        }
      },
    };
  }
}

registerAgentToolService(IArenaTool, ArenaTool, { name: 'Arena', domain: 'agentTask' });
