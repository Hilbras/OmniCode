import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';
import type { IStateRegistry } from '@hilbras/omnicode-base/state/stateRegistry';

export interface IAppStateService extends IStateRegistry {
  readonly _serviceBrand: undefined;
}

export const IAppStateService: ServiceIdentifier<IAppStateService> =
  createDecorator<IAppStateService>('appStateService');
