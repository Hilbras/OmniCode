import {
  evaluateSandboxPathGrants,
  normalizeSandboxPathGrants,
  type SandboxPathGrants,
} from '@hilbras/omnicode-kaos/sandbox';

/**
 * Per-path sandbox grants for in-process tools. These are the same grants the
 * child-process sandbox carries (`OMNICODE_SANDBOX_WRITE_ROOTS` /
 * `OMNICODE_SANDBOX_DENY_READ`), enforced here so the whole agent — not only
 * sandboxed children — honors them. Configure nothing and every check passes.
 *
 * Parsing is fail-closed: a configured value that contains a non-absolute
 * entry is a refusal naming the rejected entries, never a silent restriction
 * of the grant set. An invalid configured allowlist therefore denies the
 * operation until the host fixes the variable.
 */

export interface ParsedSandboxGrantList {
  readonly entries: readonly string[];
  readonly invalid: readonly string[];
}

export function parseSandboxGrantList(raw: string | undefined): ParsedSandboxGrantList {
  if (raw === undefined || raw.trim().length === 0) return { entries: [], invalid: [] };
  const entries: string[] = [];
  const invalid: string[] = [];
  for (const value of raw.split(',')) {
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('/')) entries.push(trimmed);
    else invalid.push(trimmed);
  }
  return { entries, invalid };
}

function grantRefusal(
  grants: SandboxPathGrants,
  path: string,
  workspace: string,
  operation: 'read' | 'write',
): string | undefined {
  const normalized = normalizeSandboxPathGrants(grants, workspace);
  if (!normalized.ok) return `sandbox policy is invalid, refusing ${operation}: ${normalized.message}`;
  const decision = evaluateSandboxPathGrants(normalized.value, path, operation);
  return decision.allowed ? undefined : (decision.reason ?? `${operation} access to ${path} is denied by sandbox policy`);
}

function invalidConfigRefusal(variable: string, invalid: readonly string[], operation: 'read' | 'write'): string {
  return (
    `sandbox policy is invalid, refusing ${operation}: ${variable} must contain ` +
    `absolute paths — rejected: ${invalid.join(', ')}`
  );
}

/** Refusal message when writing `path` violates the configured write allowlist, `undefined` when allowed. */
export function checkSandboxWritePath(path: string, workspace: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const parsed = parseSandboxGrantList(env['OMNICODE_SANDBOX_WRITE_ROOTS']);
  if (parsed.entries.length === 0 && parsed.invalid.length === 0) return undefined;
  if (parsed.invalid.length > 0) {
    return invalidConfigRefusal('OMNICODE_SANDBOX_WRITE_ROOTS', parsed.invalid, 'write');
  }
  return grantRefusal({ writeAllowlist: parsed.entries }, path, workspace, 'write');
}

/** Refusal message when reading `path` matches a deny-read entry, `undefined` when allowed. */
export function checkSandboxReadPath(path: string, workspace: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const parsed = parseSandboxGrantList(env['OMNICODE_SANDBOX_DENY_READ']);
  if (parsed.entries.length === 0 && parsed.invalid.length === 0) return undefined;
  if (parsed.invalid.length > 0) {
    return invalidConfigRefusal('OMNICODE_SANDBOX_DENY_READ', parsed.invalid, 'read');
  }
  return grantRefusal({ denyReadPaths: parsed.entries }, path, workspace, 'read');
}
