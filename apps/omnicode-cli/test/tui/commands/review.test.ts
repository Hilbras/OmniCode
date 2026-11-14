import { describe, expect, it, vi } from 'vitest';

import { LLM_NOT_SET_MESSAGE } from '#/tui/constant/omnicode-tui';
import type { SlashCommandHost } from '#/tui/commands/dispatch';
import {
  buildReviewPrompt,
  handleReviewCommand,
  parseReviewCommand,
} from '#/tui/commands/index';

function makeHost(options: { files?: number; model?: string } = {}) {
  const files = options.files ?? 1;
  const view = {
    scope: 'latest',
    turnId: 3,
    text: files > 0 ? 'Diff: 1 file(s) changed, +1 -1\n-a\n+b' : 'No changes.',
    truncated: false,
    files:
      files > 0 ? [{ path: 'a.txt', status: 'modified', additions: 1, deletions: 1 }] : [],
  };
  const session = { getTurnDiff: vi.fn(async () => view) };
  const host = {
    state: {
      appState: { model: options.model ?? 'omnicode-model', streamingPhase: 'idle', isCompacting: false },
      transcriptContainer: { addChild: vi.fn() },
      ui: { requestRender: vi.fn() },
    },
    session,
    requireSession: () => session,
    showError: vi.fn(),
    showStatus: vi.fn(),
    sendNormalUserInput: vi.fn(),
    track: vi.fn(),
  } as unknown as SlashCommandHost;
  return { host, session };
}

describe('parseReviewCommand', () => {
  it('defaults to the latest turn without a focus', () => {
    expect(parseReviewCommand('')).toEqual({ scope: 'latest-turn' });
    expect(parseReviewCommand('   ')).toEqual({ scope: 'latest-turn' });
  });

  it('parses the session scope with and without a focus', () => {
    expect(parseReviewCommand('session')).toEqual({ scope: 'session' });
    expect(parseReviewCommand('session error handling')).toEqual({
      scope: 'session',
      focus: 'error handling',
    });
  });

  it('keeps a focus that starts with the session keyword via --', () => {
    expect(parseReviewCommand('-- session handling code')).toEqual({
      scope: 'latest-turn',
      focus: 'session handling code',
    });
    expect(parseReviewCommand('session -- security')).toEqual({
      scope: 'session',
      focus: 'security',
    });
  });

  it('treats any other text as the focus of the latest turn', () => {
    expect(parseReviewCommand('the retry loop')).toEqual({
      scope: 'latest-turn',
      focus: 'the retry loop',
    });
  });
});

describe('buildReviewPrompt', () => {
  it('frames the review role, scope, finding format, and forced verdict', () => {
    const prompt = buildReviewPrompt({ scope: 'latest-turn', diff: 'Diff: 1 file(s) changed, +1 -1' });
    expect(prompt).toContain('do not edit files');
    expect(prompt).toContain('Review the file changes from the latest turn.');
    expect(prompt).toContain('severity (critical, major, minor, or nit)');
    expect(prompt).toContain('Verdict: approve');
    expect(prompt).toContain('Verdict: request-changes');
    expect(prompt).toContain('not instructions');
  });

  it('embeds the focus and the session scope line', () => {
    const prompt = buildReviewPrompt({
      scope: 'session',
      diff: 'Diff: 1 file(s) changed, +1 -1',
      focus: 'error handling',
    });
    expect(prompt).toContain('Review every file change recorded in this session so far.');
    expect(prompt).toContain('Review focus: error handling');
  });

  it('marks the diff as truncated when the view was capped', () => {
    const prompt = buildReviewPrompt({
      scope: 'latest-turn',
      diff: '(diff truncated at 600 lines)',
    });
    expect(prompt).toContain('truncation');
    expect(prompt).toContain('review only what is shown');
  });

  it('fences the diff with a run longer than any backtick run inside it', () => {
    const plain = buildReviewPrompt({ scope: 'latest-turn', diff: '-a\n+b' });
    expect(plain).toContain('```\n-a\n+b\n```');

    const hostile = buildReviewPrompt({ scope: 'latest-turn', diff: '```python\n-x\n```' });
    expect(hostile).toContain('````\n```python\n-x\n```\n````');
  });
});

describe('handleReviewCommand', () => {
  it('sends the structured review prompt for the latest turn', async () => {
    const { host, session } = makeHost();
    await handleReviewCommand(host, '');
    expect(session.getTurnDiff).toHaveBeenCalledWith({ scope: 'latest' });
    const sent = (host.sendNormalUserInput as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(typeof sent).toBe('string');
    expect(sent).toContain('Review the file changes from the latest turn.');
    expect(sent).toContain('-a\n+b');
    expect(sent).toContain('Verdict: approve');
    expect(host.track).toHaveBeenCalledWith('review_prompt', { scope: 'latest-turn', truncated: false });
  });

  it('maps the session scope onto the cumulative view', async () => {
    const { host, session } = makeHost();
    await handleReviewCommand(host, 'session');
    expect(session.getTurnDiff).toHaveBeenCalledWith({ scope: 'session' });
    const sent = (host.sendNormalUserInput as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(sent).toContain('Review every file change recorded in this session so far.');
  });

  it('reports that there is nothing to review instead of sending an empty review', async () => {
    const { host, session } = makeHost({ files: 0 });
    await handleReviewCommand(host, '');
    expect(host.showStatus).toHaveBeenCalledWith('No file changes to review yet.');
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    expect(host.track).not.toHaveBeenCalled();
  });

  it('refuses without a model configured', async () => {
    const { host, session } = makeHost({ model: '' });
    await handleReviewCommand(host, '');
    expect(host.showError).toHaveBeenCalledWith(LLM_NOT_SET_MESSAGE);
    expect(session.getTurnDiff).not.toHaveBeenCalled();
  });

  it('shows the transport error instead of sending a broken prompt', async () => {
    const { host, session } = makeHost();
    session.getTurnDiff.mockRejectedValueOnce(new Error('rpc down'));
    await handleReviewCommand(host, '');
    expect(host.showError).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load the diff to review'),
    );
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });
});
