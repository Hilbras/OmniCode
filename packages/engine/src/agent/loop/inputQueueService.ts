import { Disposable } from '@hilbras/omnicode-base/di/lifecycle';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { LifecycleScope } from '#/app/scopes';

import {
  IAgentInputQueueService,
  type InputDrainState,
  type InputNotice,
} from './inputQueue';

/** Notices held per channel before the oldest of that channel is dropped. */
export const INPUT_QUEUE_MAX_PER_KIND = 16;

/** Order in which one notice of each kind is offered at a step boundary. */
const DRAIN_ORDER: readonly InputNotice['kind'][] = ['steer', 'tool_output', 'mail'];

/**
 * Holds mid-turn input until the next safe injection point.
 *
 * Precedence is fixed: a steer always goes first, response data for the tool
 * calls that just finished comes next, and passive mail last — so a user
 * interruption is never queued behind a background notice. Delivery is one
 * notice per step boundary; nothing is reordered inside a channel, and a
 * channel that overflows drops its oldest entry rather than unbounded memory.
 *
 * Tool output is only released while the tool call it answers is part of the
 * running set; otherwise it is stale and discarded.
 */
export class AgentInputQueueService
  extends Disposable
  implements IAgentInputQueueService
{
  declare readonly _serviceBrand: undefined;

  private readonly byKind = new Map<InputNotice['kind'], InputNotice[]>([
    ['steer', []],
    ['mail', []],
    ['tool_output', []],
  ]);

  push(notice: InputNotice): void {
    const bucket = this.byKind.get(notice.kind);
    if (bucket === undefined) return;
    if (notice.kind !== 'steer' && isEmptyContent(notice.content)) return;
    bucket.push(notice);
    const overflow = bucket.length - INPUT_QUEUE_MAX_PER_KIND;
    if (overflow > 0) bucket.splice(0, overflow);
  }

  next(state?: InputDrainState): InputNotice | undefined {
    if (state !== undefined) this.dropStale(state);
    for (const kind of DRAIN_ORDER) {
      const bucket = this.byKind.get(kind)!;
      const notice = bucket.shift();
      if (notice !== undefined) return notice;
    }
    return undefined;
  }

  size(): number {
    let total = 0;
    for (const bucket of this.byKind.values()) total += bucket.length;
    return total;
  }

  clear(): void {
    for (const bucket of this.byKind.values()) bucket.length = 0;
  }

  private dropStale(state: InputDrainState): void {
    const live = new Set(state.toolCallIds);
    const outputs = this.byKind.get('tool_output')!;
    for (let index = outputs.length - 1; index >= 0; index -= 1) {
      const notice = outputs[index]!;
      if (notice.kind === 'tool_output' && !live.has(notice.toolCallId)) outputs.splice(index, 1);
    }
    if (!state.running) {
      // Nothing can consume tool output outside a running turn.
      outputs.length = 0;
    }
  }
}

function isEmptyContent(content: readonly { readonly type: string; readonly text?: string }[]): boolean {
  return content.every((part) => part.type !== 'text' || (part.text ?? '').trim().length === 0);
}

registerScopedService(
  LifecycleScope.Agent,
  IAgentInputQueueService,
  AgentInputQueueService,
  ScopeActivation.OnScopeCreated,
  'inputQueue',
);
