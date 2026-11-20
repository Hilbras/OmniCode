import { describe, expect, it } from 'vitest';

import {
  buildSuspensionRecord,
  decideTurnSuspension,
  RESUME_INSTRUCTION,
  resumeSuspension,
  type SuspensionCandidate,
} from '#/agent/loop/turnSuspension';

const candidate = (overrides: Partial<SuspensionCandidate> = {}): SuspensionCandidate => ({
  turnId: 7,
  active: true,
  shuttingDown: true,
  terminalError: undefined,
  budgetExhausted: false,
  unclaimedInputs: [{ id: 'm1', text: 'keep working' }],
  ...overrides,
});

describe('decideTurnSuspension', () => {
  it('suspends an active turn with unclaimed input during shutdown', () => {
    expect(decideTurnSuspension(candidate())).toEqual({
      kind: 'suspend', reason: 'shutdown with unclaimed input',
    });
  });

  it('finishes on terminal error, exhausted budget or no active turn', () => {
    expect(decideTurnSuspension(candidate({ terminalError: 'filtered' })).kind).toBe('finish');
    expect(decideTurnSuspension(candidate({ budgetExhausted: true })).kind).toBe('finish');
    expect(decideTurnSuspension(candidate({ active: false })).kind).toBe('finish');
    expect(decideTurnSuspension(candidate({ shuttingDown: false })).kind).toBe('finish');
  });

  it('finishes when nothing is unclaimed', () => {
    expect(decideTurnSuspension(candidate({ unclaimedInputs: [] })).kind).toBe('finish');
  });
});

describe('buildSuspensionRecord', () => {
  it('records the flushed journal and unclaimed inputs', () => {
    expect(buildSuspensionRecord(candidate(), 1234)).toEqual({
      version: 1, turnId: 7, suspendedAt: 1234,
      unclaimedInputs: [{ id: 'm1', text: 'keep working' }], journalFlushed: true,
    });
  });

  it('returns nothing when the turn should finish', () => {
    expect(buildSuspensionRecord(candidate({ budgetExhausted: true }))).toBeUndefined();
  });
});

describe('resumeSuspension', () => {
  it('resumes a flushed record from the same boot with a durable instruction', () => {
    const record = buildSuspensionRecord(candidate())!;
    expect(resumeSuspension(record, 'boot-a', 'boot-a')).toEqual({
      turnId: 7,
      inputs: [{ id: 'm1', text: 'keep working' }],
      systemNote: RESUME_INSTRUCTION,
    });
  });

  it('refuses stale boots, unflushed records and empty records', () => {
    const record = buildSuspensionRecord(candidate())!;
    expect(resumeSuspension(record, 'boot-b', 'boot-a')).toBeUndefined();
    expect(resumeSuspension({ ...record, journalFlushed: false }, 'boot-a', 'boot-a')).toBeUndefined();
    expect(resumeSuspension({ ...record, unclaimedInputs: [] }, 'boot-a', 'boot-a')).toBeUndefined();
    expect(resumeSuspension(undefined, 'boot-a', undefined)).toBeUndefined();
  });
});
