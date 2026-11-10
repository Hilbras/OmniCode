import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';

export interface IExtraAgentProfileLoader {
  readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;
  reload(): Promise<void>;
}

export const IExtraAgentProfileLoader: ServiceIdentifier<IExtraAgentProfileLoader> =
  createDecorator<IExtraAgentProfileLoader>('extraAgentProfileLoader');
