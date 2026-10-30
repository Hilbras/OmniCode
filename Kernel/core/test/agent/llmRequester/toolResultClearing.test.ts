import { describe, expect, it } from 'vitest';

import type { ContextMessage } from '#/agent/contextMemory/types';
import { ToolResultClearer } from '#/agent/llmRequester/toolResultClearing';
import type { Message } from '#/llm-adapter/contract/message';

const WINDOW = 200_000;

function exchange(id: string, chars: number): ContextMessage[] {
  return [
    {
      role: 'assistant',
      content: [],
      toolCalls: [{ type: 'function', id, name: 'Read', arguments: `{"path":"${id}.ts"}` }],
    },
    {
      role: 'tool',
      content: [{ type: 'text', text: 'x'.repeat(chars) }],
      toolCalls: [],
      toolCallId: id,
    },
  ];
}

function history(count: number, chars: number, prefix = 'call'): ContextMessage[] {
  const messages: ContextMessage[] = [
    { role: 'user', content: [{ type: 'text', text: 'go' }], toolCalls: [] },
  ];
  for (let i = 0; i < count; i++) messages.push(...exchange(`${prefix}-${String(i)}`, chars));
  return messages;
}

function clearedIds(messages: readonly Message[]): string[] {
  return messages.flatMap((message) =>
    message.role === 'tool' &&
    message.content.some(
      (part) => part.type === 'text' && part.text.startsWith('[Earlier tool result cleared'),
    )
      ? [message.toolCallId!]
      : [],
  );
}

describe('ToolResultClearer', () => {
  it('returns the history unchanged below the trigger ratio', () => {
    const clearer = new ToolResultClearer();
    const messages = history(10, 4_000);

    expect(clearer.apply(messages, WINDOW)).toBe(messages);
  });

  it('clears older tool results and keeps the recent window once over the trigger', () => {
    const clearer = new ToolResultClearer();
    const messages = history(30, 16_000);

    const cleared = clearedIds(clearer.apply(messages, WINDOW));

    expect(cleared).toEqual(Array.from({ length: 26 }, (_, i) => `call-${String(i)}`));
  });

  it('names the original call in the stub', () => {
    const clearer = new ToolResultClearer();
    const result = clearer.apply(history(30, 16_000), WINDOW);
    const stub = result.find((message) => message.toolCallId === 'call-0')!;

    expect(stub.content).toEqual([
      {
        type: 'text',
        text: '[Earlier tool result cleared to save context: Read({"path":"call-0.ts"}) returned about 4001 tokens. Run the tool again if you need this output.]',
      },
    ]);
  });

  it('keeps earlier clears sticky and waits for a full batch before clearing more', () => {
    const clearer = new ToolResultClearer();
    const messages = history(30, 16_000);
    const first = clearedIds(clearer.apply(messages, WINDOW));

    const grown = [...messages, ...exchange('next-0', 16_000)];
    const second = clearedIds(clearer.apply(grown, WINDOW));

    expect(second).toEqual(first);
  });

  it('forgets cleared results that left the history', () => {
    const clearer = new ToolResultClearer();
    clearer.apply(history(30, 16_000), WINDOW);

    const replaced = history(3, 400, 'fresh');

    expect(clearer.apply(replaced, WINDOW)).toBe(replaced);
  });

  it('never clears results that carry media', () => {
    const clearer = new ToolResultClearer();
    const messages = history(30, 16_000);
    const withImage = messages.map((message) =>
      message.toolCallId === 'call-0'
        ? {
            ...message,
            content: [
              ...message.content,
              { type: 'image_url' as const, imageUrl: { url: 'https://example.test/a.png' } },
            ],
          }
        : message,
    );

    expect(clearedIds(clearer.apply(withImage, WINDOW))).not.toContain('call-0');
  });

  it('does nothing when the context window is unknown', () => {
    const clearer = new ToolResultClearer();
    const messages = history(30, 16_000);

    expect(clearer.apply(messages, 0)).toBe(messages);
  });
});
