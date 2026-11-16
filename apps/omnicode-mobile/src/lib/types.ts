export type ProviderId = 'openai' | 'anthropic' | 'google' | 'custom';

export type ToolName = 'web_search' | 'read_url' | 'read_file' | 'run_code' | 'memory_save';

export type ToolStatus = 'running' | 'done' | 'denied' | 'error';

export interface ToolCall {
  id: string;
  tool: ToolName;
  args: Record<string, string>;
  status: ToolStatus;
  result?: string;
  durationMs?: number;
}

export interface Approval {
  id: string;
  tool: ToolName;
  args: Record<string, string>;
  status: 'pending' | 'allowed' | 'denied';
}

export interface Attachment {
  id: string;
  name: string;
  size?: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  toolCalls: ToolCall[];
  approval?: Approval;
  attachments?: Attachment[];
  streaming?: boolean;
  stopped?: boolean;
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  providerId: ProviderId;
  model: string;
}

export interface Settings {
  providerId: ProviderId;
  model: string;
  customBaseUrl: string;
  streaming: boolean;
  haptics: boolean;
  ambient: boolean;
}

export interface AppState {
  sessions: Session[];
  activeSessionId: string | null;
  settings: Settings;
  hydrated: boolean;
}

export const defaultSettings: Settings = {
  providerId: 'anthropic',
  model: 'claude-sonnet-4-5',
  customBaseUrl: '',
  streaming: true,
  haptics: true,
  ambient: true,
};
