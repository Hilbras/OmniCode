import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';

export interface IAgentToolSelectAnnouncementsService {
  readonly _serviceBrand: undefined;
}

export const IAgentToolSelectAnnouncementsService: ServiceIdentifier<IAgentToolSelectAnnouncementsService> =
  createDecorator<IAgentToolSelectAnnouncementsService>('agentToolSelectAnnouncementsService');
