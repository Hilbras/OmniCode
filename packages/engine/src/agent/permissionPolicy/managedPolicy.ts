/**
 * Managed/admin policy tier (unified plan B1).
 *
 * An additional highest-precedence source above project/user settings. Managed
 * restrictions are fail-closed and cannot be relaxed by a lower tier; it does
 * not replace local guards. Reference: Claude `examples/settings/settings-hippa.json:5-16,88-127`.
 */
export type PolicySource = 'managed' | 'project' | 'user' | 'session';

export interface ManagedPolicyConfig {
  readonly allowManagedHooksOnly?: boolean;
  readonly allowManagedMcpServersOnly?: boolean;
  readonly disableSideloadFlags?: boolean;
  readonly strictKnownMarketplaces?: boolean;
  readonly credentialEnvDeny?: readonly string[];
}

export interface PolicyOverrideInput {
  readonly source: PolicySource;
  readonly flag: keyof ManagedPolicyConfig;
  readonly localValue: boolean | undefined;
  readonly managed: ManagedPolicyConfig;
}

export interface PolicyOverrideResult {
  readonly value: boolean | undefined;
  readonly enforcedBy: PolicySource | undefined;
  readonly reason: string;
}

export function resolveManagedPolicy(input: PolicyOverrideInput): PolicyOverrideResult {
  const managedValue = input.managed[input.flag];
  if (input.source === 'managed' && managedValue !== undefined) {
    return { value: Boolean(managedValue), enforcedBy: 'managed', reason: 'managed policy is authoritative' };
  }
  if (managedValue === true) {
    return { value: true, enforcedBy: 'managed', reason: 'managed restriction cannot be relaxed' };
  }
  if (input.source === 'session' && input.flag === 'disableSideloadFlags') {
    return { value: true, enforcedBy: 'managed', reason: 'sideload flags are disabled below managed tier' };
  }
  return {
    value: input.localValue,
    enforcedBy: input.localValue === undefined ? undefined : input.source,
    reason: 'no managed restriction applies',
  };
}

export function isCredentialEnvDenied(managed: ManagedPolicyConfig, name: string): boolean {
  return (managed.credentialEnvDeny ?? []).some((denied) => denied === name);
}
