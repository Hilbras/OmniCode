import { describe, expect, it } from 'vitest';

import { planNudgeDrain } from '#/agent/loop/nudgeReconciliation';

describe('planNudgeDrain', () => {
  it('consumes only nudges the machine did not report', () => {
    expect(planNudgeDrain(5, 0, 3)).toEqual({ count: 2, nextCursor: 2 });
  });

  it('advances the cursor by exactly the consumed count', () => {
    expect(planNudgeDrain(6, 2, 1)).toEqual({ count: 3, nextCursor: 5 });
  });

  it('never consumes more than remain, even with a negative or oversized report', () => {
    expect(planNudgeDrain(4, 1, 99)).toEqual({ count: 0, nextCursor: 1 });
    expect(planNudgeDrain(4, 1, -5)).toEqual({ count: 3, nextCursor: 4 });
  });

  it('is exhausted when the cursor has reached the end', () => {
    expect(planNudgeDrain(4, 4, 0)).toEqual({ count: 0, nextCursor: 4 });
    expect(planNudgeDrain(0, 0, 0)).toEqual({ count: 0, nextCursor: 0 });
  });
});
