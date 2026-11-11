# features — import-time capability seam

## Role and non-goals

`packages/engine/src/features` is the seam that adds optional capabilities to
the engine. It owns the `Feature` base class, the import-time registry, the
assembly service, and built-in feature implementations such as `btw`, `cron`,
`goal`, `plan`, `skill`, `swarm`, `todo`, `notify`, `reminder`, `fileHistory`,
`externalHooks`, `debugEvents`, `computerUse`, `sessionSearch`, `tower`,
`tokenCounting`, and `usage`.

Not here: app bootstrap, session lifecycle, tool implementations, MCP
transports, or host/UI behavior. Those belong to `app/`, `session/`,
`packages/Tools`, `mcpCore/`, and the app packages.

## Entry points and ownership

- `feature.ts` defines `Feature` and its contribution helpers.
- `featureRegistry.ts` is the module-level recipe array filled by
  `registerFeature()` at import time.
- `featureAssemblyService.ts` copies registered recipes into the app-scope
  `IFeatureManager` when the app scope is created.
- `featureAssembly.ts` is the service identifier.
- Each `<name>/` directory owns a `<name>Feature.ts` class plus its services,
  ops, config sections, state contributions, and tool contributions. Tool
  implementations stay in `packages/Tools`.
- Built-in feature modules are activated by imports from
  `packages/engine/src/index.ts` or another composition root. Nothing discovers
  directories at runtime.

## Registration rules

- A feature exists only if its module was imported. `registerFeature()` appends
  to a module-level array; `FeatureAssemblyService` reads it at app-scope
  creation. Silent non-registration is the normal failure mode.
- Contribute through `Feature` methods rather than raw registration where one
  exists: `contributeService`, `contributeAgentService`, `contributeTool`,
  `contributeCommand`, `contributeConfig`, `contributeProfiles`,
  `contributeSessionModel`, and `contributeAgentModel`.
- Feature names come from `static override readonly name`; they identify the
  managed unit and must stay stable.
- Feature contributions are materialized per scope. A feature that provides
  agent services contributes to `LifecycleScope.Agent`; session services to
  `LifecycleScope.Session`; app services to `LifecycleScope.App`.
- A feature tool is registered as an agent service with `OnDemand` activation
  and must also appear in the active profile allowlist in
  `packages/engine/src/session/agentLifecycle/profile/profiles.ts`.
- Commands register as `CommandContribution`; profiles as
  `AgentProfileContribution`; config as `ConfigSectionContribution`; models as
  `AgentModelContribution`/`SessionModelContribution`.

## Generated manifests

- `contributeConfig` or a feature config section changes
  `packages/engine/docs/config-manifest.toml`: run
  `pnpm --filter @hilbras/omnicode-engine gen:config-manifest`.
- Durable `Event2` classes in a feature change
  `packages/engine/docs/wire-manifest.d.ts`: run `gen:wire-manifest`.
- Feature state definitions change `packages/engine/docs/state-manifest.d.ts`:
  run `gen:state-manifest`.
- Contract-surface changes: `gen:contract-types`.
- Never hand-edit a generated manifest; a stale generator result is a failure.

## Import boundaries

- Features live inside the engine and follow the engine layering rule: import
  leaf packages only, never `Tools`, `Addons`, `memory`, `core`, `SDK`, `API`,
  `server`, or `ACP`.
- Features may use engine contracts from `agent/`, `session/`, `app/`, `state/`,
  `mcpCore/`, and `human/` vocabulary modules.
- `human/` is the pure kernel; do not import its implementation from a feature
  unless the adapter rule explicitly allows it.
- Tools stay in `packages/Tools`; feature directories hold the services and
  state the tools call.
- Run `pnpm --filter @hilbras/omnicode-engine lint:imports`.

## Tests

Feature seam tests live in `packages/engine/test/features/feature.test.ts`.
Feature-specific tests mirror directories under `packages/engine/test/features/`
(`btw/`, `cron/`, `goal/`, `plan/`, `skill/`, `swarm/`, `todo/`, `notify/`,
`reminder/`, `fileHistory/`, `externalHooks/`, `debugEvents/`, `computerUse/`,
`tower/`). Tests clear the registries with `_clearFeatureRecipesForTests`,
`_clearScopedRegistryForTests`, and the config/tool clears where needed.

```bash
pnpm --filter @hilbras/omnicode-engine typecheck
pnpm --filter @hilbras/omnicode-engine exec vitest run test/features
pnpm --filter @hilbras/omnicode-engine test
```

## Local traps and where new logic belongs

- A feature module that is not imported contributes nothing. Check the
  composition root before debugging the feature itself.
- Registering a tool in a feature does not admit it to a profile. Update the
  profile allowlist and, if safe, the default approval policy.
- Moving a core-required feature to `packages/Addons` requires inverting static
  imports and DI lookups; `packages/README.md` lists the known blockers.
- New core-required behavior goes in `features/`; new optional behavior that
  can be dropped without changing the engine goes in `packages/Addons`.
- Feature tests should drive the real feature assembly path, not only call the
  service directly.

## Do not add here

Do not add tool implementations, app bootstrap/session lifecycle code, MCP
transports, UI code, or a second discovery mechanism for feature modules.
