export type SandboxBackendKind = 'bwrap' | 'landlock';

export type SandboxPermissionMode = 'manual' | 'auto' | 'yolo';

export type SandboxFailureCode =
  | 'backend-unavailable'
  | 'probe-failed'
  | 'invalid-request'
  | 'policy-denied'
  | 'path-escape'
  | 'payload-too-large'
  | 'unsupported-operation'
  | 'io-error'
  | 'not-found'
  | 'too-many-entries'
  | 'commit-failed';

export interface SandboxFailure {
  readonly ok: false;
  readonly code: SandboxFailureCode;
  readonly message: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface SandboxSuccess<T> {
  readonly ok: true;
  readonly value: T;
}

export type SandboxResult<T> = SandboxSuccess<T> | SandboxFailure;

export function sandboxFailure(
  code: SandboxFailureCode,
  message: string,
  detail?: Readonly<Record<string, unknown>>,
): SandboxFailure {
  return detail === undefined ? { ok: false, code, message } : { ok: false, code, message, detail };
}

export function sandboxSuccess<T>(value: T): SandboxSuccess<T> {
  return { ok: true, value };
}

export interface SandboxPolicy {
  readonly workspace: string;
  readonly cwd?: string;
  readonly shareNetwork?: boolean;
  readonly sharePid?: boolean;
  readonly shareIpc?: boolean;
  readonly systemPaths?: readonly string[];
  readonly tmpfsPaths?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export interface SandboxCommand {
  readonly command: readonly string[];
}

export interface SandboxExecutionPlan {
  readonly backend: SandboxBackendKind;
  readonly permissionMode: SandboxPermissionMode;
  readonly command: 'bwrap';
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface SandboxProbeCommand {
  readonly label: string;
  readonly file: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

export interface SandboxProbeOutput {
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error: string | null;
}

export type SandboxProbeExec = (command: SandboxProbeCommand) => Promise<SandboxProbeOutput>;

export interface SandboxProbeDetail {
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error: string | null;
}

export interface SandboxAvailability {
  readonly backend: SandboxBackendKind;
  readonly available: boolean;
  readonly version: string | null;
  readonly reason: string | null;
  readonly fallback: SandboxBackendKind | null;
  readonly probes: readonly SandboxProbeDetail[];
  readonly checkedAt: number;
}

export interface SandboxBackend {
  readonly kind: SandboxBackendKind;
  probe(): Promise<SandboxAvailability>;
  buildArgv(request: SandboxCommand, policy: SandboxPolicy): SandboxResult<readonly string[]>;
}

export interface SandboxSelection {
  readonly backend: SandboxBackendKind | null;
  readonly enabled: boolean;
  readonly permissionMode: SandboxPermissionMode;
  readonly reason: 'sandbox-available' | 'sandbox-unavailable';
  readonly message: string;
  readonly availability: SandboxAvailability | null;
}

export interface SandboxPolicySummary {
  readonly workspace: string;
  readonly cwd: string;
  readonly network: 'denied' | 'shared';
  readonly pidNamespace: 'isolated' | 'shared';
  readonly ipcNamespace: 'isolated' | 'shared';
  readonly systemPaths: readonly string[];
  readonly tmpfsPaths: readonly string[];
}

export interface SandboxStatus {
  readonly backend: SandboxBackendKind;
  readonly available: boolean;
  readonly version: string | null;
  readonly probes: readonly SandboxProbeDetail[];
  readonly reason: string | null;
  readonly fallback: SandboxBackendKind | null;
  readonly activePolicy: SandboxPolicySummary | null;
  readonly permissionMode: SandboxPermissionMode;
  readonly selection: SandboxSelection;
}
