import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  approvalKeyboard,
  approvalText,
  groupSessionsByProject,
  modelsKeyboard,
  progressLine,
  projectReport,
  projectsKeyboard,
  projectsReport,
  questionKeyboard,
  questionText,
  sessionsKeyboard,
  summarizeTurn,
  otherFinishLine,
} from '../bin/omnicode-telegram.mjs';

const TURN = {
  turnId: 't1',
  state: 'completed',
  durationMs: 65_000,
  startedAt: '2026-11-06T10:00:00.000Z',
  endedAt: '2026-11-06T10:01:05.000Z',
  steps: [
    { stepId: 't1.1', frames: [{ kind: 'thinking', text: 'hmm' }, { kind: 'tool', name: 'Bash', input: { command: 'ls' } }] },
    { stepId: 't1.2', frames: [{ kind: 'tool', name: 'Edit', input: { path: '/tmp/work/a.ts' } }] },
    { stepId: 't1.3', frames: [{ kind: 'text', text: 'Final **report**' }] },
  ],
};

const SESSIONS = [
  { id: 'session_1', title: 'first', project: 'OmniCode', status: 'running', updatedAt: 5, workspaceId: 'ws1', cwd: '/w/OmniCode' },
  { id: 'session_2', title: 'second', project: 'trading', status: 'idle', updatedAt: 4, workspaceId: 'ws2', cwd: '/w/trading' },
  { id: 'session_3', title: 'third', project: 'OmniCode', status: 'idle', updatedAt: 3, workspaceId: 'ws1', cwd: '/w/OmniCode' },
];

describe('summarizeTurn', () => {
  it('reports duration, steps, tools and changed files', () => {
    const text = summarizeTurn(TURN, { project: 'OmniCode', title: 'hi' });

    assert.match(text, /✅ Finished<\/b> · 1m 5s/);
    assert.match(text, /OmniCode · hi/);
    assert.match(text, /3 steps/);
    assert.match(text, /2 tools/);
    assert.match(text, /Bash×1/);
    assert.match(text, /Edit×1/);
    assert.match(text, /a\.ts/);
  });

  it('renders the final message as converted markdown inside a quote', () => {
    const text = summarizeTurn(TURN, undefined);

    assert.match(text, /<blockquote>/);
    assert.match(text, /<b>report<\/b>/);
  });

  it('omits the body when asked, so a long report can be attached instead', () => {
    const text = summarizeTurn(TURN, undefined, false);

    assert.doesNotMatch(text, /<blockquote>/);
    assert.match(text, /2 tools/);
  });
});

describe('progressLine', () => {
  it('shows the step, the last tool and the tool count', () => {
    const running = {
      ...TURN,
      state: 'running',
      durationMs: undefined,
      steps: [...TURN.steps, { stepId: 't1.4', frames: [{ kind: 'tool', name: 'Read', input: { path: '/tmp/work/b.ts' } }] }],
    };
    const line = progressLine(running);

    assert.match(line, /Working/);
    assert.match(line, /step 4/);
    assert.match(line, /Read/);
    assert.match(line, /3 tools/);
  });

  it('still renders when the newest step has no tool yet', () => {
    const line = progressLine({ ...TURN, state: 'running', durationMs: undefined });

    assert.match(line, /step 3/);
    assert.match(line, /2 tools/);
  });
});

describe('grouping and listing', () => {
  it('groups sessions by project, keeping first-seen order', () => {
    const groups = groupSessionsByProject(SESSIONS);

    assert.deepEqual(
      groups.map(([project]) => project),
      ['OmniCode', 'trading'],
    );
    assert.equal(groups[0][1].length, 2);
  });

  it('lists projects with counts, running markers and no session previews', () => {
    const text = projectsReport(SESSIONS, '5488134280');

    assert.match(text, /Projects \(2\) · 3 sessions/);
    assert.match(text, /1\. OmniCode — 2 · 1 running/);
    assert.match(text, /2\. trading — 1/);
    assert.doesNotMatch(text, /first/);
  });

  it('lists every session when a project is opened', () => {
    const text = projectReport(['OmniCode', SESSIONS.filter((s) => s.project === 'OmniCode')], '5488134280');

    assert.match(text, /OmniCode — 2 sessions/);
    assert.match(text, /1\. first \(running\)/);
    assert.match(text, /2\. third/);
  });
});

const buttons = (keyboard) => (keyboard === undefined ? [] : keyboard.inline_keyboard.flat());

