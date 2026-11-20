import { Container } from '@hilbras/omnicode-tui';
import { NotifyPanelComponent } from '#/tui/components/chrome/notify-panel';
import type { Event } from '@hilbras/omnicode-api';
import { describe, expect, it, vi } from 'vitest';

import { SessionEventHandler } from '#/tui/controllers/session-event-handler';
import { summarizeInteractionResponse } from '#/tui/utils/interaction-summary';
import { getBuiltInPalette } from '#/tui/theme';

function makeHost(resolvedPayload: { interaction_id?: string } | undefined) {
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
    approvalController: { resolveExternally: vi.fn(() => resolvedPayload) },
    questionController: { resolveExternally: vi.fn(() => undefined) },
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

function interactionResolved(
  id: string,
  response: unknown,
): Event {
  return {
    sessionId: 's1',
    agentId: 'main',
    type: 'interaction.resolved',
    id,
    response,
  } as unknown as Event;
}

describe('SessionEventHandler — interaction resolved elsewhere', () => {
  it('clears a matching approval panel and reports the Telegram answer', () => {
    const { host, showStatus } = makeHost({ interaction_id: 'i1' });
    const handler = new SessionEventHandler(host);

    handler.handleEvent(
      interactionResolved('i1', { decision: 'approved', selectedLabel: 'Approach B' }),
      vi.fn(),
    );

    expect(host.approvalController.resolveExternally).toHaveBeenCalledWith(
      expect.any(Function),
      'answered-elsewhere',
    );
    expect(showStatus).toHaveBeenCalledWith('Answered from Telegram: approved (Approach B)');
  });

  it('falls back to the question panel when no approval matched', () => {
    const { host, showStatus } = makeHost(undefined);
    host.questionController.resolveExternally = vi.fn(() => ({ interaction_id: 'q1' }));
    const handler = new SessionEventHandler(host);

    handler.handleEvent(
      interactionResolved('q1', { answers: { 'Proceed?': 'Yes' } }),
      vi.fn(),
    );

    expect(host.questionController.resolveExternally).toHaveBeenCalled();
    expect(showStatus).toHaveBeenCalledWith('Answered from Telegram: Proceed?: Yes');
  });

  it('stays silent when the resolution matches no pending panel', () => {
    const { host, showStatus } = makeHost(undefined);
    const handler = new SessionEventHandler(host);

    handler.handleEvent(interactionResolved('other', { decision: 'approved' }), vi.fn());

    expect(showStatus).not.toHaveBeenCalled();
  });
});

describe('summarizeInteractionResponse', () => {
  it('summarizes decisions, labels, feedback, answers and cancellations', () => {
    expect(summarizeInteractionResponse({ decision: 'rejected' })).toBe('rejected');
    expect(summarizeInteractionResponse({ decision: 'approved', selectedLabel: 'Approach B' })).toBe(
      'approved (Approach B)',
    );
    expect(
      summarizeInteractionResponse({ decision: 'rejected', feedback: 'please split the change' }),
    ).toBe('rejected — please split the change');
    expect(summarizeInteractionResponse({ answers: { 'Proceed?': 'Yes' } })).toBe('Proceed?: Yes');
    expect(summarizeInteractionResponse({ cancelled: true, reason: 'turn_ended' })).toBe(
      'dismissed (turn_ended)',
    );
    expect(summarizeInteractionResponse(null)).toBe('dismissed');
  });
});
