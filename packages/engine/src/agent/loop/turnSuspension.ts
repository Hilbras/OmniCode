/**
 * In-flight turn suspension (unified plan A1).
 *
 * A close/shutdown while a turn is active must not emit a terminal event if the
 * work can be handed to a replacement worker: flush the journal, persist the
 * unclaimed input, and let the next process resume the same turn. Modelled on
 * Codex `core/src/session/turn_suspension.rs:14-118`.
 */
export interface SuspensionInput {
  readonly id: string;
  readonly text: string;
}

export interface SuspensionCandidate {
  readonly turnId: number;
  readonly active: boolean;
  readonly shuttingDown: boolean;
  readonly terminalError: string | undefined;
  readonly budgetExhausted: boolean;
  readonly unclaimedInputs: readonly SuspensionInput[];
}

export interface SuspensionRecord {
  readonly version: 1;
  readonly turnId: number;
  readonly suspendedAt: number;
  readonly unclaimedInputs: readonly SuspensionInput[];
  readonly journalFlushed: boolean;
}

export type SuspensionDecision =
  | { readonly kind: 'finish'; readonly reason: string }
  | { readonly kind: 'suspend'; readonly reason: string };

export function decideTurnSuspension(candidate: SuspensionCandidate): SuspensionDecision {
  if (candidate.terminalError !== undefined) {
    return { kind: 'finish', reason: 'terminal error' };
  }
  if (candidate.budgetExhausted) {
    return { kind: 'finish', reason: 'budget exhausted' };
  }
  if (!candidate.active || !candidate.shuttingDown) {
    return { kind: 'finish', reason: 'no active turn during shutdown' };
  }
  if (candidate.unclaimedInputs.length === 0) {
    return { kind: 'finish', reason: 'no unclaimed input to hand off' };
  }
  return { kind: 'suspend', reason: 'shutdown with unclaimed input' };
}

export function buildSuspensionRecord(
  candidate: SuspensionCandidate,
  now: number = Date.now(),
): SuspensionRecord | undefined {
  if (decideTurnSuspension(candidate).kind !== 'suspend') return undefined;
  return {
    version: 1,
    turnId: candidate.turnId,
    suspendedAt: now,
    unclaimedInputs: candidate.unclaimedInputs,
    journalFlushed: true,
  };
}

export const RESUME_INSTRUCTION =
  'Resume the suspended turn from the durable record. Do not ask the user to repeat the request.';

export interface ResumedTurn {
  readonly turnId: number;
  readonly inputs: readonly SuspensionInput[];
  readonly systemNote: string;
}

/** A suspension is resumable only if it was flushed and is not from an old boot. */
export function resumeSuspension(
  record: SuspensionRecord | undefined,
  currentBoot: string,
  recordBoot: string | undefined,
): ResumedTurn | undefined {
  if (record === undefined || !record.journalFlushed) return undefined;
  if (recordBoot !== undefined && recordBoot !== currentBoot) return undefined;
  if (record.unclaimedInputs.length === 0) return undefined;
  return {
    turnId: record.turnId,
    inputs: record.unclaimedInputs,
    systemNote: RESUME_INSTRUCTION,
  };
}
