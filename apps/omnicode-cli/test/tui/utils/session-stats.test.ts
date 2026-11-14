import { describe, expect, test } from 'vitest';

import {
  cacheHitRatePercent,
  formatLatencyMs,
  formatSessionStatsLines,
  sessionErrorRatePercent,
  SessionStats,
} from '@/tui/utils/session-stats';

const plain = (text: string): string => text;
const noop = plain;

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('SessionStats accumulator', () => {
  test('starts empty and reports no error rate before any turn', () => {
    const snapshot = new SessionStats().snapshot();
    expect(snapshot.turnsStarted).toBe(0);
    expect(sessionErrorRatePercent(snapshot)).toBeUndefined();
  });

  test('counts started, completed and failed turns', () => {
    const stats = new SessionStats();
    stats.recordTurnStarted();
    stats.recordTurnStarted();
    stats.recordTurnStarted();
    stats.recordTurnEnded({ reason: 'completed' });
    stats.recordTurnEnded({ reason: 'failed' });
    const snapshot = stats.snapshot();
    expect(snapshot.turnsStarted).toBe(3);
    expect(snapshot.turnsCompleted).toBe(1);
    expect(snapshot.turnsFailed).toBe(1);
    expect(sessionErrorRatePercent(snapshot)).toBeCloseTo(33.3, 1);
  });

  test('cancelled and blocked turns count as neither completed nor failed', () => {
    const stats = new SessionStats();
    stats.recordTurnStarted();
    stats.recordTurnEnded({ reason: 'cancelled' });
    stats.recordTurnStarted();
    stats.recordTurnEnded({ reason: 'blocked' });
    const snapshot = stats.snapshot();
    expect(snapshot.turnsCompleted).toBe(0);
    expect(snapshot.turnsFailed).toBe(0);
    expect(sessionErrorRatePercent(snapshot)).toBe(0);
  });

  test('keeps last and average turn duration from turn.ended durationMs', () => {
    const stats = new SessionStats();
    stats.recordTurnStarted();
    stats.recordTurnEnded({ reason: 'completed', durationMs: 1000 });
    stats.recordTurnStarted();
    stats.recordTurnEnded({ reason: 'completed', durationMs: 3000 });
    const snapshot = stats.snapshot();
    expect(snapshot.turnsWithDuration).toBe(2);
    expect(snapshot.totalTurnMs).toBe(4000);
    expect(snapshot.lastTurnMs).toBe(3000);
  });

  test('ignores missing or non-finite durations', () => {
    const stats = new SessionStats();
    stats.recordTurnStarted();
    stats.recordTurnEnded({ reason: 'completed' });
    stats.recordTurnEnded({ reason: 'completed', durationMs: Number.NaN });
    stats.recordTurnEnded({ reason: 'completed', durationMs: -5 });
    const snapshot = stats.snapshot();
    expect(snapshot.turnsWithDuration).toBe(0);
    expect(snapshot.lastTurnMs).toBeUndefined();
  });

  test('records first-token latency per completed step', () => {
    const stats = new SessionStats();
    stats.recordStepCompleted({ llmFirstTokenLatencyMs: 800 });
    stats.recordStepCompleted({});
    stats.recordStepCompleted({ llmFirstTokenLatencyMs: 1600 });
    const snapshot = stats.snapshot();
    expect(snapshot.stepsWithFirstToken).toBe(2);
    expect(snapshot.totalFirstTokenMs).toBe(2400);
    expect(snapshot.lastFirstTokenMs).toBe(1600);
  });

  test('counts error events independently of failed turns', () => {
    const stats = new SessionStats();
    stats.recordError();
    stats.recordError();
    const snapshot = stats.snapshot();
    expect(snapshot.errorEvents).toBe(2);
    expect(snapshot.turnsFailed).toBe(0);
  });

  test('reset clears every dimension', () => {
    const stats = new SessionStats();
    stats.recordTurnStarted();
    stats.recordTurnEnded({ reason: 'completed', durationMs: 1000 });
    stats.recordStepCompleted({ llmFirstTokenLatencyMs: 500 });
    stats.recordError();
    stats.reset();
    const snapshot = stats.snapshot();
    expect(snapshot).toEqual({
      turnsStarted: 0,
      turnsCompleted: 0,
      turnsFailed: 0,
      errorEvents: 0,
      turnsWithDuration: 0,
      totalTurnMs: 0,
      lastTurnMs: undefined,
      stepsWithFirstToken: 0,
      totalFirstTokenMs: 0,
      lastFirstTokenMs: undefined,
    });
  });
});

describe('formatLatencyMs', () => {
  test('keeps milliseconds under a second', () => {
    expect(formatLatencyMs(812)).toBe('812ms');
    expect(formatLatencyMs(0)).toBe('0ms');
  });

  test('renders seconds with one decimal below 100s', () => {
    expect(formatLatencyMs(4200)).toBe('4.2s');
    expect(formatLatencyMs(59_400)).toBe('59.4s');
  });

  test('formats minutes past one minute', () => {
    expect(formatLatencyMs(123_400)).toBe('2m 03s');
    expect(formatLatencyMs(66_000)).toBe('1m 06s');
  });

  test('undefined and invalid input render nothing', () => {
    expect(formatLatencyMs(undefined)).toBeUndefined();
    expect(formatLatencyMs(Number.NaN)).toBeUndefined();
    expect(formatLatencyMs(-1)).toBeUndefined();
  });
});

describe('cacheHitRatePercent', () => {
  test('measures cache read against all input tokens', () => {
    expect(
      cacheHitRatePercent({
        inputOther: 100,
        output: 0,
        inputCacheRead: 300,
        inputCacheCreation: 100,
      }),
    ).toBeCloseTo(60, 5);
  });

  test('no input tokens yields no rate', () => {
    expect(
      cacheHitRatePercent({
        inputOther: 0,
        output: 50,
        inputCacheRead: 0,
        inputCacheCreation: 0,
      }),
    ).toBeUndefined();
    expect(cacheHitRatePercent(undefined)).toBeUndefined();
  });
});

describe('formatSessionStatsLines', () => {
  test('an empty session renders no section', () => {
    expect(formatSessionStatsLines(new SessionStats().snapshot(), noop, noop, noop)).toEqual([]);
  });

  test('renders turn counts, error rate, latency and first token', () => {
    const stats = new SessionStats();
    stats.recordTurnStarted();
    stats.recordTurnEnded({ reason: 'completed', durationMs: 1000 });
    stats.recordTurnStarted();
    stats.recordTurnEnded({ reason: 'failed', durationMs: 3000 });
    stats.recordStepCompleted({ llmFirstTokenLatencyMs: 800 });
    const lines = formatSessionStatsLines(stats.snapshot(), noop, noop, noop).map(stripAnsi);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('2 turns');
    expect(lines[0]).toContain('1 failed');
    expect(lines[1]).toContain('50%');
    expect(lines[2]).toContain('3.0s');
    expect(lines[2]).toContain('2.0s');
    expect(lines[3]).toContain('800ms');
    expect(lines[3]).toContain('avg');
  });

  test('error events render without forcing an error-rate line onto completed turns', () => {
    const stats = new SessionStats();
    stats.recordTurnStarted();
    stats.recordTurnEnded({ reason: 'completed' });
    stats.recordError();
    const lines = formatSessionStatsLines(stats.snapshot(), noop, noop, noop);
    expect(lines[0]).toContain('1 error');
    expect(lines[1]).toContain('0%');
    expect(lines.some((line) => line.includes('Turn latency'))).toBe(false);
  });
});
