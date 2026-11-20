import type { PermissionPolicy, PermissionPolicyResult } from '#/agent/permissionPolicy/types';
import { IAgentPermissionModeService } from '#/agent/permissionMode/permissionMode';
import type { ResolvedToolExecutionHookContext } from '#/agent/toolExecutor/toolHooks';
import { IBashParserService } from '#/app/bashParser/bashParser';
import { isSensitiveFile } from '#/tool/path-access';
import { extractShellOperations } from '#/tool/shellSemantics';

import { fileAccesses } from './path-utils';

const SHELL_TOKEN_SPLIT = /[\s;|&<>()`"'\\]+/;

function commandText(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const command = (args as { readonly command?: unknown }).command;
  return typeof command === 'string' ? command : undefined;
}

function pathArgument(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const value = (args as { readonly path?: unknown }).path;
  return typeof value === 'string' ? value : undefined;
}

function commandTouchesSensitivePath(command: string): boolean {
  return command
    .split(SHELL_TOKEN_SPLIT)
    .some((token) => token.length > 0 && isSensitiveFile(token));
}

export class SensitiveFileAccessAskPermissionPolicyService implements PermissionPolicy {
  readonly name = 'sensitive-file-access-ask';

  constructor(
    @IBashParserService private readonly bashParser: IBashParserService,
    @IAgentPermissionModeService private readonly modeService: IAgentPermissionModeService,
  ) {}

  evaluate(context: ResolvedToolExecutionHookContext): PermissionPolicyResult | undefined {
    if (this.modeService.mode === 'yolo') return undefined;
    const access = fileAccesses(context).find((fileAccess) => isSensitiveFile(fileAccess.path));
    if (access !== undefined) return { kind: 'ask' };
    if (context.toolCall.name === 'Bash') {
      const command = commandText(context.args);
      if (command !== undefined) {
        const display = context.execution.display;
        const cwd = display?.kind === 'command' ? display.cwd : undefined;
        const operations = extractShellOperations(command, this.bashParser, cwd);
        const touchesSensitive = operations.some(
          (operation) =>
            (operation.path !== undefined && isSensitiveFile(operation.path)) ||
            (operation.resolvedPath !== undefined && isSensitiveFile(operation.resolvedPath)),
        );
        if (touchesSensitive) return { kind: 'ask' };
        if (commandTouchesSensitivePath(command)) return { kind: 'ask' };
      }
    }
    if (context.toolCall.name === 'Grep') {
      const path = pathArgument(context.args);
      if (path !== undefined && isSensitiveFile(path)) return { kind: 'ask' };
    }
    return undefined;
  }
}
