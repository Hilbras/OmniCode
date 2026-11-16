# Addons — optional composition add-ons

## Role and non-goals

`@hilbras/omnicode-addons` holds optional agent behaviors that plug into the
engine through the Feature seam. It currently contains:

- `dateChange` — injects a date-change reminder when the local date rolls over.
- `sessionInit` — implements the engine's session-init contract by spawning a
  `coder` subagent to generate or refresh `AGENTS.md`.

Not here: core-required features (`packages/engine/src/features`), tool
implementations (`packages/Tools`), engine services, MCP transports, or host/UI
behavior.

## Entry points and ownership

- `src/index.ts` is the package surface and activation point. It exports addon
  contracts/services and side-effect-imports each `<name>Feature.ts`.
- `src/features/dateChange/` owns the date-change service, disclosure baseline,
  actor injection, and feature class.
- `src/features/sessionInit/` owns the init service, init profile prompt, and
  feature class. `sessionInit.ts` re-exports the engine contract
  `ISessionInitService` from `session/sessionInit/sessionInitContract`.
- Addons are activated when the package is imported. Today the public
  `packages/API/src/index.ts` re-exports Addons, and the cross-package test
  suite `packages/features-integration/test/setup.ts` imports it; a new surface
  must import it too or the addon is inert.

## Registration rules

- Each addon feature extends `Feature` from
  `@hilbras/omnicode-engine/features/feature` and calls `registerFeature()` from
  `features/featureRegistry` at module scope.
- Contribute services through `Feature` helpers, not by calling engine
  registration functions directly. `DateChangeFeature` uses
  `contributeAgentService`; `SessionInitFeature` uses
  `contributeService(LifecycleScope.Session, ...)`.
- A feature is active only if its module is imported. There is no directory scan
  and no automatic discovery.
- `sessionInit` is an implementation of an engine-owned contract. The engine
  defines the interface and composes the feature; Addons supplies the service.
- Addons must not register profiles, tools, or permission policy unless the
  engine explicitly owns that collaboration point. Tool implementations belong
  in `packages/Tools`; profile allowlists belong in
  `packages/engine/src/session/agentLifecycle/profile/profiles.ts`.

## Import boundaries

- Addons sit above the engine. Import engine contracts through public subpaths
  such as `@hilbras/omnicode-engine/features/feature` and
  `@hilbras/omnicode-engine/session/sessionInit/sessionInitContract`; import base
  utilities from `@hilbras/omnicode-base`.
- The engine must never import `packages/Addons` from `src/` or `test/`. The
  cross-package suite in `packages/features-integration` owns the test edge.
- Addons must not import `human/` implementation, `llm-adapter/` internals,
  `packages/Tools`, `packages/memory`, or app packages.
- Addons are not part of the kernel layering graph; do not rely on cycle
  detection to catch an inverted import. Keep the arrow one-way.

## Generated manifests

`packages/Addons` owns no generated manifest and defines no engine `Event2`,
config section, or state contribution. Do not add those here: the engine
generators scan engine `src`, so an addon-owned config/event/state definition
would be invisible to `gen:config-manifest`, `gen:wire-manifest`, and
`gen:state-manifest`. Put such definitions in the engine and expose a contract
for the addon. Never hand-edit generated files under `packages/engine/docs/`.

## Tests

Addons tests live under `packages/Addons/test/features/`:

- `dateChange/dateChangeInjection.test.ts` drives the real engine harness and
  checks date-change injection and disclosure behavior.
- `sessionInit/sessionInit.test.ts` covers the init service.
- `sessionInit/sessionInitFeature.test.ts` covers feature assembly and service
  withdrawal/restoration.

```bash
pnpm --filter @hilbras/omnicode-addons typecheck
pnpm --filter @hilbras/omnicode-addons test
pnpm --filter @hilbras/omnicode-addons exec vitest run test/features
```

The package Vitest config uses `passWithNoTests`; an unmatched test root is not
a failure.

## Local traps and where new logic belongs

- If an addon seems absent, check that `src/index.ts` imports its feature module
  and that the consuming surface imports Addons.
- `sessionInit` can run a subagent; preserve cancellation, permission-mode
  propagation, and reminder seeding when changing it.
- Date-change behavior depends on the disclosure baseline and cwd ownership;
  changing the reminder text is a behavior change.
- Add optional behavior here only when it can be dropped without changing the
  engine. If a core feature or app service needs it, put the seam in the engine.
- New addon: `src/features/<name>/` with a self-registering feature class and a
  test under `test/features/<name>/`.

## Do not add here

Do not add engine services, tool implementations, profile allowlists, permission
policy, MCP transports, UI code, generated manifests, or a second composition
root.
