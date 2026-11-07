import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';

export interface IExplicitAgentProfileLoader {
  readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;
  reload(): Promise<void>;
}

export const IExplicitAgentProfileLoader: ServiceIdentifier<IExplicitAgentProfileLoader> =
  createDecorator<IExplicitAgentProfileLoader>('explicitAgentProfileLoader');
