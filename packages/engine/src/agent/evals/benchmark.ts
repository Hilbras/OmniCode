import {
  bootstrapInterval,
  bootstrapMeanDifference,
  meanOf,
  type BootstrapInterval,
  type BootstrapIntervalOptions,
} from './bootstrap';

export interface BenchmarkObservation {
  readonly firstOutputMs: number;
  readonly quality: number;
}

export type BenchmarkProbe = (arm: string) => BenchmarkObservation | Promise<BenchmarkObservation>;

export interface BenchmarkScheduleEntry {
  readonly arm: string;
  readonly block: number;
  readonly position: 0 | 1;
}

export interface BenchmarkRun {
  readonly arm: string;
  readonly block: number;
  readonly position: 0 | 1;
  readonly observation: BenchmarkObservation;
}

export interface ArmBenchmarkSummary {
  readonly arm: string;
  readonly runs: number;
  readonly firstOutputMs: BootstrapInterval;
  readonly quality: BootstrapInterval;
}

export interface BenchmarkComparison {
  readonly baseline: string;
  readonly treatment: string;
  readonly firstOutputMsDifference: BootstrapInterval;
  readonly qualityDifference: BootstrapInterval;
}

export interface FirstOutputBenchmarkReport {
  readonly armA: string;
  readonly armB: string;
  readonly blocks: number;
  readonly runs: readonly BenchmarkRun[];
  readonly arms: readonly ArmBenchmarkSummary[];
  readonly comparison: BenchmarkComparison;
}

export interface FirstOutputBenchmarkOptions {
  readonly armA: string;
  readonly armB: string;
  readonly blocks: number;
  readonly probe: BenchmarkProbe;
  readonly bootstrap: BootstrapIntervalOptions;
}

export function abbaSchedule(armA: string, armB: string, blocks: number): readonly BenchmarkScheduleEntry[] {
  if (!Number.isInteger(blocks) || blocks < 1) {
    throw new Error(`AB/BA schedule needs at least one block, got ${String(blocks)}`);
  }
  if (armA === armB) {
    throw new Error(`AB/BA arms must be distinct, got '${armA}' for both`);
  }
  const entries: BenchmarkScheduleEntry[] = [];
  for (let block = 0; block < blocks; block++) {
    const leadsWithA = block % 2 === 0;
    const first = leadsWithA ? armA : armB;
    const second = leadsWithA ? armB : armA;
    entries.push({ arm: first, block, position: 0 }, { arm: second, block, position: 1 });
  }
  return entries;
}

export async function runFirstOutputBenchmark(
  options: FirstOutputBenchmarkOptions,
): Promise<FirstOutputBenchmarkReport> {
  const schedule = abbaSchedule(options.armA, options.armB, options.blocks);
  const runs: BenchmarkRun[] = [];
  for (const entry of schedule) {
    const observation = await options.probe(entry.arm);
    runs.push({ arm: entry.arm, block: entry.block, position: entry.position, observation });
  }

  const firstOutputMsOf = (arm: string): number[] =>
    runs.filter((run) => run.arm === arm).map((run) => run.observation.firstOutputMs);
  const qualityOf = (arm: string): number[] =>
    runs.filter((run) => run.arm === arm).map((run) => run.observation.quality);

  const armSummary = (arm: string): ArmBenchmarkSummary => ({
    arm,
    runs: firstOutputMsOf(arm).length,
    firstOutputMs: bootstrapInterval(firstOutputMsOf(arm), meanOf, options.bootstrap),
    quality: bootstrapInterval(qualityOf(arm), meanOf, options.bootstrap),
  });

  return {
    armA: options.armA,
    armB: options.armB,
    blocks: options.blocks,
    runs,
    arms: [armSummary(options.armA), armSummary(options.armB)],
    comparison: {
      baseline: options.armA,
      treatment: options.armB,
      firstOutputMsDifference: bootstrapMeanDifference(
        firstOutputMsOf(options.armA),
        firstOutputMsOf(options.armB),
        options.bootstrap,
      ),
      qualityDifference: bootstrapMeanDifference(
        qualityOf(options.armA),
        qualityOf(options.armB),
        options.bootstrap,
      ),
    },
  };
}
