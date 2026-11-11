import { describe, expect, it } from 'vitest';
import type { DaemonOmnicodeWebApi } from '../src/api';
import { createOmnicodeWebClientCore } from '../src/client/createOmnicodeWebClientCore';

describe('createOmnicodeWebClientCore', () => {
  it('creates two isolated clients (no shared singleton state)', () => {
    const api = {} as unknown as DaemonOmnicodeWebApi;
    const a = createOmnicodeWebClientCore({ api });
    const b = createOmnicodeWebClientCore({ api });
    a.state.activeSessionId = 'x';
    expect(b.state.activeSessionId).not.toBe('x');
    expect(a.state).not.toBe(b.state);
  });
});
