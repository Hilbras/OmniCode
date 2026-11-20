/**
 * Verified-progress-gated runaway reminders (unified plan C4).
 *
 * A runaway pattern is only worth interrupting the model when host-owned
 * evidence says no verified progress was made; the reminder is emitted at most
 * once per run and explicitly forbids promotion to memory or skills.
 * Reference: minimax `runaway-guard/src/{contracts,reminder}.ts`.
 */
export type RunawaySignalKind =
  | 'exact-repeat'
  | 'same-error-family'
  | 'aba-cycle'
  | 'polling-repeat'
  | 'unchanged-progress';

export interface RunawayInput {
  readonly signals: readonly RunawaySignalKind[];
  readonly verifiedProgress: boolean;
  readonly trustedToolProvenance: boolean;
  readonly emittedThisRun: boolean;
  readonly minSignals: number;
}

export interface RunawayDecision {
  readonly emit: boolean;
  readonly reason: string;
}

export const RUNAWAY_REMINDER_TEXT =
  'Runaway pattern detected. Change the approach or stop. ' +
  'This reminder is temporary — do not save it or generalize it into Memory, Skills or durable rules.';

export function decideRunawayReminder(input: RunawayInput): RunawayDecision {
  if (input.emittedThisRun) return { emit: false, reason: 'already emitted this run' };
  if (input.verifiedProgress || input.trustedToolProvenance) {
    return { emit: false, reason: 'verified progress or trusted provenance' };
  }
  if (input.signals.length < Math.max(1, input.minSignals)) {
    return { emit: false, reason: 'below signal threshold' };
  }
  return { emit: true, reason: 'unverified runaway pattern' };
}
