import { normalize } from 'pathe';

import { buildBwrapArgv } from './bwrap';
import {
  DEFAULT_RUNTIME_SHELL_POLICY,
  evaluateRuntimeShellPolicy,
  type RuntimeShellPolicy,
  type ShellPolicyRequest,
} from './shell-policy';
import { buildSeatbeltArgv, SEATBELT_EXECUTABLE } from './seatbelt';
import { buildWindowsSandboxArgv } from './windows';
import {
  sandboxFailure,
  sandboxSuccess,
  type SandboxAvailability,
  type SandboxBackendKind,
  type SandboxCommand,
  type SandboxExecutionPlan,
  type SandboxPermissionMode,
  type SandboxPolicy,
  type SandboxResult,
} from './types';

export type SandboxExecutionRequest = ShellPolicyRequest;

export interface CreateSandboxExecutionPlanInput {
  readonly backend: SandboxBackendKind;
  readonly availability: SandboxAvailability;
  readonly permissionMode: SandboxPermissionMode;
  readonly policy: SandboxPolicy;
  readonly request: SandboxExecutionRequest;
  readonly shellPolicy?: RuntimeShellPolicy;
  /** Native helper for the windows backend; without one the windows plan refuses. */
  readonly windowsHelperPath?: string;
}

function isPolicyDenial(code: string): boolean {
  return (
    code === 'shell-metacharacter' ||
    code === 'shell-mode-disabled' ||
    code === 'shell-arguments-not-allowed' ||
    code === 'unsafe-shell-path' ||
    code === 'environment-assignment'
  );
}

function buildBackendArgv(
  backend: Exclude<SandboxBackendKind, 'windows' | 'landlock'>,
  request: SandboxCommand,
  policy: SandboxPolicy,
): SandboxResult<readonly string[]> {
  if (backend === 'seatbelt') return buildSeatbeltArgv(request, policy);
  return buildBwrapArgv(request, policy);
}

export function createSandboxExecutionPlan(
  input: CreateSandboxExecutionPlanInput,
): SandboxResult<SandboxExecutionPlan> {
  if (input.availability.backend !== input.backend) {
    return sandboxFailure(
      'invalid-request',
      `availability describes ${input.availability.backend}, not ${input.backend}`,
    );
  }
  if (!input.availability.available) {
    return sandboxFailure(
      'backend-unavailable',
      `${input.backend} sandbox is unavailable: ${input.availability.reason ?? 'no reason reported'}`,
      {
        backend: input.backend,
        fallback: input.availability.fallback,
      },
    );
  }
  if (input.backend === 'landlock') {
    return sandboxFailure(
      'backend-unavailable',
      'landlock enforcement is unavailable in pure TypeScript; use the bwrap backend',
      { backend: 'landlock', fallback: 'bwrap' },
    );
  }

  const shell = evaluateRuntimeShellPolicy(
    input.request,
    input.shellPolicy ?? DEFAULT_RUNTIME_SHELL_POLICY,
  );
  if (!shell.ok) {
    return sandboxFailure(
      isPolicyDenial(shell.code) ? 'policy-denied' : 'invalid-request',
      shell.message,
      { denial: shell.code, offending: shell.offending },
    );
  }

  if (input.backend === 'windows') {
    const windowsArgv = buildWindowsSandboxArgv(
      { command: shell.argv },
      input.policy,
      { helperPath: input.windowsHelperPath },
    );
    if (!windowsArgv.ok) return windowsArgv;
    return sandboxSuccess({
      backend: 'windows',
      permissionMode: input.permissionMode,
      command: windowsArgv.value[0],
      args: windowsArgv.value,
      cwd: normalize(input.policy.cwd ?? input.policy.workspace),
    });
  }

  const argv = buildBackendArgv(input.backend, { command: shell.argv }, input.policy);
  if (!argv.ok) return argv;

  return sandboxSuccess({
    backend: input.backend,
    permissionMode: input.permissionMode,
    command: input.backend === 'seatbelt' ? SEATBELT_EXECUTABLE : 'bwrap',
    args: argv.value,
    cwd: normalize(input.policy.cwd ?? input.policy.workspace),
  });
}
