import { describe, expect, it } from 'vitest';
import {
  activeSession,
  createMessage,
  createSession,
  initialState,
  reducer,
} from '../src/lib/state';
import { defaultSettings } from '../src/lib/types';

function withSession() {
  const session = createSession('anthropic', 'claude-sonnet-4-5');
  const state = reducer(initialState, { type: 'newSession', session });
  return { state, session };
}

describe('state reducer', () => {
  it('creates and selects a session', () => {
    const { state, session } = withSession();
    expect(state.sessions).toHaveLength(1);
    expect(state.activeSessionId).toBe(session.id);
    expect(activeSession(state)?.id).toBe(session.id);
  });

  it('derives the title from the first user message', () => {
    const { state, session } = withSession();
    const message = createMessage('user', 'Refactor the auth middleware please');
    const next = reducer(state, { type: 'addMessage', sessionId: session.id, message });
    expect(next.sessions[0]?.title).toBe('Refactor the auth middleware please');
  });

  it('does not retitle on later messages', () => {
    const { state, session } = withSession();
    let next = reducer(state, {
      type: 'addMessage',
      sessionId: session.id,
      message: createMessage('user', 'First question'),
    });
    next = reducer(next, {
      type: 'addMessage',
      sessionId: session.id,
      message: createMessage('user', 'Second question'),
    });
    expect(next.sessions[0]?.title).toBe('First question');
  });

  it('streams text by appending chunks', () => {
    const { state, session } = withSession();
    const message = createMessage('assistant', '');
    let next = reducer(state, { type: 'addMessage', sessionId: session.id, message });
    next = reducer(next, { type: 'appendText', sessionId: session.id, messageId: message.id, chunk: 'Hel' });
    next = reducer(next, { type: 'appendText', sessionId: session.id, messageId: message.id, chunk: 'lo' });
    expect(next.sessions[0]?.messages[0]?.text).toBe('Hello');
  });

  it('tracks tool call lifecycle', () => {
    const { state, session } = withSession();
    const message = createMessage('assistant', '');
    let next = reducer(state, { type: 'addMessage', sessionId: session.id, message });
    const toolCall = { id: 'tc1', tool: 'web_search' as const, args: { query: 'x' }, status: 'running' as const };
    next = reducer(next, { type: 'addToolCall', sessionId: session.id, messageId: message.id, toolCall });
    next = reducer(next, {
      type: 'patchToolCall',
      sessionId: session.id,
      messageId: message.id,
      toolCallId: 'tc1',
      patch: { status: 'done', result: 'ok' },
    });
    const stored = next.sessions[0]?.messages[0]?.toolCalls[0];
    expect(stored?.status).toBe('done');
    expect(stored?.result).toBe('ok');
  });

  it('deletes and restores a session at its original index', () => {
    const first = createSession('openai', 'gpt-5.2');
    const second = createSession('anthropic', 'claude-sonnet-4-5');
    let state = reducer(initialState, { type: 'newSession', session: first });
    state = reducer(state, { type: 'newSession', session: second });
    state = reducer(state, { type: 'deleteSession', id: second.id });
    expect(state.sessions).toHaveLength(1);
    expect(state.activeSessionId).toBe(first.id);
    state = reducer(state, { type: 'restoreSession', session: second, index: 0 });
    expect(state.sessions[0]?.id).toBe(second.id);
    expect(state.activeSessionId).toBe(second.id);
  });

  it('clears sessions but keeps settings', () => {
    let { state } = withSession();
    state = reducer(state, { type: 'updateSettings', patch: { haptics: false } });
    state = reducer(state, { type: 'clearAll' });
    expect(state.sessions).toHaveLength(0);
    expect(state.activeSessionId).toBeNull();
    expect(state.settings.haptics).toBe(false);
    expect(state.hydrated).toBe(true);
  });

  it('hydrates persisted state', () => {
    const session = createSession('google', 'gemini-3-pro');
    const state = reducer(initialState, {
      type: 'hydrate',
      sessions: [session],
      activeSessionId: session.id,
      settings: { ...defaultSettings, streaming: false },
    });
    expect(state.hydrated).toBe(true);
    expect(state.settings.streaming).toBe(false);
    expect(activeSession(state)?.id).toBe(session.id);
  });
});
