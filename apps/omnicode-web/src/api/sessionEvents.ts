import type { AppApprovalRequest, AppEvent, AppQuestionRequest } from '@hilbras/app-core/api';

/**
 * Live-turn projection for one open session: the streaming assistant text and
 * the indicators the UI needs while a turn runs. Pure reducer so the event
 * wiring stays trivial to test.
 *
 * The persisted transcript still comes from the daemon's messages endpoint;
 * this buffer only covers the in-flight turn. Any event that changes persisted
 * state returns `refetch: true` so the caller invalidates its queries.
 */
export interface LiveTurnState {
  /** Accumulated assistant text for the in-flight turn (or '' when idle). */
  readonly streamingText: string;
  /** Thinking-phase indicator for the in-flight turn. */
  readonly thinking: boolean;
  /** Whether the session currently holds an active main turn. */
  readonly busy: boolean;
  /** Set when the event changes persisted data (messages, sessions). */
  readonly refetch: boolean;
  /** Approval awaiting the user's decision, if any. */
  readonly pendingApproval: AppApprovalRequest | null;
  /** Question awaiting the user's answers, if any. */
  readonly pendingQuestion: AppQuestionRequest | null;
}

export const idleLiveTurn: LiveTurnState = {
  streamingText: '',
  thinking: false,
  busy: false,
  refetch: false,
  pendingApproval: null,
  pendingQuestion: null,
};

export function reduceLiveTurn(
  prev: LiveTurnState,
  event: AppEvent,
  sessionId: string,
): LiveTurnState {
  switch (event.type) {
    case 'assistantDelta': {
      if (event.sessionId !== sessionId) return prev;
      const text = event.delta.text ?? '';
      return {
        ...prev,
        streamingText: prev.streamingText + text,
        thinking: typeof event.delta.thinking === 'string' && event.delta.text === undefined,
        busy: true,
        refetch: false,
      };
    }
    case 'messageCreated': {
      // The messageCreated frame carries the message, not a session id; the
      // per-session subscription scopes it for us.
      if (!('sessionId' in event) || event.sessionId !== sessionId) return prev;
      return { ...prev, refetch: true };
    }
    case 'messageUpdated': {
      if (event.sessionId !== sessionId) return prev;
      return { ...prev, refetch: true };
    }
    case 'sessionWorkChanged': {
      if (event.sessionId !== sessionId) return prev;
      if (event.busy) return { ...prev, busy: true, refetch: false };
      // Turn over: the transcript will change once the final message lands;
      // refetch clears the streaming buffer on the next render pass.
      return { ...prev, streamingText: '', thinking: false, busy: false, refetch: true };
    }
    case 'sessionUpdated': {
      if (event.session.id !== sessionId) return prev;
      return { ...prev, refetch: true };
    }
    case 'sessionMetaUpdated': {
      if (event.sessionId !== sessionId) return prev;
      return { ...prev, refetch: true };
    }
    case 'approvalRequested': {
      if (event.approval.sessionId !== sessionId) return prev;
      return { ...prev, pendingApproval: event.approval };
    }
    case 'approvalResolved':
    case 'approvalExpired': {
      if (prev.pendingApproval === null) return prev;
      if (prev.pendingApproval.approvalId !== event.approvalId) return prev;
      return { ...prev, pendingApproval: null };
    }
    case 'questionRequested': {
      if (event.question.sessionId !== sessionId) return prev;
      return { ...prev, pendingQuestion: event.question };
    }
    case 'questionAnswered': {
      if (prev.pendingQuestion === null) return prev;
      if (prev.pendingQuestion.questionId !== event.questionId) return prev;
      return { ...prev, pendingQuestion: null };
    }
    default:
      return prev;
  }
}
