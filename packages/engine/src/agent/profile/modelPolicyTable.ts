/**
 * Per-model prompt/policy table (WS4.11 / C12).
 *
 * Model-specific instruction overlays and policy flags live in one typed table
 * instead of scattered hardcoded constants, so a generator can own them and a
 * validator can reject weakening entries. The most specific pattern wins;
 * exact model ids beat prefixes, which beat the wildcard default.
 */
export interface ModelPromptPolicy {
  readonly id: string;
  /** Exact model id, prefix ending in `*`, or `*`. */
  readonly match: string;
  readonly promptOverlay?: string;
  readonly allowParallelTools?: boolean;
  readonly requireVerification?: boolean;
}

export interface ModelPolicyIssue {
  readonly id: string;
  readonly reason: 'duplicate-id' | 'empty-overlay' | 'weakening-flag' | 'invalid-match';
  readonly detail: string;
}

export function validateModelPolicyTable(
  table: readonly ModelPromptPolicy[],
): readonly ModelPolicyIssue[] {
  const issues: ModelPolicyIssue[] = [];
  const ids = new Set<string>();
  for (const entry of table) {
    if (ids.has(entry.id)) {
      issues.push({ id: entry.id, reason: 'duplicate-id', detail: 'duplicate policy id' });
    }
    ids.add(entry.id);
    if (entry.match.length === 0 || (entry.match !== '*' && !/^[\w./*:-]+$/.test(entry.match))) {
      issues.push({ id: entry.id, reason: 'invalid-match', detail: `invalid match "${entry.match}"` });
    }
    if (entry.promptOverlay !== undefined && entry.promptOverlay.trim().length === 0) {
      issues.push({ id: entry.id, reason: 'empty-overlay', detail: 'prompt overlay is blank' });
    }
    if (entry.allowParallelTools === true && entry.requireVerification === false) {
      issues.push({
        id: entry.id, reason: 'weakening-flag',
        detail: 'parallel tools without verification weakens the stop gate',
      });
    }
  }
  return issues;
}

function specificity(match: string): number {
  if (match === '*') return 0;
  return match.endsWith('*') ? 1 : 2;
}

function matches(match: string, modelId: string): boolean {
  if (match === '*') return true;
  if (match.endsWith('*')) return modelId.startsWith(match.slice(0, -1));
  return match === modelId;
}

/** Resolves the most specific applicable policy, or `undefined` for no table entry. */
export function resolveModelPolicy(
  table: readonly ModelPromptPolicy[],
  modelId: string,
): ModelPromptPolicy | undefined {
  return table
    .filter((entry) => matches(entry.match, modelId))
    .sort((a, b) => specificity(b.match) - specificity(a.match) || b.match.length - a.match.length)[0];
}

export const DEFAULT_MODEL_POLICY_TABLE: readonly ModelPromptPolicy[] = [
  { id: 'default', match: '*', requireVerification: true, allowParallelTools: false },
  { id: 'anthropic', match: 'claude-*', requireVerification: true, allowParallelTools: true },
  { id: 'openai', match: 'gpt-*', requireVerification: true, allowParallelTools: true },
];
