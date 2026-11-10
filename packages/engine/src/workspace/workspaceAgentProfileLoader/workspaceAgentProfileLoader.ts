import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';

export interface IWorkspaceAgentProfileLoader {
  readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;
  reload(): Promise<void>;
}

export const IWorkspaceAgentProfileLoader: ServiceIdentifier<IWorkspaceAgentProfileLoader> =
  createDecorator<IWorkspaceAgentProfileLoader>('workspaceAgentProfileLoader');
