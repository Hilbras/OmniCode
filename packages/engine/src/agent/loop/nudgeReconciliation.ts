/**
 * Pure cursor arithmetic for draining consumed nudges (WS2.2).
 *
 * The machine reports a notification count for the turn it just ran; every
 * unreported nudge older than that count has been consumed. This module owns
 * the arithmetic so the side-effecting materialisation in AgentLoopService
 * cannot drift from the cursor bookkeeping.
 */
export interface NudgeDrainPlan {
  /** Number of unreported nudges to consume now. */
  readonly count: number;
  /** Cursor to store after consuming them. */
  readonly nextCursor: number;
}

export function planNudgeDrain(
  total: number,
  cursor: number,
  notificationCount: number,
): NudgeDrainPlan {
  const remaining = Math.max(0, total - Math.max(0, cursor));
  const count = Math.min(remaining, Math.max(0, remaining - Math.max(0, notificationCount)));
  return { count, nextCursor: Math.min(total, Math.max(0, cursor) + count) };
}
