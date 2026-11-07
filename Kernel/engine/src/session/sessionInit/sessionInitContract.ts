import type { ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';
import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';

export interface ISessionInitService {
  readonly _serviceBrand: undefined;

  generateAgentsMd(): Promise<void>;

  cancelInit(): void;
}

export const ISessionInitService: ServiceIdentifier<ISessionInitService> =
  createDecorator<ISessionInitService>('sessionInitService');
