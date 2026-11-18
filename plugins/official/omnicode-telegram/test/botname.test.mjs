import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { approvalKeyboard, botNameFor, longId, purgeUpperBound, questionKeyboard, shortId } from '../bin/omnicode-telegram.mjs';

const LIMIT = 64;
const bytes = (value) => Buffer.byteLength(value, 'utf8');

function callbacks(keyboard) {
  return (keyboard?.inline_keyboard ?? []).flat().map((button) => button.callback_data);
}

describe('botNameFor', () => {
  it('names the bot after the project and the session title', () => {
    assert.equal(botNameFor('trading', 'fix the deploy'), 'OmniCode - trading · fix the deploy');
    assert.equal(botNameFor('OmniCode', 'hi'), 'OmniCode - OmniCode · hi');
  });

  it('drops the title when the session has none, or repeats the project', () => {
    assert.equal(botNameFor('trading', ''), 'OmniCode - trading');
    assert.equal(botNameFor('trading', undefined), 'OmniCode - trading');
    assert.equal(botNameFor('trading', 'trading'), 'OmniCode - trading · trading');
  });

  it('copes with a missing or blank project', () => {
    assert.equal(botNameFor('', 'hi'), 'OmniCode - hi');
    assert.equal(botNameFor('', ''), 'OmniCode - no session');
    assert.equal(botNameFor(undefined, undefined), 'OmniCode - no session');
  });

  it("stays inside Telegram's 64-character limit", () => {
    const name = botNameFor('a'.repeat(80), 'b'.repeat(80));

    assert.equal(name.length, 64);
    assert.ok(name.startsWith('OmniCode - '));
  });
});

describe('callback data', () => {
  it('fits approval buttons inside the 64-byte limit', () => {
    const approval = { approval_id: 'approval_894eda7e-b1a5-44c7-a4dd-da0eb9f249dc' };

    for (const data of callbacks(approvalKeyboard(approval))) {
      assert.ok(bytes(data) <= LIMIT, `${data} is ${String(bytes(data))} bytes`);
    }
  });

  it('fits question buttons inside the 64-byte limit', () => {
    const question = {
      question_id: 'question_e67399cd-3bd1-42a4-b5b5-dd72d07752ff',
      questions: [
        {
          id: 'q_0',
          question: 'Which one?',
          options: [
            { id: 'option_0', label: 'First' },
            { id: 'option_1', label: 'Second' },
          ],
        },
      ],
    };

    for (const data of callbacks(questionKeyboard(question))) {
      assert.ok(bytes(data) <= LIMIT, `${data} is ${String(bytes(data))} bytes`);
    }
  });

  it('round-trips a shortened id back to the one the server knows', () => {
    const approvalId = 'approval_894eda7e-b1a5-44c7-a4dd-da0eb9f249dc';
    const questionId = 'question_e67399cd-3bd1-42a4-b5b5-dd72d07752ff';

    assert.equal(longId('apv', shortId('apv', approvalId)), approvalId);
    assert.equal(longId('q', shortId('q', questionId)), questionId);
  });

  it('expands the first field of a real button payload', () => {
    const approvalId = 'approval_894eda7e-b1a5-44c7-a4dd-da0eb9f249dc';
    const data = callbacks(approvalKeyboard({ approval_id: approvalId }))[2];
    const parts = data.split('|');

    assert.equal(parts[0], 'apv');
    assert.equal(longId(parts[0], parts[1]), approvalId);
    assert.equal(parts[2], 'approved');
    assert.equal(parts[3], 'session');
  });
});

describe('purgeUpperBound', () => {
  it('sweeps past the newest id it knows, to reach untracked history', () => {
    assert.equal(purgeUpperBound([1, 289, 400]), 500);
    assert.equal(purgeUpperBound([273]), 373);
  });

  it('falls back to a bounded sweep when nothing is tracked', () => {
    assert.equal(purgeUpperBound([]), 500);
  });
});
