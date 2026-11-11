import { isAbsolute, normalize } from 'pathe';

import {
  DEFAULT_SANDBOX_SYSTEM_PATHS,
  DEFAULT_SANDBOX_TMPFS_PATHS,
  isSandboxPathContained,
  normalizeSandboxRoot,
  resolveSandboxPath,
} from './paths';
import {
  sandboxFailure,
  sandboxSuccess,
  type SandboxCommand,
  type SandboxPolicy,
  type SandboxResult,
} from './types';

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function hasUnsafeArgument(value: string): boolean {
  return value.includes('\0') || value.includes('\n') || value.includes('\r');
}

function normalizeMountPath(value: string, label: string): SandboxResult<string> {
  if (typeof value !== 'string' || value.length === 0 || hasUnsafeArgument(value)) {
    return sandboxFailure('invalid-request', `${label} must be a non-empty path without NUL or newline characters`);
  }
  if (!isAbsolute(value)) {
    return sandboxFailure('invalid-request', `${label} must be an absolute path: ${value}`);
  }
  const normalized = normalize(value).replace(/\/+$/, '');
  if (normalized.length === 0 || normalized === '/') {
    return sandboxFailure('invalid-request', `${label} must not bind the filesystem root: /`);
  }
  return sandboxSuccess(normalized);
}

function collectMountPaths(
  paths: readonly string[] | undefined,
  defaults: readonly string[],
  workspace: string,
  label: string,
): SandboxResult<readonly string[]> {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of paths ?? defaults) {
    const normalized = normalizeMountPath(value, label);
    if (!normalized.ok) return normalized;
    if (isSandboxPathContained(workspace, normalized.value)) continue;
    if (seen.has(normalized.value)) continue;
    seen.add(normalized.value);
    result.push(normalized.value);
  }
  return sandboxSuccess(result);
}

export function buildBwrapArgv(
  request: SandboxCommand,
  policy: SandboxPolicy,
): SandboxResult<readonly string[]> {
  if (request.command.length === 0) {
    return sandboxFailure('invalid-request', 'sandbox command must contain at least one argument');
  }
  const executable = request.command[0];
  if (executable === undefined || executable.length === 0) {
    return sandboxFailure('invalid-request', 'sandbox command executable must be a non-empty string');
  }
  for (const argument of request.command) {
    if (hasUnsafeArgument(argument)) {
      return sandboxFailure('invalid-request', 'sandbox command arguments must not contain NUL or newline characters');
    }
  }

  let workspace: string;
  try {
    workspace = normalizeSandboxRoot(policy.workspace);
  } catch (error) {
    return sandboxFailure(
      'invalid-request',
      error instanceof Error ? error.message : 'invalid sandbox workspace',
    );
  }

  const cwd = resolveSandboxPath(workspace, policy.cwd ?? workspace);
  if (!cwd.ok) return cwd;

  const systemPaths = collectMountPaths(
    policy.systemPaths,
    DEFAULT_SANDBOX_SYSTEM_PATHS,
    workspace,
    'system path',
  );
  if (!systemPaths.ok) return systemPaths;

  const tmpfsPaths = collectMountPaths(
    policy.tmpfsPaths,
    DEFAULT_SANDBOX_TMPFS_PATHS,
    workspace,
    'tmpfs path',
  );
  if (!tmpfsPaths.ok) return tmpfsPaths;

  const envEntries: [string, string][] = [];
  for (const [key, value] of Object.entries(policy.env ?? {})) {
    if (!ENV_KEY_PATTERN.test(key)) {
      return sandboxFailure('invalid-request', `invalid sandbox environment key: ${key}`);
    }
    if (hasUnsafeArgument(value)) {
      return sandboxFailure('invalid-request', `sandbox environment value for ${key} contains NUL or newline characters`);
    }
    envEntries.push([key, value]);
  }

  const args: string[] = [
    '--die-with-parent',
    '--new-session',
    '--unshare-user',
    '--unshare-uts',
  ];

  if (policy.sharePid !== true) args.push('--unshare-pid');
  if (policy.shareIpc !== true) args.push('--unshare-ipc');
  if (policy.shareNetwork !== true) args.push('--unshare-net');

  args.push('--proc', '/proc', '--dev', '/dev');

  for (const systemPath of systemPaths.value) {
    args.push('--ro-bind-try', systemPath, systemPath);
  }

  args.push('--bind', workspace, workspace);

  for (const tmpfsPath of tmpfsPaths.value) {
    args.push('--tmpfs', tmpfsPath);
  }

  for (const [key, value] of envEntries) {
    args.push('--setenv', key, value);
  }

  args.push('--chdir', cwd.value, '--', ...request.command);

  return sandboxSuccess(args);
}
