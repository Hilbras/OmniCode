export type TelegramConnectorState = 'not-configured' | 'awaiting-chat' | 'ready';

export interface TelegramBotIdentity {
  readonly id: string;
  readonly username: string;
  readonly name: string;
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
}

export interface TelegramSettingsInput {
  readonly botToken?: string;
  readonly allowedChatIds?: readonly number[];
}
