import { describe, expect, it } from 'vitest';

import {
  queryTranscript,
  type TranscriptEntry,
} from '#/agent/contextMemory/transcriptCursor';

const entries: readonly TranscriptEntry[] = [
  { seq: 3, agentId: 'worker', role: 'assistant', text: 'c' },
  { seq: 1, agentId: 'main', role: 'user', text: 'a' },
  { seq: 2, agentId: 'worker', role: 'user', text: 'b' },
];

describe('queryTranscript', () => {
  it('returns entries in sequence order', () => {
    expect(queryTranscript(entries).messages.map((m) => m.seq)).toEqual([1, 2, 3]);
  });

  it('filters by agent and resumes after a cursor', () => {
    const page = queryTranscript(entries, { agentId: 'worker', after: 1 });
    expect(page.messages.map((m) => m.seq)).toEqual([2, 3]);
  });

  it('pages with last and reports a next cursor', () => {
    const page = queryTranscript(entries, { last: 2 });
    expect(page.messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe(2);
  });

  it('bounds last to the configured maximum', () => {
    expect(queryTranscript(entries, { last: 999, maxLast: 2 }).messages).toHaveLength(2);
  });
});
