import { buildBwrapArgv } from './bwrap';
import { probeBwrap, probeLandlock, type BwrapProbeDeps, type LandlockProbeDeps } from './availability';
import {
  sandboxFailure,
  type SandboxAvailability,
  type SandboxBackend,
  type SandboxBackendKind,
  type SandboxCommand,
  type SandboxPolicy,
  type SandboxResult,
} from './types';

export class BwrapSandboxBackend implements SandboxBackend {
  readonly kind = 'bwrap' as const;
  private readonly deps: BwrapProbeDeps;

  constructor(deps: BwrapProbeDeps = {}) {
    this.deps = deps;
  }

  probe(): Promise<SandboxAvailability> {
    return probeBwrap(this.deps);
  }

  buildArgv(request: SandboxCommand, policy: SandboxPolicy): SandboxResult<readonly string[]> {
    return buildBwrapArgv(request, policy);
  }
}

export class LandlockSandboxBackend implements SandboxBackend {
  readonly kind = 'landlock' as const;
  private readonly deps: LandlockProbeDeps;

  constructor(deps: LandlockProbeDeps = {}) {
    this.deps = deps;
  }

  probe(): Promise<SandboxAvailability> {
    return probeLandlock(this.deps);
  }

  buildArgv(_request: SandboxCommand, _policy: SandboxPolicy): SandboxResult<readonly string[]> {
    return sandboxFailure(
      'backend-unavailable',
      'landlock enforcement is unavailable in pure TypeScript; use the bwrap backend',
      { fallback: 'bwrap' },
    );
  }
}

export interface SandboxBackendDeps {
  readonly bwrap?: BwrapProbeDeps;
  readonly landlock?: LandlockProbeDeps;
}

export function createSandboxBackend(
  kind: SandboxBackendKind,
  deps: SandboxBackendDeps = {},
): SandboxBackend {
  if (kind === 'bwrap') return new BwrapSandboxBackend(deps.bwrap);
  return new LandlockSandboxBackend(deps.landlock);
}
