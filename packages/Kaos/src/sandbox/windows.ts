import { isAbsolute, normalize } from 'pathe';

import { isSandboxPathContained } from './paths';
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
 * Windows AppContainer/Job Object backend.
 *
 * Creating an AppContainer child and assigning it to a Job Object needs Win32
 * process-creation attributes (`STARTUPINFOEX` with
 * `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`) that a plain argv cannot
 * carry. This runtime ships no native helper, so the backend is honest in the
 * same way landlock is: without a configured helper the probe reports
 * unavailable and the argv builder refuses, instead of emitting an argv that
 * would run the child unconfined.
 *
 * The helper contract (a host may provide a native helper and wire it through
 * `WindowsSandboxBackendDeps.helperPath`):
 *
 * - `argv = [helperPath, 'run', '--profile', <profile JSON>, '--', ...childArgv]`.
 *   The profile JSON is one argv element, so no shell parsing sits between the
 *   policy and the helper.
 * - The profile is the `WindowsSandboxProfile` descriptor built here: named
 *   AppContainer capabilities, Job Object limits, and per-path access rules.
 *   Deny-read rules take precedence over the read/write rules when the helper
 *   applies them.
 *
 * Everything is built from literals: paths are validated (absolute, contained,
 * no NUL/newline) before they enter the descriptor, and the descriptor is
 * serialized as JSON, never interpolated into a command string.
 */

export const WINDOWS_SANDBOX_INTERNET_CAPABILITY = 'internetClient';

export interface WindowsSandboxPathRule {
  readonly path: string;
  readonly access: 'read' | 'read-write' | 'deny-read';
}

export interface WindowsSandboxProfile {
  readonly appContainer: {
    readonly capabilities: readonly string[];
  };
  readonly jobObject: {
    /** The child dies with the helper: nothing outlives supervision. */
    readonly killOnJobClose: true;
    /** No breakaway: the child cannot escape the job to shed the limits. */
    readonly breakawayAllowed: false;
  };
  readonly pathRules: readonly WindowsSandboxPathRule[];
}

function hasUnsafePathCharacter(path: string): boolean {
  return path.includes('\0') || path.includes('\n') || path.includes('\r');
}

export function buildWindowsSandboxProfile(policy: SandboxPolicy): SandboxResult<WindowsSandboxProfile> {
  let workspace: string;
  try {
    workspace = normalize(policy.workspace).replace(/\/+$/, '');
  } catch {
    return sandboxFailure('invalid-request', 'invalid sandbox workspace');
  }
  if (!isAbsolute(workspace) || workspace.length === 0) {
    return sandboxFailure('invalid-request', `sandbox workspace must be absolute: ${policy.workspace}`);
  }
  if (hasUnsafePathCharacter(workspace)) {
    return sandboxFailure('invalid-request', 'sandbox workspace must not contain NUL or newline characters');
  }

  const writeAllowlist = policy.writeAllowlist ?? [workspace];
  for (const root of writeAllowlist) {
    const normalized = normalize(root).replace(/\/+$/, '');
    if (!isAbsolute(normalized) || hasUnsafePathCharacter(normalized)) {
      return sandboxFailure('invalid-request', `write allowlist entry must be an absolute clean path: ${root}`);
    }
    if (!isSandboxPathContained(workspace, normalized)) {
      return sandboxFailure('invalid-request', `write allowlist entry escapes the workspace: ${root}`);
    }
  }

  if (policy.tmpfsPaths !== undefined && policy.tmpfsPaths.length > 0) {
    return sandboxFailure(
      'unsupported-operation',
      'AppContainer cannot express tmpfs mounts; drop tmpfsPaths or use a backend with mount support (bwrap)',
      { tmpfsPaths: [...policy.tmpfsPaths] },
    );
  }

  const pathRules: WindowsSandboxPathRule[] = [];
  const seenRules = new Set<string>();
  const pushRule = (path: string, access: WindowsSandboxPathRule['access']): void => {
    const key = `${access}\0${path}`;
    if (seenRules.has(key)) return;
    seenRules.add(key);
    pathRules.push({ path, access });
  };

  for (const entry of policy.denyReadPaths ?? []) {
    const normalized = normalize(entry).replace(/\/+$/, '');
    if (!isAbsolute(normalized) || hasUnsafePathCharacter(normalized)) {
      return sandboxFailure('invalid-request', `deny-read entry must be an absolute clean path: ${entry}`);
    }
    // AppContainer ACLs are literal paths; a glob cannot become an ACE.
    if (normalized.includes('*') || normalized.includes('?')) {
      return sandboxFailure(
        'unsupported-operation',
        `AppContainer deny-read rules must be literal paths, not globs: ${entry}`,
        { entry },
      );
    }
    pushRule(normalized, 'deny-read');
  }

  for (const entry of policy.systemPaths ?? []) {
    const normalized = normalize(entry).replace(/\/+$/, '');
    if (!isAbsolute(normalized) || hasUnsafePathCharacter(normalized)) {
      return sandboxFailure('invalid-request', `system path entry must be an absolute clean path: ${entry}`);
    }
    // AppContainer default ACLs already read system locations; an entry under
    // the workspace is covered by the workspace rules.
    if (isSandboxPathContained(workspace, normalized)) continue;
    pushRule(normalized, 'read');
  }

  if (policy.writeAllowlist === undefined) {
    pushRule(workspace, 'read-write');
  } else {
    pushRule(workspace, 'read');
    for (const root of policy.writeAllowlist) {
      pushRule(normalize(root).replace(/\/+$/, ''), 'read-write');
    }
  }

  const profile: WindowsSandboxProfile = {
    appContainer: {
      capabilities: policy.shareNetwork === true ? [WINDOWS_SANDBOX_INTERNET_CAPABILITY] : [],
    },
    jobObject: {
      killOnJobClose: true,
      breakawayAllowed: false,
    },
    pathRules,
  };
  return sandboxSuccess(profile);
}

