import type { ModelCapability } from './capability';

export interface FallbackCandidate {
  readonly id: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly capability?: ModelCapability;
  readonly available?: boolean;
  readonly ownsModel?: boolean;
}

export interface FallbackSelectionInput {
  readonly primaryId: string;
  readonly candidates: readonly FallbackCandidate[];
  readonly error: unknown;
  readonly triedIds?: readonly string[];
  readonly requiredCapability?: ModelCapability;
  readonly requireModelOwnership?: boolean;
}

export function selectFallbackCandidate(input: FallbackSelectionInput): FallbackCandidate | undefined {
  if (!isFallbackEligibleError(input.error)) return undefined;
  const tried = new Set(input.triedIds ?? []);
  tried.add(input.primaryId);
  for (const candidate of input.candidates) {
    if (tried.has(candidate.id)) continue;
    if (candidate.available === false) continue;
    if (input.requireModelOwnership === true && candidate.ownsModel === false) continue;
    if (!meetsCapability(input.requiredCapability, candidate.capability)) continue;
    return candidate;
  }
  return undefined;
}

export function isFallbackEligibleError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  if (name === 'AbortError') return false;
  if (name === 'APIProviderQuotaExhaustedError' || name === 'APIProviderRateLimitError') return true;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' && FALLBACK_STATUS_CODES.has(statusCode);
}

export function meetsCapability(
  required: ModelCapability | undefined,
  candidate: ModelCapability | undefined,
): boolean {
  if (required === undefined) return true;
  if (candidate === undefined) return false;
  if (required.image_in && !candidate.image_in) return false;
  if (required.video_in && !candidate.video_in) return false;
  if (required.audio_in && !candidate.audio_in) return false;
  if (required.thinking && !candidate.thinking) return false;
  if (required.tool_use && !candidate.tool_use) return false;
  if (required.dynamically_loaded_tools === true && candidate.dynamically_loaded_tools !== true) return false;
  if (required.max_input_tokens !== undefined) {
    const candidateLimit = candidate.max_input_tokens ?? candidate.max_context_tokens;
    if (candidateLimit > 0 && candidateLimit < required.max_input_tokens) return false;
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

const FALLBACK_STATUS_CODES = new Set([401, 403, 408, 409, 429, 500, 502, 503, 504, 529]);
