import { describe, expect, it } from 'vitest';

import { idleLiveTurn, reduceLiveTurn } from '../src/api/sessionEvents';

const SESSION = 's1';

function assistantDelta(text: string) {
  return {
    type: 'assistantDelta' as const,
    sessionId: SESSION,
    messageId: 'm1',
    contentIndex: 0,
    delta: { text },
  };
}

describe('live turn projection', () => {
  it('accumulates assistant deltas for the open session only', () => {
    let state = reduceLiveTurn(idleLiveTurn, assistantDelta('Hello '), SESSION);
    state = reduceLiveTurn(state, assistantDelta('world'), SESSION);
    expect(state.streamingText).toBe('Hello world');
    expect(state.busy).toBe(true);

    const other = reduceLiveTurn(state, assistantDelta('noise'), 'other-session');
    expect(other.streamingText).toBe('Hello world');
  });

  it('flags thinking without text deltas', () => {
    const state = reduceLiveTurn(idleLiveTurn, {
      type: 'assistantDelta',
      sessionId: SESSION,
      messageId: 'm1',
      contentIndex: 0,
      delta: { thinking: 'reasoning…' },
    }, SESSION);
    expect(state.thinking).toBe(true);
    expect(state.streamingText).toBe('');
  });

  it('requests a refetch when persisted messages change', () => {
    const created = reduceLiveTurn(idleLiveTurn, {
      type: 'messageCreated',
      sessionId: SESSION,
      message: { id: 'm1', role: 'assistant', content: [], createdAt: '', updatedAt: '' },
    } as never, SESSION);
    expect(created.refetch).toBe(true);
  });

  it('clears the buffer and refetches when the turn ends', () => {
    let state = reduceLiveTurn(idleLiveTurn, assistantDelta('partial'), SESSION);
    state = reduceLiveTurn(state, {
      type: 'sessionWorkChanged',
      sessionId: SESSION,
      busy: false,
    }, SESSION);
    expect(state.streamingText).toBe('');
    expect(state.busy).toBe(false);
    expect(state.refetch).toBe(true);
  });

  it('marks busy without refetch on work start', () => {
    const state = reduceLiveTurn(idleLiveTurn, {
      type: 'sessionWorkChanged',
      sessionId: SESSION,
      busy: true,
    }, SESSION);
    expect(state.busy).toBe(true);
    expect(state.refetch).toBe(false);
  });
});
