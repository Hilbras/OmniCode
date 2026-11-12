import { isAbsolute, normalize } from 'pathe';

import { DEFAULT_SANDBOX_SYSTEM_PATHS, isSandboxPathContained } from './paths';
import {
  sandboxFailure,
  sandboxSuccess,
  type SandboxAvailability,
  type SandboxBackend,
  type SandboxCommand,
  type SandboxPolicy,
  type SandboxResult,
} from './types';

/**
 * macOS Seatbelt (`sandbox-exec`) backend.
 *
 * Seatbelt policies are text and deny by default; everything is granted by an
 * explicit rule. That is the same shape as the bwrap argv builder: build a
 * profile from the policy, never from caller-supplied text.
 *
 * Rules that keep this safe:
 *
 * - The generated profile is built from literals only. Paths are escaped for
 *   the Seatbelt S-expression syntax, so a workspace path containing a quote
 *   or backslash cannot inject an extra rule.
 * - Network is denied unless the policy shares it; there is no `allow default`.
 * - Writes are permitted only under the workspace (or the explicit write
 *   allowlist); system paths stay readable and never writable.
 * - Like landlock, this backend reports availability honestly: a probe must
 *   actually run `sandbox-exec` before anything claims enforcement.
 */

export const SEATBELT_EXECUTABLE = '/usr/bin/sandbox-exec';

export interface SeatbeltProbeDeps {
  readonly platform?: NodeJS.Platform;
  readonly probe?: (file: string, args: readonly string[]) => Promise<{
    readonly ok: boolean;
    readonly exitCode: number | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly error: string | null;
  }>;
  readonly now?: () => number;
}

/** Escapes a path for a Seatbelt profile string literal. */
export function escapeSeatbeltString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function subpathRule(operation: 'file-read*' | 'file-write*', path: string): string {
  const normalized = normalize(path).replace(/\/+$/, '') || '/';
  return `(allow ${operation} (subpath "${escapeSeatbeltString(normalized)}"))`;
}

export interface SeatbeltProfile {
  readonly profile: string;
  /** Paths whose writes are granted (workspace, or the write allowlist). */
  readonly writableRoots: readonly string[];
}

/** Builds a deny-by-default Seatbelt profile for one sandbox policy. */
export function buildSeatbeltProfile(policy: SandboxPolicy): SandboxResult<SeatbeltProfile> {
  let workspace: string;
  try {
    workspace = normalize(policy.workspace).replace(/\/+$/, '');
  } catch {
    return sandboxFailure('invalid-request', 'invalid sandbox workspace');
  }
  if (!isAbsolute(workspace) || workspace.length === 0) {
    return sandboxFailure('invalid-request', `sandbox workspace must be absolute: ${policy.workspace}`);
  }
  if (/[\0\n\r]/.test(workspace)) {
    return sandboxFailure('invalid-request', 'sandbox workspace must not contain NUL or newline characters');
  }

  const writableRoots = (policy.writeAllowlist ?? [workspace]).map((path) => path.replace(/\/+$/, ''));
  for (const root of writableRoots) {
    if (!isAbsolute(root) || /[\0\n\r]/.test(root)) {
      return sandboxFailure('invalid-request', `write allowlist entry must be an absolute clean path: ${root}`);
    }
    if (!isSandboxPathContained(workspace, root)) {
      return sandboxFailure(
        'invalid-request',
        `write allowlist entry escapes the workspace: ${root}`,
      );
    }
  }

  const readonlyRoots = (policy.systemPaths ?? DEFAULT_SANDBOX_SYSTEM_PATHS)
    .map((path) => path.replace(/\/+$/, ''))
    .filter((path) => !isSandboxPathContained(workspace, path));

  const lines: string[] = [
    '(version 1)',
    '(deny default)',
    '(allow process-exec)',
    '(allow process-fork)',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow signal (target self))',
    // Devices are readable; nothing is writable outside the listed roots.
    '(allow file-read*)',
    ...(policy.shareNetwork === true ? ['(allow network*)'] : []),
    ...(policy.tmpfsPaths ?? ['/tmp', '/private/tmp']).map((path) => subpathRule('file-write*', path)),
    ...readonlyRoots.map((path) => subpathRule('file-read*', path)),
    ...writableRoots.map((path) => subpathRule('file-write*', path)),
  ];

  return sandboxSuccess({ profile: lines.join('\n'), writableRoots });
}

export async function probeSeatbelt(deps: SeatbeltProbeDeps = {}): Promise<SandboxAvailability> {
  const now = deps.now ?? Date.now;
  const platform = deps.platform ?? process.platform;
  const checkedAt = now();
  if (platform !== 'darwin') {
    return {
      backend: 'seatbelt',
      available: false,
      version: null,
      reason: `seatbelt requires darwin (running on ${platform})`,
      fallback: 'bwrap',
      probes: [],
      checkedAt,
    };
  }
  const probe = deps.probe;
  if (probe === undefined) {
    return {
      backend: 'seatbelt',
      available: false,
      version: null,
      reason: 'no sandbox-exec probe configured',
      fallback: 'bwrap',
      probes: [],
      checkedAt,
    };
  }
  const result = await probe(SEATBELT_EXECUTABLE, ['-p', '(version 1)(allow default)', '/usr/bin/true']);
  return {
    backend: 'seatbelt',
    available: result.ok,
    version: null,
    reason: result.ok
      ? null
      : (result.error ?? (result.stderr.trim() || 'sandbox-exec probe failed')),
    fallback: result.ok ? null : 'bwrap',
    probes: [
      {
        label: 'sandbox-exec',
        command: SEATBELT_EXECUTABLE,
        args: ['-p', '(version 1)(allow default)', '/usr/bin/true'],
        ok: result.ok,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error,
      },
    ],
    checkedAt,
  };
}

export class SeatbeltSandboxBackend implements SandboxBackend {
  readonly kind = 'seatbelt' as const;
  private readonly deps: SeatbeltProbeDeps;

  constructor(deps: SeatbeltProbeDeps = {}) {
    this.deps = deps;
  }

  probe(): Promise<SandboxAvailability> {
    return probeSeatbelt(this.deps);
  }

  buildArgv(request: SandboxCommand, policy: SandboxPolicy): SandboxResult<readonly string[]> {
    if (request.command.length === 0) {
      return sandboxFailure('invalid-request', 'sandbox command must contain at least one argument');
    }
    if (request.command.some((argument) => /[\0\n\r]/.test(argument))) {
      return sandboxFailure('invalid-request', 'sandbox command arguments must not contain NUL or newline characters');
    }
    const built = buildSeatbeltProfile(policy);
    if (!built.ok) return built;
    return sandboxSuccess([SEATBELT_EXECUTABLE, '-p', built.value.profile, '--', ...request.command]);
  }
}