describe('keyboards', () => {
  it('carries a command per button and stays inside the callback limit', () => {
    const groups = groupSessionsByProject(SESSIONS);
    for (const keyboard of [projectsKeyboard(groups), sessionsKeyboard(SESSIONS), modelsKeyboard([{ model: 'a/b', display_name: 'b', provider: 'a' }])]) {
      const all = buttons(keyboard);
      assert.ok(all.length > 0);
      for (const button of all) {
        assert.match(button.callback_data, /^cmd\|/);
        assert.ok(button.callback_data.length <= 64);
      }
    }
  });

  it('numbers commands to match the listing order', () => {
    const [first] = buttons(projectsKeyboard(groupSessionsByProject(SESSIONS)));

    assert.equal(first.callback_data, 'cmd|/project 1');
    assert.equal(first.text, 'OmniCode');
  });

  it('shows five sessions per page and offers more', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ id: `s${String(index + 1)}`, title: `session ${String(index + 1)}` }));
    const page1 = buttons(sessionsKeyboard(many, 1, 3));

    assert.equal(page1.filter((button) => button.callback_data.startsWith('cmd|/use ')).length, 5);
    assert.deepEqual(
      page1.map((button) => button.callback_data).slice(-1),
      ['cmd|/project 3 2'],
    );
    assert.match(page1.at(-1).text, /More/);
  });

  it('numbers the second page from six, so /use keeps working', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ id: `s${String(index + 1)}`, title: `session ${String(index + 1)}` }));
    const page2 = buttons(sessionsKeyboard(many, 2, 3)).map((button) => button.callback_data);

    assert.equal(page2[0], 'cmd|/use 6');
    assert.ok(page2.includes('cmd|/project 3 1'));
    assert.ok(page2.includes('cmd|/project 3 3'));
  });

  it('shows five projects per page and offers more', () => {
    const groups = Array.from({ length: 7 }, (_, index) => [`project ${String(index + 1)}`, [{ id: `s${String(index)}`, title: 't' }]]);
    const page1 = buttons(projectsKeyboard(groups, 1)).map((button) => button.callback_data);

    assert.equal(page1.filter((entry) => entry.startsWith('cmd|/project ')).length, 5);
    assert.equal(page1.at(-1), 'cmd|/sessions 2');
  });

  it('says which page it is on', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ id: `s${String(index + 1)}`, title: `session ${String(index + 1)}` }));
    const text = projectReport(['OmniCode', many], '5488134280', 2);

    assert.match(text, /page 2\/3/);
    assert.match(text, /6\. session 6/);
    assert.doesNotMatch(text, /1\. session 1/);
  });
});

describe('approval and question rendering', () => {
  it('offers allow, deny and allow-for-session', () => {
    const approval = { approval_id: 'a1', tool_name: 'Bash', action: 'run tests', tool_input_display: { command: 'pnpm test' } };
    const data = buttons(approvalKeyboard(approval)).map((button) => button.callback_data);

    assert.deepEqual(data, ['apv|a1|approved', 'apv|a1|rejected', 'apv|a1|approved|session']);
    assert.match(approvalText(approval), /Bash · run tests/);
    assert.match(approvalText(approval), /pnpm test/);
  });

  it('offers one button per option and instructs multi-select in text', () => {
    const question = {
      question_id: 'q1',
      questions: [
        { id: 'q_0', header: 'git', question: 'Which branch?', options: [{ id: 'opt_0_0', label: 'main' }, { id: 'opt_0_1', label: 'feat' }], allow_other: true },
      ],
    };
    const data = buttons(questionKeyboard(question)).map((button) => button.callback_data);

    assert.deepEqual(data, ['q|q1|q_0|opt_0_0', 'q|q1|q_0|opt_0_1']);
    assert.match(questionText(question), /Which branch\?/);
    assert.match(questionText(question), /1\. main/);

    const multi = {
      question_id: 'q2',
      questions: [{ id: 'q_0', question: 'Pick some', multi_select: true, options: [{ id: 'opt_0_0', label: 'a' }] }],
    };
    assert.equal(questionKeyboard(multi), undefined);
    assert.match(questionText(multi), /multi-select: reply with numbers/);
  });
});

describe('otherFinishLine', () => {
  it('names the project and session with the duration and first reply line', () => {
    const line = otherFinishLine({ ...TURN }, { project: 'OmniHilbras', title: 'hi' });

    assert.match(line, /^✅ Finished · 1m 5s/);
    assert.match(line, /OmniHilbras · hi/);
    assert.match(line, /Final \*\*report\*\*/);
  });

  it('copes with a session that has no project or reply', () => {
    const line = otherFinishLine({ turnId: 't9', state: 'completed', steps: [] }, {});

    assert.match(line, /^✅ Finished\nanother session$/);
  });

  it('keeps the reply short enough to read as a notification', () => {
    const long = { turnId: 't9', state: 'completed', durationMs: 1000, steps: [{ stepId: 's', frames: [{ kind: 'text', text: 'x'.repeat(400) }] }] };
    const line = otherFinishLine(long, { project: 'p' });

    assert.ok(line.length < 260);
  });
});
