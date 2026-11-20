/**
 * Idle-judge orchestration around the goal verifier (unified plan A2).
 *
 * The verifier itself stays a pure evidence gate; this module owns the
 * orchestration that opencode wraps around it: boot-generation fencing,
 * per-goal round caps, background-aware `wait`, and a stale-goal watchdog.
 * Reference: opencode `packages/core/src/plugin/goal.ts:104-265`.
 */
export type JudgeVerdict = 'done' | 'continue' | 'blocked' | 'paused' | 'wait';

export interface IdleJudgeInput {
  readonly goalId: string;
  readonly bootId: string;
  readonly currentBoot: string;
  readonly rounds: number;
  readonly maxRounds: number;
  readonly lastReason: string | undefined;
  readonly usedTools: readonly string[];
  readonly backgroundTaskActive: boolean;
  readonly staleMs: number;
  readonly staleThresholdMs: number;
}

export interface IdleJudgeDecision {
  readonly kind: 'judge' | 'skip-stale-boot' | 'wait-background' | 'pause-stale' | 'exhausted';
  readonly reason: string;
}

function normalizeReason(reason: string | undefined): string {
  return (reason ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function hasStalled(lastReason: string | undefined, usedTools: readonly string[]): boolean {
  return normalizeReason(lastReason).length > 0 && usedTools.length === 0;
}

export function decideIdleJudge(input: IdleJudgeInput): IdleJudgeDecision {
  if (input.bootId !== input.currentBoot) {
    return { kind: 'skip-stale-boot', reason: 'judge record belongs to a previous boot' };
  }
  if (input.rounds >= input.maxRounds) {
    return { kind: 'exhausted', reason: 'judge round cap reached' };
  }
  if (input.staleMs >= input.staleThresholdMs) {
    if (input.backgroundTaskActive) {
      return { kind: 'wait-background', reason: 'background task will deliver a wake' };
    }
    return { kind: 'pause-stale', reason: 'goal wake never arrived within the watchdog window' };
  }
  return { kind: 'judge', reason: 'idle with a live goal' };
}

export type VerdictAction = 'complete' | 'continue' | 'pause' | 'wait';

export function applyJudgeVerdict(
  verdict: JudgeVerdict,
  stalled: boolean,
): VerdictAction {
  if (verdict === 'wait') return 'wait';
  if (verdict === 'done' && !stalled) return 'complete';
  if (verdict === 'paused' || verdict === 'blocked') return 'pause';
  return 'continue';
}
