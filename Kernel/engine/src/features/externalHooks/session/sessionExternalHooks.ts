import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';

export interface ISessionExternalHooksService {
  readonly _serviceBrand: undefined;
}

export const ISessionExternalHooksService: ServiceIdentifier<ISessionExternalHooksService> =
  createDecorator<ISessionExternalHooksService>('sessionExternalHooksService');
