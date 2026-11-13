import { isAbsolute, normalize } from 'pathe';

import { isSandboxPathContained } from './paths';
import { sandboxFailure, sandboxSuccess, type SandboxResult } from './types';

/**
 * Per-path grants compose the write allowlist and deny-read globs that a
 * sandbox policy carries. Several policy sources (host config, session config,
 * per-call restrictions) each declare grants; `mergeSandboxPathGrants` and
 * `intersectSandboxPathGrants` are the two sanctioned compositions.
 *
 * Deny-read always wins: no composition can un-deny a read.
 */

export interface SandboxPathGrants {
  /** Absolute writable paths inside the workspace. `undefined` = whole workspace writable. */
  readonly writeAllowlist?: readonly string[];
  /** Absolute deny-read paths or globs (`*`, `**`, `?`). */
  readonly denyReadPaths?: readonly string[];
}

export interface NormalizedSandboxPathGrants {
  /** `null` = whole workspace writable; otherwise the normalized write roots. */
  readonly writeAllowlist: readonly string[] | null;
  readonly denyReadPaths: readonly string[];
}

export type SandboxGrantOperation = 'read' | 'write';

export interface SandboxGrantDecision {
  readonly allowed: boolean;
  readonly reason?: string;
}

const GLOB_CHARACTERS = new Set(['*', '?']);

function stripTrailingSeparator(path: string): string {
  let result = path;
  while (result.length > 1 && result.endsWith('/')) result = result.slice(0, -1);
  return result;
}

function hasUnsafePathCharacter(path: string): boolean {
  return path.includes('\0') || path.includes('\n') || path.includes('\r');
}

/** True when the deny-read pattern uses glob wildcards rather than a literal path. */
export function sandboxDenyReadHasGlob(pattern: string): boolean {
  for (const character of pattern) {
    if (GLOB_CHARACTERS.has(character)) return true;
  }
  return false;
}

/**
 * Anchored regular expression source for one deny-read glob. `*` matches
 * within one path segment, `**` across segments, `?` one non-separator
 * character. Shared by the pure grant checker and the Seatbelt regex
 * projection so both answer identically. This is the raw source text —
 * `RegExp.prototype.source` would re-escape `/` as `\/`.
 */
export function sandboxDenyReadToRegexSource(pattern: string): string {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === undefined) break;
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        index += 1;
        source += '.*';
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (character === '?') {
      source += '[^/]';
      continue;
    }
    source += character.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return `${source}$`;
}

export function sandboxDenyReadToRegExp(pattern: string): RegExp {
  return new RegExp(sandboxDenyReadToRegexSource(pattern));
}

/** True when `path` is denied by one deny-read pattern. Literal patterns deny their subtree. */
export function isSandboxDenyReadMatch(pattern: string, path: string): boolean {
  const normalizedPattern = stripTrailingSeparator(normalize(pattern));
  const normalizedPath = stripTrailingSeparator(normalize(path));
  if (sandboxDenyReadHasGlob(normalizedPattern)) {
    return sandboxDenyReadToRegExp(normalizedPattern).test(normalizedPath);
  }
  return isSandboxPathContained(normalizedPattern, normalizedPath);
}

export function normalizeSandboxPathGrants(
  grants: SandboxPathGrants,
  workspace: string,
): SandboxResult<NormalizedSandboxPathGrants> {
  const normalizedWorkspace = stripTrailingSeparator(normalize(workspace));
  if (!isAbsolute(normalizedWorkspace) || normalizedWorkspace.length === 0) {
    return sandboxFailure('invalid-request', `sandbox grants workspace must be absolute: ${workspace}`);
  }

  let writeAllowlist: readonly string[] | null = null;
  if (grants.writeAllowlist !== undefined) {
    const roots: string[] = [];
    const seenWrite = new Set<string>();
    for (const entry of grants.writeAllowlist) {
      if (typeof entry !== 'string' || entry.length === 0 || hasUnsafePathCharacter(entry)) {
        return sandboxFailure('invalid-request', 'write allowlist entries must be non-empty paths without NUL or newline characters');
      }
      const normalized = stripTrailingSeparator(normalize(entry));
      if (!isAbsolute(normalized)) {
        return sandboxFailure('invalid-request', `write allowlist entry must be an absolute path: ${entry}`);
      }
      if (!isSandboxPathContained(normalizedWorkspace, normalized)) {
        return sandboxFailure('path-escape', `write allowlist entry escapes the workspace: ${entry}`);
      }
      if (seenWrite.has(normalized)) continue;
      seenWrite.add(normalized);
      roots.push(normalized);
    }
    writeAllowlist = roots;
  }

  const denyReadPaths: string[] = [];
  const seenDeny = new Set<string>();
  for (const entry of grants.denyReadPaths ?? []) {
    if (typeof entry !== 'string' || entry.length === 0 || hasUnsafePathCharacter(entry)) {
      return sandboxFailure('invalid-request', 'deny-read entries must be non-empty paths without NUL or newline characters');
    }
    const normalized = stripTrailingSeparator(normalize(entry));
    if (!isAbsolute(normalized)) {
      return sandboxFailure('invalid-request', `deny-read entry must be an absolute path or glob: ${entry}`);
    }
    if (seenDeny.has(normalized)) continue;
    seenDeny.add(normalized);
    denyReadPaths.push(normalized);
  }

  return sandboxSuccess({ writeAllowlist, denyReadPaths });
}

