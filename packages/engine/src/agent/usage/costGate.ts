import { UsageError, UsageErrors } from './usage';

/**
 * Pre-call cost gate.
 *
 * A budget that is only checked after the call has already been paid for is a
 * report, not a limit. This guard is consulted *before* a request is issued: it
 * projects the cheapest plausible cost of the call (prompt tokens at the input
 * rate, plus one output token so a zero-output model still moves the meter),
 * and refuses the call when the spend so far plus that projection is already
 * over the limit.
 *
 * The projection is deliberately a lower bound. It cannot stop a call that
 * starts under budget and ends over it — nothing can — so the refusal message
 * says the budget was already spent, and the caller still records actual cost
 * after the call for the overshoot accounting.
 */

export type CostModelPricing = {
  readonly inputPerMillionUsd: number;
  readonly outputPerMillionUsd: number;
};

export interface CostSoFar {
  readonly spentUsd: number;
  /** True when any recorded call had no known price; the meter under-counts. */
  readonly unknownPricing: boolean;
}

export interface PreCallCostCheck {
  readonly modelId: string;
  readonly pricing: CostModelPricing | undefined;
  readonly promptTokens: number;
  readonly spent: CostSoFar;
  readonly limitUsd: number;
}

export interface PreCallCostVerdict {
  readonly allowed: boolean;
  readonly projectedUsd: number;
  readonly remainingUsd: number;
  readonly reason?: 'over-budget' | 'unknown-pricing';
}

/** Minimum spend a call can incur; used so an empty prompt is still priced. */
const MIN_OUTPUT_TOKENS = 1;

export function projectedCallCost(
  pricing: CostModelPricing,
  promptTokens: number,
): number {
  const tokens = Math.max(0, Math.floor(promptTokens));
  return (
    (tokens / 1_000_000) * pricing.inputPerMillionUsd +
    (MIN_OUTPUT_TOKENS / 1_000_000) * pricing.outputPerMillionUsd
  );
}

export function checkPreCallCost(check: PreCallCostCheck): PreCallCostVerdict {
  const remainingUsd = Math.max(0, check.limitUsd - check.spent.spentUsd);
  if (check.pricing === undefined) {
    // Unknown price is not a refusal: the model may be free or on a plan. The
    // verdict says so so the caller can surface it and keep the meter honest.
    return { allowed: true, projectedUsd: 0, remainingUsd, reason: 'unknown-pricing' };
  }
  const projectedUsd = projectedCallCost(check.pricing, check.promptTokens);
  if (check.spent.spentUsd + projectedUsd > check.limitUsd) {
    return { allowed: false, projectedUsd, remainingUsd, reason: 'over-budget' };
  }
  return { allowed: true, projectedUsd, remainingUsd };
}

/** Thrown before the request when the budget is already exhausted. */
export function assertPreCallCost(check: PreCallCostCheck): PreCallCostVerdict {
  const verdict = checkPreCallCost(check);
  if (!verdict.allowed) {
    throw new UsageError(
      UsageErrors.codes.BUDGET_EXCEEDED,
      `Cost budget exhausted: spent ${check.spent.spentUsd.toFixed(4)} USD of ${check.limitUsd.toFixed(4)}; ` +
        `the next call to ${check.modelId} would start at ${verdict.projectedUsd.toFixed(4)} USD. ` +
        'Raise the budget limit or switch to a cheaper model before retrying.',
      {
        modelId: check.modelId,
        spentUsd: check.spent.spentUsd,
        limitUsd: check.limitUsd,
        projectedUsd: verdict.projectedUsd,
      },
    );
  }
  return verdict;
}
