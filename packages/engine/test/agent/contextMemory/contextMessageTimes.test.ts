import { describe, expect, it } from 'vitest';

import {
  contextMessageTimesKey,
  shouldMicrocompactByAge,
  staleMessageIndices,
} from '#/agent/contextMemory/contextMessageTimes';
import { ContextAppendMessage } from '#/agent/contextMemory/contextEvents';
import type { ContextMessage } from '#/agent/contextMemory/types';
import { resolveMicrocompactionMaxAgeMs, MICROCOMPACTION_MAX_AGE_ENV_KEY } from '#/agent/contextMemory/microcompaction';

function message(id?: string): ContextMessage {
  return {
    ...(id === undefined ? {} : { id }),
    role: 'user',
    content: [{ type: 'text', text: 'x' }],
    toolCalls: [],
  };
}

describe('contextMessageTimes state', () => {
  it('folds the durable append event time by message id', () => {
    const folds = contextMessageTimesKey.replayable.folds;
    const fold = folds.get(ContextAppendMessage);
    expect(fold).toBeDefined();
    const ctx = {
      silent: true,
      checkpoint: () => undefined,
      clearCheckpoints: () => undefined,
      undoToCheckpoint: () => undefined,
      emit: () => undefined,
    };
    const first = fold!(
      {},
      new ContextAppendMessage({ agentId: 'a1', message: message('m1') }, 1000),
      ctx,
    ) as Record<string, number>;
    expect(first).toEqual({ m1: 1000 });
    const again = fold!(
      first,
      new ContextAppendMessage({ agentId: 'a1', message: message('m1') }, 2000),
      ctx,
    );
    expect(again).toBe(first);
  });
});

describe('staleMessageIndices', () => {
  const messages = [message('old'), message('fresh'), message('newest')];
  const times = { old: 100, fresh: 9_000, newest: 9_500 };

  it('finds only older messages outside the protected tail', () => {
    expect(staleMessageIndices(messages, times, 10_000, 1_000, 1)).toEqual([0]);
  });

  it('is disabled by a non-positive window', () => {
    expect(staleMessageIndices(messages, times, 10_000, 0)).toEqual([]);
  });

  it('drives the age-only trigger', () => {
    expect(shouldMicrocompactByAge(messages, times, 10_000, 1_000, 1)).toBe(true);
    expect(shouldMicrocompactByAge(messages, { fresh: 9_000 }, 10_000, 1_000, 1)).toBe(false);
  });
});

describe('resolveMicrocompactionMaxAgeMs', () => {
  it('defaults on with a 30-minute window and honours the opt-out', () => {
    expect(resolveMicrocompactionMaxAgeMs({})).toBe(30 * 60 * 1000);
    expect(resolveMicrocompactionMaxAgeMs({ [MICROCOMPACTION_MAX_AGE_ENV_KEY]: '0' })).toBe(0);
    expect(resolveMicrocompactionMaxAgeMs({ [MICROCOMPACTION_MAX_AGE_ENV_KEY]: '5000' })).toBe(5000);
  });
});
