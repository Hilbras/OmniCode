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
 */

export type ReviewerOutcome =
  | { readonly kind: 'approve'; readonly note?: string }
  | { readonly kind: 'defer'; readonly why: string };

export interface ReviewerRequest {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly fingerprint: string;
  readonly approvalRule: string;
  readonly display: unknown;
}

export interface ReviewerAnswer {
  readonly kind: 'approve' | 'reject' | 'unclear';
  readonly note?: string;
}

export interface ReviewerLane {
  review(request: ReviewerRequest, signal: AbortSignal): Promise<ReviewerAnswer>;
}

export interface ReviewerAdmissionInput {
  readonly decision: 'approve' | 'deny' | 'ask';
  readonly reason?: Readonly<Record<string, unknown>> | undefined;
  readonly policyName: string;
  readonly request: ReviewerRequest;
  /** Reviewer lane for this scope; `undefined` disables reviewing. */
  readonly lane: ReviewerLane | undefined;
  readonly timeoutMs?: number;
}

export const DEFAULT_REVIEWER_TIMEOUT_MS = 20_000;

/** True when the policy reason says only a human may decide. */
export function requiresHumanDecision(
  reason: Readonly<Record<string, unknown>> | undefined,
): boolean {
  return reason?.['requires_human'] === true;
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

  const timeoutMs =
    input.timeoutMs !== undefined && Number.isInteger(input.timeoutMs) && input.timeoutMs > 0
      ? input.timeoutMs
      : DEFAULT_REVIEWER_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // A lane that ignores its signal must still not hang the approval path.
    const answer = await raceWithAbort(lane.review(input.request, controller.signal), controller.signal);
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
