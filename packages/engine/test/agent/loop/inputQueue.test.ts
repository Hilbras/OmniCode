import { describe, expect, it } from 'vitest';

import type { ContentPart } from '#human/llm/message';
import { AgentInputQueueService } from '#/agent/loop/inputQueueService';
import type { InputNotice } from '#/agent/loop/inputQueue';

function text(value: string): ContentPart[] {
  return [{ type: 'text', text: value }];
}

function steer(value: string): InputNotice {
  return { kind: 'steer', content: text(value), wake: true };
}

function mail(value: string, wake = false): InputNotice {
  return { kind: 'mail', content: text(value), wake, label: 'task' };
}

function toolOutput(toolCallId: string, value: string): InputNotice {
  return { kind: 'tool_output', content: text(value), wake: false, toolCallId };
}

function sizeOf(notice: InputNotice | undefined): string | undefined {
  return notice?.content[0]?.type === 'text' ? notice.content[0].text : undefined;
}

describe('AgentInputQueueService', () => {
  it('delivers steer before tool output before mail', () => {
    const queue = new AgentInputQueueService();
    queue.push(mail('background'));
    queue.push(toolOutput('call_1', 'response'));
    queue.push(steer('interrupt'));

    const state = { turnId: 1, running: true, toolCallIds: ['call_1'] };
    expect(sizeOf(queue.next(state))).toBe('interrupt');
    expect(sizeOf(queue.next(state))).toBe('response');
    expect(sizeOf(queue.next(state))).toBe('background');
    expect(queue.next(state)).toBeUndefined();
  });

  it('keeps FIFO order inside one channel', () => {
    const queue = new AgentInputQueueService();
    queue.push(steer('one'));
    queue.push(steer('two'));
    expect(sizeOf(queue.next())).toBe('one');
    expect(sizeOf(queue.next())).toBe('two');
  });

  it('marks passive mail as non-waking and keeps the wake flag', () => {
    const queue = new AgentInputQueueService();
    queue.push(mail('passive', false));
    queue.push(mail('waking', true));
    expect(queue.next()?.wake).toBe(false);
    expect(queue.next()?.wake).toBe(true);
  });

  it('drops tool output whose call is no longer running', () => {
    const queue = new AgentInputQueueService();
    queue.push(toolOutput('call_old', 'stale'));
    queue.push(steer('keep'));
    const state = { turnId: 1, running: true, toolCallIds: ['call_new'] };
    expect(sizeOf(queue.next(state))).toBe('keep');
    expect(queue.size()).toBe(0);
  });

  it('drops all tool output when no turn is running', () => {
    const queue = new AgentInputQueueService();
    queue.push(toolOutput('call_1', 'response'));
    queue.next({ turnId: 1, running: false, toolCallIds: ['call_1'] });
    expect(queue.size()).toBe(0);
  });

  it('ignores empty passive content but keeps empty steer', () => {
    const queue = new AgentInputQueueService();
    queue.push({ kind: 'mail', content: text('   '), wake: true });
    queue.push({ kind: 'tool_output', content: [], wake: false, toolCallId: 'c' });
    expect(queue.size()).toBe(0);

    queue.push({ kind: 'steer', content: [], wake: true });
    expect(queue.size()).toBe(1);
  });

  it('bounds each channel by dropping the oldest', () => {
    const queue = new AgentInputQueueService();
    for (let index = 0; index < 20; index += 1) queue.push(mail(`m${index}`));
    expect(queue.size()).toBe(16);
    expect(sizeOf(queue.next())).toBe('m4');
  });

  it('clear empties every channel', () => {
    const queue = new AgentInputQueueService();
    queue.push(steer('a'));
    queue.push(toolOutput('c', 'b'));
    queue.push(mail('c'));
    queue.clear();
    expect(queue.size()).toBe(0);
  });
});
