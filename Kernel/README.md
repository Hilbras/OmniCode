# Kernel

Holds the packages that connect the rest of the repository to each other. Systems
reach these through `Kernel/API` rather than importing each other directly.

## Contents

| Package | Name | Role |
|---|---|---|
| `API` | `@hilbras/omnicode-api` | the single connection surface between kernel packages; re-exports the SDK |
| `SDK` | `@hilbras/omnicode-sdk` | the public TypeScript SDK and harness |
| `ACP` | `@hilbras/omnicode-acp` | the Agent Client Protocol host, so editors can drive Omnicode |
| `Addons` | `@hilbras/omnicode-addons` | optional agent behaviours that plug in through the Feature seam |
| `Tools` | `@hilbras/omnicode-tools` | the built-in agent tools — filesystem, shell, search, prompts |

## Current status

| | |
|---|---|
| pnpm workspace | yes — `pnpm-workspace.yaml` globs `Kernel/*` |
| Nix build | `flake.nix`'s `workspacePaths` and `workspaceNames` list every package here |
| vitest | the root `vitest.config.ts` project glob covers `Kernel/*/vitest.config.ts` |

## What Addons can and cannot hold

`Addons` currently carries `dateChange` and `sessionInit`. Most of the other
features cannot move, because `omnicode-core` still needs them. Three distinct
dependencies block the rest, and only the first is visible to a grep:

1. **Static imports** — 63 import statements across 36 core source files name
   feature modules directly (`modeMutexService` imports goal, plan and swarm;
   `sessionLifecycleService` imports plan, fileHistory and notify).
2. **DI registration** — core services resolve feature services through the
   container, so nothing imports them yet they must exist.
   `agentContextMemoryService` needs `sessionTokenCountingService`;
   `agentLLMRequesterService` needs `sessionUsageService`.
3. **Test harness** — `test/harness/agent.ts` drives `ISessionBtwService`, and
   `test/debug/debug.test.ts` exercises `DebugEventsService`.

Splitting those means inverting the dependency: move each feature's contracts
into a core-owned module, let the feature implement them, and point the arrow
the other way. That is a refactor of the engine's service graph, not a move.

`features/tower` also blocks the move on its own — it stays in core but imports
from `reminder`, so moving `reminder` out strands it.

## Wiring to remember

Adding a package under `Kernel/` needs four manual edits, all of which fail
silently when missed: the pnpm workspace globs, `flake.nix` (an explicit fileset,
not globs), the root `vitest.config.ts` project glob (an unmatched project root
stops its tests from running while the suite still reports green), and the
`--filter './Kernel/*'` arguments in the root `build:packages` and `typecheck`
scripts.

Features register through a module-level array populated by `registerFeature()`
at import time, so anything that moves out of core also needs an explicit
activation import at its composition root — the CLI does this in
`apps/omnicode/src/main.ts`.