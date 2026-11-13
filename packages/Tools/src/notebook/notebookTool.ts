import type { IHostFileSystem } from '@hilbras/omnicode-engine/os/interface/hostFileSystem';
import { IAgentRuntimeService, inspectAgentRuntime } from '@hilbras/omnicode-engine/agent/runtimeBinding/agentRuntime';
import { RuntimeWorkspaceView } from '@hilbras/omnicode-engine/runtime/runtimeWorkspaceView';
import { ISessionSkillCatalog } from '@hilbras/omnicode-engine/features/skill/session/skillCatalog';
import { ISessionWorkspaceContext } from '@hilbras/omnicode-engine/session/workspaceContext/workspaceContext';
import { ToolAccesses, type ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';
import { registerAgentToolService } from '@hilbras/omnicode-engine/agent/toolRegistry/toolContribution';
import { toInputJsonSchema } from '@hilbras/omnicode-engine/tool/input-schema';
import { literalRulePattern } from '@hilbras/omnicode-engine/tool/rule-match';
import {
  resolvePathAccessPath,
  type WorkspaceConfig,
} from '@hilbras/omnicode-engine/tool/path-access';

import { writeTextAtomic } from '#/shared/atomicWrite';
import { checkSandboxReadPath, checkSandboxWritePath } from '../os/sandbox/pathGrants';
import {
  INotebookEditTool,
  NOTEBOOK_MAX_BYTES,
  NotebookEditInputSchema,
  deleteNotebookCell,
  insertNotebookCell,
  parseNotebook,
  replaceNotebookCell,
  serializeNotebook,
  summarizeNotebook,
  type NotebookDocument,
  type NotebookEditInput,
} from './notebook';

export class NotebookEditTool implements INotebookEditTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'NotebookEdit' as const;
  readonly description =
    'Read or edit Jupyter .ipynb notebooks. Supports read, insert, replace, and delete of cells with JSON schema validation and atomic writes.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(NotebookEditInputSchema);

  constructor(
    @IAgentRuntimeService private readonly runtime: IAgentRuntimeService,
    @ISessionWorkspaceContext private readonly workspaceCtx: ISessionWorkspaceContext,
    @ISessionSkillCatalog private readonly skillCatalog?: ISessionSkillCatalog,
  ) {}

  resolveExecution(args: NotebookEditInput): ToolExecution {
    const inspected = inspectAgentRuntime(this.runtime);
    const view = new RuntimeWorkspaceView(inspected, {
      workDir: this.workspaceCtx.workDir,
      additionalDirs: [
        ...this.workspaceCtx.additionalDirs,
        ...(this.skillCatalog?.catalog.getSkillRoots() ?? []),
      ],
    });
    const env = { _serviceBrand: undefined, ...inspected.environment, ready: Promise.resolve() };
    const workspace: WorkspaceConfig = {
      workspaceDir: view.workDir,
      additionalDirs: view.additionalDirs,
    };
    const operation = args.action === 'read' ? 'read' : 'write';
    const path = resolvePathAccessPath(args.path, { env, workspace, operation });
    const sandboxRefusal =
      operation === 'read'
        ? checkSandboxReadPath(path, view.workDir)
        : checkSandboxWritePath(path, view.workDir);
    return {
      accesses:
        args.action === 'read' ? ToolAccesses.readFile(path) : ToolAccesses.readWriteFile(path),
      description: `${args.action} notebook ${args.path}`,
      display: {
        kind: 'file_io',
        operation: args.action === 'read' ? 'read' : 'edit',
        path,
      },
      approvalRule: literalRulePattern(this.name, path),
      execute: async () => {
        if (sandboxRefusal !== undefined) {
          return { isError: true, output: sandboxRefusal };
        }
        const lease = this.runtime.acquire(['fs']);
        try {
          if (lease.runtime.identity.generation !== inspected.identity.generation) {
            return { isError: true, output: 'Runtime changed before execution. Retry the tool call.' };
          }
          return await this.execution(lease.runtime.fs!, args, path);
        } finally {
          lease.dispose();
        }
      },
    };
  }

  private async execution(
    fs: IHostFileSystem,
    args: NotebookEditInput,
    path: string,
  ): Promise<{ output: string; isError?: boolean }> {
    try {
      const stat = await fs.stat(path);
      if (!stat.isFile) return { isError: true, output: `${args.path} is not a file.` };
      if (stat.size > NOTEBOOK_MAX_BYTES) {
        return {
          isError: true,
          output: `Notebook is ${String(stat.size)} bytes; limit is ${String(NOTEBOOK_MAX_BYTES)}.`,
        };
      }
      const document = parseNotebook(await fs.readText(path));
      if (args.action === 'read') {
        return { output: summarizeNotebook(document) };
      }
      const result = this.mutate(document, args);
      await writeTextAtomic(fs, path, serializeNotebook(result.document));
      return { output: result.message };
    } catch (error) {
      return { isError: true, output: error instanceof Error ? error.message : String(error) };
    }
  }

  private mutate(
    document: NotebookDocument,
    args: NotebookEditInput,
  ): { document: NotebookDocument; message: string } {
    if (args.action === 'insert') {
      const result = insertNotebookCell(document, {
        ...(args.index === undefined ? {} : { index: args.index }),
        cellType: args.cell_type ?? 'markdown',
        source: args.source ?? '',
      });
      return { document: result.document, message: `Inserted cell at index ${String(result.index)}.` };
    }
    if (args.action === 'replace') {
      const index = args.index ?? -1;
      const next = replaceNotebookCell(document, {
        index,
        ...(args.source === undefined ? {} : { source: args.source }),
        ...(args.cell_type === undefined ? {} : { cellType: args.cell_type }),
      });
      return { document: next, message: `Replaced cell at index ${String(index)}.` };
    }
    const index = args.index ?? -1;
    const removed = deleteNotebookCell(document, index);
    return { document: removed.document, message: `Deleted cell at index ${String(index)}.` };
  }
}

registerAgentToolService(INotebookEditTool, NotebookEditTool, {
  name: 'NotebookEdit',
  domain: 'notebook',
  requiredRuntimeCapabilities: ['fs'],
});
