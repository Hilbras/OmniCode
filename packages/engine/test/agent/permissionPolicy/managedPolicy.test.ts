import { describe, expect, it } from 'vitest';

import {
  isCredentialEnvDenied,
  resolveManagedPolicy,
  type ManagedPolicyConfig,
} from '#/agent/permissionPolicy/managedPolicy';

const managed: ManagedPolicyConfig = {
  allowManagedHooksOnly: true,
  credentialEnvDeny: ['OPENAI_API_KEY'],
};

describe('resolveManagedPolicy', () => {
  it('lets the managed tier set a value authoritatively', () => {
    expect(resolveManagedPolicy({
      source: 'managed', flag: 'allowManagedHooksOnly', localValue: undefined, managed,
    })).toEqual({ value: true, enforcedBy: 'managed', reason: 'managed policy is authoritative' });
  });

  it('refuses to relax a managed restriction from a lower tier', () => {
    expect(resolveManagedPolicy({
      source: 'user', flag: 'allowManagedHooksOnly', localValue: false, managed,
    })).toEqual({ value: true, enforcedBy: 'managed', reason: 'managed restriction cannot be relaxed' });
  });

  it('keeps local values when no managed restriction applies', () => {
    expect(resolveManagedPolicy({
      source: 'project', flag: 'strictKnownMarketplaces', localValue: false, managed,
    })).toEqual({ value: false, enforcedBy: 'project', reason: 'no managed restriction applies' });
  });

  it('disables sideload flags below the managed tier', () => {
    expect(resolveManagedPolicy({
      source: 'session', flag: 'disableSideloadFlags', localValue: false, managed,
    }).value).toBe(true);
  });
});

describe('isCredentialEnvDenied', () => {
  it('matches exact credential env names', () => {
    expect(isCredentialEnvDenied(managed, 'OPENAI_API_KEY')).toBe(true);
    expect(isCredentialEnvDenied(managed, 'OTHER_KEY')).toBe(false);
  });
});
