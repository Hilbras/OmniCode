/**
 * Reviewer lane admission.
 *
 * The reviewer is an automated second opinion for approvals that the current
 * mode would otherwise hand to the user. It is an *approval resolver*, not a
 * policy: it can only ever turn an `ask` into an outcome, and it can never
 * change a decision that came from a rule. That shape is what keeps it safe:
 *
 * - `approve`/`deny` evaluated by the policy chain are final. A reviewer never
 *   sees them, so it cannot un-deny a sensitive-file rule or bypass a
 *   `forbidden` exec rule.
 * - An ask marked `requires_human: true` (exec-policy `prompt-user`) is never
 *   offered to the reviewer. Human-required means human.
 * - Anything that fails, times out, or answers ambiguously is `defer`: the ask
 *   goes to the user exactly as before. There is no fail-open path.
 * - A reviewer answer of `approve` is honoured only for the exact tool call it
 *   was asked about (`toolCallId` + argument fingerprint), so a stale answer
 *   cannot land on a different call.
 * - Only a `fallback-ask` origin and a local read/write surface are in scope
 *   (`reviewerScope.ts`). Boundary asks stay human even when their payload
 *   looks harmless.
 */

import {
  REVIEWABLE_POLICY_ORIGINS,
  classifyReviewAsk,
  type ReviewerAskKind,
} from './reviewerScope';

export type ReviewerOutcome =
  | { readonly kind: 'approve'; readonly note?: string }
  | { readonly kind: 'defer'; readonly why: string };

export interface ReviewerRequest {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly fingerprint: string;
  readonly approvalRule: string;
  readonly display: unknown;
  /** What is being approved; defaults to a tool approval. */
  readonly askKind?: ReviewerAskKind;
}

export interface ReviewerAnswer {
  readonly kind: 'approve' | 'reject' | 'unclear';
  readonly note?: string;
}

export interface ReviewerLane {
  /** Deadline the lane asks the admission path to enforce, when it has one. */
  readonly timeoutMs?: number;
  /**
   * When true, the lane may adjudicate `auto-mode-classifier` asks for the
   * surfaces `reviewerScope` already admits (local reads/writes/diffs). Shell,
   * network, credential, and human-required asks still defer.
   */
  readonly allowAutoMode?: boolean;
  review(request: ReviewerRequest, signal: AbortSignal): Promise<ReviewerAnswer>;
}

/**
 * Caps how many reviews one session can spend, and trips a breaker after a
 * run of failures so a broken reviewer stops costing latency on every ask.
 *
 * Budget is a hard ceiling, not a hint: once exhausted, every ask defers to
 * the user. The breaker needs a *consecutive* run of refusals to open (a
 * timeout, an error, an unclear answer), and resets on any real decision, so
 * one flaky review does not disable the lane for the session.
 */
export interface ReviewerGuardOptions {
  /** Reviews allowed per session. Default 20. */
  readonly maxReviews?: number;
  /** Consecutive failed reviews before the breaker opens. Default 3. */
  readonly failureThreshold?: number;
}

export interface ReviewerGuardState {
  readonly used: number;
  readonly remaining: number;
  readonly consecutiveFailures: number;
  readonly open: boolean;
}

export class ReviewerGuard {
  private used = 0;
  private consecutiveFailures = 0;
  private readonly maxReviews: number;
  private readonly failureThreshold: number;

  constructor(options: ReviewerGuardOptions = {}) {
    this.maxReviews = positive(options.maxReviews, DEFAULT_MAX_REVIEWS);
    this.failureThreshold = positive(options.failureThreshold, DEFAULT_FAILURE_THRESHOLD);
  }

  /** True when a review may be attempted at all. */
  canReview(): boolean {
    return !this.open() && this.used < this.maxReviews;
  }

  open(): boolean {
    return this.consecutiveFailures >= this.failureThreshold;
  }

  /** Counts an attempt; call once per `admitReviewer` that reaches the lane. */
  begin(): void {
    this.used += 1;
  }

  /** A decisive reviewer answer (approve or reject) clears the failure run. */
  settle(decisive: boolean): void {
    this.consecutiveFailures = decisive ? 0 : this.consecutiveFailures + 1;
  }

