import {
  DEFAULT_MAX_REVIEWS,
  DEFAULT_REVIEWER_TIMEOUT_MS,
  type ReviewerAnswer,
  type ReviewerLane,
  type ReviewerRequest,
} from './reviewerLane';
import { buildReviewerPrompt, parseReviewerAnswer } from './reviewerPrompt';
import { classifyReviewAsk } from './reviewerScope';
import {
  ReviewerSampleBudget,
  normalizeReviewerSamples,
  runReviewSampling,
  type ReviewerCheckpoint,
} from './reviewerSampling';

/**
 * The isolated reviewer: one ask in, one decision out.
 *
 * Isolation is structural, not a convention:
 *
 * - The only input is the `ReviewerRequest` (tool name, approval rule, display
 *   payload). No conversation, history, or workspace state is passed in.
 * - The model seam is its own interface, so the requester adapter is the only
 *   place that knows how a reviewer call is made (see `reviewerLaneService.ts`,
 *   which marks the request `isolated` so the main-conversation world state is
 *   neither consumed nor injected).
 * - The lane re-checks scope itself, so a caller that skips admission cannot
 *   use it to approve a shell, network, credential, or interactive ask.
 *
 * Resampling and the per-session sample budget live in `reviewerSampling.ts`;
 * the last checkpoint is exposed for status surfaces and tests.
 */

export interface ReviewerModelRequest {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly signal: AbortSignal;
}

/** The reviewer's model seam. One call, one bounded text answer. */
export interface ReviewerModel {
  complete(request: ReviewerModelRequest): Promise<string>;
}

export interface LlmReviewerLaneOptions {
  readonly model: ReviewerModel;
  /** Reviewer model alias; `undefined` uses the agent's primary model. */
  readonly modelAlias?: string;
  /** Review deadline; the admission path enforces it. Default 20s. */
  readonly timeoutMs?: number;
  /** Samples per review (1..3). Default 1. */
  readonly samples?: number;
  /** Characters kept from the rendered payload. Default 4_000. */
  readonly maxPromptChars?: number;
  /** Total samples this lane may spend. Default reviews × max samples. */
  readonly maxSamples?: number;
  /** Reviews per session used to derive the default sample budget. */
  readonly maxReviews?: number;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value >= 1 ? value : fallback;
}

export class LlmReviewerLane implements ReviewerLane {
  readonly timeoutMs: number;
  readonly modelAlias: string | undefined;
  private readonly model: ReviewerModel;
  private readonly samples: number;
  private readonly maxPromptChars: number | undefined;
  private readonly budget: ReviewerSampleBudget;
  private lastCheckpoint: ReviewerCheckpoint | undefined;

  constructor(options: LlmReviewerLaneOptions) {
    this.model = options.model;
    this.modelAlias = options.modelAlias;
    this.timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_REVIEWER_TIMEOUT_MS);
    this.samples = normalizeReviewerSamples(options.samples);
    this.maxPromptChars = options.maxPromptChars;
    const reviews = positiveInteger(options.maxReviews, DEFAULT_MAX_REVIEWS);
    this.budget = new ReviewerSampleBudget(
      positiveInteger(options.maxSamples, reviews * this.samples),
    );
  }

  async review(request: ReviewerRequest, signal: AbortSignal): Promise<ReviewerAnswer> {
    const scope = classifyReviewAsk(request.askKind ?? 'tool', request.display);
    if (!scope.reviewable) {
      this.lastCheckpoint = { attempts: [], decisive: false, truncated: false };
      return { kind: 'unclear', note: scope.why ?? 'outside reviewer scope' };
    }
    signal.throwIfAborted();
    const prompt = buildReviewerPrompt(request, { maxChars: this.maxPromptChars });
    const result = await runReviewSampling(
      () =>
        this.model.complete({
          systemPrompt: prompt.system,
          userPrompt: prompt.user,
          signal,
        }),
      parseReviewerAnswer,
      { samples: this.samples, budget: this.budget },
    );
    this.lastCheckpoint = result.checkpoint;
    return result.answer;
  }

  checkpoint(): ReviewerCheckpoint | undefined {
    return this.lastCheckpoint;
  }

  sampleState(): { readonly used: number; readonly remaining: number } {
    return this.budget.state();
  }
}