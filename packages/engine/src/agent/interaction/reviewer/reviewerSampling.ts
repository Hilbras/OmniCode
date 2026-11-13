import type { ReviewerAnswer } from './reviewerLane';

/**
 * Resampling and checkpoints for one reviewer decision.
 *
 * Resampling is the only defence against a single unlucky sample: when the
 * operator asks for more than one sample, every sample must agree before the
 * lane approves. A single explicit rejection stops the run immediately — a
 * negative signal is never averaged away — and a disagreement or an
 * unparseable answer defers to the user.
 *
 * The sample budget is the hard ceiling. Checkpoints are what make the spend
 * observable: each attempt is recorded, and an exhausted budget truncates the
 * run into `unclear` instead of approving on a partial sample set.
 */

export const MAX_REVIEWER_SAMPLES = 3;

export class ReviewerSampleBudget {
  private used = 0;

  constructor(readonly maxSamples: number) {}

  canSample(): boolean {
    return this.used < this.maxSamples;
  }

  take(): boolean {
    if (!this.canSample()) return false;
    this.used += 1;
    return true;
  }

  state(): { readonly used: number; readonly remaining: number } {
    return { used: this.used, remaining: Math.max(0, this.maxSamples - this.used) };
  }
}

export interface ReviewerSampleAttempt {
  readonly attempt: number;
  readonly answer: ReviewerAnswer;
}

export interface ReviewerCheckpoint {
  readonly attempts: readonly ReviewerSampleAttempt[];
  /** True when the run produced an approve or reject rather than a deferral. */
  readonly decisive: boolean;
  /** True when the sample budget ran out before the run finished. */
  readonly truncated: boolean;
}

export interface ReviewerSamplingOptions {
  /** Samples requested per review; normalized to 1..MAX_REVIEWER_SAMPLES. */
  readonly samples: number;
  readonly budget: ReviewerSampleBudget;
}

export interface ReviewerSamplingResult {
  readonly answer: ReviewerAnswer;
  readonly checkpoint: ReviewerCheckpoint;
}

export function normalizeReviewerSamples(samples: number | undefined): number {
  if (samples === undefined || !Number.isInteger(samples) || samples < 1) return 1;
  return Math.min(samples, MAX_REVIEWER_SAMPLES);
}

export async function runReviewSampling(
  sample: (attempt: number) => Promise<string>,
  parse: (text: string) => ReviewerAnswer,
  options: ReviewerSamplingOptions,
): Promise<ReviewerSamplingResult> {
  const samples = normalizeReviewerSamples(options.samples);
  const attempts: ReviewerSampleAttempt[] = [];
  let truncated = false;

  for (let attempt = 1; attempt <= samples; attempt += 1) {
    if (!options.budget.take()) {
      truncated = true;
      break;
    }
    const answer = parse(await sample(attempt));
    attempts.push({ attempt, answer });
    if (answer.kind === 'reject') {
      return { answer, checkpoint: { attempts, decisive: true, truncated: false } };
    }
  }

  const checkpoint = { attempts, decisive: false, truncated };
  if (truncated) {
    return {
      answer: { kind: 'unclear', note: 'reviewer sample budget exhausted' },
      checkpoint,
    };
  }
  const first = attempts[0];
  if (attempts.length !== samples || first === undefined) {
    return { answer: { kind: 'unclear', note: 'reviewer produced no sample' }, checkpoint };
  }
  const unanimous = attempts.every((entry) => entry.answer.kind === 'approve');
  if (!unanimous) {
    const mixed = attempts.some((entry) => entry.answer.kind === 'approve');
    const note = mixed
      ? 'reviewer samples disagreed'
      : (first.answer.note ?? 'reviewer answer unclear');
    return {
      answer: { kind: 'unclear', note },
      checkpoint,
    };
  }
  return {
    answer: { kind: 'approve', note: first.answer.note },
    checkpoint: { attempts, decisive: true, truncated: false },
  };
}