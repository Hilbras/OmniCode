import { dirname } from 'pathe';
import { z } from 'zod';

import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import { IAgentRuntimeService, inspectAgentRuntime } from '@hilbras/omnicode-engine/agent/runtimeBinding/agentRuntime';
import { registerAgentToolService } from '@hilbras/omnicode-engine/agent/toolRegistry/toolContribution';
import type { IHostFileSystem } from '@hilbras/omnicode-engine/os/interface/hostFileSystem';
import { resolvePathAccessPath } from '@hilbras/omnicode-engine/tool/path-access';
import { RuntimeWorkspaceView } from '@hilbras/omnicode-engine/runtime/runtimeWorkspaceView';
import { ISessionWorkspaceContext } from '@hilbras/omnicode-engine/session/workspaceContext/workspaceContext';
import { ToolAccesses, type AgentTool, type ExecutableToolResult, type ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';
import { toInputJsonSchema } from '@hilbras/omnicode-engine/tool/input-schema';
import { literalRulePattern } from '@hilbras/omnicode-engine/tool/rule-match';
import { withWorkspaceWriteLock } from '@hilbras/omnicode-engine/workspace/writeLock';

import {
  PatchApplyError,
  applyPatch,
  parsePatch,
  patchOperationPaths,
  type PatchFileAdapter,
  type PatchOperation,
} from './applyPatch';
import { PatchJournal, recoverPatchJournals } from './patchJournal';
import { createPatchPathMapper } from './patchPath';

export const APPLY_PATCH_DESCRIPTION = 'Apply an atomic multi-file patch. Supports Add File, Update File, and Delete File with exact hunks. All files roll back if any operation fails.';

export const ApplyPatchInputSchema = z.object({
  patch: z.string().min(1).describe('Codex-style patch beginning with *** Begin Patch and ending with *** End Patch.'),
  dryRun: z.boolean().optional().describe('Validate and compute changes without writing.'),
});

export type ApplyPatchInput = z.infer<typeof ApplyPatchInputSchema>;

export interface IApplyPatchTool extends AgentTool<ApplyPatchInput> {
  readonly _serviceBrand: undefined;
}

export const IApplyPatchTool = createDecorator<IApplyPatchTool>('applyPatchTool');

export class ApplyPatchTool implements IApplyPatchTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'ApplyPatch' as const;
  readonly description = APPLY_PATCH_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(ApplyPatchInputSchema);

  constructor(
    @IAgentRuntimeService private readonly runtime: IAgentRuntimeService,
    @ISessionWorkspaceContext private readonly workspaceCtx: ISessionWorkspaceContext,
  ) {}

  resolveExecution(args: ApplyPatchInput): ToolExecution {
    const inspected = inspectAgentRuntime(this.runtime);
    const view = new RuntimeWorkspaceView(inspected, {
      workDir: this.workspaceCtx.workDir,
      additionalDirs: this.workspaceCtx.additionalDirs,
    });
    const env = { _serviceBrand: undefined, ...inspected.environment, ready: Promise.resolve() };
    let operations: readonly PatchOperation[] = [];
    let parseError: string | undefined;
    try {
      operations = parsePatch(args.patch);
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
    const safePaths = new Map<string, string>();
    for (const operation of operations) {
      for (const path of patchOperationPaths(operation)) {
        const safe = resolvePathAccessPath(path, {
          env,
          workspace: { workspaceDir: view.workDir, additionalDirs: view.additionalDirs },
          operation: 'write',
        });
        safePaths.set(path, safe);
      }
    }
    const accesses = [
      ...new Set([...safePaths.values()].flatMap((safe) => ToolAccesses.writeFile(safe))),
    ];
    return {
      accesses,
      description: `Applying multi-file patch (${String(operations.length)} operation${operations.length === 1 ? '' : 's'})`,
      display: { kind: 'generic', summary: args.dryRun === true ? 'Validating multi-file patch' : 'Applying multi-file patch' },
      approvalRule: literalRulePattern(this.name, [...safePaths.values()].sort().join(',')),
      execute: async (): Promise<ExecutableToolResult> => {
        if (parseError !== undefined) return { isError: true, output: parseError };
        const lease = this.runtime.acquire(['fs']);
        try {
          if (lease.runtime.identity.generation !== inspected.identity.generation) {
            return { isError: true, output: 'Runtime changed before execution. Retry the tool call.' };
          }
          const adapter = createAdapter(lease.runtime.fs!, args.dryRun === true);
          const paths = createPatchPathMapper((path) => {
            const safe = safePaths.get(path);
            if (safe === undefined) throw new Error(`patch path was not resolved: ${path}`);
            return safe;
          });
          if (args.dryRun === true) {
            const validated = await applyPatch(args.patch, adapter, { paths });
            return {
              isError: false,
              output: `Validated patch: ${validated.changedFiles.join(', ')} (added ${String(validated.added)}, updated ${String(validated.updated)}, deleted ${String(validated.deleted)})`,
            };
          }
          return await withWorkspaceWriteLock(view.workDir, async () => {
            const recovered = await recoverPatchJournals(view.workDir);
            const journal = await PatchJournal.open(view.workDir);
            const result = await applyPatch(args.patch, adapter, { journal, paths });
            const recovery =
              recovered.length === 0
                ? ''
                : ` (recovered ${String(recovered.length)} file(s) from an interrupted patch)`;
            return {
              isError: false,
              output: `Applied patch: ${result.changedFiles.join(', ')} (added ${String(result.added)}, updated ${String(result.updated)}, deleted ${String(result.deleted)})${recovery}`,
            };
          });
        } catch (error) {
          if (error instanceof PatchApplyError) {
            const committed =
              error.committedFiles.length === 0
                ? 'no files were changed'
                : `files touched before the failure (rolled back): ${error.committedFiles.join(', ')}`;
            return {
              isError: true,
              output: `Patch failed [${error.code}]: ${error.message}\n${committed}`,
            };
          }
          return { isError: true, output: error instanceof Error ? error.message : String(error) };
        } finally {
          lease.dispose();
        }
      },
    };
  }
}

function createAdapter(fs: IHostFileSystem, dryRun: boolean): PatchFileAdapter {
  const virtual = new Map<string, string | undefined>();
  return {
    async readFile(path) {
      if (virtual.has(path)) return virtual.get(path);
      try {
        return await fs.readText(path);
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async writeFile(path, content) {
      if (dryRun) {
        virtual.set(path, content);
        return;
      }
      await fs.mkdir(dirname(path), { recursive: true });
      await fs.writeText(path, content);
    },
    async deleteFile(path) {
      if (dryRun) {
        virtual.set(path, undefined);
        return;
      }
      await fs.remove(path);
    },
  };
}

registerAgentToolService(IApplyPatchTool, ApplyPatchTool, {
  name: 'ApplyPatch',
  domain: 'os/backends',
  requiredRuntimeCapabilities: ['fs'],
});
