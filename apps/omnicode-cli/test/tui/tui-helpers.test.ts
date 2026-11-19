import { describe, expect, it } from 'vitest';

import {
  isSteerableQueuedMessage,
  loadingTipKind,
  sameStringArrays,
  toSteerInputItem,
  waitingSpinnerLabel,
  type EffectiveActivityPaneMode,
} from '#/tui/controllers/tui-helpers';
import type { QueuedMessage } from '#/tui/types';

const message = (overrides: Partial<QueuedMessage> = {}): QueuedMessage => ({
  text: 'hello', ...overrides,
});

describe('loadingTipKind', () => {
  it('maps busy modes to a tip and idle modes to none', () => {
    const cases: [EffectiveActivityPaneMode, string | undefined][] = [
      ['waiting', 'moon'], ['tool', 'moon'], ['composing', 'braille'],
      ['thinking', 'braille'], ['idle', undefined], ['session', undefined],
    ];
    for (const [mode, expected] of cases) expect(loadingTipKind(mode)).toBe(expected);
  });
});

describe('waitingSpinnerLabel', () => {
  it('is empty without a retry and delegates otherwise', () => {
    expect(waitingSpinnerLabel(null)).toBe('');
    expect(typeof waitingSpinnerLabel({ count: 1 } as never)).toBe('string');
  });
});

describe('sameStringArrays', () => {
  it('compares element-wise and respects length', () => {
    expect(sameStringArrays(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameStringArrays(['a'], ['a', 'b'])).toBe(false);
    expect(sameStringArrays(['a', 'b'], ['b', 'a'])).toBe(false);
  });
});

describe('queued-message steering helpers', () => {
  it('steers only plain prompt messages', () => {
    expect(isSteerableQueuedMessage(message())).toBe(true);
    expect(isSteerableQueuedMessage(message({ mode: 'bash' }))).toBe(false);
    expect(isSteerableQueuedMessage(message({ mode: 'skill' }))).toBe(false);
    expect(isSteerableQueuedMessage(message({ inlineSkillActivations: [] }))).toBe(false);
  });

  it('projects only the steerable fields', () => {
    const ids = [1, 2];
    expect(toSteerInputItem(message({
      agentId: 'a',
      text: 'go',
      imageAttachmentIds: ids,
      mode: 'prompt',
    }))).toEqual({
      text: 'go',
      parts: undefined,
      imageAttachmentIds: ids,
      videoAttachmentIds: undefined,
    });
  });
});
