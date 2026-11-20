/**
 * Write-ahead execution claim (unified plan A5).
 *
 * Before a busy-period side effect the session records a durable claim with a
 * bounded lease; on boot a claimed session is resumed with an explicit
 * continuation instruction. An advisory wake is not itself crash recovery.
 * Reference: opencode `specs/v2/session.md:68,116`.
 */
export interface ClaimInput {
  readonly sessionId: string;
  readonly turnId: number;
  readonly bootId: string;
  readonly now: number;
  readonly leaseMs: number;
  readonly existing: ExecutionClaim | undefined;
  readonly claimedAtOverride?: number;
}

export interface ExecutionClaim {
  readonly claimId: string;
  readonly sessionId: string;
  readonly turnId: number;
  readonly bootId: string;
  readonly claimedAt: number;
  readonly expiresAt: number;
  readonly toolCallDurable: boolean;
}

export type ClaimDecision =
  | { readonly kind: 'claim'; readonly reason: string }
  | { readonly kind: 'reclaim'; readonly reason: string }
  | { readonly kind: 'held'; readonly reason: string };

export const DEFAULT_CLAIM_LEASE_MS = 30_000;

export function decideExecutionClaim(input: ClaimInput): ClaimDecision {
  const existing = input.existing;
  if (existing === undefined) {
    return { kind: 'claim', reason: 'no prior claim' };
  }
  if (existing.sessionId !== input.sessionId || existing.turnId !== input.turnId) {
    return { kind: 'claim', reason: 'claim belongs to a different execution' };
  }
  if (existing.bootId === input.bootId && existing.expiresAt > input.now) {
    return { kind: 'held', reason: 'claim is live in this boot' };
  }
  return { kind: 'reclaim', reason: 'claim expired or belongs to a previous boot' };
}

export function createExecutionClaim(
  input: ClaimInput,
  decision: ClaimDecision,
): ExecutionClaim | undefined {
  if (decision.kind === 'held') return undefined;
  const lease = Math.max(Math.trunc(input.leaseMs || DEFAULT_CLAIM_LEASE_MS), 1);
  return {
    claimId: `${input.sessionId}:${String(input.turnId)}:${String(input.claimedAtOverride ?? input.now)}`,
    sessionId: input.sessionId,
    turnId: input.turnId,
    bootId: input.bootId,
    claimedAt: input.now,
    expiresAt: input.now + lease,
    toolCallDurable: true,
  };
}

export const DURABLE_CONTINUATION_INSTRUCTION =
  'Resume the claimed session from its durable record. An advisory wake is not itself crash recovery: verify the recorded tool call before executing side effects.';

export function recoveryInstruction(claim: ExecutionClaim | undefined): string | undefined {
  if (claim === undefined || !claim.toolCallDurable) return undefined;
  return DURABLE_CONTINUATION_INSTRUCTION;
}
