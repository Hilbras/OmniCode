export type TelegramConnectorState = 'not-configured' | 'awaiting-chat' | 'ready';
export type TelegramMode = 'polling' | 'webhook';

export interface TelegramBotIdentity {
  readonly id: string;
  readonly username: string;
  readonly name: string;
}

export interface TelegramPairingCode {
  readonly code: string;
  readonly expiresAt: number;
  readonly deepLink?: string;
}

export interface TelegramChatBinding {
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly updatedAt: number;
  readonly permission?: string;
}

export interface TelegramMetrics {
  readonly updates: number;
  readonly messages: number;
  readonly errors: number;
  readonly retries: number;
}

export interface TelegramConnectorStatus {
  readonly state: TelegramConnectorState;
  readonly configPath: string;
  readonly hasToken: boolean;
  readonly allowedChatIds: readonly number[];
  readonly running: boolean;
  readonly pid?: number;
  readonly heartbeatAt?: number;
  readonly bot?: TelegramBotIdentity;
  readonly error?: string;
  readonly lastUpdateAt?: number;
  readonly lastError?: string;
  readonly pairing?: TelegramPairingCode;
  readonly boundChats?: number;
  readonly startedAt?: number;
  readonly uptimeMs?: number;
  readonly metrics?: TelegramMetrics;
  readonly mode?: TelegramMode;
  readonly webhookUrl?: string;
}

export interface TelegramSettingsInput {
  readonly botToken?: string;
  readonly allowedChatIds?: readonly number[];
  readonly mode?: TelegramMode;
  readonly webhookUrl?: string;
  readonly webhookSecret?: string;
}