/**
 * Additive composition for sources that describe parts of one intent: the
 * write grant widens to the union (an `undefined` source keeps the whole
 * workspace writable) and deny-read unions because any source's denial holds.
 */
export function mergeSandboxPathGrants(
  ...sources: readonly SandboxPathGrants[]
): SandboxPathGrants {
  let writeAllowlist: readonly string[] | undefined;
  let wholeWorkspace = false;
  const denyReadPaths: string[] = [];
  const seenDeny = new Set<string>();
  for (const source of sources) {
    if (source.writeAllowlist === undefined) {
      wholeWorkspace = true;
    } else {
      writeAllowlist =
        writeAllowlist === undefined
          ? [...source.writeAllowlist]
          : [...writeAllowlist, ...source.writeAllowlist];
    }
    for (const entry of source.denyReadPaths ?? []) {
      if (seenDeny.has(entry)) continue;
      seenDeny.add(entry);
      denyReadPaths.push(entry);
    }
  }
  if (wholeWorkspace) writeAllowlist = undefined;
  return denyReadPaths.length === 0
    ? { writeAllowlist }
    : { writeAllowlist, denyReadPaths };
}

/**
 * Conjunctive composition for independent authorities: a path is writable only
 * when every source that constrains writes grants it, while a read denied by
 * any source stays denied. Sources without a write allowlist constrain nothing.
 */
export function intersectSandboxPathGrants(
  ...sources: readonly SandboxPathGrants[]
): SandboxPathGrants {
  let writeAllowlist: readonly string[] | undefined;
  let constrained = false;
  const denyReadPaths: string[] = [];
  const seenDeny = new Set<string>();
  for (const source of sources) {
    if (source.writeAllowlist !== undefined) {
      if (!constrained) {
        writeAllowlist = [...source.writeAllowlist];
        constrained = true;
      } else {
        const allowed = new Set(writeAllowlist);
        writeAllowlist = source.writeAllowlist.filter((entry) => allowed.has(entry));
      }
    }
    for (const entry of source.denyReadPaths ?? []) {
      if (seenDeny.has(entry)) continue;
      seenDeny.add(entry);
      denyReadPaths.push(entry);
    }
  }
  return denyReadPaths.length === 0
    ? { writeAllowlist }
    : { writeAllowlist, denyReadPaths };
}

function denyReason(path: string, pattern: string): string {
  return `read access to ${path} is denied by sandbox policy: ${pattern}`;
}

/**
 * Answers one path check against normalized grants. Workspace containment and
 * symlink resolution stay with the caller; this only applies the grants.
 */
export function evaluateSandboxPathGrants(
  grants: NormalizedSandboxPathGrants,
  path: string,
  operation: SandboxGrantOperation,
): SandboxGrantDecision {
  if (operation === 'read') {
    for (const pattern of grants.denyReadPaths) {
      if (isSandboxDenyReadMatch(pattern, path)) {
        return { allowed: false, reason: denyReason(path, pattern) };
      }
    }
    return { allowed: true };
  }

  if (grants.writeAllowlist === null) return { allowed: true };
  for (const root of grants.writeAllowlist) {
    if (isSandboxPathContained(root, path)) return { allowed: true };
  }
  return {
    allowed: false,
    reason:
      `write access to ${path} is denied by sandbox policy: ` +
      'only paths under the write allowlist are writable',
  };
}
