import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';

export interface ISessionOutcomeMirror {
  readonly _serviceBrand: undefined;
}

export const ISessionOutcomeMirror: ServiceIdentifier<ISessionOutcomeMirror> =
  createDecorator<ISessionOutcomeMirror>('sessionOutcomeMirror');
