import type { ModelCapability } from '#/llm-adapter/contract/capability';
import type { ModelRecord } from '#/llm-adapter/model/model';

/**
 * Ordered fallback selection.
 *
 * This is the engine-side composition of the provider fallback seam: given the
 * model that just failed, the pool the operator has configured, and the models
 * already tried in this chain, it picks the next candidate or returns an honest
 * "nothing left" answer with the reason for every rejection.
 *
 * Invariants, not preferences:
 *
 * - A model already in the chain (including the primary) is never selected
 *   again, so a candidate that names another candidate cannot loop.
 * - A candidate must cover everything the primary was asked to do. Falling
 *   back from a tool-capable model to one without tool use, or to a smaller
 *   context window, would turn a provider outage into a broken turn, so
 *   capability loss is a rejection, not a silent degradation.
 * - Ownership is required by default: a model is only a fallback if its record
 *   names the provider or endpoint that serves it. Piggy-backing on the default
 *   provider is a guess about a provider the operator did not bind it to.
 * - Ranking is deterministic: capability match first, then explicit ownership,
 *   then configuration order. Nothing depends on map iteration luck.
 */

export type FallbackRejectionReason =
  | 'already-tried'
  | 'capability-mismatch'
  | 'not-owned'
  | 'circuit-open';

export interface FallbackCandidate {
  readonly alias: string;
  readonly providerName: string;
  readonly capability: ModelCapability;
  readonly owned: boolean;
  readonly circuitOpen?: boolean;
}

export interface FallbackCandidateVerdict {
  readonly alias: string;
  readonly providerName: string;
  readonly eligible: boolean;
  readonly capabilityScore: number;
  readonly rejections: readonly FallbackRejectionReason[];
}

export interface OrderedFallbackInput {
  readonly primaryAlias: string;
  readonly requiredCapability: ModelCapability;
  readonly candidates: readonly FallbackCandidate[];
  readonly triedAliases?: readonly string[];
  readonly requireOwnership?: boolean;
}

export interface FallbackSelection {
  readonly status: 'selected' | 'exhausted';
  readonly selected: string | undefined;
  readonly tried: readonly string[];
  readonly verdicts: readonly FallbackCandidateVerdict[];
}

export function declaresProviderOwnership(
  record: Pick<ModelRecord, 'providerId' | 'provider' | 'baseUrl'>,
): boolean {
  return [record.providerId, record.provider, record.baseUrl].some(
    (value) => typeof value === 'string' && value.trim().length > 0,
  );
}

export function capabilityScore(
  required: ModelCapability,
  candidate: ModelCapability,
): number {
  let score = 0;
  if (required.image_in && candidate.image_in) score += 1;
  if (required.video_in && candidate.video_in) score += 1;
  if (required.audio_in && candidate.audio_in) score += 1;
  if (required.thinking && candidate.thinking) score += 1;
  if (required.tool_use && candidate.tool_use) score += 1;
  if (required.dynamically_loaded_tools === true && candidate.dynamically_loaded_tools === true) {
    score += 1;
  }
  const requiredInput = required.max_input_tokens;
  if (requiredInput !== undefined) {
    const candidateInput = candidate.max_input_tokens ?? candidate.max_context_tokens;
    if (candidateInput >= requiredInput) score += 1;
  }
  if (
    required.max_context_tokens > 0 &&
    candidate.max_context_tokens >= required.max_context_tokens
  ) {
    score += 1;
  }
  return score;
}

export function capabilityCovers(
  required: ModelCapability,
  candidate: ModelCapability,
): boolean {
  if (required.image_in && !candidate.image_in) return false;
  if (required.video_in && !candidate.video_in) return false;
  if (required.audio_in && !candidate.audio_in) return false;
  if (required.thinking && !candidate.thinking) return false;
  if (required.tool_use && !candidate.tool_use) return false;
  if (required.dynamically_loaded_tools === true && candidate.dynamically_loaded_tools !== true) {
    return false;
  }
  const requiredInput = required.max_input_tokens;
  if (requiredInput !== undefined) {
    const candidateInput = candidate.max_input_tokens ?? candidate.max_context_tokens;
    if (candidateInput > 0 && candidateInput < requiredInput) return false;
  }
  if (
    required.max_context_tokens > 0 &&
    candidate.max_context_tokens > 0 &&
    candidate.max_context_tokens < required.max_context_tokens
  ) {
    return false;
  }
  return true;
}

export function selectOrderedFallback(input: OrderedFallbackInput): FallbackSelection {
  const tried = new Set<string>(input.triedAliases ?? []);
  tried.add(input.primaryAlias);
  const requireOwnership = input.requireOwnership ?? true;
  const seen = new Set<string>();
  const verdicts: FallbackCandidateVerdict[] = [];
  const eligible: {
    readonly verdict: FallbackCandidateVerdict;
    readonly index: number;
    readonly owned: number;
  }[] = [];

  input.candidates.forEach((candidate, index) => {
    const rejections: FallbackRejectionReason[] = [];
    const duplicate = seen.has(candidate.alias);
    seen.add(candidate.alias);
    if (tried.has(candidate.alias) || duplicate) rejections.push('already-tried');
    const score = capabilityScore(input.requiredCapability, candidate.capability);
    if (!capabilityCovers(input.requiredCapability, candidate.capability)) {
      rejections.push('capability-mismatch');
    }
    if (requireOwnership && !candidate.owned) rejections.push('not-owned');
    if (candidate.circuitOpen === true) rejections.push('circuit-open');
    const verdict: FallbackCandidateVerdict = {
      alias: candidate.alias,
      providerName: candidate.providerName,
      eligible: rejections.length === 0,
      capabilityScore: score,
      rejections,
    };
    verdicts.push(verdict);
    if (verdict.eligible) eligible.push({ verdict, index, owned: candidate.owned ? 1 : 0 });
  });

  eligible.sort((left, right) => {
    const score = right.verdict.capabilityScore - left.verdict.capabilityScore;
    if (score !== 0) return score;
    const ownership = right.owned - left.owned;
    if (ownership !== 0) return ownership;
    return left.index - right.index;
  });

  const selected = eligible[0]?.verdict.alias;
  return {
    status: selected === undefined ? 'exhausted' : 'selected',
    selected,
    tried: [...tried],
    verdicts,
  };
}