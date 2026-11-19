import { describe, expect, it } from 'vitest';

import {
  estimateContextTokens,
  estimateMessageTokens,
  microcompactContext,
} from '#/agent/contextMemory/microcompaction';
import type { ContextMessage } from '#/agent/contextMemory/types';
import { historyFromContext } from '#/agent/loop/machine/history';

const big = (chars: number): string => 'x'.repeat(chars);

function system(text = 'system'): ContextMessage {
  return { role: 'system', content: [{ type: 'text', text }], toolCalls: [] };
}

function user(text: string): ContextMessage {
  return { role: 'user', content: [{ type: 'text', text }], toolCalls: [] };
}

function assistant(callId: string): ContextMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'calling tool' }],
    toolCalls: [{ type: 'function', id: callId, name: 'Read', arguments: '{"path":"a.ts"}' }],
  };
}

function tool(callId: string, text: string): ContextMessage {
  return { role: 'tool', content: [{ type: 'text', text }], toolCalls: [], toolCallId: callId };
}

describe('microcompaction', () => {
  it('does nothing below the trigger', () => {
    const messages = [system(), user('hi'), assistant('c1'), tool('c1', 'ok')];
    const result = microcompactContext(messages, { triggerTokens: 10_000, targetTokens: 5_000 });
    expect(result.truncated).toBe(false);
    expect(result.messages).toBe(messages);
  });

  it('evicts a stale result below the token trigger using the live clock (WS3.1)', () => {
    const messages = [
      { ...assistant('c1'), id: 'm1' },
      { ...tool('c1', big(200)), id: 'm2' },
      user('latest'),
    ];
    const base = {
      triggerTokens: 100_000,
      targetTokens: 50_000,
      keepRecentMessages: 0,
      keepRecentUserMessages: 0,
      maxMessageAgeMs: 1_000,
      messageTimes: { m1: 100, m2: 100 },
      now: 10_000,
    };
    const result = microcompactContext(messages, base);
    expect(result.truncated).toBe(true);
    expect(result.evictedToolResults).toBeGreaterThan(0);

    const fresh = microcompactContext(messages, { ...base, messageTimes: { m1: 9_900, m2: 9_900 } });
    expect(fresh.truncated).toBe(false);
    const disabled = microcompactContext(messages, { ...base, maxMessageAgeMs: 0 });
    expect(disabled.truncated).toBe(false);
  });

  it('evicts old tool results to the target while preserving user and recent messages', () => {
    const messages = [
      system(),
      user('keep this request'),
      assistant('c1'),
      tool('c1', big(80_000)),
      assistant('c2'),
      tool('c2', big(80_000)),
      user('latest request'),
      assistant('c3'),
      tool('c3', 'recent result'),
    ];
    const result = microcompactContext(messages, {
      triggerTokens: 1_000,
      targetTokens: 100,
      keepRecentMessages: 3,
    });
    expect(result.truncated).toBe(true);
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
    expect(result.messages[1]).toBe(messages[1]);
    expect(result.messages[6]).toBe(messages[6]);
    expect(result.messages[3]?.content[0]).toEqual({ type: 'text', text: '[older Read result evicted by microcompaction: re-read a.ts if needed]' });
    expect(result.messages[8]?.content[0]).toEqual({ type: 'text', text: 'recent result' });
    expect(result.evictedReads).toEqual(['a.ts', 'a.ts']);
  });

  it('reports evicted Read paths but not other tools or media', () => {
    const messages: ContextMessage[] = [
      system(),
      user('look'),
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'tools' }],
        toolCalls: [
          { type: 'function', id: 'read-1', name: 'Read', arguments: '{"path":"src/a.ts"}' },
          { type: 'function', id: 'grep-1', name: 'Grep', arguments: '{"pattern":"x"}' },
        ],
      },
      tool('read-1', big(80_000)),
      tool('grep-1', big(80_000)),
      user('latest'),
    ];
    const result = microcompactContext(messages, {
      triggerTokens: 100,
      targetTokens: 1,
      keepRecentMessages: 0,
    });
    expect(result.evictedReads).toEqual(['src/a.ts']);
    const grepPlaceholder = result.messages.find((message) => message.toolCallId === 'grep-1');
    expect(grepPlaceholder?.content[0]).toEqual({
      type: 'text',
      text: '[older Grep result evicted by microcompaction]',
    });
  });

  it('honors a custom placeholder without a refetch hint but still reports reads', () => {
    const messages = [system(), user('look'), assistant('c1'), tool('c1', big(80_000)), user('latest')];
    const result = microcompactContext(messages, {
      triggerTokens: 100,
      targetTokens: 1,
      keepRecentMessages: 0,
      placeholder: '[evicted]',
    });
    expect(result.messages[3]?.content[0]).toEqual({ type: 'text', text: '[evicted]' });
    expect(result.evictedReads).toEqual(['a.ts']);
  });

  it('keeps assistant tool calls paired with placeholder tool results', () => {
    const messages = [system(), user('edit it'), assistant('c1'), tool('c1', big(80_000))];
    const result = microcompactContext(messages, { triggerTokens: 100, targetTokens: 1, keepRecentMessages: 1 });
    expect(result.messages[2]?.toolCalls[0]?.id).toBe('c1');
    expect(result.messages[3]?.toolCallId).toBe('c1');
  });

  it('replaces old media with bounded placeholders', () => {
    const media: ContextMessage = {
      role: 'user',
      content: [{ type: 'image_url', imageUrl: { url: 'file:///a.png' } }],
      toolCalls: [],
    };
    const messages = [system(), media, user('latest')];
    const result = microcompactContext(messages, {
      triggerTokens: 1,
      targetTokens: 1,
      keepRecentMessages: 0,
      keepRecentUserMessages: 0,
    });
    expect(result.replacedMedia).toBe(1);
    expect(result.messages[1]?.content[0]).toEqual({ type: 'text', text: '[image_url evicted by microcompaction]' });
  });

  it('estimates text, tool arguments, and media', () => {
    expect(estimateMessageTokens(user('1234'))).toBe(1);
    expect(estimateMessageTokens(assistant('c1'))).toBeGreaterThan(1);
    expect(
      estimateMessageTokens({
        role: 'user',
        content: [{ type: 'image_url', imageUrl: { url: 'file:///a.png' } }],
        toolCalls: [],
      }),
    ).toBe(512);
    expect(estimateContextTokens([user('1234'), system('1234')])).toBe(2);
  });

  it('applies microcompaction before converting loop history', () => {
    const history = historyFromContext(
      [system(), user('keep'), assistant('c1'), tool('c1', big(80_000)), user('latest')],
      { triggerTokens: 100, targetTokens: 1, keepRecentMessages: 0, keepRecentUserMessages: 1 },
    );
    expect(history[3]?.message).toMatchObject({ role: 'tool' });
    expect(JSON.stringify(history[3]?.message.content)).toContain('older Read result evicted by microcompaction');
  });
});
