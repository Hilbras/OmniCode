export const DEFAULT_DIAGNOSTIC_RESULT_MAX_CHARS = 50_000;
export const DEFAULT_DIAGNOSTIC_RETAINED_MAX_CHARS = 10_000_000;
export const CHARS_PER_TOKEN_ESTIMATE = 4;

export interface ToolResultDiagnosticInput {
  readonly toolName?: string;
  readonly output: string;
  readonly retainedChars?: number;
  readonly maxResultChars?: number;
  readonly maxRetainedChars?: number;
  readonly spilled?: boolean;
  readonly spillPath?: string;
}

export interface ToolResultDiagnostic {
  readonly toolName?: string;
  readonly originalChars: number;
  readonly retainedChars: number;
  readonly maxResultChars: number;
  readonly maxRetainedChars: number;
  readonly estimatedTokens: number;
  readonly overResultLimit: boolean;
  readonly overRetentionLimit: boolean;
  readonly truncated: boolean;
  readonly retentionRatio: number;
  readonly spilled: boolean;
  readonly spillPath?: string;
  readonly messages: readonly string[];
}

export interface ToolResultRetentionRecord {
  readonly toolName: string;
  readonly originalChars: number;
  readonly retainedChars: number;
  readonly truncated: boolean;
}

export interface ToolResultRetentionSnapshot {
  readonly records: readonly ToolResultRetentionRecord[];
  readonly totalOriginalChars: number;
  readonly totalRetainedChars: number;
  readonly truncatedRecords: number;
  readonly estimatedTokens: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

export function truncateTextAtCharBoundary(
  text: string,
  maxChars: number,
  marker = '\n...[truncated]',
): string {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  if (marker.length >= maxChars) return marker.slice(0, maxChars);
  let end = maxChars - marker.length;
  if (end > 0 && end < text.length) {
    const code = text.charCodeAt(end - 1);
    const next = text.charCodeAt(end);
    if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
  }
  return text.slice(0, end) + marker;
}

export function diagnoseToolResult(input: ToolResultDiagnosticInput): ToolResultDiagnostic {
  const maxResultChars = input.maxResultChars ?? DEFAULT_DIAGNOSTIC_RESULT_MAX_CHARS;
  const maxRetainedChars = input.maxRetainedChars ?? DEFAULT_DIAGNOSTIC_RETAINED_MAX_CHARS;
  const originalChars = input.output.length;
  const retainedChars = input.retainedChars ?? originalChars;
  const overResultLimit = originalChars > maxResultChars;
  const overRetentionLimit = originalChars > maxRetainedChars;
  const retentionRatio = originalChars === 0 ? 1 : retainedChars / originalChars;
  const messages: string[] = [];
  if (overResultLimit) {
    messages.push(
      `Tool result is ${String(originalChars)} chars, over the ${String(maxResultChars)}-char model result limit.`,
    );
  }
  if (overRetentionLimit) {
    messages.push(
      `Tool result is ${String(originalChars)} chars, over the ${String(maxRetainedChars)}-char retained result limit.`,
    );
  }
  if (retainedChars < originalChars) {
    messages.push(
      `Only ${String(retainedChars)} of ${String(originalChars)} chars were retained (${(retentionRatio * 100).toFixed(1)}%).`,
    );
  }
  if (input.spilled === true) {
    messages.push(
      input.spillPath === undefined
        ? 'The full result was spilled outside the conversation.'
        : `The full result was spilled to ${input.spillPath}.`,
    );
  }
  return {
    ...(input.toolName === undefined ? {} : { toolName: input.toolName }),
    originalChars,
    retainedChars,
    maxResultChars,
    maxRetainedChars,
    estimatedTokens: estimateTokens(input.output),
    overResultLimit,
    overRetentionLimit,
    truncated: retainedChars < originalChars || overResultLimit,
    retentionRatio,
    spilled: input.spilled === true,
    ...(input.spillPath === undefined ? {} : { spillPath: input.spillPath }),
    messages,
  };
}

export class ToolResultRetentionDiagnostics {
  private readonly records: ToolResultRetentionRecord[] = [];

