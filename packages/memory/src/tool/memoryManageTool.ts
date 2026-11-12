import { z } from 'zod';

import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import type { AgentTool, ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';
import { toInputJsonSchema } from '@hilbras/omnicode-engine/tool/input-schema';

import { IAgentMemoryContextService } from '#/context/agentMemoryContextService';
import { IMemoryService } from '#/contracts/memoryContract';
import type { MemoryCategory, MemoryScope, MemoryTier } from '#/contracts/memoryTypes';
import { MEMORY_CATEGORIES, MEMORY_SCOPE_TIERS, MEMORY_TIERS } from '#/contracts/memoryTypes';

export const MEMORY_MANAGE_TOOL_NAME = 'memory_manage';

const MEMORY_WRITE_SCOPE_TIERS = ['repository', 'session', 'global', 'channel'] as const;

export const MEMORY_MANAGE_ACTIONS = ['dream', 'consolidate', 'list'] as const;

export const MEMORY_MANAGE_DESCRIPTION = [
  'Manage stored memory: consolidate related memories in a scope, or list the active memories available for management.',
  '',
  'Dream consolidation merges related working memories into one distilled memory and supersedes the sources. It never raises trust beyond what the evidence supports and never mutates memories on legal hold.',
  'Use this after repeated sessions to reduce duplicate or fragmented memories while preserving provenance.',
].join('\n');

export interface MemoryManageInput {
  readonly action?: (typeof MEMORY_MANAGE_ACTIONS)[number];
  readonly operation?: (typeof MEMORY_MANAGE_ACTIONS)[number];
  readonly scope?: (typeof MEMORY_WRITE_SCOPE_TIERS)[number];
  readonly channelId?: string;
  readonly tier?: (typeof MEMORY_TIERS)[number];
  readonly category?: (typeof MEMORY_CATEGORIES)[number];
  readonly limit?: number;
  readonly dryRun?: boolean;
}

export const MemoryManageInputSchema: z.ZodType<MemoryManageInput> = z.object({
  action: z.enum(MEMORY_MANAGE_ACTIONS).optional().describe('Management action. Defaults to dream consolidation.'),
  operation: z.enum(MEMORY_MANAGE_ACTIONS).optional().describe('Alias for action.'),
  scope: z.enum(MEMORY_WRITE_SCOPE_TIERS).optional().describe('Scope to manage. Defaults to repository.'),
  channelId: z.string().min(1).optional().describe('Channel id when scope is channel.'),
  tier: z.enum(MEMORY_TIERS).optional().describe('Only manage memories in this tier.'),
  category: z.enum(MEMORY_CATEGORIES).optional().describe('Only manage memories in this category.'),
  limit: z.number().int().min(1).max(500).optional().describe('Maximum memories to scan.'),
  dryRun: z.boolean().optional().describe('Report consolidation groups without changing memory.'),
});

export interface IMemoryManageTool extends AgentTool<MemoryManageInput> {
  readonly _serviceBrand: undefined;
}

export const IMemoryManageTool = createDecorator<IMemoryManageTool>('memoryManageTool');

const DISABLED_OUTPUT = 'Memory is disabled for this session. Nothing was changed.';

export class MemoryManageTool implements IMemoryManageTool {
  declare readonly _serviceBrand: undefined;

  readonly name = MEMORY_MANAGE_TOOL_NAME;
  readonly description: string = MEMORY_MANAGE_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(MemoryManageInputSchema);

  constructor(
    @IAgentMemoryContextService private readonly memory: IAgentMemoryContextService,
    @IMemoryService private readonly service: IMemoryService,
  ) {}

  resolveExecution(args: MemoryManageInput): ToolExecution {
    const action = args.action ?? args.operation ?? 'dream';
    return {
      description: action === 'list' ? 'Listing memories for management' : 'Consolidating memories',
      accesses: [],
      approvalRule: this.name,
      execute: async () => {
        if (!this.service.enabled) return { isError: false, output: DISABLED_OUTPUT };
        const scope = await this.memory.scopeFor(args.scope ?? 'repository', args.channelId);
        if (scope === undefined) {
          return {
            isError: true,
            output: 'The project for this session could not be identified, so repository memory cannot be managed. Use scope "session" or "global" instead.',
          };
        }

        if (action === 'list') {
          const records = await this.service.list({
            workspaceId: this.memory.workspaceId(),
            projectId: await this.memory.projectId(),
            sessionId: this.memory.sessionId(),
            taskId: undefined,
            scopes: [scope.tier],
            lifecycle: ['active'],
            limit: args.limit ?? 100,
          });
          const visible = records.filter((record) => record.sensitivity !== 'secret' && record.sensitivity !== 'confidential');
          const lines = [`memory manage status: list`, `count=${visible.length}`];
          for (const record of visible) {
            const subject = record.subject === undefined ? '' : ` subject=${record.subject}`;
            lines.push(`- ${record.id} [${record.tier}/${record.category}/${record.trust}]${subject}`);
          }
          if (visible.length !== records.length) lines.push(`redacted=${records.length - visible.length}`);
          return { isError: false, output: lines.join('\n') };
        }

        const result = await this.service.dreamConsolidate({
          scope,
          tier: args.tier as MemoryTier | undefined,
          category: args.category as MemoryCategory | undefined,
          limit: args.limit,
          dryRun: args.dryRun,
        });
        const lines = [
          `memory manage status: ${result.status}`,
          `scope=${result.scope.tier}`,
          `scanned=${result.scanned}`,
          `groups=${result.groups}`,
          `consolidated=${result.consolidated}`,
          `superseded=${result.superseded}`,
          `skipped=${result.skipped}`,
        ];
        if (result.ids.length > 0) lines.push(`ids=${result.ids.join(',')}`);
        if (result.reason !== undefined) lines.push(result.reason);
        return { isError: result.status === 'failed', output: lines.join('\n') };
      },
    };
  }
}