  state(): ReviewerGuardState {
    return {
      used: this.used,
      remaining: Math.max(0, this.maxReviews - this.used),
      consecutiveFailures: this.consecutiveFailures,
      open: this.open(),
    };
  }
}

export const DEFAULT_MAX_REVIEWS = 20;
export const DEFAULT_FAILURE_THRESHOLD = 3;

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value >= 1 ? value : fallback;
}

export interface ReviewerAdmissionInput {
  readonly decision: 'approve' | 'deny' | 'ask';
  readonly reason?: Readonly<Record<string, unknown>> | undefined;
  readonly policyName: string;
  readonly request: ReviewerRequest;
  /** Reviewer lane for this scope; `undefined` disables reviewing. */
  readonly lane: ReviewerLane | undefined;
  readonly timeoutMs?: number;
  /** Budget/breaker for this lane; when omitted the lane is unthrottled. */
  readonly guard?: ReviewerGuard;
}

export const DEFAULT_REVIEWER_TIMEOUT_MS = 20_000;

/** True when the policy reason says only a human may decide. */
export function requiresHumanDecision(
  reason: Readonly<Record<string, unknown>> | undefined,
): boolean {
  return reason?.['requires_human'] === true;
}

/**
 * Why an ask may not be reviewed, or `undefined` when it is in scope. Kept
 * separate so the admission path and a lane called directly agree.
 */
export function reviewerOutOfScope(
  request: ReviewerRequest,
  policyName: string,
  allowAutoMode = false,
): { readonly why: string } | undefined {
  const askKind = request.askKind ?? 'tool';
  const reviewableOrigin =
    REVIEWABLE_POLICY_ORIGINS.has(policyName) ||
    (allowAutoMode && policyName === 'auto-mode-classifier');
  if (askKind === 'tool' && !reviewableOrigin) {
    return { why: `policy ${policyName} is not reviewable` };
  }
  const scope = classifyReviewAsk(askKind, request.display);
  if (scope.reviewable) return undefined;
  return { why: scope.why ?? 'outside reviewer scope' };
}

export async function admitReviewer(input: ReviewerAdmissionInput): Promise<ReviewerOutcome> {
  if (input.decision !== 'ask') {
    return { kind: 'defer', why: `policy ${input.policyName} decided ${input.decision}` };
  }
  if (requiresHumanDecision(input.reason)) {
    return { kind: 'defer', why: 'approval requires a human decision' };
  }
  const lane = input.lane;
  if (lane === undefined) return { kind: 'defer', why: 'no reviewer configured' };
  const outOfScope = reviewerOutOfScope(input.request, input.policyName, lane.allowAutoMode === true);
  if (outOfScope !== undefined) {
    return { kind: 'defer', why: `outside reviewer scope: ${outOfScope.why}` };
  }
  const guard = input.guard;
  if (guard !== undefined && !guard.canReview()) {
    return {
      kind: 'defer',
      why: guard.state().open ? 'reviewer circuit open' : 'reviewer budget exhausted',
    };
  }
  guard?.begin();

  const requestedTimeout = input.timeoutMs ?? lane.timeoutMs;
  const timeoutMs =
    requestedTimeout !== undefined && Number.isInteger(requestedTimeout) && requestedTimeout > 0
      ? requestedTimeout
      : DEFAULT_REVIEWER_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // A lane that ignores its signal must still not hang the approval path.
    const answer = await raceWithAbort(lane.review(input.request, controller.signal), controller.signal);
    guard?.settle(answer.kind !== 'unclear');
    if (answer.kind === 'approve') {
      return answer.note === undefined
        ? { kind: 'approve' }
        : { kind: 'approve', note: answer.note };
    }
    return {
      kind: 'defer',
      why: answer.kind === 'reject' ? 'reviewer declined; asking the user' : 'reviewer answer unclear',
    };
  } catch (error) {
    guard?.settle(false);
    const timedOut = controller.signal.aborted;
    return {
      kind: 'defer',
      why: timedOut ? `reviewer timed out after ${String(timeoutMs)}ms` : `reviewer failed: ${String(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('reviewer aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error('reviewer aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
