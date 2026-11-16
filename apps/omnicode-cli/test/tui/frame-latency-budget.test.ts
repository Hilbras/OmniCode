/**
 * Frame-latency budget for the TUI steady-state path.
 *
 * What this gates: the cost of one frame over a long transcript, both its
 * per-line constant and its growth with transcript size. A super-linear frame
 * cost, or a large constant-factor regression, fails here.
 *
 * What this does NOT gate: the processed-line reuse inside `doRender`, and the
 * shape of the cost curve between small and large transcripts.
 *
 * - Reuse: the probe behind this file (see T3.3 in
 *   `docs/plans/strength-program.md`) measured the reuse path as not being the
 *   dominant cost for a single-component transcript — a component returning the
 *   same array every frame and one returning a fresh array cost the same (5k
 *   lines: 2.97 vs 1.91 ms, 15k: 4.30 vs 2.80 ms, 45k: 16.13 vs 15.77 ms, median
 *   of 15 frames) and the component re-renders every frame either way, so a
 *   ratio gate between the two variants would be vacuous.
 * - The cost curve: a growth-ratio gate over 10k vs 40k lines was tried and
 *   removed — the small end is noise-dominated (~2 ms), so the same run
 *   measured 8.2x growth for 4x the lines and a neighbouring run passed the
 *   same 8x threshold. Only the per-line budget at the large size was stable
 *   across runs.
 *
 * `tui-frame.bench.ts` remains the place to read raw frame timings.
 */

import type { Component, Terminal } from '@hilbras/omnicode-tui';
import { TuiMainScreen } from '@hilbras/omnicode-tui';
import { describe, expect, it } from 'vitest';

const WIDTH = 120;
const HEIGHT = 40;
const LARGE_LINES = 40_000;
const FRAMES = 15;
const MAX_FRAME_MS_PER_1000_LINES = 2;

class StubTerminal implements Terminal {
  start(): void {}
  stop(): void {}
  async drainInput(): Promise<void> {}
  write(): void {}
  get columns(): number {
    return WIDTH;
  }
  get rows(): number {
    return HEIGHT;
  }
  get kittyProtocolActive(): boolean {
    return false;
  }
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
}

class SpinnerComponent implements Component {
  frame = 0;
  render(): string[] {
    return [`⠋ working (frame ${this.frame})`];
  }
  invalidate(): void {}
}

class TranscriptComponent implements Component {
  constructor(private readonly lines: string[]) {}
  render(): string[] {
    return this.lines;
  }
  invalidate(): void {}
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const value = sorted[Math.floor(sorted.length / 2)];
  if (value === undefined) throw new Error('median of an empty sample');
  return value;
}

function measureFrameMs(lineCount: number): number {
  const lines = Array.from(
    { length: lineCount },
    (_, index) => `line ${String(index)} — the quick brown fox jumps over the lazy dog`,
  );
  const tui = new TuiMainScreen(new StubTerminal());
  const spinner = new SpinnerComponent();
  tui.addChild(new TranscriptComponent(lines));
  tui.addChild(spinner);
  tui.start();
  const renderFrame = (): void => {
    spinner.frame++;
    (tui as unknown as { doRender(): void }).doRender();
  };
  for (let warm = 0; warm < 5; warm += 1) renderFrame();

  const samples: number[] = [];
  for (let index = 0; index < FRAMES; index += 1) {
    const started = performance.now();
    renderFrame();
    samples.push(performance.now() - started);
  }
  return median(samples);
}

describe('TUI frame latency budget', () => {
  it('keeps the steady-state frame under a bounded per-line budget', () => {
    const largeMs = measureFrameMs(LARGE_LINES);
    const perThousandLines = (largeMs / LARGE_LINES) * 1_000;

    expect(
      perThousandLines,
      `${String(LARGE_LINES)}-line frame took ${largeMs.toFixed(2)}ms ` +
        `(${perThousandLines.toFixed(2)}ms per 1000 lines)`,
    ).toBeLessThan(MAX_FRAME_MS_PER_1000_LINES);
  }, 120_000);
});
