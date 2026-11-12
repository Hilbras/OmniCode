import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import type { ContentPart } from '#human/llm/message';

/**
 * Where a mid-turn input came from. The kinds differ only in precedence and in
 * whether they may start work on their own:
 *
 * - `steer` is the user interrupting: it jumps ahead of everything else and
 *   wakes a parked loop.
 * - `mail` is a background notice (task finished, channel message, reminder).
 *   It is passive unless the producer marks it as waking.
 * - `tool_output` is response data for a specific tool call. It is passive, and
 *   it is folded into the tool channel rather than the user channel so the
 *   model can tell response data from instruction.
 */
export type InputKind = 'steer' | 'mail' | 'tool_output';

export interface InputNoticeBase {
  readonly content: readonly ContentPart[];
  /** Wake a parked loop. Only steer and waking mail may set it. */
  readonly wake: boolean;
  readonly label?: string;
}

export interface SteerNotice extends InputNoticeBase {
  readonly kind: 'steer';
  readonly wake: true;
}

export interface MailNotice extends InputNoticeBase {
  readonly kind: 'mail';
}

export interface ToolOutputNotice extends InputNoticeBase {
  readonly kind: 'tool_output';
  readonly toolCallId: string;
  readonly wake: false;
}

export type InputNotice = SteerNotice | MailNotice | ToolOutputNotice;

export interface InputDrainState {
  readonly turnId: number;
  readonly running: boolean;
  readonly toolCallIds: readonly string[];
}

export interface IAgentInputQueueService {
  readonly _serviceBrand: undefined;
  push(notice: InputNotice): void;
  /** Next notice to inject at this step boundary, honouring precedence. */
  next(state?: InputDrainState): InputNotice | undefined;
  size(): number;
  clear(): void;
}

export const IAgentInputQueueService = createDecorator<IAgentInputQueueService>(
  'agentInputQueueService',
);
