import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

process.env.OMNICODE_HOME = mkdtempSync(path.join(tmpdir(), 'omnicode-tg-test-'));

const m = await import('../bin/omnicode-telegram.mjs');

const CHAT = 111;
const OTHER_CHAT = 222;
const FORUM_CHAT = 333;
const SESSION = 'session_alpha';
const config = { botToken: 'test-token', allowedChatIds: [CHAT, OTHER_CHAT, FORUM_CHAT] };

const calls = { tg: [], api: [] };
const fixture = { sessions: [], turns: [], messages: [], approvals: [], questions: [], failTgMethod: undefined, failApiRoute: undefined, answerFails: undefined };

function turn(turnId, state, text, durationMs = 1000) {
  return {
    kind: 'turn',
    turnId,
    state,
    durationMs,
    startedAt: '2026-11-06T10:00:00.000Z',
    endedAt: '2026-11-06T10:00:01.000Z',
    steps: [{ stepId: `${turnId}.1`, frames: [{ kind: 'text', text }] }],
  };
}

m.setServerResolver({ baseUrl: 'http://fake.invalid', token: 'test-token', version: '0.0.0' });

m.setApiTransport(async (server, method, route, body) => {
  calls.api.push({ method, route, body });
  if (fixture.failApiRoute !== undefined && route.includes(fixture.failApiRoute)) {
    throw new Error(fixture.failApiRoute === 'not found' ? 'question not found' : 'HTTP 500 from the server');
  }
  if (route.includes('/api/v2/sessions')) return { items: fixture.sessions };
  if (route.includes('/transcript')) return { items: fixture.turns };
  if (route.includes('/messages')) return { items: fixture.messages };
  if (method === 'GET' && route.includes('/approvals')) return { items: fixture.approvals };
  if (method === 'GET' && route.includes('/questions')) return { items: fixture.questions };
  if (method === 'POST' && (route.includes('/prompts') || route.includes(':abort'))) return {};
  if (method === 'POST' && route.includes('/approvals/')) return { resolved: true };
  if (method === 'POST' && route.includes('/questions/')) {
    if (fixture.answerFails === 'transient') throw new Error('HTTP 500 from the server');
    if (fixture.answerFails === 'gone') throw new Error('question not found');
    return {};
  }
  throw new Error(`unrouted ${method} ${route}`);
});

m.setTelegramTransport(async (unusedConfig, method, body) => {
  calls.tg.push({ method, body });
  if (fixture.failTgMethod === method) throw new Error('send failed');
  if (method === 'getChat') return { is_forum: body?.chat_id === FORUM_CHAT };
  if (method === 'createForumTopic') return { message_thread_id: 55 };
  return { message_id: 900 + calls.tg.length };
});

function sentTexts() {
  return calls.tg.filter((call) => call.method === 'sendMessage').map((call) => String(call.body?.text ?? ''));
}

function reset(overrides = {}) {
  calls.tg = [];
  calls.api = [];
  Object.assign(
    fixture,
    { sessions: [], turns: [], messages: [], approvals: [], questions: [], failTgMethod: undefined, failApiRoute: undefined, answerFails: undefined },
    overrides,
  );
}

function session(overrides = {}) {
  return {
    id: SESSION,
    meta: { title: 'alpha', updated_at: 5 },
    activity: { status: 'idle' },
    workspace: { id: 'ws_1', cwd: '/work/alpha' },
    ...overrides,
  };
}

describe('/stop', () => {
  it('aborts through the session action the server actually exposes', async () => {
    reset({ sessions: [session()] });
    m.state.selection[String(CHAT)] = SESSION;

    await m.handle(config, CHAT, '/stop');

    const abort = calls.api.find((call) => call.route.includes(':abort'));
    assert.ok(abort, 'no :abort call was made');
    assert.match(abort.route, new RegExp(`/sessions/${SESSION}:abort$`));
    assert.ok(sentTexts().some((text) => /Cancel requested/.test(text)));
    assert.ok(!calls.api.some((call) => call.route.includes('/prompts/cancel')), 'still using the missing route');
  });
});

