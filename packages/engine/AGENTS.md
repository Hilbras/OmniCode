# engine — agent runtime kernel

## Role and non-goals

`@hilbras/omnicode-engine` is the agent runtime: agent loop, context memory,
permissions, sessions, MCP orchestration, feature seam, LLM compatibility
adapter, and the pure `human/` kernel.

Not this package: `packages/core` is the re-export facade over `base` + `engine`,
not the DI engine; tools live in `packages/Tools`; add-ons in `packages/Addons`;
memory in `packages/memory`; host/UI surfaces in `apps/*`, `packages/API`, and
`packages/SDK`.

## Entry points and ownership

`packages/engine/src/index.ts` is the package entry and composition root; it
exports contracts and imports services/features for registration side effects.
Ownership: `agent/` loop/tools/permissions/media/teams; `session/` lifecycle/profile/
state/subagent/MCP overlay; `app/` app-scope services; `features/` feature seam;
`human/` pure LLM/agent kernel; `llm-adapter/` compatibility boundary; `mcpCore/`
transports/config/OAuth; `workspace/` workspace/session lifecycle; `state/` state
contributions; `wire/` durable log/replay. Local guides cover `agent/`,
`features/`, `session/`, `app/`, `human/`, and `mcpCore/`.

## Registration rules

- A feature is active only when its module is imported. `registerFeature()`
  appends to the array in `packages/engine/src/features/featureRegistry.ts`;
  `FeatureAssemblyService` copies those recipes into the app feature manager.
- Feature contributions are services, tools, commands, config sections,
  agent/session models, and profiles. See `packages/engine/src/features/AGENTS.md`.
- Config sections, agent profiles, and models register through
  `packages/engine/src/app/config/configSectionContributions.ts`,
  `packages/engine/src/app/agentProfileCatalog/contribution.ts`, and
  `packages/engine/src/state/agentModel.ts`.
- Built-in tools are registered by side-effect imports from `packages/Tools`;
  the profile allowlist in
  `packages/engine/src/session/agentLifecycle/profile/profiles.ts` decides
  whether the model sees the tool. Approval is a separate policy.
- Durable state uses `Event2`/`AgentEvent2`; durable events declare `type`,
  `durable`, and a zod schema. Replayed state comes from `wire.jsonl`.

## Import boundaries

- The kernel-layering guard allows `engine` to import leaf packages only:
  `base`, `auth`, `minidb`, `tree-sitter-bash`, and the other declared leaves.
- Engine source must not import `Tools`, `Addons`, `memory`, `core`, `SDK`,
  `API`, `server`, or `ACP`. They are dev-only test dependencies where present.
- `human/` is the pure kernel. Outside the sanctioned adapters
  (`agent/loop/machine`, `session/agentLifecycle`, `llm-adapter`), use only the
  human vocabulary modules exported through `#human/...` contracts.
- `human/` must never import `llm-adapter` or v2 domains; format/trait modules
  must not import each other. Run `pnpm --filter @hilbras/omnicode-engine
  lint:imports` and `pnpm check:architecture`.

## Generated manifests

Generated files live in `packages/engine/docs/` and are never hand-edited:
`config-manifest.toml` (config sections and environment overlays),
`wire-manifest.d.ts` (durable/observable wire events), and
`state-manifest.d.ts` (app/workspace/session/agent state snapshots).
Regenerate after changing a config schema, an `Event2` shape, a wire event, or
a state definition:

```bash
pnpm --filter @hilbras/omnicode-engine gen:config-manifest
pnpm --filter @hilbras/omnicode-engine gen:wire-manifest
pnpm --filter @hilbras/omnicode-engine gen:state-manifest
pnpm --filter @hilbras/omnicode-engine gen:contract-types
```

A generator that reports stale output is a failure. Do not commit generated
outputs unless the owning script and guard expect them.

## Tests

Tests mirror source under `packages/engine/test/`: `test/agent/`, `test/app/`,
`test/features/`, `test/session/`, `test/mcpCore/`, `test/llm-adapter/`,
`test/wire/`, `test/state/`, and `test/workspace/`. Pure-kernel tests are
`test/human/llm/protocol/` and `src/human/test/`.

`packages/engine/test/setup.ts` clears `OMNICODE_*` env vars except the cassette
key and imports `@hilbras/omnicode-addons` + `@hilbras/omnicode-tools`.

```bash
pnpm --filter @hilbras/omnicode-engine typecheck
pnpm --filter @hilbras/omnicode-engine test
pnpm --filter @hilbras/omnicode-engine exec vitest run test/agent/loop
```

## Local traps and where new logic belongs

- Silent non-registration is the common bug. A registered tool absent from the
  profile allowlist is invisible to the model.
- Do not move `human/` implementation imports into ordinary v2 code; route them
  through the adapter layers.
- New built-in tool: `packages/Tools/src/`, then profile and approval policy.
  New optional behavior: `packages/engine/src/features/` or `packages/Addons`.
- New app service: `packages/engine/src/app/`. New state:
  `packages/engine/src/agent/` with durable `Event2` plus manifest regeneration.
- New provider wire: `packages/engine/src/human/llm/` plus the adapter boundary.

## Do not add here

Do not add tool implementations, add-on features, memory-package behavior, UI
or host-specific code, a second DI facade, direct provider SDK calls outside
`human/llm`, or handwritten edits to generated manifests.


## Permission policy

Auto mode now uses `AutoModeClassifierPermissionPolicyService` (`auto-mode-classifier`) instead of blanket auto-approval. Denial tracking state resets on mode change. Dangerous-command and ask-user-question-deny policies remain ahead of the classifier.
