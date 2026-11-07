import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';

export interface IAgentToolSelectSchemasService {
  readonly _serviceBrand: undefined;
}

export const IAgentToolSelectSchemasService: ServiceIdentifier<IAgentToolSelectSchemasService> =
  createDecorator<IAgentToolSelectSchemasService>('agentToolSelectSchemasService');
