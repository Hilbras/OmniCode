import { describe, expect, it } from 'vitest';

import {
  decideSpeculativeCompaction,
  isCompiledSummaryFresh,
  type CompiledSummary,
} from '#/agent/contextMemory/speculativeCompaction';

const summary = (fingerprint: string): CompiledSummary => ({
  fingerprint, text: 'summary', compiledAt: 1,
});

describe('decideSpeculativeCompaction', () => {
  it('stays idle well below the ceiling', () => {
    expect(decideSpeculativeCompaction(
      { tokens: 100, triggerTokens: 1000, fingerprint: 'a' }, undefined,
    ).action).toBe('idle');
  });

  it('compiles early at the speculative threshold and immediately at the ceiling', () => {
    expect(decideSpeculativeCompaction(
      { tokens: 700, triggerTokens: 1000, fingerprint: 'a' }, undefined,
    ).action).toBe('compile');
    expect(decideSpeculativeCompaction(
      { tokens: 1000, triggerTokens: 1000, fingerprint: 'a' }, undefined,
    ).action).toBe('compile');
  });

  it('installs only a compiled summary with a matching fingerprint', () => {
    expect(decideSpeculativeCompaction(
      { tokens: 900, triggerTokens: 1000, fingerprint: 'a' }, summary('a'),
    ).action).toBe('install');
    expect(decideSpeculativeCompaction(
      { tokens: 900, triggerTokens: 1000, fingerprint: 'b' }, summary('a'),
    ).action).toBe('compile');
  });

  it('honours a custom ratio', () => {
    expect(decideSpeculativeCompaction(
      { tokens: 550, triggerTokens: 1000, fingerprint: 'a' }, undefined, 0.5,
    ).action).toBe('compile');
  });
});

describe('isCompiledSummaryFresh', () => {
  it('requires a match and non-empty text', () => {
    expect(isCompiledSummaryFresh(summary('a'), 'a')).toBe(true);
    expect(isCompiledSummaryFresh(summary('a'), 'b')).toBe(false);
    expect(isCompiledSummaryFresh(undefined, 'a')).toBe(false);
    expect(isCompiledSummaryFresh({ ...summary('a'), text: '' }, 'a')).toBe(false);
  });
});
