import { afterEach, describe, expect, it, vi } from 'vitest';

import { decideTurnSettlement, type TurnSettleInput } from '#/agent/loop/turnSettlement';
import { STALL_GUARD_ENV_KEY } from '#/agent/loop/stallGuard';
import { OUTPUT_ESCALATION_ENV_KEY } from '#/agent/loop/outputEscalation';

afterEach(() => vi.unstubAllEnvs());

function input(overrides: Partial<TurnSettleInput> = {}): TurnSettleInput {
  return {
    outcome: 'done',
    failedStep: false,
    abortReason: undefined,
    aborted: false,
    filtered: false,
    failureError: undefined,
    maxStepsError: undefined,
    stopRequested: false,
    toolStopRequested: false,
    liveNudge: false,
    lastStopReason: undefined,
    outputEscalated: false,
    lastFinalText: '',
    stallNudges: 0,
    wroteFiles: false,
    verifiedAfterWrite: false,
    verificationNudged: false,
    ...overrides,
  };
}

describe('decideTurnSettlement', () => {
  it('recovers a failed step before any terminal condition', () => {
    expect(decideTurnSettlement(input({ failedStep: true, filtered: true, outcome: 'failed' })))
      .toEqual({ kind: 'recover-failed-step' });
  });

  it('cancels on an explicit reason, an aborted signal, or an aborted outcome', () => {
    expect(decideTurnSettlement(input({ abortReason: 'user stop', aborted: true })))
      .toEqual({ kind: 'cancel', reason: 'user stop' });
    expect(decideTurnSettlement(input({ aborted: true })))
      .toEqual({ kind: 'cancel', reason: undefined });
    expect(decideTurnSettlement(input({ outcome: 'aborted' })))
      .toEqual({ kind: 'cancel', reason: undefined });
  });

  it('fails filtered and max-step turns without emitting a step interruption', () => {
    expect(decideTurnSettlement(input({ filtered: true }))).toEqual({ kind: 'fail-filtered' });
    expect(decideTurnSettlement(input({ maxStepsError: 'cap' })))
      .toEqual({ kind: 'fail-max-steps', error: 'cap' });
  });

  it('honours a stop request before checking nudges', () => {
    expect(decideTurnSettlement(input({
      stopRequested: true,
      liveNudge: true,
      lastFinalText: 'Next I will refactor the parser.',
    }))).toEqual({ kind: 'complete' });
  });

  it('waits for a live nudge before tool-stop, truncation and stall decisions', () => {
    for (const overrides of [
      { toolStopRequested: true },
      { lastStopReason: 'truncated' as const },
      { lastFinalText: 'Next I will refactor the parser.' },
    ]) {
      expect(decideTurnSettlement(input({ liveNudge: true, ...overrides })))
        .toEqual({ kind: 'wait-for-nudge' });
    }
  });

  it('completes on a tool-stop request', () => {
    expect(decideTurnSettlement(input({ toolStopRequested: true }))).toEqual({ kind: 'complete' });
  });

  it('fails an outcome with the observed error', () => {
    const error = new Error('provider exploded');
    expect(decideTurnSettlement(input({ outcome: 'failed', failureError: error })))
      .toEqual({ kind: 'fail-outcome', error });
  });

  it('escalates a truncated turn once', () => {
    const truncated = input({ lastStopReason: 'truncated' });
    expect(decideTurnSettlement(truncated)).toEqual({ kind: 'escalate-truncation' });
    expect(decideTurnSettlement(input({
      lastStopReason: 'truncated', outputEscalated: true,
    }))).toEqual({ kind: 'complete' });
    vi.stubEnv(OUTPUT_ESCALATION_ENV_KEY, '0');
    expect(decideTurnSettlement(truncated)).toEqual({ kind: 'complete' });
  });

  it('nudges an intent-ack final text and prefers a verification nudge after writes', () => {
    expect(decideTurnSettlement(input({ lastFinalText: 'Next I will refactor the parser.' })))
      .toEqual({ kind: 'nudge-stall', verification: false });
    expect(decideTurnSettlement(input({ wroteFiles: true })))
      .toEqual({ kind: 'nudge-stall', verification: true });
    expect(decideTurnSettlement(input({
      wroteFiles: true, verificationNudged: true, lastFinalText: 'All done — tests pass.',
    }))).toEqual({ kind: 'complete' });
  });

  it('limits stall nudges and honours the opt-out', () => {
    expect(decideTurnSettlement(input({
      lastFinalText: 'Next I will refactor the parser.', stallNudges: 2,
    }))).toEqual({ kind: 'complete' });
    vi.stubEnv(STALL_GUARD_ENV_KEY, '0');
    expect(decideTurnSettlement(input({ lastFinalText: 'Next I will refactor the parser.' })))
      .toEqual({ kind: 'complete' });
  });

  it('completes a normal final response', () => {
    expect(decideTurnSettlement(input({ lastFinalText: 'All done — tests pass.' })))
      .toEqual({ kind: 'complete' });
  });
});
