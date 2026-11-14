import type { Terminal, TUI } from '@hilbras/omnicode-tui';
import { afterEach, describe, expect, it } from 'vitest';

import { CatalogBrowserApp } from '@/tui/components/dialogs/catalog-browser';
import { ToolOutputViewer } from '@/tui/components/dialogs/tool-output-viewer';
import {
  cardDiffLines,
  collectToolCallCards,
  extractSpillOutputPath,
  findLastUserPrompt,
  ToolCallsController,
  toolCardDiff,
  toolCardPath,
  type ToolCallsBrowserHost,
  type ToolCallsBrowserState,
} from '@/tui/controllers/tool-calls';
import type { ColorToken } from '@/tui/theme';
import type { TranscriptEntry } from '@/tui/types';
import { currentTheme, darkColors } from '#/tui/theme';

const ANSI = /\u001B\[[0-9;]*m/g;
const strip = (text: string): string => text.replaceAll(ANSI, '');
const ESC = String.fromCodePoint(27);
const ENTER = '\r';
const DOWN = `${ESC}[B`;

function fakeTerminal(rows: number, columns = 120): Terminal {
  return {
    start: () => {},
    stop: () => {},
    drainInput: () => Promise.resolve(),
    write: () => {},
    get columns() {
      return columns;
    },
    get rows() {
      return rows;
    },
    get kittyProtocolActive() {
      return false;
    },
    moveBy: () => {},
    hideCursor: () => {},
    showCursor: () => {},
    clearLine: () => {},
    clearFromCursor: () => {},
    clearScreen: () => {},
    setTitle: () => {},
    setProgress: () => {},
  };
}

function fakeUi(): TUI {
  const children: unknown[] = [];
  return {
    children,
    clear: () => {
      children.length = 0;
    },
    addChild: (child: unknown) => {
      children.push(child);
    },
    setFocus: () => {},
    requestRender: () => {},
  } as unknown as TUI;
}

function userEntry(text: string, overrides: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    id: `user-${text.slice(0, 8)}-${String(Math.random())}`,
    kind: 'user',
    renderMode: 'plain',
    content: text,
    ...overrides,
  };
}

function toolEntry(
  id: string,
  name: string,
  args: Record<string, unknown>,
  result?: { output: string; is_error?: boolean },
): TranscriptEntry {
  return {
    id,
    kind: 'tool_call',
    renderMode: 'plain',
    content: '',
    toolCallData: {
      id,
      name,
      args,
      ...(result === undefined ? {} : { result: { tool_call_id: id, ...result } }),
    },
  };
}

const SPILL_ENVELOPE = [
  'Tool output exceeded 40000 characters; the full output was saved to a file.',
  '[Spilled tool output]',
  'output_path: /tmp/omnicode/spills/abc123.txt',
  'next_step: Use Read with output_path to page through the saved output, or Grep to search it.]',
].join('\n');

describe('collectToolCallCards', () => {
  it('collects tool cards newest-first and skips other entries', () => {
    const cards = collectToolCallCards(
      [
        userEntry('fix the bug'),
        toolEntry('t1', 'Read', { file_path: '/ws/src/a.ts' }),
        toolEntry('t2', 'Bash', { command: 'ls' }, { output: 'total 0' }),
        userEntry('also this'),
        toolEntry('t3', 'Grep', { pattern: 'foo' }, { output: 'no matches', is_error: false }),
      ],
      '/ws',
    );
    expect(cards.map((card) => card.id)).toEqual(['t3', 't2', 't1']);
    expect(cards[0]).toMatchObject({ name: 'Grep', hasResult: true, isError: false });
    expect(cards[2]).toMatchObject({ name: 'Read', hasResult: false, path: '/ws/src/a.ts' });
  });

  it('marks error results', () => {
    const cards = collectToolCallCards(
      [toolEntry('t1', 'Bash', { command: 'nope' }, { output: 'boom', is_error: true })],
      undefined,
    );
    expect(cards[0]?.isError).toBe(true);
  });

  it('keeps the workspace-relative key argument as the label', () => {
    const cards = collectToolCallCards(
      [toolEntry('t1', 'Read', { file_path: '/ws/src/a.ts' })],
      '/ws',
    );
    expect(cards[0]?.keyArgument).toBe('src/a.ts');
  });
});

