import { describe, expect, it } from 'vitest';

import type { FinishReason } from '#human/llm/finish-reason';
import {
  isOutputEscalationEnabled,
  OUTPUT_ESCALATION_WARNING_CODE,
  shouldContinueTruncatedTurn,
} from '#/agent/loop/outputEscalation';

const env = (value: string | undefined): NodeJS.ProcessEnv =>
  value === undefined ? {} : { OMNICODE_OUTPUT_ESCALATION: value };

describe('isOutputEscalationEnabled', () => {
  it('defaults on when the env key is unset', () => {
    expect(isOutputEscalationEnabled(env(undefined))).toBe(true);
    expect(isOutputEscalationEnabled({})).toBe(true);
  });

  it('disables on 0 or false, case- and space-insensitive', () => {
    for (const raw of ['0', 'false', 'FALSE', ' false ', '0 ']) {
      expect(isOutputEscalationEnabled(env(raw))).toBe(false);
    }
  });

  it('stays on for any other value', () => {
    for (const raw of ['1', 'true', 'yes', 'off-but-not-really']) {
      expect(isOutputEscalationEnabled(env(raw))).toBe(true);
    }
  });

  it('exposes a stable warning code', () => {
    expect(OUTPUT_ESCALATION_WARNING_CODE).toBe('output-escalation');
  });
});

describe('shouldContinueTruncatedTurn', () => {
  const base = {
    lastStopReason: 'truncated' as FinishReason,
    continued: false,
    enabled: true,
    stopRequested: false,
    outcome: 'done' as const,
  };

  it('continues a truncated done turn', () => {
    expect(shouldContinueTruncatedTurn(base)).toBe(true);
  });

  it('never continues twice in one turn', () => {
    expect(shouldContinueTruncatedTurn({ ...base, continued: true })).toBe(false);
  });

  it('respects the env kill switch', () => {
    expect(shouldContinueTruncatedTurn({ ...base, enabled: false })).toBe(false);
  });

  it('does not continue a turn the model asked to stop', () => {
    expect(shouldContinueTruncatedTurn({ ...base, stopRequested: true })).toBe(false);
  });

  it.each(['failed', 'aborted'] as const)('does not continue a %s run', (outcome) => {
    expect(shouldContinueTruncatedTurn({ ...base, outcome })).toBe(false);
  });

  it.each(['completed', 'tool_calls', 'other', 'filtered'] as const)(
    'does not continue when the stop reason is %s',
    (lastStopReason) => {
      expect(shouldContinueTruncatedTurn({ ...base, lastStopReason })).toBe(false);
    },
  );

  it('does not continue when no stop reason was recorded', () => {
    expect(shouldContinueTruncatedTurn({ ...base, lastStopReason: undefined })).toBe(false);
  });
});
