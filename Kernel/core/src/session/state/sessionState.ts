import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';
import type { IStateRegistry } from '@hilbras/omnicode-base/state/stateRegistry';

export interface ISessionStateService extends IStateRegistry {
  readonly _serviceBrand: undefined;
}

export const ISessionStateService: ServiceIdentifier<ISessionStateService> =
  createDecorator<ISessionStateService>('sessionStateService');
