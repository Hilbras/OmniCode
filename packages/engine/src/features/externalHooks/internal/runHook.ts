import { type SpawnOptionsWithoutStdio } from 'node:child_process';

import { z } from 'zod';

import { prepareChildSandboxSpawn } from '#/os/sandbox/childSandbox';
import { type IHostProcess, IHostProcessService } from '#/os/interface/hostProcess';

import type { HookResult } from './types';

export interface RunHookOptions {
  readonly timeout: number;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly signal?: AbortSignal;
  readonly shell?: boolean;
  readonly inheritEnv?: boolean;
  /**
   * Workspace the hook's child process is sandboxed against when the host
   * enabled `OMNICODE_SANDBOX_MODE`. Absent means the hook runs unsandboxed.
   */
  readonly sandbox?: { readonly workspace: string };
}

export function buildHookSpawnOptions(options: {
  cwd?: string;
  env?: Record<string, string>;
  shell?: boolean;
  inheritEnv?: boolean;
}): SpawnOptionsWithoutStdio {
  return {
    shell: options.shell === true,
    cwd: options.cwd,
    stdio: 'pipe',
    detached: process.platform !== 'win32',
    windowsHide: true,
    env: buildHookEnv(options.env, options.inheritEnv === true),
  };
}

const DEFAULT_TIMEOUT_SECONDS = 30;
const KILL_GRACE_MS = 100;
const OptionalStringSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value);
    }
    return undefined;
  },
  z.string().optional(),
);
const HookSpecificOutputSchema = z.preprocess(
  (value) => (isRecord(value) ? value : undefined),
  z
    .looseObject({
      message: OptionalStringSchema,
      permissionDecision: z.unknown().optional(),
      permissionDecisionReason: z.unknown().optional(),
    })
    .optional(),
);
const HookJsonOutputSchema = z.looseObject({
  message: OptionalStringSchema,
  hookSpecificOutput: HookSpecificOutputSchema,
});

type HookSandbox =
  | { readonly kind: 'unsandboxed'; readonly note?: string }
  | { readonly kind: 'sandboxed'; readonly command: string; readonly args: readonly string[] }
  | { readonly kind: 'denied'; readonly message: string };

async function prepareHookSandbox(
  options: RunHookOptions,
  command: string,
  args: readonly string[],
): Promise<HookSandbox> {
  if (options.sandbox === undefined) return { kind: 'unsandboxed' };
  if (options.shell === true) {
    return {
      kind: 'unsandboxed',
      note: 'hook shell mode cannot be sandboxed; the hook runs outside the OS sandbox',
    };
  }
  const prepared = await prepareChildSandboxSpawn({
    argv: [command, ...args],
    cwd: options.cwd ?? options.sandbox.workspace,
    workspace: options.sandbox.workspace,
  });
  if (prepared.kind === 'denied') return { kind: 'denied', message: prepared.message };
  if (prepared.kind === 'sandbox') {
    return { kind: 'sandboxed', command: prepared.command, args: prepared.args };
  }
  return { kind: 'unsandboxed', note: prepared.reason };
}

export async function runHook(
  hostProcess: IHostProcessService,
  command: string,
  input: Record<string, unknown>,
  options: RunHookOptions,
): Promise<HookResult> {
  const parsed = options.shell === true ? { command, args: [] as string[] } : parseHookCommand(command);
  if ('error' in parsed) {
    return { action: 'block', message: parsed.error, reason: parsed.error, errored: true };
  }
  const sandbox = await prepareHookSandbox(options, parsed.command, parsed.args);
  if (sandbox.kind === 'denied') {
    return {
      action: 'block',
      message: sandbox.message,
      reason: sandbox.message,
      errored: true,
    };
  }
  const sandboxNote = sandbox.kind === 'unsandboxed' ? sandbox.note : undefined;
  let proc: IHostProcess;
  try {
    if (sandbox.kind === 'sandboxed') {
      proc = await hostProcess.spawn(sandbox.command, sandbox.args, {
        cwd: options.cwd,
        env: buildHookEnv(options.env, options.inheritEnv === true),
        inheritEnv: false,
      });
    } else {
      proc = await hostProcess.spawn(parsed.command, parsed.args, {
        shell: options.shell === true,
        cwd: options.cwd,
        env: buildHookEnv(options.env, options.inheritEnv === true),
        inheritEnv: false,
      });
    }
  } catch (error) {
    const message = errorMessage(error);
    return {
      action: 'block',
      message,
      reason: message,
      errored: true,
      sandboxNote,
    };
  }

  return new Promise<HookResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeoutMs = timeoutSeconds(options.timeout) * 1000;

    const cleanup = (): void => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    };

    const settle = (result: HookResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ...result, sandboxNote });
    };

    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    proc.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const stdoutDone = new Promise<void>((done) => proc.stdout.once('end', done));
    const stderrDone = new Promise<void>((done) => proc.stderr.once('end', done));
    void Promise.all([proc.wait(), stdoutDone, stderrDone]).then(
      ([code]) => {
        void proc.dispose();
        settle(resultFromExitCode(code, stdout, stderr));
      },
      (error) => {
        void proc.dispose();
        settle(allowResult({ stdout, stderr: stderr + errorMessage(error), errored: true }));
      },
    );

    const timeout = setTimeout(() => {
      killProcess(proc);
      settle(allowResult({ stdout, stderr, timedOut: true }));
    }, timeoutMs);

    const onAbort = (): void => {
      killProcess(proc);
      settle(allowResult({ stdout, stderr }));
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted === true) {
      onAbort();
      return;
    }

    proc.stdin.on('error', () => {});
    proc.stdin.end(JSON.stringify(input));
  });
}

