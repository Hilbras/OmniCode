import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';

export interface IAgentCacheProbeService {
  readonly _serviceBrand: undefined;
}

export const IAgentCacheProbeService: ServiceIdentifier<IAgentCacheProbeService> =
  createDecorator<IAgentCacheProbeService>('agentCacheProbeService');
