import { describe, expect, it } from 'vitest';

import {
  bootstrapInterval,
  bootstrapMeanDifference,
  meanOf,
  medianOf,
  quantileOf,
  type BootstrapIntervalOptions,
} from '#/agent/evals/bootstrap';

const DEFAULT_OPTIONS: BootstrapIntervalOptions = { resamples: 2_000, confidence: 0.95, seed: 7 };

describe('meanOf/medianOf', () => {
  it('computes the mean', () => {
    expect(meanOf([1, 2, 3, 4])).toBe(2.5);
  });

  it('computes the median of even and odd sample counts', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 2, 3])).toBe(2.5);
  });

  it('rejects empty sample sets', () => {
    expect(() => meanOf([])).toThrow(/empty/);
    expect(() => medianOf([])).toThrow(/empty/);
  });
});

describe('quantileOf', () => {
  it('interpolates linearly between order statistics', () => {
    const sorted = [1, 2, 3, 4, 5];
    expect(quantileOf(sorted, 0.5)).toBe(3);
    expect(quantileOf(sorted, 0.25)).toBe(2);
    expect(quantileOf(sorted, 0)).toBe(1);
    expect(quantileOf(sorted, 1)).toBe(5);
  });

  it('interpolates between adjacent values', () => {
    expect(quantileOf([1, 2], 0.5)).toBe(1.5);
    expect(quantileOf([10, 20], 0.75)).toBe(17.5);
  });

  it('rejects empty input and out-of-range levels', () => {
    expect(() => quantileOf([], 0.5)).toThrow(/empty/);
    expect(() => quantileOf([1], -0.1)).toThrow(/outside/);
    expect(() => quantileOf([1], 1.1)).toThrow(/outside/);
  });
});

describe('bootstrapInterval', () => {
  it('gives a zero-width interval for constant samples', () => {
    const interval = bootstrapInterval([5, 5, 5, 5], meanOf, DEFAULT_OPTIONS);
    expect(interval).toEqual({
      estimate: 5,
      lower: 5,
      upper: 5,
      confidence: 0.95,
      resamples: 2_000,
    });
  });

  it('is deterministic for a fixed seed', () => {
    const samples = [100, 104, 98, 130, 95, 110, 121, 99];
    const first = bootstrapInterval(samples, meanOf, DEFAULT_OPTIONS);
    const second = bootstrapInterval(samples, meanOf, DEFAULT_OPTIONS);
    expect(second).toEqual(first);
  });

  it('brackets the sample mean and reacts to the seed', () => {
    const samples = [100, 104, 98, 130, 95, 110, 121, 99];
    const interval = bootstrapInterval(samples, meanOf, DEFAULT_OPTIONS);
    expect(interval.estimate).toBeCloseTo(meanOf(samples), 10);
    expect(interval.lower).toBeLessThanOrEqual(interval.estimate);
    expect(interval.upper).toBeGreaterThanOrEqual(interval.estimate);
    const otherSeed = bootstrapInterval(samples, meanOf, { ...DEFAULT_OPTIONS, seed: 99 });
    expect(otherSeed.lower).not.toBe(interval.lower);
  });

  it('supports non-mean statistics such as the median', () => {
    const interval = bootstrapInterval([1, 2, 3, 4, 100], medianOf, DEFAULT_OPTIONS);
    expect(interval.estimate).toBe(3);
    expect(interval.lower).toBeGreaterThanOrEqual(1);
    expect(interval.upper).toBeLessThanOrEqual(100);
  });

  it('rejects empty samples, bad resample counts, and bad confidence levels', () => {
    expect(() => bootstrapInterval([], meanOf, DEFAULT_OPTIONS)).toThrow(/at least one sample/);
    expect(() =>
      bootstrapInterval([1], meanOf, { ...DEFAULT_OPTIONS, resamples: 0 }),
    ).toThrow(/positive integer/);
    expect(() =>
      bootstrapInterval([1], meanOf, { ...DEFAULT_OPTIONS, confidence: 1 }),
    ).toThrow(/strictly between/);
  });
});

describe('bootstrapMeanDifference', () => {
  const fastArm = [100, 102, 98, 101, 99, 103, 100, 97];
  const slowArm = [200, 198, 202, 199, 201, 197, 203, 200];

  it('separates clearly different arms from zero', () => {
    const interval = bootstrapMeanDifference(fastArm, slowArm, DEFAULT_OPTIONS);
    expect(interval.estimate).toBeCloseTo(meanOf(fastArm) - meanOf(slowArm), 10);
    expect(interval.upper).toBeLessThan(0);
  });

  it('keeps identical arms inside the interval', () => {
    const interval = bootstrapMeanDifference(fastArm, fastArm, DEFAULT_OPTIONS);
    expect(interval.estimate).toBe(0);
    expect(interval.lower).toBeLessThanOrEqual(0);
    expect(interval.upper).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic for a fixed seed', () => {
    const first = bootstrapMeanDifference(fastArm, slowArm, DEFAULT_OPTIONS);
    const second = bootstrapMeanDifference(fastArm, slowArm, DEFAULT_OPTIONS);
    expect(second).toEqual(first);
  });

  it('resamples both arms independently per draw', () => {
    const options: BootstrapIntervalOptions = { resamples: 500, confidence: 0.9, seed: 42 };
    const interval = bootstrapMeanDifference(fastArm, slowArm, options);
    expect(interval.confidence).toBe(0.9);
    expect(interval.resamples).toBe(500);
    expect(interval.upper).toBeLessThan(-80);
  });

  it('rejects an empty arm', () => {
    expect(() => bootstrapMeanDifference([], [1], DEFAULT_OPTIONS)).toThrow(/at least one sample/);
    expect(() => bootstrapMeanDifference([1], [], DEFAULT_OPTIONS)).toThrow(/at least one sample/);
  });
});
