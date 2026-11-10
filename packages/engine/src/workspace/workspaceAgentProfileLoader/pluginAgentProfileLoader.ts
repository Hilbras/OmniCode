import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';

export interface IPluginAgentProfileLoader {
  readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;
  reload(): Promise<void>;
}

export const IPluginAgentProfileLoader: ServiceIdentifier<IPluginAgentProfileLoader> =
  createDecorator<IPluginAgentProfileLoader>('pluginAgentProfileLoader');
