import { normalize } from 'pathe';

import { buildBwrapArgv } from './bwrap';
import {
  DEFAULT_RUNTIME_SHELL_POLICY,
  evaluateRuntimeShellPolicy,
  type RuntimeShellPolicy,
  type ShellPolicyRequest,
} from './shell-policy';
import {
  sandboxFailure,
  sandboxSuccess,
  type SandboxAvailability,
  type SandboxBackendKind,
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

  const argv = buildBwrapArgv({ command: shell.argv }, input.policy);
  if (!argv.ok) return argv;

  return sandboxSuccess({
    backend: input.backend,
    permissionMode: input.permissionMode,
    command: 'bwrap',
    args: argv.value,
    cwd: normalize(input.policy.cwd ?? input.policy.workspace),
  });
}
