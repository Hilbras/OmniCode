import { describe, expect, it } from 'vitest';

import { EMPTY_HANDLE_MESSAGE, projectionFromEntry } from '#/agent/loop/projection';
import { createUserEntry } from '#human/agent/turn';

describe('projectionFromEntry', () => {
  it('defaults origin and ids when metadata is absent', () => {
    const projection = projectionFromEntry(
      createUserEntry({ role: 'user', content: [{ type: 'text', text: 'hi' }] }),
    );
    expect(projection.origin).toEqual({ kind: 'user' });
    expect(projection.userMessageId).toBe('');
    expect(projection.createdAt).toBe('');
    expect(projection.tracked).toBe(false);
    expect(projection.message.content).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('carries prompt metadata through to the projection', () => {
    const projection = projectionFromEntry(
      createUserEntry(
        { role: 'user', content: [{ type: 'text', text: 'go' }] },
        {
          promptId: 'p1',
          origin: { kind: 'system_trigger', name: 'hook' } as never,
          tracked: true,
          userMessageId: 'u1',
          createdAt: '2026-01-01',
        },
      ),
    );
    expect(projection.message.id).toBe('p1');
    expect(projection.tracked).toBe(true);
    expect(projection.userMessageId).toBe('u1');
    expect(projection.createdAt).toBe('2026-01-01');
  });

  it('exposes an empty handle message', () => {
    expect(EMPTY_HANDLE_MESSAGE.content).toEqual([]);
  });
});
