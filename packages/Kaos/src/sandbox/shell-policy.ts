import { isAbsolute } from 'pathe';

export type ShellExecutionMode = 'argv' | 'shell';

export interface RuntimeShellPolicy {
  readonly mode: ShellExecutionMode;
  readonly allowShell: boolean;
  readonly shellPath: string;
}

export interface ShellPolicyRequest {
  readonly command: string;
  readonly args?: readonly string[];
  readonly mode?: ShellExecutionMode;
}

export type ShellPolicyDenialCode =
  | 'empty-command'
  | 'nul-byte'
  | 'shell-metacharacter'
  | 'shell-mode-disabled'
  | 'shell-arguments-not-allowed'
  | 'unsafe-shell-path'
  | 'environment-assignment';

export interface ShellPolicyDenial {
  readonly ok: false;
  readonly code: ShellPolicyDenialCode;
  readonly message: string;
  readonly offending?: string;
}

export interface ShellPolicyAllowance {
  readonly ok: true;
  readonly mode: ShellExecutionMode;
  readonly argv: readonly string[];
}

export type ShellPolicyDecision = ShellPolicyAllowance | ShellPolicyDenial;

export const DEFAULT_RUNTIME_SHELL_POLICY: RuntimeShellPolicy = Object.freeze({
  mode: 'argv',
  allowShell: false,
  shellPath: '/bin/sh',
});

const SHELL_METACHARACTER = /[\s;&|`$><(){}\[\]*?!#~'"\\]/;
const ENVIRONMENT_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELL_COMMANDS = new Set(['sh', 'bash', 'dash', 'zsh', 'ksh', 'mksh', 'fish', 'busybox']);
const INLINE_SHELL_FLAG = /^-[A-Za-z]*c[A-Za-z]*$/;

function basename(command: string): string {
  const separator = command.lastIndexOf('/');
  return separator >= 0 ? command.slice(separator + 1) : command;
}

function denial(
  code: ShellPolicyDenialCode,
  message: string,
  offending?: string,
): ShellPolicyDenial {
  return offending === undefined ? { ok: false, code, message } : { ok: false, code, message, offending };
}

function hasInlineShellCommand(args: readonly string[]): boolean {
  for (const argument of args) {
    if (argument === '--command' || argument.startsWith('--command=')) return true;
    if (INLINE_SHELL_FLAG.test(argument)) return true;
  }
  return false;
}

function isShellInvocation(command: string, args: readonly string[]): boolean {
  const executable = basename(command);
  if (SHELL_COMMANDS.has(executable)) return hasInlineShellCommand(args);
  if (executable !== 'env') return false;
  let index = 0;
  while (index < args.length) {
    const value = args[index];
    if (value === undefined) return false;
    if (value === '-i' || value === '--ignore-environment') {
      index += 1;
      continue;
    }
    if (ENVIRONMENT_ASSIGNMENT.test(value)) {
      index += 1;
      continue;
    }
    return isShellInvocation(value, args.slice(index + 1));
  }
  return false;
}

function validateShellPath(shellPath: string): ShellPolicyDenial | null {
  if (!isAbsolute(shellPath) || shellPath.includes('\0') || SHELL_METACHARACTER.test(shellPath)) {
    return denial('unsafe-shell-path', `shell path must be an absolute path without shell metacharacters: ${shellPath}`);
  }
  return null;
}

export function evaluateRuntimeShellPolicy(
  request: ShellPolicyRequest,
  policy: RuntimeShellPolicy = DEFAULT_RUNTIME_SHELL_POLICY,
): ShellPolicyDecision {
  const mode = request.mode ?? policy.mode;
  if (request.command.length === 0) {
    return denial('empty-command', 'command must be a non-empty string');
  }
  if (request.command.includes('\0')) {
    return denial('nul-byte', 'command must not contain NUL bytes');
  }

  const args = request.args ?? [];
  for (const argument of args) {
    if (argument.includes('\0')) {
      return denial('nul-byte', 'arguments must not contain NUL bytes', argument);
    }
  }

  if (mode === 'shell') {
    if (policy.allowShell !== true) {
      return denial('shell-mode-disabled', 'sandbox shell mode is disabled; pass an executable and argv instead');
    }
    if (args.length > 0) {
      return denial('shell-arguments-not-allowed', 'shell mode does not accept separate arguments');
    }
    const shellPathDenial = validateShellPath(policy.shellPath);
    if (shellPathDenial !== null) return shellPathDenial;
    return { ok: true, mode, argv: [policy.shellPath, '-c', request.command] };
  }

  if (SHELL_METACHARACTER.test(request.command)) {
    return denial(
      'shell-metacharacter',
      'command contains shell metacharacters; argv mode executes the command directly',
      request.command,
    );
  }
  if (ENVIRONMENT_ASSIGNMENT.test(request.command)) {
    return denial(
      'environment-assignment',
      'environment assignments are not executable commands in argv mode',
      request.command,
    );
  }
  if (isShellInvocation(request.command, args)) {
    return denial(
      'shell-mode-disabled',
      'inline shell execution is disabled; invoke the target executable directly',
      request.command,
    );
  }

  return { ok: true, mode, argv: [request.command, ...args] };
}
