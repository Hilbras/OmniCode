import { describe, expect, it } from 'vitest';

import {
  buildRecentContextText,
  flattenAndDropOldest,
  messageToText,
  truncateToolOutput,
} from '#/agent/fullCompaction/recentContext';
import {
  createAssistantMessage,
  createToolMessage,
  createUserMessage,
  type Message,
} from '#/llm-adapter/contract/message';

const estimate = (text: string): number => Math.ceil(text.length / 4);

describe('truncateToolOutput', () => {
  it('keeps short output untouched', () => {
    expect(truncateToolOutput('short', 100)).toBe('short');
  });

  it('marks truncated output', () => {
    const truncated = truncateToolOutput('x'.repeat(50), 10);
    expect(truncated.endsWith('\n[truncated]')).toBe(true);
    expect(truncated.length).toBeLessThan(50);
  });

  it('drops output entirely when the budget is zero', () => {
    expect(truncateToolOutput('anything', 0)).toBe('');
  });
});

describe('messageToText', () => {
  it('skips system messages', () => {
    expect(messageToText({ role: 'system', content: [{ type: 'text', text: 'x' }], toolCalls: [] }, 100)).toBe(
      '',
    );
  });

  it('labels user text', () => {
    expect(messageToText(createUserMessage('hello'), 100)).toBe('[User]: hello');
  });

  it('labels assistant text, reasoning and tool calls', () => {
    const message = createAssistantMessage(
      [
        { type: 'text', text: 'answer' },
        { type: 'think', think: 'because' },
      ],
      [{ type: 'function', id: 'call-1', name: 'Read', arguments: '{"path":"a.ts"}' }],
    );
    const text = messageToText(message, 100);
    expect(text).toContain('[Assistant]: answer');
    expect(text).toContain('[Assistant reasoning]: because');
    expect(text).toContain('[Assistant tool call]: Read(');
  });

  it('truncates tool results', () => {
    const message = createToolMessage('call-1', 'y'.repeat(50));
    const text = messageToText(message, 10);
    expect(text.startsWith('[Tool result]: ')).toBe(true);
    expect(text).toContain('[truncated]');
  });
});

describe('buildRecentContextText', () => {
  const conversation: Message[] = [
    createUserMessage('first request'),
    createAssistantMessage([{ type: 'text', text: 'first answer' }]),
    createUserMessage('second request'),
    createAssistantMessage([{ type: 'text', text: 'second answer' }]),
    createUserMessage('third request'),
    createAssistantMessage([{ type: 'text', text: 'third answer' }]),
  ];

  it('returns undefined when there is no budgeted content', () => {
    expect(buildRecentContextText([createUserMessage('only user')], 100, 100, estimate)).toBe(
      undefined,
    );
  });

  it('keeps the newest exchanges that fit the token budget', () => {
    const text = buildRecentContextText(conversation, 12, 1_250, estimate);
    expect(text).toContain('[Assistant]: third answer');
    expect(text).not.toContain('[Assistant]: first answer');
  });

  it('never keeps user messages', () => {
    const text = buildRecentContextText(conversation, 1_000, 1_250, estimate);
    expect(text).toBeDefined();
    expect(text).not.toContain('[User]:');
  });

  it('drops the oldest exchange when the budget is spent', () => {
    const text = buildRecentContextText(conversation, 4, 1_250, estimate);
    expect(text).toContain('[Assistant]: third answer');
    expect(text).not.toContain('[Assistant]: second answer');
  });
});

describe('flattenAndDropOldest', () => {
  const conversation: Message[] = [
    createUserMessage('first request'),
    createAssistantMessage([{ type: 'text', text: 'first answer' }]),
    createUserMessage('second request'),
    createAssistantMessage([{ type: 'text', text: 'second answer' }]),
  ];

  it('returns undefined when nothing can be flattened', () => {
    expect(flattenAndDropOldest([], 100, 1_250, estimate)).toBe(undefined);
  });

  it('notes how many older exchanges were omitted', () => {
    const flattened = flattenAndDropOldest(conversation, 30, 1_250, estimate);
    expect(flattened).toBeDefined();
    expect(flattened!.omitted).toBe(1);
    expect(flattened!.text.startsWith('[1 older exchange omitted]')).toBe(true);
    expect(flattened!.text).toContain('second request');
    expect(flattened!.text).not.toContain('first request');
  });

  it('keeps every exchange when the budget is generous', () => {
    const flattened = flattenAndDropOldest(conversation, 10_000, 1_250, estimate);
    expect(flattened).toBeDefined();
    expect(flattened!.omitted).toBe(0);
    expect(flattened!.text).toContain('first request');
    expect(flattened!.text).toContain('second answer');
  });

  it('truncates tool output inside the flattened text', () => {
    const withTool: Message[] = [
      createUserMessage('run it'),
      createToolMessage('call-1', 'z'.repeat(200)),
    ];
    const flattened = flattenAndDropOldest(withTool, 10_000, 20, estimate);
    expect(flattened).toBeDefined();
    expect(flattened!.text).toContain('[truncated]');
  });
});
