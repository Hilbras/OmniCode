import {
  createSandboxExecutionPlan,
  probeSandboxBackends,
  selectSandboxBackend,
  type SandboxAvailability,
  type SandboxBackendKind,
  type SandboxPermissionMode,
} from '@hilbras/omnicode-kaos/sandbox';

/**
 * Sandbox seam for agent child processes other than the shell tool: MCP stdio
 * servers, external hooks, and git worktree invocations. It never grants
 * approval — callers must have decided the child may run; this only decides
 * whether the already-approved child executes inside an OS sandbox, and makes
 * every "no sandbox" outcome explicit instead of silent.
 *
 * Configuration is the host environment, mirroring the Bash sandbox knobs:
 *
 * - `OMNICODE_SANDBOX_MODE` `off | auto | required` (default `off`).
 * - `OMNICODE_SANDBOX_BACKEND` pins one backend; no substitution happens when
 *   it is unavailable (see `selectSandboxBackend`).
 * - `OMNICODE_SANDBOX_WRITE_ROOTS` comma-separated write allowlist.
 * - `OMNICODE_SANDBOX_DENY_READ` comma-separated deny-read paths/globs.
 * - `OMNICODE_SANDBOX_NETWORK` `shared` keeps the network namespace shared.
 *
 * List values are passed to the plan builder unfiltered: a non-absolute entry
 * fails plan validation, so a misconfigured variable falls back with the entry
 * named (auto) or denies the child (required) instead of silently shrinking
 * the configured grants.
 */

export type ChildSandboxMode = 'off' | 'auto' | 'required';

export function resolveChildSandboxMode(env: NodeJS.ProcessEnv = process.env): ChildSandboxMode {
  const raw = (env['OMNICODE_SANDBOX_MODE'] ?? 'off').trim().toLowerCase();
  return raw === 'auto' || raw === 'required' ? raw : 'off';
}

export function resolveChildSandboxBackendPreference(
  env: NodeJS.ProcessEnv = process.env,
): SandboxBackendKind | undefined {
  const raw = (env['OMNICODE_SANDBOX_BACKEND'] ?? '').trim().toLowerCase();
  return raw === 'bwrap' || raw === 'seatbelt' || raw === 'landlock' ? raw : undefined;
}

export function childSandboxWriteRoots(env: NodeJS.ProcessEnv = process.env): readonly string[] | undefined {
  const raw = env['OMNICODE_SANDBOX_WRITE_ROOTS']?.trim();
  if (raw === undefined || raw.length === 0) return undefined;
  const roots = raw.split(',').map((value) => value.trim()).filter((value) => value.length > 0);
  return roots.length === 0 ? undefined : roots;
}

export function childSandboxDenyReadPaths(env: NodeJS.ProcessEnv = process.env): readonly string[] | undefined {
  const raw = env['OMNICODE_SANDBOX_DENY_READ']?.trim();
  if (raw === undefined || raw.length === 0) return undefined;
  const paths = raw.split(',').map((value) => value.trim()).filter((value) => value.length > 0);
  return paths.length === 0 ? undefined : paths;
}

export function childSandboxNetworkShared(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env['OMNICODE_SANDBOX_NETWORK'] ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'shared';
}

export interface ChildSandboxSpawnRequest {
  /** Exact argv of the already-approved child, e.g. `['node', 'server.js']`. */
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly workspace: string;
  readonly writeAllowlist?: readonly string[];
  readonly denyReadPaths?: readonly string[];
  readonly shareNetwork?: boolean;
}

export type ChildSandboxPreparation =
  | { readonly kind: 'direct'; readonly reason?: string }
  | { readonly kind: 'sandbox'; readonly command: string; readonly args: readonly string[]; readonly cwd: string }
  | { readonly kind: 'denied'; readonly message: string };

export interface ChildSandboxDeps {
  readonly env?: NodeJS.ProcessEnv;
  readonly probe?: () => Promise<readonly SandboxAvailability[]>;
  readonly permissionMode?: SandboxPermissionMode;
}

let cachedProbe: Promise<readonly SandboxAvailability[]> | undefined;
let testProbe: (() => Promise<readonly SandboxAvailability[]>) | undefined;

function availability(deps: ChildSandboxDeps): Promise<readonly SandboxAvailability[]> {
  if (deps.probe !== undefined) return deps.probe();
  if (testProbe !== undefined) return testProbe();
  const probing =
    cachedProbe ??
    probeSandboxBackends().catch((error: unknown) => {
      cachedProbe = undefined;
      throw error;
    });
  cachedProbe = probing;
  return probing;
}

export function clearChildSandboxProbeCache(): void {
  cachedProbe = undefined;
}

/**
 * Test seam for consumers that cannot thread `deps.probe` (MCP transport,
 * hooks, worktree tools): installs a probe so their tests never exec the real
 * backend binaries. Passing `undefined` restores the default probe.
 */
export function setChildSandboxProbeForTests(
  probe: (() => Promise<readonly SandboxAvailability[]>) | undefined,
): void {
  testProbe = probe;
  cachedProbe = undefined;
}

export async function prepareChildSandboxSpawn(
  request: ChildSandboxSpawnRequest,
  deps: ChildSandboxDeps = {},
): Promise<ChildSandboxPreparation> {
  const env = deps.env ?? process.env;
  const mode = resolveChildSandboxMode(env);
  if (mode === 'off') return { kind: 'direct' };

  const permissionMode = deps.permissionMode ?? 'manual';
  const probed = await availability(deps);
  const selection = selectSandboxBackend({
    permissionMode,
    availability: probed,
    preferredBackend: resolveChildSandboxBackendPreference(env),
  });
  if (!selection.enabled || selection.backend === null || selection.availability === null) {
    if (mode === 'required') return { kind: 'denied', message: selection.message };
    return { kind: 'direct', reason: selection.message };
  }

  const writeAllowlist = request.writeAllowlist ?? childSandboxWriteRoots(env);
  const denyReadPaths = request.denyReadPaths ?? childSandboxDenyReadPaths(env);
  const plan = createSandboxExecutionPlan({
    backend: selection.backend,
    availability: selection.availability,
    permissionMode,
    policy: {
      workspace: request.workspace,
      cwd: request.cwd,
      shareNetwork: request.shareNetwork ?? childSandboxNetworkShared(env),
      sharePid: false,
      shareIpc: false,
      writeAllowlist,
      denyReadPaths,
    },
    request: { command: request.argv[0] ?? '', args: request.argv.slice(1), mode: 'argv' },
  });
  if (plan.ok) {
    return { kind: 'sandbox', command: plan.value.command, args: plan.value.args, cwd: plan.value.cwd };
  }
  if (mode === 'required') return { kind: 'denied', message: plan.message };
  return { kind: 'direct', reason: plan.message };
}
