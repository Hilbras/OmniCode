import type { FinishReason } from '#human/llm/finish-reason';

/**
 * Truncation continuation: when a turn's last model step ended `truncated`
 * with no tool calls, the loop continues the turn once so the model can
 * finish its cut-off text. The partial output is already in context history —
 * the continuation step is a fresh request that sees it, which is the
 * "keep accumulated text" property: nothing is discarded or re-derived.
 *
 * A cap raise is a separate question (the requester's
 * `escalateTurnOutput`): continuation never depends on one, because in the
 * default configuration the request budget already equals the model's
 * declared output limit and there is no headroom to raise into.
 */
export const OUTPUT_ESCALATION_ENV_KEY = 'OMNICODE_OUTPUT_ESCALATION';

/** Warning code for the observable event issued when a continuation arms. */
export const OUTPUT_ESCALATION_WARNING_CODE = 'output-escalation';

export function isOutputEscalationEnabled(env: NodeJS.ProcessEnv | undefined = process.env): boolean {
  const raw = env?.[OUTPUT_ESCALATION_ENV_KEY];
  if (raw === undefined) return true;
  const normalized = raw.trim().toLowerCase();
  return !(normalized === '0' || normalized === 'false');
}

export interface TruncationContinuationInput {
  readonly lastStopReason: FinishReason | undefined;
  /** A turn continues at most once; the flag is set before the notify. */
  readonly continued: boolean;
  readonly enabled: boolean;
  readonly stopRequested: boolean;
  /** Machine run outcome of the turn that just settled. */
  readonly outcome: 'done' | 'failed' | 'aborted';
}

/**
 * Pure decision: continue a turn that ended truncated. Only a `done` run
 * qualifies — a failed or aborted run has its own recovery path, and a
 * truncated step that requested a stop got what it asked for.
 */
export function shouldContinueTruncatedTurn(input: TruncationContinuationInput): boolean {
  if (!input.enabled) return false;
  if (input.continued) return false;
  if (input.stopRequested) return false;
  if (input.outcome !== 'done') return false;
  return input.lastStopReason === 'truncated';
}
