import type { TurnDiffView } from '@hilbras/omnicode-api';
import { describe, expect, it, vi } from 'vitest';

import type { SlashCommandHost } from '#/tui/commands/dispatch';
import { diffPanelLines, handleDiffCommand, parseDiffCommand } from '#/tui/commands/index';

function diffView(overrides: Partial<TurnDiffView> = {}): TurnDiffView {
  return {
    scope: 'latest',
    turnId: 7,
    text: 'Diff: 1 file(s) changed, +1 -1',
    truncated: false,
    files: [{ path: 'a.txt', status: 'modified', additions: 1, deletions: 1 }],
    ...overrides,
  };
}

function makeHost(view: TurnDiffView) {
  const session = { getTurnDiff: vi.fn(async () => view) };
  const transcriptContainer = { addChild: vi.fn() };
  const host = {
    state: {
      appState: { model: 'omnicode-model', streamingPhase: 'idle', isCompacting: false },
      transcriptContainer,
      ui: { requestRender: vi.fn() },
    },
    session,
    requireSession: () => session,
    showError: vi.fn(),
    showStatus: vi.fn(),
    track: vi.fn(),
  } as unknown as SlashCommandHost;
  return { host, session, transcriptContainer };
}

describe('parseDiffCommand', () => {
  it('treats empty args as the latest turn and session as the session scope', () => {
    expect(parseDiffCommand('')).toEqual({ kind: 'latest' });
    expect(parseDiffCommand('  ')).toEqual({ kind: 'latest' });
    expect(parseDiffCommand('session')).toEqual({ kind: 'session' });
  });

  it('answers anything else with the usage hint instead of guessing', () => {
    const parsed = parseDiffCommand('all');
    expect(parsed.kind).toBe('error');
    if (parsed.kind === 'error') expect(parsed.message).toContain('/diff [session]');
  });
});

describe('diffPanelLines', () => {
  it('labels the latest turn with its id and keeps the renderer body', () => {
    const lines = diffPanelLines(diffView());
    expect(lines).toEqual(['Turn 7.', 'Diff: 1 file(s) changed, +1 -1']);
  });

  it('labels the session scope', () => {
    const lines = diffPanelLines(diffView({ scope: 'session', turnId: undefined }));
    expect(lines[0]).toBe('Session: every retained turn, merged per file.');
  });

  it('notes binary and oversize files that the renderer excluded from the body', () => {
    const view = diffView({
      files: [
        { path: 'a.txt', status: 'modified', additions: 1, deletions: 1 },
        { path: 'logo.png', status: 'modified', additions: 0, deletions: 0, binary: true },
        { path: 'lock.json', status: 'modified', additions: 0, deletions: 0, oversize: true },
      ],
    });
    const lines = diffPanelLines(view);
    expect(lines.at(-2)).toBe('logo.png: binary content — not rendered');
    expect(lines.at(-1)).toBe('lock.json: oversize — not rendered');
  });
});

describe('handleDiffCommand', () => {
  it('renders the latest turn view into a transcript panel', async () => {
    const { host, session, transcriptContainer } = makeHost(diffView());
    await handleDiffCommand(host, '');
    expect(session.getTurnDiff).toHaveBeenCalledWith({ scope: 'latest' });
    expect(transcriptContainer.addChild).toHaveBeenCalledTimes(1);
    expect(host.track).toHaveBeenCalledWith('diff_view', { scope: 'latest', files: 1 });
    expect(host.state.ui.requestRender).toHaveBeenCalled();
  });

  it('passes the session scope through', async () => {
    const { host, session } = makeHost(diffView({ scope: 'session', turnId: undefined }));
    await handleDiffCommand(host, 'session');
    expect(session.getTurnDiff).toHaveBeenCalledWith({ scope: 'session' });
  });

  it('shows the transport error instead of a broken panel', async () => {
    const { host, session, transcriptContainer } = makeHost(diffView());
    session.getTurnDiff.mockRejectedValueOnce(new Error('rpc down'));
    await handleDiffCommand(host, '');
    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('Failed to load the diff'));
    expect(transcriptContainer.addChild).not.toHaveBeenCalled();
  });

  it('reports the usage hint without touching the session', async () => {
    const { host, session } = makeHost(diffView());
    await handleDiffCommand(host, 'bogus');
    expect(host.showStatus).toHaveBeenCalledWith(expect.stringContaining('/diff [session]'));
    expect(session.getTurnDiff).not.toHaveBeenCalled();
  });
});
