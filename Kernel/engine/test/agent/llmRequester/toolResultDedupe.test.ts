import { describe, expect, it } from 'vitest';

import type { ContextMessage } from '#/agent/contextMemory/types';
import { dedupeRepeatedToolResults } from '#/agent/llmRequester/toolResultDedupe';

function exchange(id: string, text: string, name = 'Read'): ContextMessage[] {
  return [
    {
      role: 'assistant',
      content: [],
      toolCalls: [{ type: 'function', id, name, arguments: `{"path":"${id}.ts"}` }],
    },
    {
      role: 'tool',
      content: [{ type: 'text', text }],
      toolCalls: [],
      toolCallId: id,
    },
  ];
}

function prompt(): ContextMessage {
  return { role: 'user', content: [{ type: 'text', text: 'go' }], toolCalls: [] };
}

function textOf(message: ContextMessage): string {
  return message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');
}

const BODY = 'line\n'.repeat(200);

describe('dedupeRepeatedToolResults', () => {
  it('leaves a single result alone', () => {
    const messages = [prompt(), ...exchange('a', BODY)];

    const outcome = dedupeRepeatedToolResults(messages);

    expect(outcome.replaced).toBe(0);
    expect(outcome.messages).toBe(messages);
  });

  it('replaces a later identical result with a pointer to the first', () => {
    const messages = [prompt(), ...exchange('a', BODY), ...exchange('b', BODY)];

    const outcome = dedupeRepeatedToolResults(messages);

    expect(outcome.replaced).toBe(1);
    const first = outcome.messages.find((message) => message.toolCallId === 'a')!;
    const second = outcome.messages.find((message) => message.toolCallId === 'b')!;
    expect(textOf(first)).toBe(BODY);
    expect(textOf(second)).toContain('Identical to the earlier result of Read({"path":"a.ts"})');
    expect(textOf(second)).toContain('tool call a');
    expect(textOf(second)).toContain('1000 chars');
  });

  it('leaves results that differ alone', () => {
    const messages = [prompt(), ...exchange('a', BODY), ...exchange('b', `${BODY}extra`)];

    expect(dedupeRepeatedToolResults(messages).replaced).toBe(0);
  });

  it('ignores results too small for a pointer to be worth it', () => {
    const messages = [prompt(), ...exchange('a', 'short'), ...exchange('b', 'short')];

    expect(dedupeRepeatedToolResults(messages).replaced).toBe(0);
  });

  it('ignores results that carry media', () => {
    const withImage = (id: string): ContextMessage[] => {
      const [assistant, tool] = exchange(id, BODY) as [ContextMessage, ContextMessage];
      return [
        assistant,
        {
          ...tool,
          content: [
            ...tool.content,
            { type: 'image_url' as const, imageUrl: { url: 'https://example.test/a.png' } },
          ],
        },
      ];
    };
    const messages = [prompt(), ...withImage('a'), ...withImage('b')];

    expect(dedupeRepeatedToolResults(messages).replaced).toBe(0);
  });

  it('collapses three copies into one canonical result and two pointers', () => {
    const messages = [
      prompt(),
      ...exchange('a', BODY),
      ...exchange('b', BODY),
      ...exchange('c', BODY),
    ];

    const outcome = dedupeRepeatedToolResults(messages);

    expect(outcome.replaced).toBe(2);
    expect(textOf(outcome.messages.find((message) => message.toolCallId === 'a')!)).toBe(BODY);
    expect(textOf(outcome.messages.find((message) => message.toolCallId === 'c')!)).toContain(
      'tool call a',
    );
  });

  it('is idempotent', () => {
    const messages = [prompt(), ...exchange('a', BODY), ...exchange('b', BODY)];
    const once = dedupeRepeatedToolResults(messages);

    const twice = dedupeRepeatedToolResults(once.messages);

    expect(twice.replaced).toBe(0);
    expect(twice.messages).toBe(once.messages);
  });
});