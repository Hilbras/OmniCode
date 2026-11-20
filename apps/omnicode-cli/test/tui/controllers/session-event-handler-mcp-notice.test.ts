import { Container } from '@hilbras/omnicode-tui';
import { NotifyPanelComponent } from '#/tui/components/chrome/notify-panel';
import type { Event } from '@hilbras/omnicode-api';
import { describe, expect, it, vi } from 'vitest';

import { SessionEventHandler } from '#/tui/controllers/session-event-handler';
import { getBuiltInPalette } from '#/tui/theme';

function makeHost() {
  const showStatus = vi.fn();
  const host = {
    state: {
      notifyPanel: new NotifyPanelComponent(),
      notifyPanelContainer: new Container(),
      appState: {
        sessionId: 's1',
        workDir: '/tmp',
        streamingPhase: 'idle',
        isCompacting: false,
        model: 'omnicode-model',
        permissionMode: 'auto',
        stepRetry: null,
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
    surveyController: { notifyToolCallStarted: vi.fn() },
    streamingUI: {
      setTurnId: vi.fn(),
      setStep: vi.fn(),
      flushNow: vi.fn(),
      resetToolUi: vi.fn(),
      clearNotifyPanel: vi.fn(),
      markNotifyPanelEnded: vi.fn(),
      finalizeTurn: vi.fn(),
      finalizeLiveTextBuffers: vi.fn(),
      completeToolResult: vi.fn(),
      registerToolCall: vi.fn(),
      getTurnContext: vi.fn(() => ({ turnId: '1', step: 0 })),
    },
    subAgentEventHandler: { routeChildAgentEvent: vi.fn(() => false) },
    requireSession: vi.fn(),
    setAppState: vi.fn((patch: Record<string, unknown>) =>
      Object.assign(host.state.appState, patch),
    ),
    patchLivePane: vi.fn(),
    resetLivePane: vi.fn(),
    updateActivityPane: vi.fn(),
    updateQueueDisplay: vi.fn(),
    showError: vi.fn(),
    showStatus,
    showNotice: vi.fn(),
    track: vi.fn(),
    recordSessionActivity: vi.fn(),
    noteStepUsage: vi.fn(),
    noteCompactionFinished: vi.fn(),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    restoreInputText: vi.fn(),
    appendTranscriptEntry: vi.fn(),
    sendNormalUserInput: vi.fn(),
    sendQueuedMessage: vi.fn(),
    shiftQueuedMessage: vi.fn(),
    btwPanelController: { routeEvent: vi.fn(() => false) },
    tasksBrowserController: {},
  };
  return { host: host as any, showStatus };
}

function toolCall(name: string): Event {
  return {
    sessionId: 's1',
    agentId: 'main',
    type: 'tool.call.started',
    turnId: 1,
    toolCallId: 'c1',
    name,
    args: {},
  } as unknown as Event;
}

describe('SessionEventHandler MCP call notices', () => {
  it('adds a visible message for every MCP tool call', () => {
    const { host, showStatus } = makeHost();
    const handler = new SessionEventHandler(host);

    handler.handleEvent(toolCall('mcp__github__search_issues'), vi.fn());
    handler.handleEvent(toolCall('mcp__filesystem__read_file'), vi.fn());

    expect(showStatus.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      '🔌 MCP call: mcp__github__search_issues',
      '🔌 MCP call: mcp__filesystem__read_file',
    ]);
  });

  it('does not add a notice for a built-in tool', () => {
    const { host, showStatus } = makeHost();
    const handler = new SessionEventHandler(host);

    handler.handleEvent(toolCall('Bash'), vi.fn());

    expect(showStatus).not.toHaveBeenCalled();
  });
});
