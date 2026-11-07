import { LifecycleScope } from '#/app/scopes';

import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { StateRegistry } from '@hilbras/omnicode-base/state/stateRegistry';

import { IAppStateService } from './appState';

export class AppStateService extends StateRegistry implements IAppStateService {
  declare readonly _serviceBrand: undefined;
  protected override readonly inspectScope = 'app';
}

registerScopedService(
  LifecycleScope.App,
  IAppStateService,
  AppStateService,
  ScopeActivation.OnScopeCreated,
  'state',
);