describe('/use', () => {
  it('posts the newest finished turn, and progress for the running one', async () => {
    reset({
      sessions: [session()],
      turns: [turn('t1', 'completed', 'first report'), turn('t2', 'completed', 'second report'), turn('t3', 'running', 'working on it')],
    });
    m.state.view[String(CHAT)] = { workspaceId: 'ws_1', ids: [SESSION] };
    m.state.sent[String(CHAT)] = [];
    m.state.progress[String(CHAT)] = undefined;

    await m.handle(config, CHAT, '/use 1');

    const texts = sentTexts();
    assert.ok(texts.some((text) => text.includes('second report')), `newest report missing: ${texts.join(' | ').slice(0, 300)}`);
    assert.ok(!texts.some((text) => text.includes('first report')), 'posted a stale report');
    assert.ok(texts.some((text) => text.includes('Working')), 'no progress line for the running turn');
    assert.equal(m.state.selection[String(CHAT)], SESSION);
  });
});

describe('/last', () => {
  it('returns the newest assistant reply from a newest-first page', async () => {
    reset({
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'newest reply' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'older reply' }] },
      ],
    });
    m.state.selection[String(CHAT)] = SESSION;

    await m.handle(config, CHAT, '/last');

    const texts = sentTexts();
    assert.ok(texts.some((text) => text.includes('newest reply')));
    assert.ok(!texts.some((text) => text.includes('older reply')), 'returned the oldest reply');
    assert.match(calls.api.at(-1).route, /page_size=20/);
  });
});

describe('/name', () => {
  it('refuses to rename when no session is selected', async () => {
    reset({ sessions: [] });
    delete m.state.selection[String(CHAT)];

    await m.handle(config, CHAT, '/name');

    assert.ok(!calls.tg.some((call) => call.method === 'setMyName'), 'renamed the bot with no session');
    assert.ok(sentTexts().some((text) => /Select a session first/.test(text)));
  });
});

describe('callbacks', () => {
  it('ignores a press from a chat that is not allowed', async () => {
    reset({ sessions: [session()] });
    const stranger = { botToken: 'test-token', allowedChatIds: [OTHER_CHAT] };

    await m.handleCallback(stranger, { message: { chat: { id: CHAT }, message_id: 7 }, data: 'cmd|/stop' });

    assert.equal(calls.api.length, 0, 'a stranger drove a command');
    assert.equal(calls.tg.length, 0, 'a stranger got a reply');
  });

  it('answers a question by button for an allowed chat', async () => {
    reset({ questions: [] });
    m.state.interactions[String(CHAT)] = { question_1: SESSION };

    await m.handleCallback(config, { message: { chat: { id: CHAT }, message_id: 8 }, data: 'q|1|q_0|opt_0' });

    const answered = calls.api.find((call) => call.method === 'POST' && call.route.includes('/questions/'));
    assert.ok(answered, 'no answer was posted');
    assert.deepEqual(answered.body.answers, { q_0: { kind: 'single', option_id: 'opt_0' } });
  });
});

describe('answering a question by text', () => {
  const pending = { questionId: 'question_1', sessionId: SESSION, questions: [{ id: 'q_0', question: 'Pick', options: [{ id: 'a', label: 'A' }] }] };

  it('keeps the question when the server is unreachable', async () => {
    reset({ answerFails: 'transient' });
    m.state.pendingQuestion[String(CHAT)] = { ...pending };

    const outcome = await m.answerQuestionByText(config, CHAT, pending, '1');

    assert.equal(outcome, 'retry');
    assert.deepEqual(m.state.pendingQuestion[String(CHAT)], pending, 'the pending question was dropped');
    assert.ok(sentTexts().some((text) => /still open/.test(text)));
  });

  it('clears it when the server says it is gone', async () => {
    reset({ answerFails: 'gone' });
    m.state.pendingQuestion[String(CHAT)] = { ...pending };

    const outcome = await m.answerQuestionByText(config, CHAT, pending, '1');

    assert.equal(outcome, 'gone');
    assert.equal(m.state.pendingQuestion[String(CHAT)], undefined);
  });
});

