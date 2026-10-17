import {
  resolvePathAccessPath,
  type WorkspaceConfig,
} from '@hilbras/omnicode-core/tool/path-access';
import { toInputJsonSchema } from '@hilbras/omnicode-core/tool/input-schema';
import { literalRulePattern, matchesPathRuleSubject } from '@hilbras/omnicode-core/tool/rule-match';
import { IFileEditService } from '@hilbras/omnicode-core/app/edit/fileEdit';
import type { IHostFileSystem } from '@hilbras/omnicode-core/os/interface/hostFileSystem';
import type { Runtime } from '@hilbras/omnicode-core/runtime/runtime';
import { RuntimeWorkspaceView } from '@hilbras/omnicode-core/runtime/runtimeWorkspaceView';
import { IAgentRuntimeService, inspectAgentRuntime } from '@hilbras/omnicode-core/agent/runtimeBinding/agentRuntime';
import { ISessionSkillCatalog } from '@hilbras/omnicode-core/features/skill/session/skillCatalog';
import { ISessionWorkspaceContext } from '@hilbras/omnicode-core/session/workspaceContext/workspaceContext';
import {
  ToolAccesses,
  type ExecutableToolResult,
  type ToolExecution,
} from '@hilbras/omnicode-core/tool/toolContract';
import { registerAgentToolService } from '@hilbras/omnicode-core/agent/toolRegistry/toolContribution';

import { EditInputSchema, IEditTool, type EditInput } from './edit';
import editDescriptionTemplate from './edit.md?raw';

export class EditTool implements IEditTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'Edit' as const;
  readonly description = editDescriptionTemplate;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(EditInputSchema);

  constructor(
    @IFileEditService private readonly editor: IFileEditService,
    @IAgentRuntimeService private readonly runtime: IAgentRuntimeService,
    @ISessionWorkspaceContext private readonly workspaceCtx: ISessionWorkspaceContext,
    @ISessionSkillCatalog private readonly skillCatalog?: ISessionSkillCatalog,
  ) {}

  private workspaceConfig(runtime: Runtime): WorkspaceConfig {
    const view = new RuntimeWorkspaceView(runtime, {
      workDir: this.workspaceCtx.workDir,
      additionalDirs: [
        ...this.workspaceCtx.additionalDirs,
        ...(this.skillCatalog?.catalog.getSkillRoots() ?? []),
      ],
    });
    return { workspaceDir: view.workDir, additionalDirs: view.additionalDirs };
  }

  resolveExecution(args: EditInput): ToolExecution {
    const inspected = inspectAgentRuntime(this.runtime);
    const env = inspected.environment;
    const workspace = this.workspaceConfig(inspected);
    const path = resolvePathAccessPath(args.path, {
      env,
      workspace,
      operation: 'write',
    });
    return {
      accesses: ToolAccesses.readWriteFile(path),
      description: `Editing ${args.path}`,
      display: {
        kind: 'file_io',
        operation: 'edit',
        path,
        before: args.old_string,
        after: args.new_string,
      },
      approvalRule: literalRulePattern(this.name, path),
      matchesRule: (ruleArgs) =>
        matchesPathRuleSubject(ruleArgs, path, {
          cwd: workspace.workspaceDir,
          pathClass: env.pathClass,
          homeDir: env.homeDir,
        }),
      execute: async () => {
        const lease = this.runtime.acquire(['fs']);
        try {
          if (lease.runtime.identity.generation !== inspected.identity.generation) {
            return { isError: true, output: 'Runtime changed before execution. Retry the tool call.' };
          }
          return await this.execution(args, path, lease.runtime.fs!);
        } finally {
          lease.dispose();
        }
      },
    };
  }

  private async execution(
    args: EditInput,
    safePath: string,
    fs: IHostFileSystem,
  ): Promise<ExecutableToolResult> {
    if (args.old_string === args.new_string) {
      return {
        isError: true,
        output: 'No changes to make: old_string and new_string are exactly the same.',
      };
    }

    const result = await this.editor.edit({
      path: safePath,
      displayPath: args.path,
      old_string: args.old_string,
      new_string: args.new_string,
      replace_all: args.replace_all ?? false,
    }, fs);
    if (!result.ok) {
      return { isError: true, output: result.error };
    }
    const word = result.count === 1 ? 'occurrence' : 'occurrences';
    return { output: `Replaced ${String(result.count)} ${word} in ${args.path}` };
  }
}

registerAgentToolService(IEditTool, EditTool, {
  name: 'Edit',
  domain: 'edit',
  requiredRuntimeCapabilities: ['fs'],
});
