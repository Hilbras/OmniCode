import { Event } from '@hilbras/omnicode-base/event';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';

import { ISessionToolPolicyGate } from './sessionToolPolicyGate';

export class NoopSessionToolPolicyGate implements ISessionToolPolicyGate {
  declare readonly _serviceBrand: undefined;

  readonly disabledTools: readonly string[] = [];
  readonly onDidChange = Event.None as Event<void>;
}

registerScopedService(
  LifecycleScope.Session,
  ISessionToolPolicyGate,
  NoopSessionToolPolicyGate,
  ScopeActivation.OnScopeCreated,
  'sessionToolPolicyGate',
);
