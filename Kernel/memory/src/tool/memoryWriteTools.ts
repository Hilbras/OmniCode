import { z } from 'zod';

import { createDecorator } from '@hilbras/omnicode-core/_base/di/instantiation';
import type { AgentTool, ToolExecution } from '@hilbras/omnicode-core/tool/toolContract';
import { toInputJsonSchema } from '@hilbras/omnicode-core/tool/input-schema';

import { IAgentMemoryContextService } from '#/context/agentMemoryContextService';
import { IMemoryService, type MemoryCaptureResult } from '#/contracts/memoryContract';
import type { MemoryRecord, MemoryScope } from '#/contracts/memoryTypes';

export const MEMORY_SAVE_TOOL_NAME = 'memory_save';
export const MEMORY_FORGET_TOOL_NAME = 'memory_forget';

export const MEMORY_SAVE_CATEGORIES = ['fact', 'preference', 'observation', 'task'] as const;
export const MEMORY_WRITE_SCOPE_TIERS = ['repository', 'session', 'global'] as const;

export const MEMORY_SAVE_DESCRIPTION = [
  'Save one durable memory that will help in later sessions: a project fact, a user preference, an observation about the codebase, or task context worth resuming.',
  '',
  'Save only what is stable and useful later. Do not save secrets, credentials, transient progress, or anything the user asked you not to keep.',
  'Everything you save is recorded as model-authored and stays unverified until the user or the application confirms it; saving cannot raise its own trust.',
  'Use `subject` as a short stable key (for example `devserver.port`) when the memory may later be contradicted, so the conflict is detected instead of stored twice.',
  'Search first with memory_search to avoid saving a duplicate.',
].join('\n');

export const MEMORY_FORGET_DESCRIPTION = [
  'Forget one stored memory by id when it is wrong, outdated, or the user asks you to forget it.',
  '',
  'The memory is invalidated, not erased: it stops being retrieved and injected, and the reason is kept for audit.',
  'Get the id from memory_search output. Memories that belong to another project or session cannot be forgotten from here.',
].join('\n');

export interface MemorySaveInput {
  readonly content: string;
  readonly category: (typeof MEMORY_SAVE_CATEGORIES)[number];
  readonly scope?: (typeof MEMORY_WRITE_SCOPE_TIERS)[number];
  readonly subject?: string;
}

export const MemorySaveInputSchema: z.ZodType<MemorySaveInput> = z.object({
  content: z.string().trim().min(1).max(2000).describe('The memory itself, as one self-contained statement.'),
  category: z.enum(MEMORY_SAVE_CATEGORIES).describe('What kind of memory this is.'),
  scope: z
    .enum(MEMORY_WRITE_SCOPE_TIERS)
    .optional()
    .describe('Where it applies: this repository (default), only this session, or every project.'),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._:-]*$/)
    .optional()
    .describe('Optional stable conflict key in lowercase, for example `devserver.port`.'),
});

export interface MemoryForgetInput {
  readonly id: string;
  readonly reason: string;
}

export const MemoryForgetInputSchema: z.ZodType<MemoryForgetInput> = z.object({
  id: z.string().trim().min(1).describe('The memory id from memory_search output.'),
  reason: z.string().trim().min(1).max(500).describe('Why this memory should be forgotten.'),
});

export interface IMemorySaveTool extends AgentTool<MemorySaveInput> {
  readonly _serviceBrand: undefined;
}

export const IMemorySaveTool = createDecorator<IMemorySaveTool>('memorySaveTool');

export interface IMemoryForgetTool extends AgentTool<MemoryForgetInput> {
  readonly _serviceBrand: undefined;
}

export const IMemoryForgetTool = createDecorator<IMemoryForgetTool>('memoryForgetTool');

const DISABLED_OUTPUT = 'Memory is disabled for this session. Nothing was changed.';

export class MemorySaveTool implements IMemorySaveTool {
  declare readonly _serviceBrand: undefined;

  readonly name = MEMORY_SAVE_TOOL_NAME;
  readonly description: string = MEMORY_SAVE_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(MemorySaveInputSchema);

  constructor(
    @IAgentMemoryContextService private readonly memory: IAgentMemoryContextService,
    @IMemoryService private readonly service: IMemoryService,
  ) {}

