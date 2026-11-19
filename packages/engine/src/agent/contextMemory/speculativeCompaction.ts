/**
 * Speculative background compaction (WS5.1).
 *
 * Compiles a summary before the token ceiling is reached, but installs it only
 * on demand: a compiled artifact whose source fingerprint no longer matches
 * is stale and must not be injected. Independent of the WS3.1 message clock —
 * this is a token-threshold mechanism.
 */
export interface SpeculativeCompactionState {
  readonly tokens: number;
  readonly triggerTokens: number;
  readonly fingerprint: string;
}

export type SpeculativeAction = 'idle' | 'compile' | 'install';

export interface SpeculativeDecision {
  readonly action: SpeculativeAction;
  readonly reason: string;
}

export interface CompiledSummary {
  readonly fingerprint: string;
  readonly text: string;
  readonly compiledAt: number;
}

export const DEFAULT_SPECULATIVE_RATIO = 0.7;

export function decideSpeculativeCompaction(
  state: SpeculativeCompactionState,
  compiled: CompiledSummary | undefined,
  ratio = DEFAULT_SPECULATIVE_RATIO,
): SpeculativeDecision {
  const threshold = Math.max(1, Math.trunc(state.triggerTokens * Math.min(Math.max(ratio, 0), 1)));
  if (compiled !== undefined && compiled.fingerprint === state.fingerprint) {
    return { action: 'install', reason: 'compiled summary matches the current context' };
  }
  if (state.tokens >= state.triggerTokens) {
    return { action: 'compile', reason: 'token ceiling reached now' };
  }
  if (state.tokens >= threshold) {
    return { action: 'compile', reason: 'approaching the token ceiling' };
  }
  return { action: 'idle', reason: 'below the speculative threshold' };
}

export function isCompiledSummaryFresh(
  compiled: CompiledSummary | undefined,
  fingerprint: string,
): boolean {
  return compiled !== undefined && compiled.fingerprint === fingerprint && compiled.text.length > 0;
}