describe('announcing approvals', () => {
  const approval = {
    approval_id: 'approval_1',
    session_id: SESSION,
    tool_name: 'Bash',
    action: 'Running: ls',
    tool_input_display: { command: 'ls' },
  };

  it('retries instead of marking a notice as sent when Telegram refuses it', async () => {
    reset({ failTgMethod: 'sendMessage' });
    m.state.interactions[String(CHAT)] = {};

    const first = await m.announcePending(config, String(CHAT), SESSION, [approval], []);
    assert.equal(first, false);
    assert.equal(m.state.interactions[String(CHAT)]?.['approval_1'], undefined, 'marked as announced after a failure');

    fixture.failTgMethod = undefined;
    const second = await m.announcePending(config, String(CHAT), SESSION, [approval], []);
    assert.equal(second, true);
    assert.equal(m.state.interactions[String(CHAT)]?.['approval_1'], SESSION);
  });
});

describe('topic mode', () => {
  it('opens one topic per session and sends into it, without clearing or pinning', async () => {
    reset({ sessions: [session()], turns: [turn('t1', 'completed', 'topic report')] });
    m.state.view[String(FORUM_CHAT)] = { workspaceId: 'ws_1', ids: [SESSION] };
    m.state.sent[String(FORUM_CHAT)] = [];

    await m.handle(config, FORUM_CHAT, '/use 1');

    const created = calls.tg.find((call) => call.method === 'createForumTopic');
    assert.ok(created, 'no topic was created');
    assert.equal(created.body.name, 'alpha \u00b7 alpha');

    const sent = calls.tg.filter((call) => call.method === 'sendMessage');
    assert.ok(sent.length > 0, 'nothing was posted');
    assert.ok(sent.every((call) => call.body.message_thread_id === 55), 'a message was posted outside the topic');
    assert.ok(sent.some((call) => String(call.body.text).includes('topic report')));
    assert.ok(!calls.tg.some((call) => call.method === 'deleteMessage'), 'cleared the group in topic mode');
    assert.ok(!calls.tg.some((call) => call.method === 'pinChatMessage'), 'pinned in topic mode');
    assert.ok(!calls.tg.some((call) => call.method === 'setMyName'), 'renamed the bot in topic mode');
  });

  it('routes a message typed inside a topic to that topic session', async () => {
    reset({ sessions: [session()] });
    m.state.topics[String(FORUM_CHAT)] = { [SESSION]: 77 };
    delete m.state.selection[String(FORUM_CHAT)];

    await m.adoptTopicSession(config, FORUM_CHAT, { message_thread_id: 77 });

    assert.equal(m.state.selection[String(FORUM_CHAT)], SESSION);
    assert.equal(m.state.thread[String(FORUM_CHAT)], 77);
  });

  it('ignores a thread that belongs to no session', async () => {
    reset({ sessions: [session()] });
    m.state.topics[String(FORUM_CHAT)] = {};
    m.state.selection[String(FORUM_CHAT)] = 'session_other';

    await m.adoptTopicSession(config, FORUM_CHAT, { message_thread_id: 999 });

    assert.equal(m.state.selection[String(FORUM_CHAT)], 'session_other');
  });

  it('names a topic after the project and the session, cut to the limit', () => {
    assert.equal(m.topicName({ project: 'OmniHilbras', title: 'hi' }), 'OmniHilbras \u00b7 hi');
    assert.equal(m.topicName({}), 'session');
    assert.equal(m.topicName({ project: 'p'.repeat(200), title: 't' }).length, 128);
  });
});