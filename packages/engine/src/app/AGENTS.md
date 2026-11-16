# app — app-scope services

## Role and non-goals

`packages/engine/src/app` holds services that live at `LifecycleScope.App`:
bootstrap, config, file/edit, events and `Event2`, feature management, flags,
sessions/index/export, workspace, telemetry, Telegram, git/GitHub, MCP
config/management/registry, plugins, tasks, web/capability, and app state.

Not here: the agent loop, tool execution, permissions (`agent/`), agent
lifecycle (`session/`), MCP transports (`mcpCore/`), or tool implementations
(`packages/Tools`).

## Entry points and ownership

- `bootstrap/` owns paths and startup state used by the rest of the app.
- `config/` owns config loading, writeback, environment overlays, and section
  contributions. `configSectionContributions.ts` is the registration seam.
- `event/event2.ts` owns `Event2`, the durable event registry, and serialization;
  `event/eventBus.ts`/`eventService.ts` own event dispatch.
- `feature/` owns the feature manager that receives recipes from
  `features/featureAssemblyService.ts`.
- `sessionManager/`, `sessionIndex/`, `sessionExport/`, and `sessionLegacy/`
  own app-scope session records, not session-scope runtime.
- `workspace/`, `workspaceAliases/`, and `workspaceSessions/` own workspace
  lookup and persistence; workspace runtime lives in `workspace/`.
- `mcpConfig/`, `mcpManagement/`, and `mcpRegistry/` own persisted MCP config,
  management views, and the app registry; `mcpCore/` owns protocol/transports.
- `telemetry/`, `telegram/`, `git/`, `github/`, `plugin/`, `task/`, `web/`,
  `capability/`, `auth/`, `flag/`, `file/`, and `edit/` own their named services.
- `state/appState.ts` and `state/appStateService.ts` own the app state snapshot.

## Registration and event rules

- App services use `registerScopedService(LifecycleScope.App, ...)`. Do not put
  session-scoped or agent-scoped services here.
- Config sections use `registerConfigSection`; overlays use
  `registerConfigOverlay`. A config change must preserve writeback precedence
  (`default -> config.toml -> env -> memory`).
- Durable `Event2` classes declare `static type`, `static durable`, and a zod
  schema. `registerEvent2Class` rejects duplicate types and missing schemas.
- Observable/agent events keep their `agentDomain` and `agentId` shape; replay
  validation depends on the schema.
- The feature manager receives feature recipes from the import-time registry;
  app code must not scan feature directories or instantiate features directly.
- Bootstrap and config are initialized before services that read paths; do not
  resolve home/data paths independently in a new service.

## Generated manifests

- Config section/overlay changes:
  `pnpm --filter @hilbras/omnicode-engine gen:config-manifest`.
- Durable or observable wire event changes:
  `pnpm --filter @hilbras/omnicode-engine gen:wire-manifest`.
- App state contribution/snapshot changes:
  `pnpm --filter @hilbras/omnicode-engine gen:state-manifest`.
- Contract-surface changes: `gen:contract-types`.

Outputs are `packages/engine/docs/config-manifest.toml`,
`wire-manifest.d.ts`, and `state-manifest.d.ts`. Never hand-edit them; stale
generator output is a failure.

## Import boundaries

- Engine rules apply: import leaf packages only (`base`, `auth`, `minidb`,
  `tree-sitter-bash`); never import `Tools`, `Addons`, `memory`, `core`, `SDK`,
  `API`, `server`, or `ACP`.
- App code may use engine contracts from `agent/`, `session/`, `state/`,
  `workspace/`, `wire/`, and `mcpCore/`, but must not absorb their
  responsibilities.
- `human/` is the pure kernel; use only vocabulary contracts here, not its
  implementation modules.
- Run `pnpm --filter @hilbras/omnicode-engine lint:imports`.

## Tests

Tests mirror source under `packages/engine/test/app/`: `bootstrap/`, `config/`,
`event/`, `feature/`, `file/`, `flag/`, `sessionManager/`, `sessionIndex/`,
`sessionExport/`, `workspace/`, `mcpConfig/`, `mcpManagement/`, `mcpRegistry/`,
`plugin/`, `telegram/`, `telemetry/`, `git/`, `github/`, `web/`, `capability/`,
`auth/`, `provider/`, and the remaining sibling directories. Stubs live beside
the tests.

`test/app/agentProfileCatalog/systemPromptGolden.test.ts` pins the rendered
system prompt of the built-in `agent` and `coder` profiles against
`test/app/agentProfileCatalog/goldens/`, driving the real profile definitions so
a change to `system.md` prose, the role slot, or a context section fails the
test instead of shipping a drifted prompt. Regenerate a golden only for an
intentional prompt change, and read that diff before adopting it.

```bash
pnpm --filter @hilbras/omnicode-engine typecheck
pnpm --filter @hilbras/omnicode-engine exec vitest run test/app
pnpm --filter @hilbras/omnicode-engine test
```

## Local traps and where new logic belongs

- Config manifest generation scans engine `src` for section owners. A section
  registered from another package (for example `packages/Tools`) does not get a
  manifest row; do not assume it does.
- Config writeback must not rewrite unrelated TOML or reorder comments.
  `tomlWriteback` and `configManifest` tests are the contract.
- Duplicate `Event2.type` registration fails at import time; check the registry
  before adding an event.
- App home resolution can differ between runs; verify the resolved home when
  debugging persistence.
- New app-scope service: `app/<name>/`. New session registry/index behavior:
  `app/sessionManager` or `app/sessionIndex`. New MCP config UI/persistence:
  `app/mcpConfig`/`app/mcpManagement`; transports stay in `mcpCore/`.

## Do not add here

Do not add agent loop/state, tool execution, permission policy, session runtime,
MCP transports, tool implementations, UI components, or hand-edited generated
manifests.


## Plugin and hook trust

Hooks default to argv mode with `shell: false`, reject shell metacharacters outside quotes, and receive only a platform-safe env allowlist unless `inheritEnv` is explicitly enabled. Hook parse/spawn failures fail closed. New plugin installs default to disabled; `defaultEnabledOnInstall` exists only for explicit test/composition fixtures. Remote plugin sources must use https except loopback development.


## Session ownership lease

`sessionManager/sessionLease.ts` provides atomic lease files, owner/pid/boot identity, TTL, heartbeat, release, and stale-owner reclaim. It is not yet wired into `SessionManager`; host composition must choose the session directory and expose read-only/takeover behavior.
