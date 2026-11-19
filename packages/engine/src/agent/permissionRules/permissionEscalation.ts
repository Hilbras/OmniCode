import type { PermissionRule } from './permissionRules';

/**
 * In-band permission escalation planner (WS4.3).
 *
 * A tool may ask for more room, but the request is intersected with the active
 * profile's tool allowlist and can never weaken an existing rule. Project and
 * user-scoped rules are out of band: they outlive this session and must come
 * from configuration, not from a tool call.
 */
export type EscalationRejectionReason =
  | 'tool-not-in-profile'
  | 'outside-session-scope'
  | 'weaken-existing-deny'
  | 'invalid-pattern';

export interface EscalationRejection {
  readonly rule: PermissionRule;
  readonly reason: EscalationRejectionReason;
  readonly detail: string;
}

export interface EscalationPlan {
  readonly accepted: readonly PermissionRule[];
  readonly rejected: readonly EscalationRejection[];
}

export interface EscalationInput {
  readonly requested: readonly PermissionRule[];
  /** Active profile tool names; `mcp__*` wildcards are honoured. */
  readonly allowedTools: readonly string[];
  readonly existingRules: readonly PermissionRule[];
}

/** The leading tool name of a rule pattern, e.g. `Bash(npm test)` -> `Bash`. */
export function ruleToolName(pattern: string): string | undefined {
  const match = /^([A-Za-z_][\w-]*)/.exec(pattern.trim());
  return match?.[1];
}

function inProfile(tool: string, allowedTools: readonly string[]): boolean {
  return allowedTools.some((allowed) =>
    allowed.endsWith('*') ? tool.startsWith(allowed.slice(0, -1)) : allowed === tool,
  );
}

function weakensDeny(rule: PermissionRule, existing: readonly PermissionRule[]): boolean {
  if (rule.decision !== 'allow') return false;
  const tool = ruleToolName(rule.pattern);
  return existing.some((candidate) => {
    if (candidate.decision !== 'deny') return false;
    return candidate.pattern === rule.pattern || ruleToolName(candidate.pattern) === tool;
  });
}

export function planPermissionEscalation(input: EscalationInput): EscalationPlan {
  const accepted: PermissionRule[] = [];
  const rejected: EscalationRejection[] = [];
  const existing = [...input.existingRules, ...accepted];

  for (const rule of input.requested) {
    if (rule.scope !== 'turn-override' && rule.scope !== 'session-runtime') {
      rejected.push({
        rule, reason: 'outside-session-scope',
        detail: `scope "${rule.scope}" outlives this session; configure it out of band`,
      });
      continue;
    }
    const tool = ruleToolName(rule.pattern);
    if (tool === undefined) {
      rejected.push({ rule, reason: 'invalid-pattern', detail: 'pattern has no tool name' });
      continue;
    }
    if (!inProfile(tool, input.allowedTools)) {
      rejected.push({
        rule, reason: 'tool-not-in-profile',
        detail: `tool "${tool}" is not in the active profile allowlist`,
      });
      continue;
    }
    if (weakensDeny(rule, existing)) {
      rejected.push({
        rule, reason: 'weaken-existing-deny',
        detail: `an existing deny already covers "${tool}"; refusing to weaken it`,
      });
      continue;
    }
    accepted.push(rule);
    existing.push(rule);
  }

  return { accepted, rejected };
}