describe('toolCardPath', () => {
  it('prefers the path argument', () => {
    expect(toolCardPath({ id: '1', name: 'Read', args: { file_path: '/ws/a.ts' } }, 'out')).toBe(
      '/ws/a.ts',
    );
  });

  it('falls back to the spill output_path of a spilled result', () => {
    expect(
      toolCardPath({ id: '1', name: 'Bash', args: { command: 'big' } }, SPILL_ENVELOPE),
    ).toBe('/tmp/omnicode/spills/abc123.txt');
  });

  it('never treats output_path text in an ordinary result as a path', () => {
    expect(
      toolCardPath(
        { id: '1', name: 'Bash', args: { command: 'echo' } },
        'someone wrote output_path: /etc/passwd in a log',
      ),
    ).toBeUndefined();
  });

  it('returns undefined without a path argument or spill', () => {
    expect(toolCardPath({ id: '1', name: 'Bash', args: { command: 'ls' } }, 'files')).toBeUndefined();
  });
});

describe('extractSpillOutputPath', () => {
  it('parses the envelope path', () => {
    expect(extractSpillOutputPath(SPILL_ENVELOPE)).toBe('/tmp/omnicode/spills/abc123.txt');
  });

  it('returns undefined for non-spill output', () => {
    expect(extractSpillOutputPath('output_path: /x')).toBeUndefined();
  });
});

describe('toolCardDiff', () => {
  it('pairs Edit old/new strings with the file path', () => {
    expect(
      toolCardDiff({
        id: '1',
        name: 'Edit',
        args: { file_path: '/ws/a.ts', old_string: 'a', new_string: 'b' },
      }),
    ).toEqual({ path: '/ws/a.ts', oldText: 'a', newText: 'b' });
  });

  it('renders Write as a whole-file addition', () => {
    expect(
      toolCardDiff({ id: '1', name: 'Write', args: { file_path: '/ws/b.ts', content: 'hi\n' } }),
    ).toEqual({ path: '/ws/b.ts', oldText: '', newText: 'hi\n' });
  });

  it('is undefined for tools without an args-level diff or a path', () => {
    expect(
      toolCardDiff({ id: '1', name: 'Bash', args: { command: 'diff a b' } }),
    ).toBeUndefined();
    expect(toolCardDiff({ id: '1', name: 'Edit', args: {} })).toBeUndefined();
    expect(
      toolCardDiff({ id: '1', name: 'Edit', args: { file_path: '/a', old_string: '', new_string: '' } }),
    ).toBeUndefined();
  });
});

describe('findLastUserPrompt', () => {
  it('returns the newest real user prompt', () => {
    expect(
      findLastUserPrompt([
        userEntry('first'),
        toolEntry('t1', 'Read', { file_path: '/a' }),
        userEntry('second  '),
      ]),
    ).toBe('second');
  });

  it('skips shell-command echoes (empty bullet with a $ prefix)', () => {
    expect(
      findLastUserPrompt([userEntry('real prompt'), userEntry('$ ls', { bullet: '' })]),
    ).toBe('real prompt');
  });

  it('skips empty entries', () => {
    expect(findLastUserPrompt([userEntry('   ')])).toBeUndefined();
    expect(findLastUserPrompt([])).toBeUndefined();
  });
});

describe('cardDiffLines', () => {
  it('renders a header and the clustered diff without a line cap', () => {
    const long = Array.from({ length: 120 }, (_, i) => `line ${String(i)}`).join('\n');
    const card = {
      id: 't1',
      name: 'Write',
      keyArgument: 'b.ts',
      isError: false,
      hasResult: true,
      path: '/ws/b.ts',
      diff: { path: '/ws/b.ts', oldText: '', newText: long },
      output: undefined,
    };
    const lines = cardDiffLines(card, '/ws').map(strip);
    expect(lines[0]).toContain('Card diff · b.ts');
    expect(lines.length).toBeGreaterThan(100);
    expect(lines.some((line) => line.includes('line 119'))).toBe(true);
  });

  it('renders nothing for a card without a diff', () => {
    expect(
      cardDiffLines(
        {
          id: 't1',
          name: 'Bash',
          keyArgument: null,
          isError: false,
          hasResult: true,
          path: undefined,
          diff: undefined,
          output: 'x',
        },
        undefined,
      ),
    ).toEqual([]);
  });
});

