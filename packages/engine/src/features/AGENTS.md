# features — import-time capability seam

## Role and non-goals

`packages/engine/src/features` is the seam that adds optional capabilities to
the engine. It owns the `Feature` base class, the import-time registry, the
assembly service, and built-in feature implementations such as `btw`, `cron`,
`goal`, `plan`, `skill`, `swarm`, `todo`, `notify`, `reminder`, `fileHistory`,
`externalHooks`, `debugEvents`, `computerUse`, `sessionSearch`, `tower`,
`tokenCounting`, `usage`, and `reviewer`.

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
- `externalHooks` hook commands run through the child-sandbox seam
  (`#/os/sandbox/childSandbox`) with the trigger cwd as the workspace: `off`
  (default) is unchanged, `auto` falls back direct with `HookResult.sandboxNote`,
  `required` blocks the hook when no backend is available, and `shell: true`
  hooks always run unsandboxed with a note.
- Moving a core-required feature to `packages/Addons` requires inverting static
  imports and DI lookups; `packages/README.md` lists the known blockers.
- New core-required behavior goes in `features/`; new optional behavior that
  can be dropped without changing the engine goes in `packages/Addons`.
- Feature tests should drive the real feature assembly path, not only call the
  service directly.

## Do not add here

Do not add tool implementations, app bootstrap/session lifecycle code, MCP
transports, UI code, or a second discovery mechanism for feature modules.


## Skill tool capabilities

Skill frontmatter may declare `allowed-tools`/`disallowed-tools`; parser normalizes both and `skillAllowsTool` applies wildcard matching with deny-over-allow precedence. Activation-time enforcement remains a separate step.


## Local session search

`sessionSearch/localSessionSearch.ts` provides a host-agnostic local search implementation with term/literal modes, role/session filters, pagination, snippets, and candidate-cap degradation. Runtime composition remains separate.

## Bounded diff rendering

`sessionSearch/diffRender.ts` renders `/diff` output: unified format, hunks with 3 context lines, line-level LCS bounded by `lcsCellBudget` (falls back to whole-region replacement), and three caps (per-hunk lines, total lines, line chars) that each set `truncated`. Never render a diff without these caps — generated files are the normal case, not the exception.

## Skill enforcement

`skill/enforcement.ts` owns skill tool grants (`SkillToolEnforcer`): `visibleTools()` filters the offered tools, `enforceTool()` refuses anything outside `allowedTools`/`disallowedTools` (boundary, not a hint), `deactivate()` clears the grant, and `provenance()` + `labelSkillContent()` mark project/plugin (`project`, `extra`) content untrusted. A skill without metadata stays unrestricted. `AgentSkillService` arms it on activation, exposes `visibleToolNames()` for a narrowed tool list, deactivates on `TurnEnded`, and labels project/`extra` content before rendering. The request path narrows its tool list through a pushed grant (`IAgentLLMRequesterService.setSkillGrant`, not DI — DI would cycle through the loop), and `AgentSkillService` binds `IAgentToolExecutorService.setSkillGrant` through a lazy `IInstantiationService.invokeFunction` lookup — never a constructor dependency, which would break executor construction in tests without the skill feature. Both sites receive the same instance.

`skill/curator/` owns usage and lifecycle bookkeeping (usage tracker, lifecycle ledger, curated-set lockfiles, node store). `AgentSkillCuratorService` (agent scope, contributed by `SkillFeature`) composes it over `<homeDir>/skill-curator`, and `AgentSkillService.recordCuratorUsage` records one usage event per activation (`user-slash`, `model-tool`, or `nested-skill`). That write is best-effort: failures are dropped, because curation is bookkeeping and must never fail the activation it is recording, and an activation without a resolved source or path is skipped rather than recorded with invented provenance.

## Goal verification

`goal/verifier.ts` is the independent completion check: checks name required evidence ids, external checks reject `agent_claim`/model-observed records, run evidence needs an exit code and provenance, and stale evidence is refused. Verdicts are `verified | partial | rejected` — never upgrade partial. Wired through `goal/verificationGate.ts`: `goalService.markComplete` gates every model completion on runtime-observed evidence (`assertModelCompletionVerified`), refusing with `GOAL_NOT_VERIFIED` while the goal stays active; `OMNICODE_GOAL_VERIFIER=0` disables. Design write-up: `docs/en/architecture/goal-verification.md` and `docs/en/architecture/completion-gate.md`.
