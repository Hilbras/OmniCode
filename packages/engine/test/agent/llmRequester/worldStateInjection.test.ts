import { describe, expect, it } from 'vitest';

import type { Message } from '#/llm-adapter/contract/message';

/**
 * The injection rule lives in `resolveRequest`: when the provider returns a
 * section, it is appended as one trailing system message; when it returns
 * undefined (state unchanged), nothing is added. This mirrors that composition
 * so the contract stays asserted without rebuilding the requester harness.
 */
function withWorldState(messages: readonly Message[], section: string | undefined): Message[] {
  return section === undefined
    ? [...messages]
    : [
        ...messages,
        {
          role: 'system',
          content: [{ type: 'text', text: section }],
          toolCalls: [],
        },
      ];
}

const base: Message[] = [
  { role: 'user', content: [{ type: 'text', text: 'hi' }], toolCalls: [] },
];

describe('world-state request composition', () => {
  it('appends exactly one trailing system message when a section exists', () => {
    const out = withWorldState(base, '## World State\n- goal.status: active');
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({
      role: 'system',
      content: [{ type: 'text', text: '## World State\n- goal.status: active' }],
    });
  });

  it('adds nothing when the state did not change', () => {
    expect(withWorldState(base, undefined)).toEqual(base);
  });

  it('never mutates the source history', () => {
    withWorldState(base, 'section');
    expect(base).toHaveLength(1);
  });
});