  resolveExecution(args: MemorySaveInput): ToolExecution {
    if (args.content.trim().length === 0) {
      return { isError: true, output: 'Provide the memory content to save.' };
    }
    return {
      description: 'Saving a memory',
      accesses: [],
      approvalRule: this.name,
      execute: async ({ toolCallId }) => {
        if (!this.service.enabled) return { isError: false, output: DISABLED_OUTPUT };
        const scope = await this.memory.scopeFor(args.scope ?? 'repository');
        if (scope === undefined) {
          return {
            isError: true,
            output: 'The project for this session could not be identified, so a repository memory cannot be saved. Use scope "session" or "global" instead.',
          };
        }
        const result = await this.service.capture({
          content: args.content.trim(),
          tier: 'working',
          category: args.category,
          sourceType: 'agent_observation',
          origin: 'model',
          scope,
          subject: args.subject,
          requestKey: `${this.memory.sessionId()}:${toolCallId}`,
        });
        return { isError: result.status === 'rejected' || result.status === 'failed', output: renderCapture(result) };
      },
    };
  }
}

export class MemoryForgetTool implements IMemoryForgetTool {
  declare readonly _serviceBrand: undefined;

  readonly name = MEMORY_FORGET_TOOL_NAME;
  readonly description: string = MEMORY_FORGET_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(MemoryForgetInputSchema);

  constructor(
    @IAgentMemoryContextService private readonly memory: IAgentMemoryContextService,
    @IMemoryService private readonly service: IMemoryService,
  ) {}

  resolveExecution(args: MemoryForgetInput): ToolExecution {
    if (args.id.trim().length === 0 || args.reason.trim().length === 0) {
      return { isError: true, output: 'Provide both the memory id and the reason for forgetting it.' };
    }
    return {
      description: 'Forgetting a memory',
      accesses: [],
      approvalRule: this.name,
      execute: async () => {
        if (!this.service.enabled) return { isError: false, output: DISABLED_OUTPUT };
        const id = args.id.trim();
        const record = await this.service.get(id);
        if (record === undefined || !(await this.isVisible(record))) {
          return { isError: true, output: `No memory with id ${id} is visible to this session. Nothing was changed.` };
        }
        if (record.lifecycle !== 'active') {
          return { isError: false, output: `Memory ${id} is already ${record.lifecycle}. Nothing was changed.` };
        }
        const result = await this.service.invalidate(id, `forgotten by the agent: ${args.reason.trim()}`);
        if (result.status !== 'updated') {
          return {
            isError: true,
            output: `memory forget status: ${result.status}${result.reason === undefined ? '' : `\n${result.reason}`}`,
          };
        }
        return { isError: false, output: `memory forget status: invalidated\nid=${id} content=${record.content}` };
      },
    };
  }

  private async isVisible(record: MemoryRecord): Promise<boolean> {
    return isScopeVisible(record.scope, {
      workspaceId: this.memory.workspaceId(),
      projectId: await this.memory.projectId(),
      sessionId: this.memory.sessionId(),
    });
  }
}

export function isScopeVisible(
  scope: MemoryScope,
  current: { readonly workspaceId: string; readonly projectId?: string; readonly sessionId: string },
): boolean {
  if (scope.tier === 'global') return true;
  if (scope.tier === 'workspace') return scope.workspaceId === current.workspaceId;
  if (scope.projectId === undefined || scope.projectId !== current.projectId) return false;
  if (scope.tier === 'repository') return true;
  return scope.sessionId === current.sessionId;
}

export function renderCapture(result: MemoryCaptureResult): string {
  const lines = [`memory save status: ${result.status}`];
  if (result.record !== undefined) {
    lines.push(
      `id=${result.record.id} trust=${result.record.trust} scope=${result.record.scope.tier} category=${result.record.category}`,
    );
    if (result.record.redactionCount > 0) lines.push('Secret-like content was redacted before storing.');
    if (result.record.suspicious) {
      lines.push(`Flagged as instruction-like content: ${result.record.suspicionReasons.join(', ')}`);
    }
    if (result.record.conflictsWith.length > 0) {
      lines.push(`Conflicts with: ${result.record.conflictsWith.join(', ')}`);
    }
  } else if (result.id !== undefined) {
    lines.push(`id=${result.id}`);
  }
  if (result.reason !== undefined) lines.push(result.reason);
  for (const violation of result.violations ?? []) lines.push(`policy ${violation.rule}: ${violation.message}`);
  return lines.join('\n');
}
