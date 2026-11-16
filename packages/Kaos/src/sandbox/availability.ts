import { execFile } from 'node:child_process';

import { probeSeatbelt, type SeatbeltProbeDeps } from './seatbelt';
import { probeWindowsSandbox, type WindowsSandboxBackendDeps } from './windows';
import type {
  SandboxAvailability,
  SandboxProbeCommand,
  SandboxProbeDetail,
  SandboxProbeExec,
  SandboxProbeOutput,
} from './types';

const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
const PROBE_MAX_BUFFER = 64 * 1024;

export const nodeSandboxProbeExec: SandboxProbeExec = (command: SandboxProbeCommand) =>
  new Promise<SandboxProbeOutput>((resolve) => {
    execFile(
      command.file,
      [...command.args],
      {
        timeout: command.timeoutMs,
        maxBuffer: PROBE_MAX_BUFFER,
        windowsHide: true,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        const exitCode =
          error === null
            ? 0
            : typeof error.code === 'number'
              ? error.code
              : 1;
        resolve({
          ok: error === null && exitCode === 0,
          exitCode: error === null ? 0 : exitCode,
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : '',
          error: error === null ? null : error.message,
        });
      },
    );
  });

function toDetail(command: SandboxProbeCommand, output: SandboxProbeOutput): SandboxProbeDetail {
  return {
    label: command.label,
    command: command.file,
    args: [...command.args],
    ok: output.ok,
    exitCode: output.exitCode,
    stdout: output.stdout,
    stderr: output.stderr,
    error: output.error,
  };
}

function summariseProbeFailure(output: SandboxProbeOutput): string {
  const detail = output.stderr.trim() || output.error || output.stdout.trim();
  return detail.length > 0 ? detail : `exit code ${String(output.exitCode)}`;
}

async function runProbe(
  exec: SandboxProbeExec,
  command: SandboxProbeCommand,
): Promise<SandboxProbeOutput> {
  try {
    return await exec(command);
  } catch (error) {
    return {
      ok: false,
      exitCode: null,
      stdout: '',
      stderr: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseBwrapVersion(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return null;
  for (const line of trimmed.split('\n')) {
    const match = /bubblewrap\s+([^\s]+)/i.exec(line);
    if (match !== null && match[1] !== undefined) return match[1];
  }
  return trimmed.split('\n')[0] ?? null;
}

export interface BwrapProbeDeps {
  readonly platform?: string;
  readonly exec?: SandboxProbeExec;
  readonly timeoutMs?: number;
}

export async function probeBwrap(deps: BwrapProbeDeps = {}): Promise<SandboxAvailability> {
  const platform = deps.platform ?? process.platform;
  const exec = deps.exec ?? nodeSandboxProbeExec;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;

  if (platform !== 'linux') {
    return {
      backend: 'bwrap',
      available: false,
      version: null,
      reason: `bwrap requires Linux (host platform: ${platform})`,
      fallback: null,
      probes: [],
      checkedAt: Date.now(),
    };
  }

  const versionCommand: SandboxProbeCommand = {
    label: 'bwrap-version',
    file: 'bwrap',
    args: ['--version'],
    timeoutMs,
  };
  const versionOutput = await runProbe(exec, versionCommand);
  const versionDetail = toDetail(versionCommand, versionOutput);
  const version = parseBwrapVersion(versionOutput.stdout);

  if (!versionOutput.ok) {
    return {
      backend: 'bwrap',
      available: false,
      version,
      reason: `bwrap --version failed: ${summariseProbeFailure(versionOutput)}`,
      fallback: null,
      probes: [versionDetail],
      checkedAt: Date.now(),
    };
  }

  const unshareCommand: SandboxProbeCommand = {
    label: 'bwrap-unshare-all',
    file: 'bwrap',
    args: ['--unshare-all', '--ro-bind', '/', '/', '--', '/bin/true'],
    timeoutMs,
  };
  const unshareOutput = await runProbe(exec, unshareCommand);
  const unshareDetail = toDetail(unshareCommand, unshareOutput);

  if (!unshareOutput.ok) {
    return {
      backend: 'bwrap',
      available: false,
      version,
      reason: `bwrap --unshare-all is unavailable: ${summariseProbeFailure(unshareOutput)}`,
      fallback: null,
      probes: [versionDetail, unshareDetail],
      checkedAt: Date.now(),
    };
  }

  return {
    backend: 'bwrap',
    available: true,
    version,
    reason: null,
    fallback: null,
    probes: [versionDetail, unshareDetail],
    checkedAt: Date.now(),
  };
}

export interface LandlockProbeDeps {
  readonly platform?: string;
}

export async function probeLandlock(deps: LandlockProbeDeps = {}): Promise<SandboxAvailability> {
  const platform = deps.platform ?? process.platform;
  const reason =
    platform === 'linux'
      ? 'landlock enforcement requires a native syscall bridge (landlock_create_ruleset); pure TypeScript cannot apply a ruleset, so the landlock backend is unavailable and falls back to bwrap'
      : `landlock requires Linux (host platform: ${platform}) and falls back to bwrap`;

  return {
    backend: 'landlock',
    available: false,
    version: null,
    reason,
    fallback: 'bwrap',
    probes: [
      {
        label: 'landlock-native-bridge',
        command: 'landlock_create_ruleset',
        args: [],
        ok: false,
        exitCode: null,
        stdout: '',
        stderr: reason,
        error: null,
      },
    ],
    checkedAt: Date.now(),
  };
}

export interface SandboxProbeDeps {
  readonly bwrap?: BwrapProbeDeps;
  readonly landlock?: LandlockProbeDeps;
  readonly seatbelt?: SeatbeltProbeDeps;
  readonly windows?: WindowsSandboxBackendDeps;
}

export async function probeSandboxBackends(
  deps: SandboxProbeDeps = {},
): Promise<readonly SandboxAvailability[]> {
  const probes = await Promise.all([
    probeBwrap(deps.bwrap),
    probeLandlock(deps.landlock),
    probeSeatbelt(deps.seatbelt),
    probeWindowsSandbox(deps.windows),
  ]);
  return probes;
}
