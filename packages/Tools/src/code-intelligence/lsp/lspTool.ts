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

import {
  ILspTool,
  LSP_BACKEND,
  LSP_MAX_BYTES,
  LspInputSchema,
  runLspQuery,
  type LspInput,
} from './lsp';

export class LspTool implements ILspTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'Lsp' as const;
  readonly description =
    `Language-server style queries over a file without spawning a language server. Uses the ${LSP_BACKEND} backend: deterministic symbol/reference extraction, JSON delimiter diagnostics, and hover from declaration text. Actions: symbols, references, diagnostics, hover.`;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(LspInputSchema);

  constructor(
    @IAgentRuntimeService private readonly runtime: IAgentRuntimeService,
    @ISessionWorkspaceContext private readonly workspaceCtx: ISessionWorkspaceContext,
    @ISessionSkillCatalog private readonly skillCatalog?: ISessionSkillCatalog,
  ) {}

  resolveExecution(args: LspInput): ToolExecution {
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
    const path = resolvePathAccessPath(args.path, { env, workspace, operation: 'read' });
    return {
      accesses: ToolAccesses.readFile(path),
      description: `${args.action} ${args.path}`,
      display: { kind: 'generic', summary: `${args.action} ${args.path}` },
      approvalRule: literalRulePattern(this.name, path),
      execute: async () => {
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
    args: LspInput,
    path: string,
  ): Promise<{ output: string; isError?: boolean }> {
    try {
      const stat = await fs.stat(path);
      if (!stat.isFile) return { isError: true, output: `${args.path} is not a file.` };
      if (stat.size > LSP_MAX_BYTES) {
        return {
          isError: true,
          output: `File is ${String(stat.size)} bytes; LSP fallback limit is ${String(LSP_MAX_BYTES)} bytes.`,
        };
      }
      const result = runLspQuery({
        action: args.action,
        path: args.path,
        text: await fs.readText(path),
        ...(args.symbol === undefined ? {} : { symbol: args.symbol }),
        ...(args.position === undefined ? {} : { position: args.position }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      });
      return { output: JSON.stringify(result, null, 2) };
    } catch (error) {
      return { isError: true, output: error instanceof Error ? error.message : String(error) };
    }
  }
}

registerAgentToolService(ILspTool, LspTool, {
  name: 'Lsp',
  domain: 'code-intelligence',
  requiredRuntimeCapabilities: ['fs'],
});
