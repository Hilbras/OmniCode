import { describe, expect, it } from 'vitest';

import {
  resolveAgentSpec,
  validateAgentSpec,
  type AgentSpec,
  type ResolvedAgentSpec,
} from '#/agent/profile/agentSpec';

const base: ResolvedAgentSpec = {
  name: 'agent',
  model: 'base-model',
  permissionMode: 'auto',
  allowedTools: ['Read', 'Write'],
  maxTurns: 20,
  autoCompactWindow: 100,
  hooks: ['base-hook'],
};

const spec = (overrides: Partial<AgentSpec> = {}): AgentSpec => ({ name: 'reviewer', ...overrides });

describe('validateAgentSpec', () => {
  it('accepts a valid spec', () => {
    expect(validateAgentSpec(spec({ maxTurns: 5 }))).toEqual([]);
  });

  it('rejects invalid budgets and contradictory tool lists', () => {
    const issues = validateAgentSpec(spec({
      maxTurns: 0, autoCompactWindow: -1, tools: ['Read'], disallowedTools: ['Read'],
    }));
    expect(issues.map((issue) => issue.field)).toEqual(['maxTurns', 'autoCompactWindow', 'tools']);
  });
});

describe('resolveAgentSpec', () => {
  it('inherits model and permission mode when not overridden', () => {
    const resolved = resolveAgentSpec(base, spec(), 'fallback');
    expect(resolved).toMatchObject({ model: 'base-model', permissionMode: 'auto' });
  });

  it('honours explicit model, mode and budgets', () => {
    const resolved = resolveAgentSpec(base, spec({
      model: 'claude-x', permissionMode: 'manual', maxTurns: 3, autoCompactWindow: 50,
    }), 'fallback');
    expect(resolved).toMatchObject({
      model: 'claude-x', permissionMode: 'manual', maxTurns: 3, autoCompactWindow: 50,
    });
  });

  it('subtracts denied tools from the inherited allowlist', () => {
    expect(resolveAgentSpec(base, spec({ disallowedTools: ['Write'] }), 'fallback').allowedTools)
      .toEqual(['Read']);
  });
});
