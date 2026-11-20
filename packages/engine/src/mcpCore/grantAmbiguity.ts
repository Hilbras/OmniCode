/**
 * MCP grant ambiguity closure (unified plan B2).
 *
 * A lossy tool-name spelling may restrict every claimant but may never grant to
 * them: an allow rule is refused when more than one registered tool claims the
 * normalized name. Reference: qwen `packages/core/src/permissions/rule-parser.ts:1809-1887`.
 */
export interface ToolClaim {
  readonly name: string;
  readonly server: string;
  readonly aliases?: readonly string[];
}

export interface GrantRule {
  readonly pattern: string;
  readonly decision: 'allow' | 'deny';
}

export function normalizeToolName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^mcp__/, '')
    .replace(/[.\-\s]+/g, '_')
    .replace(/_+/g, '_');
}

export function spellings(claim: ToolClaim): readonly string[] {
  const names = [claim.name, ...(claim.aliases ?? [])];
  const out = new Set<string>();
  for (const name of names) {
    out.add(name);
    out.add(normalizeToolName(name));
    out.add(`mcp__${claim.server}__${name}`);
  }
  return [...out];
}

export interface GrantResolution {
  readonly status: 'granted' | 'denied' | 'refused-ambiguous' | 'no-match';
  readonly claimants: readonly string[];
  readonly reason: string;
}

export function resolveGrantAmbiguity(
  rule: GrantRule,
  claims: readonly ToolClaim[],
): GrantResolution {
  const target = normalizeToolName(rule.pattern.replace(/^mcp__/, ''));
  const matching = claims.filter((claim) => spellings(claim).some((name) => normalizeToolName(name) === target));
  const claimants = matching.map((claim) => claim.name);

  if (matching.length === 0) {
    return { status: 'no-match', claimants, reason: 'no tool claims this name' };
  }
  if (rule.decision === 'deny') {
    return { status: 'denied', claimants, reason: 'deny applies to every claimant' };
  }
  if (matching.length > 1) {
    return {
      status: 'refused-ambiguous', claimants,
      reason: 'allow rule refused: multiple tools claim the normalized name',
    };
  }
  return { status: 'granted', claimants, reason: 'unique claimant' };
}
