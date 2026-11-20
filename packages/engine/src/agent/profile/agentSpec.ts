/**
 * Declarative per-agent spec (unified plan B5).
 *
 * Agents can be described as data with inherited permission mode, tool
 * allow/deny lists, turn and compaction budgets, and agent-scoped hooks.
 * Complements code-defined profiles. Reference: Claude `claude-code.d.ts:817-879`.
 */
export type SpecPermissionMode = 'manual' | 'auto' | 'yolo';

export interface AgentSpec {
  readonly name: string;
  /** Model alias, or the literal `inherit` to use the base agent's model. */
  readonly model?: string;
  readonly permissionMode?: SpecPermissionMode;
  readonly tools?: readonly string[];
  readonly disallowedTools?: readonly string[];
  readonly maxTurns?: number;
  readonly autoCompactWindow?: number;
  readonly hooks?: readonly string[];
}

export interface ResolvedAgentSpec {
  readonly name: string;
  readonly model: string;
  readonly permissionMode: SpecPermissionMode;
  readonly allowedTools: readonly string[];
  readonly maxTurns: number | undefined;
  readonly autoCompactWindow: number | undefined;
  readonly hooks: readonly string[];
}

export interface AgentSpecIssue {
  readonly field: string;
  readonly reason: string;
}

export function validateAgentSpec(spec: AgentSpec): readonly AgentSpecIssue[] {
  const issues: AgentSpecIssue[] = [];
  if (spec.name.trim().length === 0) issues.push({ field: 'name', reason: 'name is required' });
  if (spec.maxTurns !== undefined && (!Number.isInteger(spec.maxTurns) || spec.maxTurns < 1)) {
    issues.push({ field: 'maxTurns', reason: 'must be a positive integer' });
  }
  if (spec.autoCompactWindow !== undefined && (!Number.isInteger(spec.autoCompactWindow) || spec.autoCompactWindow < 1)) {
    issues.push({ field: 'autoCompactWindow', reason: 'must be a positive integer' });
  }
  const disallowed = new Set(spec.disallowedTools ?? []);
  const conflict = (spec.tools ?? []).find((tool) => disallowed.has(tool));
  if (conflict !== undefined) {
    issues.push({ field: 'tools', reason: `"${conflict}" is both allowed and denied` });
  }
  return issues;
}

export function resolveAgentSpec(
  base: ResolvedAgentSpec,
  spec: AgentSpec,
  defaultModel: string,
): ResolvedAgentSpec {
  const denied = new Set(spec.disallowedTools ?? []);
  const allowed = (spec.tools ?? base.allowedTools).filter((tool) => !denied.has(tool));
  return {
    name: spec.name,
    model: spec.model === undefined || spec.model === 'inherit' ? base.model || defaultModel : spec.model,
    permissionMode: spec.permissionMode ?? base.permissionMode,
    allowedTools: allowed,
    maxTurns: spec.maxTurns ?? base.maxTurns,
    autoCompactWindow: spec.autoCompactWindow ?? base.autoCompactWindow,
    hooks: spec.hooks ?? base.hooks,
  };
}
