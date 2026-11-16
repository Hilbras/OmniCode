import { titleFromText, uid } from './format';
import {
  AppState,
  Approval,
  Message,
  Session,
  Settings,
  ToolCall,
  defaultSettings,
} from './types';

export type { AppState } from './types';

export const initialState: AppState = {
  sessions: [],
  activeSessionId: null,
  settings: defaultSettings,
  hydrated: false,
};

export type Action =
  | { type: 'hydrate'; sessions: Session[]; activeSessionId: string | null; settings: Settings }
  | { type: 'newSession'; session: Session }
  | { type: 'deleteSession'; id: string }
  | { type: 'restoreSession'; session: Session; index: number }
  | { type: 'renameSession'; id: string; title: string }
  | { type: 'selectSession'; id: string }
  | { type: 'addMessage'; sessionId: string; message: Message }
  | { type: 'patchMessage'; sessionId: string; messageId: string; patch: Partial<Message> }
  | { type: 'appendText'; sessionId: string; messageId: string; chunk: string }
  | { type: 'addToolCall'; sessionId: string; messageId: string; toolCall: ToolCall }
  | {
      type: 'patchToolCall';
      sessionId: string;
      messageId: string;
      toolCallId: string;
      patch: Partial<ToolCall>;
    }
  | { type: 'setApproval'; sessionId: string; messageId: string; approval: Approval }
  | { type: 'updateSettings'; patch: Partial<Settings> }
  | { type: 'clearAll' };

export function createSession(providerId: Session['providerId'], model: string): Session {
  const now = Date.now();
  return {
    id: uid('ses'),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
    providerId,
    model,
  };
}

export function createMessage(role: Message['role'], text: string): Message {
  return {
    id: uid('msg'),
    role,
    text,
    createdAt: Date.now(),
    toolCalls: [],
  };
}

function mapSession(state: AppState, id: string, fn: (session: Session) => Session): AppState {
  return {
    ...state,
    sessions: state.sessions.map((session) => (session.id === id ? fn(session) : session)),
  };
}

function mapMessage(
  state: AppState,
  sessionId: string,
  messageId: string,
  fn: (message: Message) => Message,
): AppState {
  return mapSession(state, sessionId, (session) => ({
    ...session,
    updatedAt: Date.now(),
    messages: session.messages.map((message) =>
      message.id === messageId ? fn(message) : message,
    ),
  }));
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'hydrate':
      return {
        sessions: action.sessions,
        activeSessionId: action.activeSessionId,
        settings: action.settings,
        hydrated: true,
      };
    case 'newSession':
      return {
        ...state,
        sessions: [action.session, ...state.sessions],
        activeSessionId: action.session.id,
      };
    case 'deleteSession': {
      const sessions = state.sessions.filter((session) => session.id !== action.id);
      const activeSessionId =
        state.activeSessionId === action.id
          ? (sessions[0]?.id ?? null)
          : state.activeSessionId;
      return { ...state, sessions, activeSessionId };
    }
    case 'restoreSession': {
      const sessions = [...state.sessions];
      sessions.splice(Math.min(action.index, sessions.length), 0, action.session);
      return { ...state, sessions, activeSessionId: action.session.id };
    }
    case 'renameSession':
      return mapSession(state, action.id, (session) => ({ ...session, title: action.title }));
    case 'selectSession':
      return { ...state, activeSessionId: action.id };
    case 'addMessage':
      return mapSession(state, action.sessionId, (session) => ({
        ...session,
        updatedAt: Date.now(),
        title:
          session.messages.length === 0 && action.message.role === 'user'
            ? titleFromText(action.message.text)
            : session.title,
        messages: [...session.messages, action.message],
      }));
    case 'patchMessage':
      return mapMessage(state, action.sessionId, action.messageId, (message) => ({
        ...message,
        ...action.patch,
      }));
    case 'appendText':
      return mapMessage(state, action.sessionId, action.messageId, (message) => ({
        ...message,
        text: message.text + action.chunk,
      }));
    case 'addToolCall':
      return mapMessage(state, action.sessionId, action.messageId, (message) => ({
        ...message,
        toolCalls: [...message.toolCalls, action.toolCall],
      }));
    case 'patchToolCall':
      return mapMessage(state, action.sessionId, action.messageId, (message) => ({
        ...message,
        toolCalls: message.toolCalls.map((toolCall) =>
          toolCall.id === action.toolCallId ? { ...toolCall, ...action.patch } : toolCall,
        ),
      }));
    case 'setApproval':
      return mapMessage(state, action.sessionId, action.messageId, (message) => ({
        ...message,
        approval: action.approval,
      }));
    case 'updateSettings':
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case 'clearAll':
      return { ...initialState, settings: state.settings, hydrated: true };
    default:
      return state;
  }
}

export function activeSession(state: AppState): Session | null {
  return state.sessions.find((session) => session.id === state.activeSessionId) ?? null;
}