describe('ToolOutputViewer', () => {
  it('shows the tool name, key argument and scroll position in the frame', () => {
    const viewer = new ToolOutputViewer(
      {
        toolName: 'Bash',
        headerDetail: 'ls -la',
        isError: false,
        output: 'file-a\nfile-b',
        onClose: () => {},
      },
      fakeTerminal(10),
    );
    const rendered = viewer.render(100).map(strip).join('\n');
    expect(rendered).toContain('Tool output');
    expect(rendered).toContain('Bash');
    expect(rendered).toContain('ls -la');
    expect(rendered).toContain('file-a');
    expect(rendered).toContain('1-2 / 2 (100%)');
  });

  it('marks error results and keeps the body single-framed at any height', () => {
    const viewer = new ToolOutputViewer(
      {
        toolName: 'Bash',
        headerDetail: undefined,
        isError: true,
        output: 'boom',
        onClose: () => {},
      },
      fakeTerminal(8),
    );
    const lines = viewer.render(60).map(strip);
    expect(lines).toHaveLength(8);
    expect(lines.join('\n')).toContain('error');
    expect(lines.join('\n')).toContain('boom');
  });
});

interface HostOverrides {
  readonly streamingPhase?: 'idle' | 'waiting' | 'thinking' | 'composing' | 'shell';
  readonly isCompacting?: boolean;
}

function makeHost(entries: TranscriptEntry[], overrides: HostOverrides = {}) {
  const browserSlot: { value: ToolCallsBrowserState | undefined } = { value: undefined };
  const calls: { status: string[]; errors: string[]; retried: string[]; panels: string[][] } = {
    status: [],
    errors: [],
    retried: [],
    panels: [],
  };
  const host: ToolCallsBrowserHost = {
    state: {
      terminal: fakeTerminal(24),
      ui: fakeUi(),
      editor: {} as ToolCallsBrowserHost['state']['editor'],
      get toolCallsBrowser() {
        return browserSlot.value;
      },
      transcriptEntries: entries,
      appState: {
        workDir: '/ws',
        isCompacting: overrides.isCompacting ?? false,
        streamingPhase: overrides.streamingPhase ?? 'idle',
      },
    },
    setToolCallsBrowser: (value) => {
      browserSlot.value = value;
    },
    showError: (msg) => {
      calls.errors.push(msg);
    },
    showStatus: (msg) => {
      calls.status.push(msg);
    },
    retryLastPrompt: (text) => {
      calls.retried.push(text);
    },
    showCardDiffPanel: (lines) => {
      calls.panels.push([...lines]);
    },
  };
  return { host, browserSlot, calls };
}

afterEach(() => {
  currentTheme.setPalette(darkColors);
});