  record(record: ToolResultRetentionRecord): void {
    this.records.push(record);
  }

  clear(): void {
    this.records.length = 0;
  }

  snapshot(): ToolResultRetentionSnapshot {
    let totalOriginalChars = 0;
    let totalRetainedChars = 0;
    let truncatedRecords = 0;
    for (const record of this.records) {
      totalOriginalChars += record.originalChars;
      totalRetainedChars += record.retainedChars;
      if (record.truncated) truncatedRecords += 1;
    }
    return {
      records: this.records.map((record) => ({ ...record })),
      totalOriginalChars,
      totalRetainedChars,
      truncatedRecords,
      estimatedTokens: Math.ceil(totalRetainedChars / CHARS_PER_TOKEN_ESTIMATE),
    };
  }
}

export interface ContextBudgetInput {
  readonly contextWindowTokens: number;
  readonly usedTokens: number;
  readonly reservedOutputTokens?: number;
  readonly toolResultTokens?: number;
  readonly systemPromptTokens?: number;
}

export interface ContextBudgetDiagnostic {
  readonly contextWindowTokens: number;
  readonly usedTokens: number;
  readonly reservedOutputTokens: number;
  readonly toolResultTokens: number;
  readonly systemPromptTokens: number;
  readonly remainingTokens: number;
  readonly usedRatio: number;
  readonly level: 'ok' | 'warning' | 'critical' | 'exhausted';
  readonly messages: readonly string[];
}

export const CONTEXT_BUDGET_WARNING_RATIO = 0.75;
export const CONTEXT_BUDGET_CRITICAL_RATIO = 0.9;

export function diagnoseContextBudget(input: ContextBudgetInput): ContextBudgetDiagnostic {
  const contextWindowTokens = Math.max(0, input.contextWindowTokens);
  const usedTokens = Math.max(0, input.usedTokens);
  const reservedOutputTokens = Math.max(0, input.reservedOutputTokens ?? 0);
  const toolResultTokens = Math.max(0, input.toolResultTokens ?? 0);
  const systemPromptTokens = Math.max(0, input.systemPromptTokens ?? 0);
  const remainingTokens = Math.max(0, contextWindowTokens - usedTokens - reservedOutputTokens);
  const usedRatio = contextWindowTokens === 0 ? 1 : usedTokens / contextWindowTokens;
  const level: ContextBudgetDiagnostic['level'] =
    usedRatio >= 1
      ? 'exhausted'
      : usedRatio >= CONTEXT_BUDGET_CRITICAL_RATIO
        ? 'critical'
        : usedRatio >= CONTEXT_BUDGET_WARNING_RATIO
          ? 'warning'
          : 'ok';
  const messages: string[] = [];
  if (level === 'exhausted') {
    messages.push('Context budget is exhausted; new tool results may be truncated or rejected.');
  } else if (level === 'critical') {
    messages.push('Context budget is critical; prefer targeted reads and bounded tool results.');
  } else if (level === 'warning') {
    messages.push('Context budget is above the warning threshold.');
  }
  if (reservedOutputTokens > remainingTokens) {
    messages.push(
      `Reserved output tokens (${String(reservedOutputTokens)}) exceed the remaining context (${String(remainingTokens)}).`,
    );
  }
  return {
    contextWindowTokens,
    usedTokens,
    reservedOutputTokens,
    toolResultTokens,
    systemPromptTokens,
    remainingTokens,
    usedRatio,
    level,
    messages,
  };
}

export class ContextBudgetDiagnostics {
  diagnose(input: ContextBudgetInput): ContextBudgetDiagnostic {
    return diagnoseContextBudget(input);
  }
}
