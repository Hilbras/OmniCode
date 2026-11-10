export interface MemoryPolicySettings {
  readonly enabled: boolean;
  readonly dir: string;
  readonly maxContentChars: number;
  readonly workingTtlMs: number;
  readonly workingGraceMs: number;
  readonly reviewMaxAttempts: number;
  readonly reviewBackoffMs: number;
  readonly maxQueuedReviews: number;
}

export const DEFAULT_MEMORY_SETTINGS: MemoryPolicySettings = Object.freeze({
  enabled: true,
  dir: '',
  maxContentChars: 4000,
  workingTtlMs: 6 * 60 * 60 * 1000,
  workingGraceMs: 24 * 60 * 60 * 1000,
  reviewMaxAttempts: 3,
  reviewBackoffMs: 30_000,
  maxQueuedReviews: 500,
});