describe('ToolCallsController', () => {
  it('opens a palette listing tool cards and closes cleanly', () => {
    const { host, browserSlot } = makeHost([
      userEntry('fix it'),
      toolEntry('t1', 'Read', { file_path: '/ws/src/a.ts' }),
    ]);
    const controller = new ToolCallsController(host);
    controller.show();
    expect(browserSlot.value).not.toBeUndefined();
    const rendered = (browserSlot.value?.component as CatalogBrowserApp).render(100).map(strip).join('\n');
    expect(rendered).toContain('Read');
    expect(rendered).toContain('src/a.ts');
    controller.close();
    expect(browserSlot.value).toBeUndefined();
  });

  it('shows a status instead of a palette when the transcript has no tool calls', () => {
    const { host, browserSlot, calls } = makeHost([userEntry('hi')]);
    const controller = new ToolCallsController(host);
    controller.show();
    expect(browserSlot.value).toBeUndefined();
    expect(calls.status.join('\n')).toContain('No tool calls');
  });

  it('offers per-card actions on the detail page', () => {
    const { host, browserSlot } = makeHost([
      toolEntry('t1', 'Bash', { command: 'ls' }, { output: 'files' }),
    ]);
    const controller = new ToolCallsController(host);
    controller.show();
    const app = browserSlot.value?.component as CatalogBrowserApp;
    app.handleInput(ENTER);
    const detail = app.render(100).map(strip).join('\n');
    expect(detail).toContain('Show full output');
    expect(detail).toContain('Open diff');
    expect(detail).toContain('Copy path');
    expect(detail).toContain('Jump to artifact');
    expect(detail).toContain('Retry turn');
    controller.close();
  });

  it('opens the full-output viewer from the palette and restores the browser on close', () => {
    const { host, browserSlot } = makeHost([
      toolEntry('t1', 'Bash', { command: 'ls' }, { output: 'file-a\nfile-b' }),
    ]);
    const controller = new ToolCallsController(host);
    controller.show();
    const app = browserSlot.value?.component as CatalogBrowserApp;
    app.handleInput(ENTER);
    app.handleInput(ENTER);
    const viewer = browserSlot.value?.viewer?.component;
    expect(viewer).toBeInstanceOf(ToolOutputViewer);
    expect(viewer?.render(80).map(strip).join('\n')).toContain('file-b');
    viewer?.handleInput('q');
    expect(browserSlot.value?.viewer).toBeUndefined();
    controller.close();
    expect(browserSlot.value).toBeUndefined();
  });

  it('renders the diff panel into the transcript and closes the palette', () => {
    const { host, browserSlot, calls } = makeHost([
      toolEntry('t1', 'Edit', { file_path: '/ws/a.ts', old_string: 'a', new_string: 'b' }),
    ]);
    const controller = new ToolCallsController(host);
    controller.show();
    const app = browserSlot.value?.component as CatalogBrowserApp;
    app.handleInput(ENTER);
    app.handleInput(DOWN);
    app.handleInput(ENTER);
    expect(browserSlot.value).toBeUndefined();
    expect(calls.panels).toHaveLength(1);
    expect(calls.panels[0]?.join('\n')).toContain('a.ts');
  });

  it('disables retry while a turn is streaming or compaction is running', () => {
    const overrideList: readonly HostOverrides[] = [
      { streamingPhase: 'composing' },
      { isCompacting: true },
    ];
    for (const overrides of overrideList) {
      const { host, browserSlot } = makeHost(
        [userEntry('go'), toolEntry('t1', 'Bash', { command: 'ls' }, { output: 'x' })],
        overrides,
      );
      const controller = new ToolCallsController(host);
      controller.show();
      const app = browserSlot.value?.component as CatalogBrowserApp;
      app.handleInput(ENTER);
      app.handleInput(DOWN);
      app.handleInput(DOWN);
      app.handleInput(DOWN);
      app.handleInput(DOWN);
      app.handleInput(ENTER);
      expect(browserSlot.value).not.toBeUndefined();
      expect(browserSlot.value?.viewer).toBeUndefined();
      controller.close();
    }
  });

  it('retries by re-sending the last user prompt after confirmation', () => {
    const { host, browserSlot, calls } = makeHost([
      userEntry('fix the bug'),
      toolEntry('t1', 'Bash', { command: 'ls' }, { output: 'x' }),
    ]);
    const controller = new ToolCallsController(host);
    controller.show();
    const app = browserSlot.value?.component as CatalogBrowserApp;
    app.handleInput(ENTER);
    app.handleInput(DOWN);
    app.handleInput(DOWN);
    app.handleInput(DOWN);
    app.handleInput(DOWN);
    app.handleInput(ENTER);
    expect(browserSlot.value).not.toBeUndefined();
    app.handleInput('y');
    expect(calls.retried).toEqual(['fix the bug']);
    expect(browserSlot.value).toBeUndefined();
  });

  it('refresh rebuilds the card list from newer transcript entries', () => {
    const entries = [toolEntry('t1', 'Bash', { command: 'ls' }, { output: 'x' })];
    const { host, browserSlot } = makeHost(entries);
    const controller = new ToolCallsController(host);
    controller.show();
    entries.push(toolEntry('t2', 'Grep', { pattern: 'q' }, { output: 'match' }));
    controller.refresh();
    const rendered = (browserSlot.value?.component as CatalogBrowserApp)
      .render(100)
      .map(strip)
      .join('\n');
    expect(rendered).toContain('Grep');
    expect(rendered).toContain('Bash');
    controller.close();
  });
});
