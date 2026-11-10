import type { LlmRequestConfig } from '#/llm/requester/requester';

export type OpaqueRejectionStep =
  | 'drop-cache-key'
  | 'drop-output-cap'
  | 'drop-tools'
  | 'drop-thinking';

const OPAQUE_REJECTION_STEPS: readonly OpaqueRejectionStep[] = [
  'drop-cache-key',
  'drop-output-cap',
  'drop-tools',
  'drop-thinking',
];

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const rec = error as { status?: unknown; statusCode?: unknown };
  if (typeof rec.status === 'number') return rec.status;
  if (typeof rec.statusCode === 'number') return rec.statusCode;
  return undefined;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error !== 'object' || error === null) return '';
  const rec = error as { message?: unknown };
  return typeof rec.message === 'string' ? rec.message : '';
}

export function isOpaqueRejection(error: unknown): boolean {
  const status = statusOf(error);
  if (status !== 400 && status !== 422) return false;
  const message = messageOf(error).trim();
  if (message.length === 0) return true;
  return message.toLowerCase().includes('status code (no body)');
}

export function degradeRequestConfig(
  config: LlmRequestConfig,
  step: OpaqueRejectionStep,
): LlmRequestConfig | undefined {
  switch (step) {
    case 'drop-cache-key':
      if (config.cacheKey === undefined) return undefined;
      return { ...config, cacheKey: undefined };
    case 'drop-output-cap':
      if (config.maxCompletionTokens === undefined) return undefined;
      return { ...config, maxCompletionTokens: undefined };
    case 'drop-tools':
      if ((config.tools ?? []).length === 0) return undefined;
      return { ...config, tools: [] };
    case 'drop-thinking':
      if (config.thinking === undefined) return undefined;
      return { ...config, thinking: undefined };
  }
}

export class OpaqueRejectionRecoveries {
  private readonly failed = new Map<string, Set<OpaqueRejectionStep>>();
  private readonly working = new Map<string, OpaqueRejectionStep>();

  workingStep(key: string): OpaqueRejectionStep | undefined {
    return this.working.get(key);
  }

  hasFailed(key: string, step: OpaqueRejectionStep): boolean {
    return this.failed.get(key)?.has(step) === true;
  }

  markFailed(key: string, step: OpaqueRejectionStep): void {
    const steps = this.failed.get(key) ?? new Set<OpaqueRejectionStep>();
    steps.add(step);
    this.failed.set(key, steps);
    if (this.working.get(key) === step) this.working.delete(key);
  }

  markWorking(key: string, step: OpaqueRejectionStep): void {
    this.working.set(key, step);
  }
}

export interface OpaqueRecoveryOutcome {
  readonly ok: boolean;
  readonly step?: OpaqueRejectionStep;
  readonly error?: unknown;
}

export async function recoverFromOpaqueRejection(input: {
  readonly modelKey: string;
  readonly config: LlmRequestConfig;
  readonly error: unknown;
  readonly recoveries: OpaqueRejectionRecoveries;
  readonly send: (config: LlmRequestConfig) => Promise<void>;
  readonly onRetry?: () => void;
}): Promise<OpaqueRecoveryOutcome> {
  const { recoveries, send } = input;
  let config = input.config;
  let error = input.error;
  for (const step of OPAQUE_REJECTION_STEPS) {
    if (recoveries.hasFailed(input.modelKey, step)) continue;
    const degraded = degradeRequestConfig(config, step);
    if (degraded === undefined) continue;
    input.onRetry?.();
    try {
      await send(degraded);
      recoveries.markWorking(input.modelKey, step);
      return { ok: true, step };
    } catch (error) {
      recoveries.markFailed(input.modelKey, step);
      if (!isOpaqueRejection(error)) return { ok: false, error: error };
      config = degraded;
    }
  }
  return { ok: false, error: error };
}
