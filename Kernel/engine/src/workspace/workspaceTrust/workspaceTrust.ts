import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';
import type { Event } from '@hilbras/omnicode-base/event';

export interface WorkspaceTrustChange {
  readonly trusted: boolean;
}

export interface IWorkspaceTrust {
  readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;

  get(): Promise<boolean>;

  isTrusted(): boolean;

  trust(): Promise<void>;
  untrust(): Promise<void>;

  readonly onDidChange: Event<WorkspaceTrustChange>;
}

export const IWorkspaceTrust: ServiceIdentifier<IWorkspaceTrust> =
  createDecorator<IWorkspaceTrust>('workspaceTrust');
