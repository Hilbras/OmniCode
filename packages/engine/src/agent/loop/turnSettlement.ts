import type { FinishReason } from '#human/llm/finish-reason';

import { isOutputEscalationEnabled, shouldContinueTruncatedTurn } from './outputEscalation';
import { isStallGuardEnabled, shouldNudgeStalledTurn } from './stallGuard';

/**
 * Pure settlement decision extracted from AgentLoopService (WS2.2).
 *
 * The service owns every side effect (emit, notify, endTurn); this function
 * only orders the terminal conditions. Keeping the ordering here makes the
 * stall guard and truncation continuation auditable as a decision table and
 * stops the settle path from growing with each new terminal case.
 */
export type TurnSettleAction =
  | { readonly kind: 'recover-failed-step' }
  | { readonly kind: 'cancel'; readonly reason: unknown }
  | { readonly kind: 'fail-filtered' }
  | { readonly kind: 'fail-max-steps'; readonly error: unknown }
  | { readonly kind: 'fail-outcome'; readonly error: unknown }
  | { readonly kind: 'complete' }
  | { readonly kind: 'wait-for-nudge' }
  | { readonly kind: 'escalate-truncation' }
  | { readonly kind: 'nudge-stall'; readonly verification: boolean };

export interface TurnSettleInput {
  readonly outcome: 'done' | 'failed' | 'aborted';
  readonly failedStep: boolean;
  readonly abortReason: unknown;
  readonly aborted: boolean;
  readonly filtered: boolean;
  readonly failureError: unknown;
  readonly maxStepsError: unknown;
  readonly stopRequested: boolean;
  readonly toolStopRequested: boolean;
  readonly liveNudge: boolean;
  readonly lastStopReason: FinishReason | undefined;
  readonly outputEscalated: boolean;
  readonly lastFinalText: string;
  readonly stallNudges: number;
  readonly wroteFiles: boolean;
  readonly verifiedAfterWrite: boolean;
  readonly verificationNudged: boolean;
}

export function decideTurnSettlement(input: TurnSettleInput): TurnSettleAction {
  if (input.failedStep && input.abortReason === undefined && !input.aborted) {
    return { kind: 'recover-failed-step' };
  }
  if (input.abortReason !== undefined || input.aborted || input.outcome === 'aborted') {
    return { kind: 'cancel', reason: input.abortReason };
  }
  if (input.filtered) return { kind: 'fail-filtered' };
  if (input.maxStepsError !== undefined) return { kind: 'fail-max-steps', error: input.maxStepsError };
  if (input.stopRequested) return { kind: 'complete' };
  if (input.liveNudge) return { kind: 'wait-for-nudge' };
  if (input.toolStopRequested) return { kind: 'complete' };
  if (input.outcome === 'failed') return { kind: 'fail-outcome', error: input.failureError };

  if (
    shouldContinueTruncatedTurn({
      lastStopReason: input.lastStopReason,
      continued: input.outputEscalated,
      enabled: isOutputEscalationEnabled(),
      stopRequested: input.stopRequested,
      outcome: input.outcome,
    })
  ) return { kind: 'escalate-truncation' };

  const verification = input.wroteFiles && !input.verifiedAfterWrite && !input.verificationNudged;
  if (
    input.outcome === 'done' &&
    shouldNudgeStalledTurn({
      text: input.lastFinalText,
      nudgesUsed: input.stallNudges,
      enabled: isStallGuardEnabled(),
      unverifiedWrites: verification,
    })
  ) return { kind: 'nudge-stall', verification };

  return { kind: 'complete' };
}