function buildHookEnv(extra: Record<string, string> | undefined, inheritEnv: boolean): Record<string, string> {
  const keys = inheritEnv
    ? Object.keys(process.env)
    : ['PATH', 'Path', 'HOME', 'USER', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'ComSpec', 'PATHEXT', 'SHELL', 'LANG', 'LC_ALL'];
  const base = Object.fromEntries(
    keys
      .map((key) => [key, process.env[key]] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined),
  );
  return { ...base, ...extra };
}

function parseHookCommand(command: string): { readonly command: string; readonly args: string[] } | { readonly error: string } {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaping = false;
  for (const char of command.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    if (/[|&;<>()`$]/u.test(char)) {
      return { error: `hook command uses shell syntax but shell mode is disabled: ${char}` };
    }
    current += char;
  }
  if (escaping || quote !== undefined) return { error: 'hook command has an unterminated quote or escape' };
  if (current.length > 0) tokens.push(current);
  if (tokens.length === 0) return { error: 'hook command is empty' };
  const [executable, ...args] = tokens;
  return { command: executable!, args };
}

function timeoutSeconds(timeout: number): number {
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_SECONDS;
}

function resultFromExitCode(exitCode: number, stdout: string, stderr: string): HookResult {
  if (exitCode === 2) {
    const message = stderr.trim();
    return {
      action: 'block',
      message,
      reason: message,
      stdout,
      stderr,
      exitCode,
    };
  }

  const structured = exitCode === 0 ? structuredOutput(stdout) : undefined;
  if (structured?.action === 'block') {
    return {
      action: 'block',
      message: structured.message ?? structured.reason,
      reason: structured.reason,
      stdout,
      stderr,
      exitCode,
      structuredOutput: structured.structuredOutput,
    };
  }
  if (structured?.action === 'approve') {
    return {
      action: 'approve',
      message: structured.message,
      reason: structured.reason,
      stdout,
      stderr,
      exitCode,
      structuredOutput: structured.structuredOutput,
    };
  }

  return allowResult({
    message: structured?.message,
    stdout,
    stderr,
    exitCode,
    structuredOutput: structured?.structuredOutput,
  });
}

interface StructuredHookOutput {
  readonly action?: 'block' | 'approve';
  readonly reason?: string;
  readonly message?: string;
  readonly structuredOutput: true;
}

function structuredOutput(stdout: string): StructuredHookOutput | undefined {
  const raw = stdout.trim();
  if (raw.length === 0) return undefined;

  try {
    const parsed = JSON.parse(raw) as unknown;
    const output = HookJsonOutputSchema.safeParse(parsed);
    if (!output.success) return undefined;

    const { message, hookSpecificOutput } = output.data;
    const decision = hookSpecificOutput?.permissionDecision;
    const reason =
      typeof hookSpecificOutput?.permissionDecisionReason === 'string'
        ? hookSpecificOutput.permissionDecisionReason
        : undefined;
    const text = message ?? hookSpecificOutput?.message;
    if (decision === 'deny') {
      return { action: 'block', message: text, reason, structuredOutput: true };
    }
    if (decision === 'approve') {
      return { action: 'approve', message: text, reason, structuredOutput: true };
    }
    return { message: text, structuredOutput: true };
  } catch {
    return undefined;
  }
}

function allowResult(input: {
  readonly message?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly timedOut?: boolean;
  readonly errored?: boolean;
  readonly structuredOutput?: boolean;
}): HookResult {
  return {
    action: 'allow',
    message: input.message,
    stdout: input.stdout,
    stderr: input.stderr,
    exitCode: input.exitCode,
    timedOut: input.timedOut,
    errored: input.errored,
    structuredOutput: input.structuredOutput,
  };
}

function killProcess(proc: IHostProcess): void {
  void proc.kill('SIGTERM');
  const killTimer = setTimeout(() => {
    void proc.kill('SIGKILL');
  }, KILL_GRACE_MS);
  killTimer.unref();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
