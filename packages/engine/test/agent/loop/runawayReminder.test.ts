import { describe, expect, it } from 'vitest';

import {
  decideRunawayReminder,
  RUNAWAY_REMINDER_TEXT,
  type RunawayInput,
} from '#/agent/loop/runawayReminder';

const input = (overrides: Partial<RunawayInput> = {}): RunawayInput => ({
  signals: ['exact-repeat', 'polling-repeat'],
  verifiedProgress: false,
  trustedToolProvenance: false,
  emittedThisRun: false,
  minSignals: 2,
  ...overrides,
});

describe('decideRunawayReminder', () => {
  it('emits once for an unverified runaway pattern', () => {
    expect(decideRunawayReminder(input())).toEqual({ emit: true, reason: 'unverified runaway pattern' });
  });

  it('suppresses on verified progress or trusted provenance', () => {
    expect(decideRunawayReminder(input({ verifiedProgress: true })).emit).toBe(false);
    expect(decideRunawayReminder(input({ trustedToolProvenance: true })).emit).toBe(false);
  });

  it('suppresses repeats and below-threshold patterns', () => {
    expect(decideRunawayReminder(input({ emittedThisRun: true })).emit).toBe(false);
    expect(decideRunawayReminder(input({ signals: ['exact-repeat'] })).emit).toBe(false);
  });
});

describe('RUNAWAY_REMINDER_TEXT', () => {
  it('forbids durable promotion', () => {
    expect(RUNAWAY_REMINDER_TEXT).toContain('temporary');
    expect(RUNAWAY_REMINDER_TEXT).toContain('do not save it');
  });
});
