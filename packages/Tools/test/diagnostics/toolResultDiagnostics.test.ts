import { describe, expect, it } from 'vitest';

import {
  ContextBudgetDiagnostics,
  ToolResultRetentionDiagnostics,
  diagnoseContextBudget,
  diagnoseToolResult,
  estimateTokens,
  truncateTextAtCharBoundary,
} from '#/diagnostics/toolResultDiagnostics';

describe('estimateTokens', () => {
  it('uses a deterministic four-chars-per-token estimate', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('truncateTextAtCharBoundary', () => {
  it('leaves text below the limit unchanged', () => {
    expect(truncateTextAtCharBoundary('hello', 20)).toBe('hello');
  });

  it('truncates and marks the result', () => {
    const result = truncateTextAtCharBoundary('abcdefghijklmnopqrstuvwxyz', 20, '...');
    expect(result).toBe('abcdefghijklmnopq...');
    expect(result.length).toBeLessThanOrEqual(20);
  });

  it('does not split a surrogate pair', () => {
    const result = truncateTextAtCharBoundary('ab😀cd', 3, '');
    expect(result).toBe('ab');
  });
});

describe('diagnoseToolResult', () => {
  it('reports a bounded result without messages', () => {
    const diagnostic = diagnoseToolResult({ output: 'hello', maxResultChars: 10 });
    expect(diagnostic.originalChars).toBe(5);
    expect(diagnostic.overResultLimit).toBe(false);
    expect(diagnostic.truncated).toBe(false);
    expect(diagnostic.messages).toEqual([]);
  });

  it('reports over-limit and retained diagnostics', () => {
    const diagnostic = diagnoseToolResult({
      toolName: 'Bash',
      output: 'x'.repeat(20),
      retainedChars: 10,
      maxResultChars: 15,
      maxRetainedChars: 1000,
      spilled: true,
      spillPath: '/tmp/spill.txt',
    });
    expect(diagnostic.overResultLimit).toBe(true);
    expect(diagnostic.overRetentionLimit).toBe(false);
    expect(diagnostic.truncated).toBe(true);
    expect(diagnostic.retentionRatio).toBeCloseTo(0.5);
    expect(diagnostic.messages).toHaveLength(3);
    expect(diagnostic.messages[2]).toContain('/tmp/spill.txt');
  });
});

describe('ToolResultRetentionDiagnostics', () => {
  it('aggregates recorded results', () => {
    const diagnostics = new ToolResultRetentionDiagnostics();
    diagnostics.record({ toolName: 'Read', originalChars: 100, retainedChars: 80, truncated: true });
    diagnostics.record({ toolName: 'Bash', originalChars: 50, retainedChars: 50, truncated: false });
    const snapshot = diagnostics.snapshot();
    expect(snapshot.totalOriginalChars).toBe(150);
    expect(snapshot.totalRetainedChars).toBe(130);
    expect(snapshot.truncatedRecords).toBe(1);
    expect(snapshot.estimatedTokens).toBe(33);
    diagnostics.clear();
    expect(diagnostics.snapshot().records).toEqual([]);
  });
});

describe('diagnoseContextBudget', () => {
  it('reports ok, warning, critical, and exhausted levels', () => {
    expect(diagnoseContextBudget({ contextWindowTokens: 100, usedTokens: 10 }).level).toBe('ok');
    expect(diagnoseContextBudget({ contextWindowTokens: 100, usedTokens: 80 }).level).toBe('warning');
    expect(diagnoseContextBudget({ contextWindowTokens: 100, usedTokens: 95 }).level).toBe('critical');
    expect(diagnoseContextBudget({ contextWindowTokens: 100, usedTokens: 100 }).level).toBe('exhausted');
  });

  it('accounts for reserved output and reports remaining tokens', () => {
    const diagnostic = new ContextBudgetDiagnostics().diagnose({
      contextWindowTokens: 1000,
      usedTokens: 700,
      reservedOutputTokens: 100,
    });
    expect(diagnostic.remainingTokens).toBe(200);
    expect(diagnostic.usedRatio).toBeCloseTo(0.7);
    expect(diagnostic.messages).toEqual([]);
  });

  it('flags a reservation larger than the remaining context', () => {
    const diagnostic = diagnoseContextBudget({
      contextWindowTokens: 100,
      usedTokens: 90,
      reservedOutputTokens: 50,
    });
    expect(diagnostic.remainingTokens).toBe(0);
    expect(diagnostic.level).toBe('critical');
    expect(diagnostic.messages.join('\n')).toContain('Reserved output tokens');
  });
});
