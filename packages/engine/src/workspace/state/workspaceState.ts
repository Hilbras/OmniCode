import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';
import type { IStateRegistry } from '@hilbras/omnicode-base/state/stateRegistry';

export interface IWorkspaceStateService extends IStateRegistry {
  readonly _serviceBrand: undefined;
}

export const IWorkspaceStateService: ServiceIdentifier<IWorkspaceStateService> =
  createDecorator<IWorkspaceStateService>('workspaceStateService');
