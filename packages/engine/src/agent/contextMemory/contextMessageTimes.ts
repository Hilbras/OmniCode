import { z } from 'zod';

import { defineState } from '#/state/state';

import { ContextAppendMessage } from './contextEvents';
import type { ContextMessage } from './types';

/**
 * Live per-message clock (WS3.1). Replay already carries message times in
 * `contextTranscript.times`; the live context memory did not, so an age-based
 * microcompaction trigger had no honest signal. This state folds the durable
 * append event's timestamp by message id, keyed the same way the transcript
 * keyed its parallel `times` array.
 */
export const contextMessageTimesKey = defineState<Readonly<Record<string, number>>>(
  'context.messageTimes',
  () => ({}),
)
  .replayable({ schema: z.record(z.string(), z.number().finite()) })
  .on(ContextAppendMessage, (state, event) => {
    const id = event.message.id;
    if (id === undefined || state[id] !== undefined) return state;
    return { ...state, [id]: event.time };
  });

/** Indices of messages whose recorded time is older than `maxAgeMs`. */
export function staleMessageIndices(
  messages: readonly ContextMessage[],
  times: Readonly<Record<string, number>>,
  now: number,
  maxAgeMs: number,
  protectedCount = 0,
): readonly number[] {
  if (maxAgeMs <= 0) return [];
  const cutoff = now - maxAgeMs;
  const out: number[] = [];
  for (let index = 0; index < messages.length - protectedCount; index += 1) {
    const id = messages[index]?.id;
    const time = id === undefined ? undefined : times[id];
    if (time !== undefined && time < cutoff) out.push(index);
  }
  return out;
}

/** True when staleness alone justifies a microcompaction pass. */
export function shouldMicrocompactByAge(
  messages: readonly ContextMessage[],
  times: Readonly<Record<string, number>>,
  now: number,
  maxAgeMs: number,
  protectedCount = 0,
): boolean {
  return staleMessageIndices(messages, times, now, maxAgeMs, protectedCount).length > 0;
}
