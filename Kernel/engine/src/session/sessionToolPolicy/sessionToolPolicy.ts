import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';
import type { Event, IWaitUntil } from '@hilbras/omnicode-base/event';

export type SessionToolPolicyChangedEvent = IWaitUntil;

export interface ISessionToolPolicy {
  readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;
  readonly onDidChange: Event<SessionToolPolicyChangedEvent>;

  disabledTools(): readonly string[];
  setDisabledTools(names: readonly string[]): Promise<void>;
}

export const ISessionToolPolicy: ServiceIdentifier<ISessionToolPolicy> =
  createDecorator<ISessionToolPolicy>('sessionToolPolicy');
