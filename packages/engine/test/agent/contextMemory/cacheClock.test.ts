import { describe, expect, it } from 'vitest';

import {
  cacheState,
  orderInstructions,
  retainedAcrossCompaction,
  type CacheClockState,
} from '#/agent/contextMemory/cacheClock';

const clock = (age: number): CacheClockState => ({
  now: age, lastPromptAt: 0, guaranteedMs: 100, estimatedMs: 300,
});

describe('cacheState', () => {
  it('maps age to guaranteed, estimated and cold windows', () => {
    expect(cacheState(clock(50))).toBe('warm');
    expect(cacheState(clock(200))).toBe('estimated');
    expect(cacheState(clock(500))).toBe('cold');
  });
});

describe('orderInstructions', () => {
  it('puts the most shared sources first', () => {
    expect(orderInstructions([
      { name: 'volatile', sharedness: 1 },
      { name: 'stable', sharedness: 100 },
      { name: 'context', sharedness: 10 },
    ])).toEqual(['stable', 'context', 'volatile']);
  });
});

describe('retainedAcrossCompaction', () => {
  it('keeps only explicitly retained non-empty summaries', () => {
    const kept = retainedAcrossCompaction([
      { callId: 'a', summary: 'result', retainAcrossWindows: true },
      { callId: 'b', summary: 'result', retainAcrossWindows: false },
      { callId: 'c', summary: '', retainAcrossWindows: true },
    ]);
    expect(kept.map((output) => output.callId)).toEqual(['a']);
  });
});