/**
 * Builds the helper argv for `request.command` under the policy profile.
 * Refuses with `backend-unavailable` when no helper is configured: emitting a
 * plain child argv instead would run the command unconfined.
 */
export function buildWindowsSandboxArgv(
  request: SandboxCommand,
  policy: SandboxPolicy,
  deps: { readonly helperPath?: string } = {},
): SandboxResult<readonly [string, ...string[]]> {
  if (request.command.length === 0) {
    return sandboxFailure('invalid-request', 'sandbox command must contain at least one argument');
  }
  if (request.command.some((argument) => /[\0\n\r]/.test(argument))) {
    return sandboxFailure('invalid-request', 'sandbox command arguments must not contain NUL or newline characters');
  }

  const helperPath = deps.helperPath;
  if (helperPath === undefined || helperPath.length === 0) {
    return sandboxFailure(
      'backend-unavailable',
      'no windows sandbox helper is configured; an AppContainer/Job Object child needs a native helper ' +
        'and the backend refuses to emit an argv that would run the command unconfined',
      { backend: 'windows' },
    );
  }
  if (!isAbsolute(helperPath) || hasUnsafePathCharacter(helperPath)) {
    return sandboxFailure(
      'invalid-request',
      `windows sandbox helper path must be absolute and free of NUL or newline characters: ${helperPath}`,
    );
  }

  const built = buildWindowsSandboxProfile(policy);
  if (!built.ok) return built;
  const argv: readonly [string, ...string[]] = [
    helperPath,
    'run',
    '--profile',
    JSON.stringify(built.value),
    '--',
    ...request.command,
  ];
  return sandboxSuccess(argv);
}

export type WindowsSandboxProbe = (
  file: string,
  args: readonly string[],
) => Promise<{
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error: string | null;
}>;

export interface WindowsSandboxBackendDeps {
  readonly platform?: NodeJS.Platform;
  readonly helperPath?: string;
  readonly probe?: WindowsSandboxProbe;
  readonly now?: () => number;
}

const WINDOWS_SANDBOX_PROBE_WORKSPACE = 'C:/Windows/Temp';

/**
 * Availability is honest: unavailable off win32 (naming the platform), on
 * win32 without a helper or probe, and with the real probe outcome otherwise.
 * There is no other backend on Windows, so the win32 fallback is `null` — the
 * refusal text, not a substitution, carries the failure.
 */
export async function probeWindowsSandbox(deps: WindowsSandboxBackendDeps = {}): Promise<SandboxAvailability> {
  const now = deps.now ?? Date.now;
  const platform = deps.platform ?? process.platform;
  const checkedAt = now();

  if (platform !== 'win32') {
    return {
      backend: 'windows',
      available: false,
      version: null,
      reason: `windows sandbox (AppContainer/Job Object) requires win32 (running on ${platform})`,
      fallback: 'bwrap',
      probes: [],
      checkedAt,
    };
  }

  const helperPath = deps.helperPath;
  if (helperPath === undefined || helperPath.length === 0) {
    return {
      backend: 'windows',
      available: false,
      version: null,
      reason:
        'no windows sandbox helper is configured; an AppContainer/Job Object child requires a native helper ' +
        'and this runtime does not ship one',
      fallback: null,
      probes: [],
      checkedAt,
    };
  }
  if (!isAbsolute(helperPath) || hasUnsafePathCharacter(helperPath)) {
    return {
      backend: 'windows',
      available: false,
      version: null,
      reason: `windows sandbox helper path must be absolute and free of NUL or newline characters: ${helperPath}`,
      fallback: null,
      probes: [],
      checkedAt,
    };
  }

  const probe = deps.probe;
  if (probe === undefined) {
    return {
      backend: 'windows',
      available: false,
      version: null,
      reason: 'no windows sandbox probe configured',
      fallback: null,
      probes: [],
      checkedAt,
    };
  }

  const profile = buildWindowsSandboxProfile({ workspace: WINDOWS_SANDBOX_PROBE_WORKSPACE });
  if (!profile.ok) {
    return {
      backend: 'windows',
      available: false,
      version: null,
      reason: `windows sandbox probe profile failed to build: ${profile.message}`,
      fallback: null,
      probes: [],
      checkedAt,
    };
  }

  const probeArgs: readonly string[] = [
    'run',
    '--profile',
    JSON.stringify(profile.value),
    '--',
    'cmd.exe',
    '/d',
    '/c',
    'exit 0',
  ];
  const result = await probe(helperPath, probeArgs);
  const reason = result.ok
    ? null
    : (result.error ?? (result.stderr.trim() || 'windows sandbox helper probe failed'));
  return {
    backend: 'windows',
    available: result.ok,
    version: null,
    reason,
    fallback: null,
    probes: [
      {
        label: 'windows-sandbox-helper',
        command: helperPath,
        args: [...probeArgs],
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

export class WindowsSandboxBackend implements SandboxBackend {
  readonly kind = 'windows' as const;
  private readonly deps: WindowsSandboxBackendDeps;

  constructor(deps: WindowsSandboxBackendDeps = {}) {
    this.deps = deps;
  }

  probe(): Promise<SandboxAvailability> {
    return probeWindowsSandbox(this.deps);
  }

  buildArgv(request: SandboxCommand, policy: SandboxPolicy): SandboxResult<readonly string[]> {
    return buildWindowsSandboxArgv(request, policy, { helperPath: this.deps.helperPath });
  }
}
