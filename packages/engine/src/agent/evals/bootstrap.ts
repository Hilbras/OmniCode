export type SampleStatistic = (samples: readonly number[]) => number;

export type SeededRng = () => number;

export interface BootstrapIntervalOptions {
  readonly resamples: number;
  readonly confidence: number;
  readonly seed: number;
}

export interface BootstrapInterval {
  readonly estimate: number;
  readonly lower: number;
  readonly upper: number;
  readonly confidence: number;
  readonly resamples: number;
}

function checkedValue(samples: readonly number[], index: number, what: string): number {
  const value = samples[index];
  if (value === undefined) throw new Error(`${what} index ${String(index)} out of range`);
  return value;
}

export function meanOf(samples: readonly number[]): number {
  if (samples.length === 0) throw new Error('mean of an empty sample set');
  let total = 0;
  for (const value of samples) total += value;
  return total / samples.length;
}

export function medianOf(samples: readonly number[]): number {
  if (samples.length === 0) throw new Error('median of an empty sample set');
  return quantileOf([...samples].sort((a, b) => a - b), 0.5);
}

export function quantileOf(sortedAscending: readonly number[], q: number): number {
  if (sortedAscending.length === 0) throw new Error('quantile of an empty sample set');
  if (!(q >= 0 && q <= 1)) throw new Error(`quantile level ${String(q)} outside [0, 1]`);
  const position = q * (sortedAscending.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = checkedValue(sortedAscending, lowerIndex, 'quantile');
  const upper = checkedValue(sortedAscending, upperIndex, 'quantile');
  if (lower === upper) return lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

function mulberry32(seed: number): SeededRng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function checkOptions(options: BootstrapIntervalOptions, sampleCountA: number, sampleCountB: number): void {
  if (sampleCountA === 0 || sampleCountB === 0) {
    throw new Error('bootstrap requires at least one sample per arm');
  }
  if (!Number.isInteger(options.resamples) || options.resamples < 1) {
    throw new Error(`bootstrap resamples must be a positive integer, got ${String(options.resamples)}`);
  }
  if (!(options.confidence > 0 && options.confidence < 1)) {
    throw new Error(`bootstrap confidence must be strictly between 0 and 1, got ${String(options.confidence)}`);
  }
}

function resample(samples: readonly number[], rng: SeededRng): number[] {
  const drawn: number[] = new Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    drawn[i] = checkedValue(samples, Math.floor(rng() * samples.length), 'resample');
  }
  return drawn;
}

function percentileInterval(
  estimate: number,
  resampleStatistics: number[],
  options: BootstrapIntervalOptions,
): BootstrapInterval {
  resampleStatistics.sort((a, b) => a - b);
  const tail = (1 - options.confidence) / 2;
  return {
    estimate,
    lower: quantileOf(resampleStatistics, tail),
    upper: quantileOf(resampleStatistics, 1 - tail),
    confidence: options.confidence,
    resamples: options.resamples,
  };
}

export function bootstrapInterval(
  samples: readonly number[],
  statistic: SampleStatistic,
  options: BootstrapIntervalOptions,
): BootstrapInterval {
  checkOptions(options, samples.length, samples.length);
  const rng = mulberry32(options.seed);
  const resampleStatistics: number[] = new Array(options.resamples);
  for (let r = 0; r < options.resamples; r++) {
    resampleStatistics[r] = statistic(resample(samples, rng));
  }
  return percentileInterval(statistic(samples), resampleStatistics, options);
}

export function bootstrapMeanDifference(
  armA: readonly number[],
  armB: readonly number[],
  options: BootstrapIntervalOptions,
): BootstrapInterval {
  checkOptions(options, armA.length, armB.length);
  const rng = mulberry32(options.seed);
  const differences: number[] = new Array(options.resamples);
  for (let r = 0; r < options.resamples; r++) {
    differences[r] = meanOf(resample(armA, rng)) - meanOf(resample(armB, rng));
  }
  return percentileInterval(meanOf(armA) - meanOf(armB), differences, options);
}
