import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';
import type { ScopeSeed } from '@hilbras/omnicode-base/di/scope';
import type { Event } from '@hilbras/omnicode-base/event';

export interface ISessionWorkspaceInfo {
  readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly additionalDirs: readonly string[];
  readonly onDidChange: Event<void>;
}

export const ISessionWorkspaceInfo: ServiceIdentifier<ISessionWorkspaceInfo> =
  createDecorator<ISessionWorkspaceInfo>('sessionWorkspaceInfo');

export function sessionWorkspaceInfoSeed(info: ISessionWorkspaceInfo): ScopeSeed {
  return [[ISessionWorkspaceInfo as ServiceIdentifier<unknown>, info]];
}
