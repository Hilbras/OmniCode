/**
 * Agent residency for tower/subagents (WS4.10).
 *
 * An idle subagent can be unloaded to free runtime capacity, but its mailbox
 * is durable state: pending mail must keep the agent resident until delivered,
 * and unloading must never discard it. Residence decisions are pure so the
 * lifecycle host cannot accidentally evict an agent with unread work.
 */
export interface ResidencyState {
  readonly agentId: string;
  readonly lastActiveAt: number;
  readonly pendingMail: number;
  readonly runningToolCalls: number;
}

export const DEFAULT_IDLE_UNLOAD_MS = 5 * 60_000;

export type ResidencyDecision =
  | { readonly kind: 'keep'; readonly reason: string }
  | { readonly kind: 'unload'; readonly reason: string };

export function decideResidency(
  state: ResidencyState,
  now: number,
  idleMs = DEFAULT_IDLE_UNLOAD_MS,
): ResidencyDecision {
  if (state.runningToolCalls > 0) {
    return { kind: 'keep', reason: 'tool calls are still running' };
  }
  if (state.pendingMail > 0) {
    return { kind: 'keep', reason: 'unread mail must be delivered before unload' };
  }
  if (now - state.lastActiveAt < idleMs) {
    return { kind: 'keep', reason: 'idle window has not elapsed' };
  }
  return { kind: 'unload', reason: 'idle with no pending mail or running tools' };
}

export interface ResidencyRecord {
  readonly agentId: string;
  readonly unloadedAt: number;
  readonly preservedMail: number;
}

export function unloadAgent(state: ResidencyState, now: number): ResidencyRecord {
  const decision = decideResidency(state, now, 0);
  if (decision.kind !== 'unload') {
    throw new Error(`Cannot unload ${state.agentId}: ${decision.reason}`);
  }
  return { agentId: state.agentId, unloadedAt: now, preservedMail: state.pendingMail };
}
