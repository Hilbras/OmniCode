/**
 * Session stats accumulator for the `/usage` panel: turn counts, turn and
 * first-token latency, error counts. Fed from the session event handler; pure
 * formatting helpers are ANSI-free and colourless like the other usage utils.
 */

import type { TokenUsage } from '@hilbras/omnicode-api';

export type SessionStatsTurnReason = 'completed' | 'cancelled' | 'failed' | 'blocked';

export interface SessionStatsSnapshot {
  readonly turnsStarted: number;
  readonly turnsCompleted: number;
  readonly turnsFailed: number;
  readonly errorEvents: number;
  readonly turnsWithDuration: number;
  readonly totalTurnMs: number;
  readonly lastTurnMs: number | undefined;
  readonly stepsWithFirstToken: number;
  readonly totalFirstTokenMs: number;
  readonly lastFirstTokenMs: number | undefined;
}

export const EMPTY_SESSION_STATS: SessionStatsSnapshot = {
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
};

/** Errors as a share of started turns; `undefined` before any turn ran. */
export function sessionErrorRatePercent(snapshot: SessionStatsSnapshot): number | undefined {
  if (snapshot.turnsStarted === 0) return undefined;
  return (snapshot.turnsFailed / snapshot.turnsStarted) * 100;
}

function usageNumber(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function usageInputTotal(usage: TokenUsage): number {
  return (
    usageNumber(usage.inputOther) +
    usageNumber(usage.inputCacheRead) +
    usageNumber(usage.inputCacheCreation)
  );
}

/**
 * Cache read as a share of total input tokens. `undefined` when no input was
 * recorded, so a fresh session renders no cache line instead of "0%".
 */
export function cacheHitRatePercent(usage: TokenUsage | undefined): number | undefined {
  if (usage === undefined) return undefined;
  const input = usageInputTotal(usage);
  if (input <= 0) return undefined;
  return (usageNumber(usage.inputCacheRead) / input) * 100;
}

/** `812ms`, `4.2s`, `1m 06s` — sub-second keeps milliseconds, minutes floor. */
export function formatLatencyMs(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${String(minutes)}m ${String(seconds).padStart(2, '0')}s`;
}

function average(total: number, count: number): number | undefined {
  return count > 0 ? total / count : undefined;
}

export type StatsColorize = (text: string) => string;

function lastAndAvg(
  total: number,
  count: number,
  last: number | undefined,
): { last: string | undefined; avg: string | undefined } {
  const lastMs = count > 0 && last !== undefined ? last : undefined;
  return {
    last: formatLatencyMs(lastMs),
    avg: formatLatencyMs(average(total, count)),
  };
}

/**
 * The `/usage` panel's session-stats section: turn counts with the error
 * rate, turn latency, and first-token latency. A dimension with no samples
 * renders no line — an empty session shows "No turns yet." instead of zeros.
 */
export function formatSessionStatsLines(
  snapshot: SessionStatsSnapshot,
  muted: StatsColorize,
  value: StatsColorize,
  errorStyle: StatsColorize,
): string[] {
  if (snapshot.turnsStarted === 0 && snapshot.errorEvents === 0) return [];
  const lines: string[] = [];
  const turnsLabel = `${String(snapshot.turnsStarted)} turn${snapshot.turnsStarted === 1 ? '' : 's'}`;
  const parts: string[] = [];
  if (snapshot.turnsFailed > 0) {
    parts.push(errorStyle(`${String(snapshot.turnsFailed)} failed`));
  }
  if (snapshot.errorEvents > 0) {
    parts.push(errorStyle(`${String(snapshot.errorEvents)} error${snapshot.errorEvents === 1 ? '' : 's'}`));
  }
  parts.push(value(turnsLabel));
  lines.push(`  ${muted('Turns')}  ${parts.join('  ·  ')}`);
  const errorRate = sessionErrorRatePercent(snapshot);
  if (errorRate !== undefined) {
    lines.push(`  ${muted('Error rate')}  ${value(`${errorRate.toFixed(0)}%`)}`);
  }
  const turnLatency = lastAndAvg(snapshot.totalTurnMs, snapshot.turnsWithDuration, snapshot.lastTurnMs);
  if (turnLatency.last !== undefined || turnLatency.avg !== undefined) {
    lines.push(`  ${muted('Turn latency')}  ${formatLastAvg(turnLatency, value, muted)}`);
  }
  const firstToken = lastAndAvg(
    snapshot.totalFirstTokenMs,
    snapshot.stepsWithFirstToken,
    snapshot.lastFirstTokenMs,
  );
  if (firstToken.last !== undefined || firstToken.avg !== undefined) {
    lines.push(`  ${muted('First token')}  ${formatLastAvg(firstToken, value, muted)}`);
  }
  return lines;
}

function formatLastAvg(
  latency: { last: string | undefined; avg: string | undefined },
  value: StatsColorize,
  muted: StatsColorize,
): string {
  const pieces: string[] = [];
  if (latency.last !== undefined) pieces.push(`${value(latency.last)}${muted(' last')}`);
  if (latency.avg !== undefined) pieces.push(`${value(latency.avg)}${muted(' avg')}`);
  return pieces.join('  ·  ');
}

/** One accumulator instance per live session; `reset()` on session switch. */
export class SessionStats {
  private turnsStarted = 0;
  private turnsCompleted = 0;
  private turnsFailed = 0;
  private errorEvents = 0;
  private turnsWithDuration = 0;
  private totalTurnMs = 0;
  private lastTurnMs: number | undefined = undefined;
  private stepsWithFirstToken = 0;
  private totalFirstTokenMs = 0;
  private lastFirstTokenMs: number | undefined = undefined;

  reset(): void {
    this.turnsStarted = 0;
    this.turnsCompleted = 0;
    this.turnsFailed = 0;
    this.errorEvents = 0;
    this.turnsWithDuration = 0;
    this.totalTurnMs = 0;
    this.lastTurnMs = undefined;
    this.stepsWithFirstToken = 0;
    this.totalFirstTokenMs = 0;
    this.lastFirstTokenMs = undefined;
  }

  recordTurnStarted(): void {
    this.turnsStarted += 1;
  }

  recordTurnEnded(info: { readonly reason: SessionStatsTurnReason; readonly durationMs?: number }): void {
    if (info.reason === 'failed') this.turnsFailed += 1;
    else if (info.reason === 'completed') this.turnsCompleted += 1;
    if (info.durationMs !== undefined && Number.isFinite(info.durationMs) && info.durationMs >= 0) {
      this.turnsWithDuration += 1;
      this.totalTurnMs += info.durationMs;
      this.lastTurnMs = info.durationMs;
    }
  }

  recordError(): void {
    this.errorEvents += 1;
  }

  recordStepCompleted(info: { readonly llmFirstTokenLatencyMs?: number }): void {
    const latency = info.llmFirstTokenLatencyMs;
    if (latency === undefined || !Number.isFinite(latency) || latency < 0) return;
    this.stepsWithFirstToken += 1;
    this.totalFirstTokenMs += latency;
    this.lastFirstTokenMs = latency;
  }

  snapshot(): SessionStatsSnapshot {
    return {
      turnsStarted: this.turnsStarted,
      turnsCompleted: this.turnsCompleted,
      turnsFailed: this.turnsFailed,
      errorEvents: this.errorEvents,
      turnsWithDuration: this.turnsWithDuration,
      totalTurnMs: this.totalTurnMs,
      lastTurnMs: this.lastTurnMs,
      stepsWithFirstToken: this.stepsWithFirstToken,
      totalFirstTokenMs: this.totalFirstTokenMs,
      lastFirstTokenMs: this.lastFirstTokenMs,
    };
  }
}
