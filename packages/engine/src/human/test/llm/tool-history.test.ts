import { describe, expect, it } from 'vitest';

import type { Message } from '#/llm/message';
import {
  repairUnansweredToolCalls,
  UNANSWERED_TOOL_RESULT_TEXT,
} from '#/llm/requester/tool-history';

function call(id: string): { type: 'function'; id: string; name: string; arguments: string } {
  return { type: 'function', id, name: 'Read', arguments: '{}' };
}

function assistant(ids: readonly string[]): Message {
  return { role: 'assistant', content: [], toolCalls: ids.map(call) };
}

function result(id: string): Message {
  return { role: 'tool', content: [{ type: 'text', text: 'ok' }], toolCallId: id };
}

describe('unanswered tool call repair', () => {
  it('leaves a fully answered exchange untouched', () => {
    const messages: Message[] = [assistant(['a']), result('a')];
    const repair = repairUnansweredToolCalls(messages);
    expect(repair.messages).toEqual(messages);
    expect(repair.repairedCallIds).toEqual([]);
  });

  it('synthesizes a result for a call that never completed', () => {
    const repair = repairUnansweredToolCalls([assistant(['a'])]);
    expect(repair.repairedCallIds).toEqual(['a']);
    expect(repair.messages).toHaveLength(2);
    const synthesized = repair.messages[1];
    expect(synthesized?.role).toBe('tool');
    if (synthesized?.role !== 'tool') throw new Error('expected a tool message');
    expect(synthesized.toolCallId).toBe('a');
    expect(synthesized.content[0]).toEqual({ type: 'text', text: UNANSWERED_TOOL_RESULT_TEXT });
  });

  it('repairs only the missing half of a parallel batch', () => {
    const repair = repairUnansweredToolCalls([assistant(['a', 'b']), result('a')]);
    expect(repair.repairedCallIds).toEqual(['b']);
    expect(repair.messages).toHaveLength(3);
  });

  it('does not duplicate a result that arrived out of order', () => {
    const repair = repairUnansweredToolCalls([assistant(['a', 'b']), result('b'), result('a')]);
    expect(repair.repairedCallIds).toEqual([]);
    expect(repair.messages).toHaveLength(3);
  });

  it('repairs a crash-interrupted exchange in a longer history', () => {
    const user: Message = { role: 'user', content: [{ type: 'text', text: 'go' }] };
    const repair = repairUnansweredToolCalls([
      user,
      assistant(['a']),
      result('a'),
      { role: 'assistant', content: [{ type: 'text', text: 'next' }], toolCalls: [call('b')] },
    ]);
    expect(repair.repairedCallIds).toEqual(['b']);
    const roles = repair.messages.map((message) => message.role);
    expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool']);
  });

  it('ignores tool results with no matching call', () => {
    const repair = repairUnansweredToolCalls([result('ghost')]);
    expect(repair.repairedCallIds).toEqual([]);
    expect(repair.messages).toHaveLength(1);
  });

  it('is idempotent', () => {
    const once = repairUnansweredToolCalls([assistant(['a'])]);
    const twice = repairUnansweredToolCalls(once.messages);
    expect(twice.repairedCallIds).toEqual([]);
    expect(twice.messages).toHaveLength(2);
  });
});