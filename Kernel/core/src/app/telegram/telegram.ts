import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';

import type { TelegramConnectorStatus, TelegramSettingsInput } from './types';

export interface TelegramStatusOptions {
  readonly probe?: boolean;
}

export interface ITelegramConnectorService {
  readonly _serviceBrand: undefined;

  status(options?: TelegramStatusOptions): Promise<TelegramConnectorStatus>;
  saveSettings(input: TelegramSettingsInput): Promise<TelegramConnectorStatus>;
}

export const ITelegramConnectorService: ServiceIdentifier<ITelegramConnectorService> =
  createDecorator<ITelegramConnectorService>('telegramConnectorService');
