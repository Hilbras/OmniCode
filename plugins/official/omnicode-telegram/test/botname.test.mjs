import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { botNameFor } from '../bin/omnicode-telegram.mjs';

describe('botNameFor', () => {
  it('names the bot after the project and the session', () => {
    assert.equal(botNameFor('OmniCode', 'fix the deploy'), 'OmniCode - OmniCode · fix the deploy');
    assert.equal(botNameFor('trading', 'hi'), 'OmniCode - trading · hi');
  });

  it('does not repeat the title when it equals the project', () => {
    assert.equal(botNameFor('OmniCode', 'OmniCode'), 'OmniCode - OmniCode');
  });

  it('uses only what it has', () => {
    assert.equal(botNameFor('', 'hi'), 'OmniCode - hi');
    assert.equal(botNameFor('trading', ''), 'OmniCode - trading');
    assert.equal(botNameFor('', ''), 'OmniCode - no session');
  });

  it('stays inside Telegram\'s 64-character limit', () => {
    const name = botNameFor('a'.repeat(80), 'b'.repeat(80));

    assert.equal(name.length, 64);
    assert.ok(name.startsWith('OmniCode - '));
  });
});