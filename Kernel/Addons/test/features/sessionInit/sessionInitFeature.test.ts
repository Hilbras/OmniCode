import { beforeEach, describe, expect, it } from 'vitest';

import { ScopeActivation } from '@hilbras/omnicode-core/_base/di/instantiation';
import {
  _clearScopedRegistryForTests,
  registerScopedService,
} from '@hilbras/omnicode-core/_base/di/scope';
import { createScopedTestHost, stubPair } from '@hilbras/omnicode-core/_base/di/test';
import { IBootstrapService } from '@hilbras/omnicode-core/app/bootstrap/bootstrap';
import { IFeatureManager } from '@hilbras/omnicode-core/app/feature/featureManager';
import { FeatureManagerService } from '@hilbras/omnicode-core/app/feature/featureManagerService';
import { LifecycleScope } from '@hilbras/omnicode-core/app/scopes';
import { SessionInitFeature } from '#/features/sessionInit/sessionInitFeature';
import { ISessionInitService } from '#/features/sessionInit/sessionInit';
import { IHostEnvironment } from '@hilbras/omnicode-core/os/interface/hostEnvironment';
import { IHostFileSystem } from '@hilbras/omnicode-core/os/interface/hostFileSystem';
import { IFeatureAssemblyService } from '@hilbras/omnicode-core/features/featureAssembly';
import { FeatureAssemblyService } from '@hilbras/omnicode-core/features/featureAssemblyService';
import {
  _clearFeatureRecipesForTests,
  registerFeature,
} from '@hilbras/omnicode-core/features/featureRegistry';
import { IAgentLifecycleService } from '@hilbras/omnicode-core/session/agentLifecycle/agentLifecycle';
import { ISessionContext } from '@hilbras/omnicode-core/session/sessionContext/sessionContext';
import { ISessionSubagentService } from '@hilbras/omnicode-core/session/subagent/subagent';

describe('SessionInitFeature', () => {
  beforeEach(() => {
    _clearScopedRegistryForTests();
    _clearFeatureRecipesForTests();
    registerScopedService(
      LifecycleScope.App,
      IFeatureManager,
      FeatureManagerService,
      ScopeActivation.OnScopeCreated,
      'feature',
    );
    registerScopedService(
      LifecycleScope.App,
      IFeatureAssemblyService,
      FeatureAssemblyService,
      ScopeActivation.OnScopeCreated,
      'features',
    );
    registerFeature(SessionInitFeature);
  });

  it('withdraws and restores the Session service with the Feature', async () => {
    const host = createScopedTestHost();
    const session = host.child(LifecycleScope.Session, 'session-1', [
      stubPair(IAgentLifecycleService, {} as IAgentLifecycleService),
      stubPair(ISessionSubagentService, {} as ISessionSubagentService),
      stubPair(IHostFileSystem, {} as IHostFileSystem),
      stubPair(IHostEnvironment, {} as IHostEnvironment),
      stubPair(IBootstrapService, {} as IBootstrapService),
      stubPair(ISessionContext, {} as ISessionContext),
    ]);
    const manager = host.app.accessor.get(IFeatureManager);

    expect(session.accessor.get(ISessionInitService)).toBeDefined();

    await manager.unprovideUnit('sessionInit');
    await host.app.instantiation.cascade.whenIdle();
    expect(() => session.accessor.get(ISessionInitService)).toThrow();

    manager.provideUnit(SessionInitFeature);
    await host.app.instantiation.cascade.whenIdle();
    expect(session.accessor.get(ISessionInitService)).toBeDefined();

    host.dispose();
  });
});
