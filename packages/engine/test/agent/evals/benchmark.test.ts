import { describe, expect, it } from 'vitest';

import {
  abbaSchedule,
  runFirstOutputBenchmark,
  type BenchmarkObservation,
  type BenchmarkProbe,
} from '#/agent/evals/benchmark';
import { meanOf, type BootstrapIntervalOptions } from '#/agent/evals/bootstrap';

const BOOTSTRAP: BootstrapIntervalOptions = { resamples: 1_000, confidence: 0.95, seed: 11 };

describe('abbaSchedule', () => {
  it('alternates A-then-B and B-then-A across blocks', () => {
    const schedule = abbaSchedule('alpha', 'beta', 3);
    expect(schedule).toEqual([
      { arm: 'alpha', block: 0, position: 0 },
      { arm: 'beta', block: 0, position: 1 },
      { arm: 'beta', block: 1, position: 0 },
      { arm: 'alpha', block: 1, position: 1 },
      { arm: 'alpha', block: 2, position: 0 },
      { arm: 'beta', block: 2, position: 1 },
    ]);
  });

  it('balances both arms across positions for an even block count', () => {
    const schedule = abbaSchedule('alpha', 'beta', 4);
    for (const arm of ['alpha', 'beta']) {
      expect(schedule.filter((entry) => entry.arm === arm && entry.position === 0)).toHaveLength(2);
      expect(schedule.filter((entry) => entry.arm === arm && entry.position === 1)).toHaveLength(2);
    }
  });

  it('rejects zero blocks and duplicate arms', () => {
    expect(() => abbaSchedule('a', 'b', 0)).toThrow(/at least one block/);
    expect(() => abbaSchedule('a', 'a', 1)).toThrow(/distinct/);
  });
});

describe('runFirstOutputBenchmark', () => {
  const fastObservations = [100, 104, 98, 101];
  const slowObservations = [200, 196, 204, 199];

  function syntheticProbe(calls: string[]): BenchmarkProbe {
    const seen = new Map<string, number>();
    return (arm: string) => {
      calls.push(arm);
      const index = seen.get(arm) ?? 0;
      seen.set(arm, index + 1);
      const isFirstOutput = arm === 'fast';
      const latency = isFirstOutput ? fastObservations[index] : slowObservations[index];
      const quality = isFirstOutput ? 0.9 + index * 0.01 : 0.7 + index * 0.01;
      if (latency === undefined) throw new Error(`no synthetic sample #${String(index)} for arm ${arm}`);
      return { firstOutputMs: latency, quality };
    };
  }

  it('runs arms in AB/BA order and pairs observations with their schedule slot', async () => {
    const calls: string[] = [];
    const report = await runFirstOutputBenchmark({
      armA: 'fast',
      armB: 'slow',
      blocks: 2,
      probe: syntheticProbe(calls),
      bootstrap: BOOTSTRAP,
    });
    expect(calls).toEqual(['fast', 'slow', 'slow', 'fast']);
    expect(report.runs).toEqual([
      { arm: 'fast', block: 0, position: 0, observation: { firstOutputMs: 100, quality: 0.9 } },
      { arm: 'slow', block: 0, position: 1, observation: { firstOutputMs: 200, quality: 0.7 } },
      { arm: 'slow', block: 1, position: 0, observation: { firstOutputMs: 196, quality: 0.71 } },
      { arm: 'fast', block: 1, position: 1, observation: { firstOutputMs: 104, quality: 0.91 } },
    ]);
  });

  it('summarizes each arm with bootstrap intervals over first-output latency and quality', async () => {
    const report = await runFirstOutputBenchmark({
      armA: 'fast',
      armB: 'slow',
      blocks: 2,
      probe: syntheticProbe([]),
      bootstrap: BOOTSTRAP,
    });
    expect(report.arms.map((arm) => arm.arm)).toEqual(['fast', 'slow']);
    for (const arm of report.arms) {
      expect(arm.runs).toBe(2);
      expect(arm.firstOutputMs.resamples).toBe(BOOTSTRAP.resamples);
      expect(arm.quality.confidence).toBe(BOOTSTRAP.confidence);
      expect(arm.firstOutputMs.lower).toBeLessThanOrEqual(arm.firstOutputMs.estimate);
      expect(arm.firstOutputMs.upper).toBeGreaterThanOrEqual(arm.firstOutputMs.estimate);
    }
    const fast = report.arms[0];
    expect(fast?.firstOutputMs.estimate).toBeCloseTo(meanOf(fastObservations.slice(0, 2)), 10);
    expect(fast?.quality.estimate).toBeCloseTo(0.905, 10);
  });

  it('reports a bootstrap interval for the latency difference and separates clear arms from zero', async () => {
    const report = await runFirstOutputBenchmark({
      armA: 'fast',
      armB: 'slow',
      blocks: 2,
      probe: syntheticProbe([]),
      bootstrap: BOOTSTRAP,
    });
    const { comparison } = report;
    expect(comparison.baseline).toBe('fast');
    expect(comparison.treatment).toBe('slow');
    const latencyRuns = report.runs.filter((run) => run.arm === 'fast').map((run) => run.observation.firstOutputMs);
    expect(comparison.firstOutputMsDifference.estimate).toBeCloseTo(
      meanOf(latencyRuns) - meanOf([200, 196]),
      10,
    );
    expect(comparison.firstOutputMsDifference.upper).toBeLessThan(0);
    expect(comparison.qualityDifference.upper).toBeGreaterThan(0);
  });

  it('keeps near-identical arms inside the difference interval', async () => {
    const probe: BenchmarkProbe = () => ({ firstOutputMs: 120, quality: 0.8 });
    const report = await runFirstOutputBenchmark({
      armA: 'a',
      armB: 'b',
      blocks: 3,
      probe,
      bootstrap: BOOTSTRAP,
    });
    expect(report.comparison.firstOutputMsDifference.lower).toBeLessThanOrEqual(0);
    expect(report.comparison.firstOutputMsDifference.upper).toBeGreaterThanOrEqual(0);
    expect(report.comparison.qualityDifference.estimate).toBe(0);
  });

  it('awaits async probes', async () => {
    const probe: BenchmarkProbe = async (arm: string): Promise<BenchmarkObservation> => ({
      firstOutputMs: arm === 'a' ? 10 : 20,
      quality: 1,
    });
    const report = await runFirstOutputBenchmark({
      armA: 'a',
      armB: 'b',
      blocks: 1,
      probe,
      bootstrap: BOOTSTRAP,
    });
    expect(report.runs).toHaveLength(2);
    expect(report.comparison.firstOutputMsDifference.estimate).toBe(-10);
  });
});
