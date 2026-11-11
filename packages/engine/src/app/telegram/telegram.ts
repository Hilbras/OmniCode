import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';

import type {
  TelegramChatBinding,
  TelegramConnectorStatus,
  TelegramPairingCode,
  TelegramSettingsInput,
} from './types';

export interface TelegramStatusOptions {
  readonly probe?: boolean;
}

export interface ITelegramConnectorService {
  readonly _serviceBrand: undefined;

  status(options?: TelegramStatusOptions): Promise<TelegramConnectorStatus>;
  saveSettings(input: TelegramSettingsInput): Promise<TelegramConnectorStatus>;
  createPairingCode(): Promise<TelegramPairingCode>;
  start(): Promise<TelegramConnectorStatus>;
  stop(): Promise<TelegramConnectorStatus>;
  addAllowedChat(chatId: number): Promise<TelegramConnectorStatus>;
  removeAllowedChat(chatId: number): Promise<TelegramConnectorStatus>;
  listBindings(): Promise<Readonly<Record<string, TelegramChatBinding>>>;
  unbindChat(chatId: number): Promise<TelegramConnectorStatus>;
  handleWebhookUpdate(update: unknown, secret: string | undefined): Promise<boolean>;
}

export const ITelegramConnectorService: ServiceIdentifier<ITelegramConnectorService> =
  createDecorator<ITelegramConnectorService>('telegramConnectorService');
