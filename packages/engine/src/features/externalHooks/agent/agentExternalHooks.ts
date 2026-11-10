import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';

export interface IAgentExternalHooksService {
  readonly _serviceBrand: undefined;
}

export const IAgentExternalHooksService =
  createDecorator<IAgentExternalHooksService>('agentExternalHooksService');
