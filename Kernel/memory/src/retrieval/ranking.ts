import type { MemoryScopeTier, MemoryTrust } from '#/contracts/memoryTypes';
import type { RetrievalScoreComponents } from '#/contracts/retrieval';

export const LEXICAL_WEIGHT = 1;
export const MAX_REINFORCEMENT = 0.3;
export const REINFORCEMENT_WEIGHT = 0.1;

const TRUST_WEIGHT: Readonly<Record<MemoryTrust, number>> = Object.freeze({
  unverified: 0,
  trusted: 0.5,
  verified: 0.8,
  system: 1,
});

const SCOPE_WEIGHT: Readonly<Record<MemoryScopeTier, number>> = Object.freeze({
  global: 0,
  workspace: 0.1,
  repository: 0.2,
  session: 0.3,
  task: 0.2,
});

export function trustWeight(trust: MemoryTrust): number {
  return TRUST_WEIGHT[trust];
}

export function scopeWeight(tier: MemoryScopeTier): number {
  return SCOPE_WEIGHT[tier];
}

export function reinforcementWeight(accessCount: number): number {
  if (accessCount <= 0) return 0;
  return Math.min(MAX_REINFORCEMENT, REINFORCEMENT_WEIGHT * Math.log1p(accessCount));
}

export function normalizeLexical(scores: readonly number[]): ReadonlyMap<number, number> {
  const max = scores.reduce((best, score) => (score > best ? score : best), 0);
  const normalized = new Map<number, number>();
  if (max <= 0) {
    for (const score of scores) normalized.set(score, 0);
    return normalized;
  }
  for (const score of scores) normalized.set(score, score / max);
  return normalized;
}

export function composeScore(input: {
  readonly lexical: number;
  readonly trust: MemoryTrust;
  readonly scope: MemoryScopeTier;
  readonly accessCount: number;
}): RetrievalScoreComponents {
  const lexical = input.lexical * LEXICAL_WEIGHT;
  const trust = trustWeight(input.trust);
  const scope = scopeWeight(input.scope);
  const reinforcement = reinforcementWeight(input.accessCount);
  return {
    lexical,
    trust,
    scope,
    reinforcement,
    total: Number((lexical + trust + scope + reinforcement).toFixed(6)),
  };
}