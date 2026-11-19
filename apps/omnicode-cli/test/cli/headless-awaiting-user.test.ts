import { describe, expect, it } from 'vitest';

import {
  assertNotAwaitingUser,
  HeadlessAwaitingUserError,
  HEADLESS_AWAITING_USER_ENV_KEY,
  HEADLESS_AWAITING_USER_MESSAGE,
  isAwaitingUserText,
  isHeadlessAwaitingUserEnabled,
} from '#/cli/headless-awaiting-user';

describe('isHeadlessAwaitingUserEnabled', () => {
  it('defaults on and honors the kill switch', () => {
    expect(isHeadlessAwaitingUserEnabled({})).toBe(true);
    expect(isHeadlessAwaitingUserEnabled({ [HEADLESS_AWAITING_USER_ENV_KEY]: '0' })).toBe(false);
    expect(isHeadlessAwaitingUserEnabled({ [HEADLESS_AWAITING_USER_ENV_KEY]: ' false ' })).toBe(
      false,
    );
    expect(isHeadlessAwaitingUserEnabled({ [HEADLESS_AWAITING_USER_ENV_KEY]: '1' })).toBe(true);
  });
});

describe('isAwaitingUserText', () => {
  it.each([
    'I updated the config. What should I do next?',
    'The migration is blocked. Please decide which approach to keep.',
    'Two options remain. Which would you prefer?',
    'I need your decision on the schema before I continue.',
    'Should I keep the old behavior or the new one?',
    'Waiting for your confirmation on the destructive step.',
    'Everything else is done; let me know how you would like to proceed.',
  ])('flags an explicit request for user input: %s', (text) => {
    expect(isAwaitingUserText(text)).toBe(true);
  });

  it.each([
    'All done. The tests pass and the feature is complete.',
    'The answer to your question is 42.',
    'I considered whether to refactor, then decided against it.',
    'The commit is ready for review.',
    '',
  ])('does not flag a completed answer: %s', (text) => {
    expect(isAwaitingUserText(text)).toBe(false);
  });

  it('only inspects the closing part of a long final message', () => {
    const longAnswer = `${'Detailed report of completed work. '.repeat(20)}\nWhat should I do next?`;
    expect(isAwaitingUserText(longAnswer)).toBe(true);
    const rhetoricalOnly = `What should I do when the cache misses? Then I decided on a fallback. ${'This is a detailed section describing exactly what the implementation does and why. '.repeat(12)}Done — all tests pass.`;
    expect(isAwaitingUserText(rhetoricalOnly)).toBe(false);
  });
});

describe('assertNotAwaitingUser', () => {
  it('throws a clear error for a user-input question', () => {
    expect(() => assertNotAwaitingUser('What should I do next?', true)).toThrow(
      HeadlessAwaitingUserError,
    );
    expect(() => assertNotAwaitingUser('What should I do next?', true)).toThrow(
      HEADLESS_AWAITING_USER_MESSAGE,
    );
  });

  it('does not throw for a completed answer', () => {
    expect(() => assertNotAwaitingUser('All done — tests pass.', true)).not.toThrow();
  });

  it('honors the disabled flag', () => {
    expect(() => assertNotAwaitingUser('What should I do next?', false)).not.toThrow();
  });
});
