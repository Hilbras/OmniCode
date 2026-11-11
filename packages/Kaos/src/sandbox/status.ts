import { normalize } from 'pathe';

import { DEFAULT_SANDBOX_SYSTEM_PATHS, DEFAULT_SANDBOX_TMPFS_PATHS } from './paths';
import type {
  SandboxAvailability,
  SandboxPolicy,
  SandboxPolicySummary,
  SandboxSelection,
  SandboxStatus,
} from './types';

function uniqueNormalized(paths: readonly string[]): readonly string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const normalized = normalize(path);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function summarizeSandboxPolicy(policy: SandboxPolicy): SandboxPolicySummary {
  const workspace = normalize(policy.workspace);
  return {
    workspace,
    cwd: normalize(policy.cwd ?? policy.workspace),
    network: policy.shareNetwork === true ? 'shared' : 'denied',
    pidNamespace: policy.sharePid === true ? 'shared' : 'isolated',
    ipcNamespace: policy.shareIpc === true ? 'shared' : 'isolated',
    systemPaths: uniqueNormalized(policy.systemPaths ?? DEFAULT_SANDBOX_SYSTEM_PATHS),
    tmpfsPaths: uniqueNormalized(policy.tmpfsPaths ?? DEFAULT_SANDBOX_TMPFS_PATHS),
  };
}

export interface SandboxStatusInput {
  readonly availability: SandboxAvailability;
  readonly selection: SandboxSelection;
  readonly policy?: SandboxPolicy;
}

export function createSandboxStatus(input: SandboxStatusInput): SandboxStatus {
  return {
    backend: input.availability.backend,
    available: input.availability.available,
    version: input.availability.version,
    probes: input.availability.probes,
    reason: input.availability.reason,
    fallback: input.availability.fallback,
    activePolicy: input.policy === undefined ? null : summarizeSandboxPolicy(input.policy),
    permissionMode: input.selection.permissionMode,
    selection: input.selection,
  };
}
