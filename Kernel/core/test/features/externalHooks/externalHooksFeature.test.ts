import { beforeEach, describe, expect, it } from 'vitest';

import { type CollectionToken, type CollectionView } from '#/_base/di/collection';
import { ScopeUnits } from '#/_base/di/fiber';
import { ScopeActivation } from '#/_base/di/instantiation';
import { type InstantiationService } from '#/_base/di/instantiationService';
import { _clearScopedRegistryForTests, registerScopedService, type Scope } from '#/_base/di/scope';
import { createScopedTestHost } from '#/_base/di/test';
import { Event } from '#/_base/event';
import { ILogService } from '#/_base/log/log';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IConfigService } from '#/app/config/config';
import { IFeatureManager } from '#/app/feature/featureManager';
import { FeatureManagerService } from '#/app/feature/featureManagerService';
import { IPluginService } from '#/app/plugin/plugin';
import { LifecycleScope } from '#/app/scopes';
import { ITelemetryService, noopTelemetryService } from '#/app/telemetry/telemetry';
import { IAgentExternalHooksService } from '#/features/externalHooks/agent/agentExternalHooks';
import { IExternalHooksRunnerService } from '#/features/externalHooks/app/externalHooksRunner';
import { ExternalHooksRunnerService } from '#/features/externalHooks/app/externalHooksRunnerService';
import { ISessionExternalHooksService } from '#/features/externalHooks/session/sessionExternalHooks';
import { IFeatureAssemblyService } from '#/features/featureAssembly';
import '#/features/externalHooks/externalHooksFeature';
import { FeatureAssemblyService } from '#/features/featureAssemblyService';
import { IHostProcessService } from '#/os/interface/hostProcess';

import { stubLog } from '../../_base/log/stubs';
import { stubBootstrap } from '../../app/bootstrap/stubs';

function collectionViewOf<T>(scope: Scope, token: CollectionToken<T>): CollectionView<T> {
  return (scope.instantiation as InstantiationService).fiberHost.collectionView(token);
}

describe('ExternalHooksFeature — assembly (src/features/externalHooks)', () => {
  beforeEach(() => {
    _clearScopedRegistryForTests();
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
  });

  it('assembles the feature and retracts all contributions on unprovide', async () => {
    const host = createScopedTestHost([
      [IBootstrapService, stubBootstrap()],
      [
        IConfigService,
        { _serviceBrand: undefined, ready: Promise.resolve(), get: () => undefined },
      ],
      [
        IPluginService,
        { _serviceBrand: undefined, enabledHooks: async () => [], onDidReload: Event.None },
      ],
      [IHostProcessService, { _serviceBrand: undefined }],
      [ILogService, stubLog()],
      [ITelemetryService, noopTelemetryService],
    ]);
    const manager = host.app.accessor.get(IFeatureManager);
    expect(manager.units().map((unit) => unit.name)).toContain('externalHooks');

    const runner = host.app.accessor.get(IExternalHooksRunnerService);
    expect(runner).toBeInstanceOf(ExternalHooksRunnerService);

    const sessionUnits = collectionViewOf(host.app, ScopeUnits(LifecycleScope.Session));
    expect(sessionUnits.items.map((item) => item.name)).toContain(
      `externalHooks:${String(ISessionExternalHooksService)}`,
    );
    const agentUnits = collectionViewOf(host.app, ScopeUnits(LifecycleScope.Agent));
    expect(agentUnits.items.map((item) => item.name)).toContain(
      `externalHooks:${String(IAgentExternalHooksService)}`,
    );

    await manager.unprovideUnit('externalHooks');
    await host.app.instantiation.cascade.whenIdle();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(manager.units().map((unit) => unit.name)).not.toContain('externalHooks');
    expect(() => host.app.accessor.get(IExternalHooksRunnerService)).toThrow();
    expect(sessionUnits.items.map((item) => item.name)).not.toContain(
      `externalHooks:${String(ISessionExternalHooksService)}`,
    );
    expect(agentUnits.items.map((item) => item.name)).not.toContain(
      `externalHooks:${String(IAgentExternalHooksService)}`,
    );

    host.dispose();
  });
});
