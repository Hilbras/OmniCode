/**
 * Approval floors and turn liveness (unified plan B4).
 *
 * Certain actions require confirmation regardless of permission mode; a bypass
 * request can never relax them. A generation-bound liveness watchdog stops a
 * turn that has not produced progress within its window.
 * References: Hermes `tools/approval_floors.py:1-53`, `agent/turn_liveness.py:23-25,90-140`.
 */
export type PermissionMode = 'manual' | 'auto' | 'yolo';

export interface ApprovalFloor {
  readonly pattern: string;
  readonly reason: string;
}

export interface FloorInput {
  readonly mode: PermissionMode;
  readonly toolName: string;
  readonly bypassRequested: boolean;
  readonly floors: readonly ApprovalFloor[];
}

export type FloorDecision =
  | { readonly kind: 'proceed'; readonly reason: string }
  | { readonly kind: 'must-ask'; readonly reason: string };

function matchesPattern(pattern: string, toolName: string): boolean {
  if (pattern === toolName) return true;
  if (!pattern.includes('*')) return false;
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`).test(toolName);
}

export function evaluateApprovalFloor(input: FloorInput): FloorDecision {
  const floor = input.floors.find((candidate) => matchesPattern(candidate.pattern, input.toolName));
  if (floor !== undefined) {
    return { kind: 'must-ask', reason: `approval floor: ${floor.reason}` };
  }
  return { kind: 'proceed', reason: `no floor for ${input.toolName}` };
}

export interface LivenessState {
  readonly generation: number;
  readonly observedGeneration: number;
  readonly lastProgressAt: number;
  readonly now: number;
  readonly timeoutMs: number;
}

export type LivenessDecision =
  | { readonly kind: 'alive'; readonly reason: string }
  | { readonly kind: 'watchdog'; readonly reason: string };

export function decideLiveness(state: LivenessState): LivenessDecision {
  if (state.generation !== state.observedGeneration) {
    return { kind: 'watchdog', reason: 'turn generation changed without observed progress' };
  }
  if (state.now - state.lastProgressAt >= state.timeoutMs) {
    return { kind: 'watchdog', reason: 'no progress within the liveness window' };
  }
  return { kind: 'alive', reason: 'progress within the liveness window' };
}
