/**
 * Streaming text-loop detector.
 *
 * Fed incrementally with assistant text (or thinking) deltas, it reports the
 * degenerate repetition patterns an agent falls into when it stalls:
 * a phrase repeated verbatim, alternating blocks (A B A B …), or a whole-text
 * period that keeps restarting. Fenced code blocks are excluded from analysis,
 * because generated code legitimately repeats lines and blocks.
 *
 * The detector is pure and side-effect free; deciding what to do with a signal
 * (reminder, telemetry, turn cap) belongs to the caller.
 */

export type TextLoopKind = 'repeated-phrase' | 'alternating-blocks' | 'periodic-text';

export interface TextLoopSignal {
  readonly kind: TextLoopKind;
  /** Human-readable evidence, e.g. the repeated line or the detected period. */
  readonly detail: string;
}

export interface TextLoopDetectorOptions {
  /** Minimum analyzable characters before any check runs. Default 240. */
  readonly minLength?: number;
  /** How many identical phrases trigger the phrase check. Default 4. */
  readonly maxPhraseRepeats?: number;
  /** Shortest phrase worth counting, in characters. Default 24. */
  readonly minPhraseLength?: number;
  /** Largest whole-text period considered, in characters. Default 1200. */
  readonly maxPeriodLength?: number;
}

const DEFAULTS = {
  minLength: 240,
  maxPhraseRepeats: 4,
  minPhraseLength: 24,
  maxPeriodLength: 1200,
} as const;

/** Lines inside ``` or ~~~ fences are dropped; the fence may span pushes because the whole buffer is rescanned. */
export function stripFencedBlocks(text: string): string {
  const kept: string[] = [];
  let fence: string | undefined;
  for (const line of text.split('\n')) {
    const trimmed = line.trimStart();
    const marker = trimmed.startsWith('```') ? '```' : trimmed.startsWith('~~~') ? '~~~' : undefined;
    if (fence === undefined) {
      if (marker === undefined) kept.push(line);
      else fence = marker;
      continue;
    }
    if (marker === fence) fence = undefined;
  }
  return kept.join('\n');
}

function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Smallest period p where `text` is a whole number of repeats of `text[0..p)`,
 * via the prefix-function failure table. Returns undefined when the text is
 * not an exact repetition.
 */
export function exactPeriod(text: string): number | undefined {
  const length = text.length;
  if (length < 2) return undefined;
  const failure = new Array<number>(length).fill(0);
  let matched = 0;
  for (let index = 1; index < length; index += 1) {
    while (matched > 0 && text[index] !== text[matched]) matched = failure[matched - 1]!;
    if (text[index] === text[matched]) matched += 1;
    failure[index] = matched;
  }
  const period = length - failure[length - 1]!;
  return period > 0 && length % period === 0 && period < length ? period : undefined;
}

/**
 * Smallest p ≤ maxPeriod such that `text` ends with at least `minRepeats`
 * repetitions of its last p characters. Candidate periods are pruned by
 * sampling positions from the end before the exact verification.
 */
export function periodicSuffix(text: string, maxPeriod: number, minRepeats = 3): number | undefined {
  const length = text.length;
  const maxCandidate = Math.min(maxPeriod, Math.floor(length / minRepeats));
  for (let period = 1; period <= maxCandidate; period += 1) {
    // Only the last `minRepeats * period` characters can prove the suffix
    // repeats, so sampling stays inside that span (and skips indices below 0).
    const span = Math.min(length, minRepeats * period);
    const step = Math.max(1, Math.floor(span / 16));
    let plausible = true;
    for (let position = length - 1; position > length - span && position >= period; position -= step) {
      if (text[position] !== text[position - period]) {
        plausible = false;
        break;
      }
    }
    if (!plausible) continue;
    const unit = text.slice(length - period);
    if (text.endsWith(unit.repeat(minRepeats))) return period;
  }
  return undefined;
}

export class TextLoopDetector {
  private readonly options: Required<TextLoopDetectorOptions>;
  private buffer = '';
  private lastCheckedLength = 0;

  constructor(options: TextLoopDetectorOptions = {}) {
    this.options = {
      minLength: options.minLength ?? DEFAULTS.minLength,
      maxPhraseRepeats: options.maxPhraseRepeats ?? DEFAULTS.maxPhraseRepeats,
      minPhraseLength: options.minPhraseLength ?? DEFAULTS.minPhraseLength,
      maxPeriodLength: options.maxPeriodLength ?? DEFAULTS.maxPeriodLength,
    };
  }

  /** Everything pushed so far, fences included. */
  get text(): string {
    return this.buffer;
  }

  push(chunk: string): TextLoopSignal | undefined {
    if (chunk.length === 0) return undefined;
    this.buffer += chunk;
    // Re-scanning the whole buffer per token would be quadratic; 64 chars of
    // growth is small enough to catch a loop early and large enough to stay cheap.
    if (this.buffer.length - this.lastCheckedLength < 64) return undefined;
    this.lastCheckedLength = this.buffer.length;
    return this.check();
  }

  reset(): void {
    this.buffer = '';
    this.lastCheckedLength = 0;
  }

  private check(): TextLoopSignal | undefined {
    const analyzable = stripFencedBlocks(this.buffer);
    if (analyzable.length < this.options.minLength) return undefined;
    return (
      this.checkPhraseRepeat(analyzable) ??
      this.checkAlternatingBlocks(analyzable) ??
      this.checkExactPeriod(analyzable)
    );
  }

  private checkPhraseRepeat(analyzable: string): TextLoopSignal | undefined {
    const counts = new Map<string, number>();
    for (const line of analyzable.split('\n')) {
      const normalized = normalizeLine(line);
      if (normalized.length < this.options.minPhraseLength) continue;
      const count = (counts.get(normalized) ?? 0) + 1;
      counts.set(normalized, count);
      if (count >= this.options.maxPhraseRepeats) {
        return { kind: 'repeated-phrase', detail: normalized.slice(0, 120) };
      }
    }
    return undefined;
  }

  private checkAlternatingBlocks(analyzable: string): TextLoopSignal | undefined {
    const lines = analyzable
      .split('\n')
      .map(normalizeLine)
      .filter((line) => line.length > 0);
    const tail = lines.slice(-32);
    // Walk the suffix backwards: the alternating run covers every index whose
    // line equals the line two places before it.
    let start = tail.length;
    for (let index = tail.length - 1; index >= 2; index -= 1) {
      if (tail[index] !== tail[index - 2]) break;
      start = index - 2;
    }
    const run = tail.slice(start);
    if (run.length < 6) return undefined;
    const first = run[0]!;
    const second = run[1]!;
    if (first.length < 8 || second.length < 8 || first === second) return undefined;
    return { kind: 'alternating-blocks', detail: `${first.slice(0, 60)} ⇄ ${second.slice(0, 60)}` };
  }

  private checkExactPeriod(analyzable: string): TextLoopSignal | undefined {
    const window = Math.min(analyzable.length, this.options.maxPeriodLength * 3);
    const tail = analyzable.slice(analyzable.length - window);
    const period = periodicSuffix(tail, this.options.maxPeriodLength);
    if (period === undefined) return undefined;
    return { kind: 'periodic-text', detail: `period ${String(period)} chars` };
  }
}

export function detectTextLoop(
  text: string,
  options: TextLoopDetectorOptions = {},
): TextLoopSignal | undefined {
  return new TextLoopDetector(options).push(text);
}
