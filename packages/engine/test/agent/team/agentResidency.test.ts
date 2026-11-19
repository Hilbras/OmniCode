import { describe, expect, it } from 'vitest';

import {
  decideResidency,
  unloadAgent,
  DEFAULT_IDLE_UNLOAD_MS,
  type ResidencyState,
} from '#/agent/team/agentResidency';

const state = (overrides: Partial<ResidencyState> = {}): ResidencyState => ({
  agentId: 'worker-1', lastActiveAt: 0, pendingMail: 0, runningToolCalls: 0, ...overrides,
});

describe('decideResidency', () => {
  it('keeps a busy agent regardless of age', () => {
    expect(decideResidency(state({ runningToolCalls: 1 }), 10 * DEFAULT_IDLE_UNLOAD_MS).kind)
      .toBe('keep');
  });

  it('keeps an agent with pending mail even when idle', () => {
    const decision = decideResidency(state({ pendingMail: 2 }), 10 * DEFAULT_IDLE_UNLOAD_MS);
    expect(decision).toEqual({ kind: 'keep', reason: 'unread mail must be delivered before unload' });
  });

  it('waits for the idle window before unloading', () => {
    expect(decideResidency(state(), DEFAULT_IDLE_UNLOAD_MS - 1).kind).toBe('keep');
    expect(decideResidency(state(), DEFAULT_IDLE_UNLOAD_MS).kind).toBe('unload');
  });
});

describe('unloadAgent', () => {
  it('records the unload and preserves the mail count', () => {
    expect(unloadAgent(state(), DEFAULT_IDLE_UNLOAD_MS)).toEqual({
      agentId: 'worker-1', unloadedAt: DEFAULT_IDLE_UNLOAD_MS, preservedMail: 0,
    });
  });

  it('refuses to unload an agent that still has mail', () => {
    expect(() => unloadAgent(state({ pendingMail: 1 }), 0)).toThrow(/Cannot unload/);
  });
});
