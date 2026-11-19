import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_STALL_NUDGES,
  isIntentAckText,
  isStallGuardEnabled,
  shouldNudgeStalledTurn,
  STALL_GUARD_ENV_KEY,
} from '#/agent/loop/stallGuard';

describe('isStallGuardEnabled', () => {
  it('defaults on and honors the kill switch', () => {
    expect(isStallGuardEnabled({})).toBe(true);
    expect(isStallGuardEnabled({ [STALL_GUARD_ENV_KEY]: '0' })).toBe(false);
    expect(isStallGuardEnabled({ [STALL_GUARD_ENV_KEY]: ' false ' })).toBe(false);
    expect(isStallGuardEnabled({ [STALL_GUARD_ENV_KEY]: '1' })).toBe(true);
  });
});

describe('isIntentAckText', () => {
  it.each([
    "I've updated the config. Next I'll run the tests.",
    'Fixed the parser. Now I will check the CLI path.',
    'Done with step 1; remaining: wire the adapter.',
    'The refactor is in place. Let me verify the build.',
    'Progress so far: schemas are updated. Next: guards.',
    'Working on the permissions layer',
    'I will continue with the migration.',
  ])('flags a progress note: %s', (text) => {
    expect(isIntentAckText(text)).toBe(true);
  });

  it.each([
    'All done — the tests pass and the feature is complete.',
    'The implementation is finished and the deliverable is ready.',
    'Tests passed. Task complete.',
    'Here is the answer to your question.',
    '',
    'x'.repeat(1_300),
  ])('does not flag a final answer: %s', (text) => {
    expect(isIntentAckText(text.slice(0, 40))).toBe(false);
  });

  it('does not flag a bare status with no next-action marker', () => {
    expect(isIntentAckText('The file was updated and saved.')).toBe(false);
  });
});

describe('shouldNudgeStalledTurn', () => {
  const text = "I've updated the config. Next I'll run the tests.";

  it('nudges a fresh intent-ack', () => {
    expect(shouldNudgeStalledTurn({ text, nudgesUsed: 0, enabled: true })).toBe(true);
  });

  it('stops after the default cap', () => {
    expect(shouldNudgeStalledTurn({ text, nudgesUsed: 1, enabled: true })).toBe(true);
    expect(shouldNudgeStalledTurn({ text, nudgesUsed: 2, enabled: true })).toBe(false);
    expect(DEFAULT_MAX_STALL_NUDGES).toBe(2);
  });

  it('honors a custom cap and the kill switch', () => {
    expect(shouldNudgeStalledTurn({ text, nudgesUsed: 1, enabled: true, maxNudges: 1 })).toBe(false);
    expect(shouldNudgeStalledTurn({ text, nudgesUsed: 0, enabled: false })).toBe(false);
  });

  it('does not nudge a final answer', () => {
    expect(
      shouldNudgeStalledTurn({ text: 'All done — tests pass. Task complete.', nudgesUsed: 0, enabled: true }),
    ).toBe(false);
  });
});
