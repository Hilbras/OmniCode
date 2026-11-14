import { describe, expect, it, vi } from 'vitest';

import { SessionEventHandler } from '#/tui/controllers/session-event-handler';
import {
  LoopConfirmationDialog,
  type LoopConfirmationAction,
} from '#/tui/components/dialogs/loop-confirmation';
import { getBuiltInPalette } from '#/tui/theme';

const ANSI = /\u001B\[[0-9;]*m/g;
const strip = (text: string): string => text.replaceAll(ANSI, '');
const ESC = String.fromCodePoint(27);
const ENTER = '\r';
const DOWN = `${ESC}[B`;
const UP = `${ESC}[A`;

function makeDialog(
  overrides: Partial<{
    kind: 'text_loop' | 'result_stagnation';
    detail: string;
    turnId: number;
    onSelect: (action: LoopConfirmationAction) => void;
    onCancel: () => void;
  }> = {},
): { dialog: LoopConfirmationDialog; selected: LoopConfirmationAction[]; cancelled: number } {
  const selected: LoopConfirmationAction[] = [];
  let cancelled = 0;
  const dialog = new LoopConfirmationDialog({
    kind: 'text_loop',
    detail: 'the same phrase was emitted repeatedly',
    turnId: 3,
    onSelect: (action) => {
      selected.push(action);
    },
    onCancel: () => {
      cancelled += 1;
    },
    ...overrides,
  });
  return { dialog, selected, get cancelled() { return cancelled; } };
}

describe('LoopConfirmationDialog', () => {
  it('renders the kind headline, detail, and both options', () => {
    const { dialog } = makeDialog();
    const rendered = dialog.render(80).map(strip).join('\n');
    expect(rendered).toContain('Agent looks stuck');
    expect(rendered).toContain('turn 3');
    expect(rendered).toContain('keeps emitting the same text');
    expect(rendered).toContain('the same phrase was emitted repeatedly');
    expect(rendered).toContain('Continue the turn');
    expect(rendered).toContain('Stop the turn');
  });

  it('renders the stagnation headline for result_stagnation', () => {
    const { dialog } = makeDialog({ kind: 'result_stagnation' });
    expect(dialog.render(80).map(strip).join('\n')).toContain('keeps repeating the same tool call');
  });

  it('selects the highlighted option with Enter and moves with arrows', () => {
    const { dialog, selected } = makeDialog();
    dialog.handleInput(ENTER);
    expect(selected).toEqual(['continue']);
    dialog.handleInput(DOWN);
    dialog.handleInput(ENTER);
    expect(selected).toEqual(['continue', 'stop']);
    dialog.handleInput(UP);
    dialog.handleInput(ENTER);
    expect(selected).toEqual(['continue', 'stop', 'continue']);
  });

  it('supports j/k navigation like the other list dialogs', () => {
    const { dialog, selected } = makeDialog();
    dialog.handleInput('j');
    dialog.handleInput(ENTER);
    expect(selected).toEqual(['stop']);
    dialog.handleInput('k');
    dialog.handleInput(ENTER);
    expect(selected).toEqual(['stop', 'continue']);
  });

  it('dismisses with Esc without selecting', () => {
    const state = makeDialog();
    state.dialog.handleInput(ESC_KEY);
    expect(state.selected).toEqual([]);
    expect(state.cancelled).toBe(1);
  });
});

const ESC_KEY = ESC;

describe('loop.detected routing', () => {
  it('forwards the session event to the host once per dispatch', () => {
    const host = makeHostStub();
    const handler = new SessionEventHandler(host as unknown as ConstructorParameters<typeof SessionEventHandler>[0]);
    handler.handleEvent(
      {
        type: 'loop.detected',
        sessionId: 's1',
        agentId: 'main',
        turnId: 3,
        kind: 'text_loop',
        detail: 'the same phrase was emitted repeatedly',
      },
      () => {},
    );
    expect(host.handleLoopDetected).toHaveBeenCalledTimes(1);
    const event = host.handleLoopDetected.mock.calls[0]?.[0] as { turnId: number; kind: string };
    expect(event.turnId).toBe(3);
    expect(event.kind).toBe('text_loop');
  });
});

function makeHostStub(): {
  handleLoopDetected: ReturnType<typeof vi.fn>;
} & Record<string, unknown> {
  const host = {
    state: {
      appState: {
        sessionId: 's1',
        streamingPhase: 'composing',
        isCompacting: false,
        model: 'omnicode-model',
        permissionMode: 'auto',
      },
      queuedMessages: [],
      queuedMessageDispatchPending: false,
      theme: { palette: getBuiltInPalette('dark') },
      toolOutputExpanded: false,
      todoPanel: { getTodos: vi.fn(() => []) },
      transcriptContainer: { addChild: vi.fn() },
      ui: { requestRender: vi.fn() },
    },
    session: { id: 's1' },
    aborted: false,
    sessionEventUnsubscribe: undefined,
    streamingUI: {
      setTurnId: vi.fn(),
      flushNow: vi.fn(),
      resetToolUi: vi.fn(),
      finalizeTurn: vi.fn(),
      hasActiveTurn: vi.fn(() => false),
      hasThinkingDraft: vi.fn(() => false),
      scheduleFlush: vi.fn(),
      appendAssistantDelta: vi.fn(),
      appendThinkingDelta: vi.fn(),
    },
    requireSession: vi.fn(),
    setAppState: vi.fn(),
    patchLivePane: vi.fn(),
    showError: vi.fn(),
    showStatus: vi.fn(),
    showNotice: vi.fn(),
    track: vi.fn(),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    appendTranscriptEntry: vi.fn(),
    sendNormalUserInput: vi.fn(),
    sendQueuedMessage: vi.fn(),
    shiftQueuedMessage: vi.fn(),
    btwPanelController: { routeEvent: vi.fn(() => false) },
    tasksBrowserController: {},
    handleLoopDetected: vi.fn(),
  };
  return host as unknown as {
    handleLoopDetected: ReturnType<typeof vi.fn>;
  } & Record<string, unknown>;
}
