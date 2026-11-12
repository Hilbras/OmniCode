import { describe, expect, it } from 'vitest';

import {
  agentMemoryRecallProperties,
  agentPermissionProperties,
  agentSandboxProperties,
  agentToolProperties,
  agentTurnProperties,
} from '#/agentMetrics';

describe('agent telemetry properties', () => {
  it('keeps turn metrics numeric and bounded', () => {
    expect(agentTurnProperties({ durationMs: 12.6, status: 'completed', toolCalls: 3, retries: -1 })).toEqual({
      duration_ms: 13,
      status: 'completed',
      tool_calls: 3,
      retries: 0,
    });
  });

  it('does not accept arbitrary text in tool names', () => {
    expect(agentToolProperties({ toolName: 'Bash rm -rf / secret', durationMs: 1, status: 'ok' })).toMatchObject({
      tool: 'Bash_rm_-rf___secret',
    });
  });

  it('emits only permission enums and safe policy/tool names', () => {
    expect(
      agentPermissionProperties({ mode: 'auto', decision: 'ask', policy: 'auto-mode-classifier', toolName: 'Write' }),
    ).toEqual({ mode: 'auto', decision: 'ask', policy: 'auto-mode-classifier', tool: 'Write' });
  });

  it('emits memory counts without content', () => {
    expect(
      agentMemoryRecallProperties({ purpose: 'auto_inject', status: 'complete', resultCount: 2, durationMs: 9, tokens: 120 }),
    ).toEqual({ purpose: 'auto_inject', status: 'complete', result_count: 2, duration_ms: 9, tokens: 120 });
  });

  it('emits sandbox outcome without paths or commands', () => {
    expect(agentSandboxProperties({ mode: 'auto', backend: 'bwrap', outcome: 'fallback' })).toEqual({
      mode: 'auto',
      backend: 'bwrap',
      outcome: 'fallback',
    });
  });
});
