import { isAbsolute, join, normalize } from 'pathe';

import { KaosValueError } from '../errors';
import { sandboxFailure, sandboxSuccess, type SandboxResult } from './types';

export const DEFAULT_SANDBOX_SYSTEM_PATHS: readonly string[] = [
  '/usr',
  '/bin',
  '/sbin',
  '/lib',
  '/lib64',
  '/etc',
  '/nix/store',
];

export const DEFAULT_SANDBOX_TMPFS_PATHS: readonly string[] = ['/tmp'];

function hasUnsafePathCharacter(path: string): boolean {
  return path.includes('\0') || path.includes('\n') || path.includes('\r');
}

function stripTrailingSeparator(path: string): string {
  let result = path;
  while (result.length > 1 && result.endsWith('/')) result = result.slice(0, -1);
  return result;
}

export function normalizeSandboxRoot(root: string): string {
  if (typeof root !== 'string' || root.length === 0 || hasUnsafePathCharacter(root)) {
    throw new KaosValueError('sandbox root must be a non-empty path without NUL or newline characters');
  }
  const normalized = stripTrailingSeparator(normalize(root));
  if (!isAbsolute(normalized) || normalized === '/') {
    throw new KaosValueError(`sandbox root must be an absolute path other than "/": ${root}`);
  }
  return normalized;
}

export function isSandboxPathContained(root: string, candidate: string): boolean {
  const normalizedRoot = stripTrailingSeparator(normalize(root));
  const normalizedCandidate = stripTrailingSeparator(normalize(candidate));
  if (normalizedRoot === '/') return normalizedCandidate.startsWith('/');
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}/`)
  );
}

export function resolveSandboxPath(root: string, requested: string): SandboxResult<string> {
  if (typeof requested !== 'string' || requested.length === 0 || requested.length > 4096) {
    return sandboxFailure('invalid-request', 'sandbox path must be a non-empty string of at most 4096 characters');
  }
  if (hasUnsafePathCharacter(requested)) {
    return sandboxFailure('invalid-request', 'sandbox path must not contain NUL or newline characters');
  }
  const candidate = stripTrailingSeparator(
    isAbsolute(requested) ? normalize(requested) : join(normalize(root), requested),
  );
  if (!isSandboxPathContained(root, candidate)) {
    return sandboxFailure('path-escape', `path escapes the sandbox root: ${requested}`);
  }
  return sandboxSuccess(candidate);
}
