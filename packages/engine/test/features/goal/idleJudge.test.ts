import { describe, expect, it } from 'vitest';

import {
  applyJudgeVerdict,
  decideIdleJudge,
  hasStalled,
  type IdleJudgeInput,
} from '#/features/goal/idleJudge';

const input = (overrides: Partial<IdleJudgeInput> = {}): IdleJudgeInput => ({
  goalId: 'g1',
  bootId: 'boot-a',
  currentBoot: 'boot-a',
  rounds: 1,
  maxRounds: 10,
  lastReason: undefined,
  usedTools: ['Read'],
  backgroundTaskActive: false,
  staleMs: 0,
  staleThresholdMs: 30 * 60_000,
  ...overrides,
});

describe('decideIdleJudge', () => {
  it('judges a live idle goal', () => {
    expect(decideIdleJudge(input()).kind).toBe('judge');
  });

  it('fences records from a previous boot', () => {
    expect(decideIdleJudge(input({ bootId: 'boot-old' })).kind).toBe('skip-stale-boot');
  });

  it('respects the round cap', () => {
    expect(decideIdleJudge(input({ rounds: 10 })).kind).toBe('exhausted');
  });

  it('waits when a background task owns the wake, pauses otherwise', () => {
    expect(decideIdleJudge(input({ staleMs: 30 * 60_000, backgroundTaskActive: true })).kind)
      .toBe('wait-background');
    expect(decideIdleJudge(input({ staleMs: 30 * 60_000 })).kind).toBe('pause-stale');
  });
});

describe('hasStalled / applyJudgeVerdict', () => {
  it('detects a repeated reason with no tools', () => {
    expect(hasStalled('  still working ', [])).toBe(true);
    expect(hasStalled('still working', ['Read'])).toBe(false);
    expect(hasStalled(undefined, [])).toBe(false);
  });

  it('maps verdicts to actions, refusing a stalled completion', () => {
    expect(applyJudgeVerdict('done', false)).toBe('complete');
    expect(applyJudgeVerdict('done', true)).toBe('continue');
    expect(applyJudgeVerdict('continue', false)).toBe('continue');
    expect(applyJudgeVerdict('paused', false)).toBe('pause');
    expect(applyJudgeVerdict('wait', false)).toBe('wait');
  });
});
