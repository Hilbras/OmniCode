import type { PermissionPolicy, PermissionPolicyResult } from '#/agent/permissionPolicy/types';
import type { ResolvedToolExecutionHookContext } from '#/agent/toolExecutor/toolHooks';
import { isSensitiveFile } from '#/tool/path-access';

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

  evaluate(context: ResolvedToolExecutionHookContext): PermissionPolicyResult | undefined {
    const access = fileAccesses(context).find((fileAccess) => isSensitiveFile(fileAccess.path));
    if (access !== undefined) return { kind: 'ask' };
    if (context.toolCall.name === 'Bash') {
      const command = commandText(context.args);
      if (command !== undefined && commandTouchesSensitivePath(command)) return { kind: 'ask' };
    }
    if (context.toolCall.name === 'Grep') {
      const path = pathArgument(context.args);
      if (path !== undefined && isSensitiveFile(path)) return { kind: 'ask' };
    }
    return undefined;
  }
}
