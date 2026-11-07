import { LifecycleScope } from '#/app/scopes';

import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { StateRegistry } from '@hilbras/omnicode-base/state/stateRegistry';

import { ISessionStateService } from './sessionState';

export class SessionStateService extends StateRegistry implements ISessionStateService {
  declare readonly _serviceBrand: undefined;
  protected override readonly inspectScope = 'session';

  constructor() {
    super();
  }
}

registerScopedService(
  LifecycleScope.Session,
  ISessionStateService,
  SessionStateService,
  ScopeActivation.OnScopeCreated,
  'state',
);
