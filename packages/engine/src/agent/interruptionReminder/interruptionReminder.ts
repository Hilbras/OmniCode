import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';

export interface IAgentInterruptionReminderService {
  readonly _serviceBrand: undefined;
}

export const IAgentInterruptionReminderService =
  createDecorator<IAgentInterruptionReminderService>('agentInterruptionReminderService');
