import { describe, expect, it } from 'vitest';

import {
  planPermissionEscalation,
  ruleToolName,
} from '#/agent/permissionRules/permissionEscalation';
import type { PermissionRule } from '#/agent/permissionRules/permissionRules';

function rule(overrides: Partial<PermissionRule> = {}): PermissionRule {
  return {
    decision: 'allow',
    scope: 'session-runtime',
    pattern: 'Bash(npm test)',
    ...overrides,
  };
}

describe('ruleToolName', () => {
  it('extracts the leading tool name from a rule pattern', () => {
    expect(ruleToolName('Bash(npm test)')).toBe('Bash');
    expect(ruleToolName(' Read:/repo/a.ts ')).toBe('Read');
    expect(ruleToolName('mcp__server__tool')).toBe('mcp__server__tool');
    expect(ruleToolName('')).toBeUndefined();
  });
});

describe('planPermissionEscalation', () => {
  it('accepts a session-scoped rule for a tool in the active profile', () => {
    const plan = planPermissionEscalation({
      requested: [rule()],
      allowedTools: ['Bash', 'Read'],
      existingRules: [],
    });
    expect(plan.accepted).toEqual([rule()]);
    expect(plan.rejected).toEqual([]);
  });

  it('refuses a tool outside the profile allowlist', () => {
    const plan = planPermissionEscalation({
      requested: [rule({ pattern: 'CurlExample' })],
      allowedTools: ['Bash', 'Read'],
      existingRules: [],
    });
    expect(plan.accepted).toEqual([]);
    expect(plan.rejected[0]?.reason).toBe('tool-not-in-profile');
  });

  it('honours wildcard profile entries', () => {
    const plan = planPermissionEscalation({
      requested: [rule({ pattern: 'mcp__github__list' })],
      allowedTools: ['mcp__*'],
      existingRules: [],
    });
    expect(plan.accepted).toHaveLength(1);
  });

  it('refuses out-of-band scopes', () => {
    for (const scope of ['project', 'user'] as const) {
      const plan = planPermissionEscalation({
        requested: [rule({ scope })],
        allowedTools: ['Bash'],
        existingRules: [],
      });
      expect(plan.rejected[0]?.reason).toBe('outside-session-scope');
    }
  });

  it('refuses to weaken an existing deny (fail on base: no tool existed)', () => {
    const denied = rule({ decision: 'deny', pattern: 'Bash(curl *)' });
    const samePattern = planPermissionEscalation({
      requested: [rule({ pattern: 'Bash(curl *)' })],
      allowedTools: ['Bash'],
      existingRules: [denied],
    });
    expect(samePattern.rejected[0]?.reason).toBe('weaken-existing-deny');

    const sameTool = planPermissionEscalation({
      requested: [rule({ pattern: 'Bash(npm test)' })],
      allowedTools: ['Bash'],
      existingRules: [denied],
    });
    expect(sameTool.rejected[0]?.reason).toBe('weaken-existing-deny');
  });

  it('accepts a strengthening deny rule', () => {
    const plan = planPermissionEscalation({
      requested: [rule({ decision: 'deny', pattern: 'Bash(rm -rf *)' })],
      allowedTools: ['Bash'],
      existingRules: [rule({ pattern: 'Bash(npm test)' })],
    });
    expect(plan.accepted).toHaveLength(1);
    expect(plan.rejected).toEqual([]);
  });

  it('treats an accepted rule as existing for later requests in the same call', () => {
    const plan = planPermissionEscalation({
      requested: [
        rule({ decision: 'deny', pattern: 'Bash(git push *)' }),
        rule({ pattern: 'Bash(git push --force)' }),
      ],
      allowedTools: ['Bash'],
      existingRules: [],
    });
    expect(plan.accepted).toHaveLength(1);
    expect(plan.rejected[0]?.reason).toBe('weaken-existing-deny');
  });

  it('rejects a pattern with no tool name', () => {
    const plan = planPermissionEscalation({
      requested: [rule({ pattern: '()' })],
      allowedTools: ['Bash'],
      existingRules: [],
    });
    expect(plan.rejected[0]?.reason).toBe('invalid-pattern');
  });
});
