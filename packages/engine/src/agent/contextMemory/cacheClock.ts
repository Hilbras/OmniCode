/**
 * Prompt-cache clock and retained tool outputs (unified plan C5).
 *
 * Instructions are ordered most-shared-first so the prefix stays reusable;
 * cache warmth is derived from guaranteed/estimated windows; and tool outputs
 * explicitly marked `retainAcrossWindows` survive a compaction boundary.
 * References: Hermes `prompt_cache_clock.py:1-45`, Codex
 * `compact_retained_tool_outputs.rs:6-13`.
 */
export interface CacheClockState {
  readonly now: number;
  readonly lastPromptAt: number;
  readonly guaranteedMs: number;
  readonly estimatedMs: number;
}

export type CacheState = 'warm' | 'estimated' | 'cold';

export function cacheState(input: CacheClockState): CacheState {
  const age = input.now - input.lastPromptAt;
  if (age <= input.guaranteedMs) return 'warm';
  if (age <= input.estimatedMs) return 'estimated';
  return 'cold';
}

export interface InstructionSource {
  readonly name: string;
  /** Higher means shared by more sessions — goes earlier in the prefix. */
  readonly sharedness: number;
}

export function orderInstructions(sources: readonly InstructionSource[]): readonly string[] {
  return [...sources]
    .sort((a, b) => b.sharedness - a.sharedness || a.name.localeCompare(b.name))
    .map((source) => source.name);
}

export interface RetainedToolOutput {
  readonly callId: string;
  readonly summary: string;
  readonly retainAcrossWindows: boolean;
}

export function retainedAcrossCompaction(
  outputs: readonly RetainedToolOutput[],
): readonly RetainedToolOutput[] {
  return outputs.filter((output) => output.retainAcrossWindows && output.summary.length > 0);
}
