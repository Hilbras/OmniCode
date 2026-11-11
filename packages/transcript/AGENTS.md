# packages/transcript — Agent Guide

Read the root `AGENTS.md` first. `transcript` is a leaf package and a
comment-free zone.

## Role and non-goals

Isomorphic transcript data layer for rendering: model types, idempotent
operations and snapshots, per-agent/session stores, granularity filtering,
pagination, history folding, and a framework-free view registry.

Non-goals: no React/TUI components, no transport, no durable persistence, and
no engine session lifecycle. It projects data; it does not own the agent.

## Entry points and modules

Root `@hilbras/omnicode-transcript` (`src/index.ts`) exports all public modules.
There are no subpath exports and no separate test helpers.

- `src/model/`: ids, turns/steps, frames, interactions, attachments, todos,
  items/markers, tasks, meta, prompts.
- `src/ops/operation.ts`: the `TranscriptOperation` union, snapshots, batches,
  append targets.
- `src/ops/apply.ts`: pure `applyOperation`, `appendAtOffset`,
  `EMPTY_AGENT_STATE`.
- `src/store/agentTranscript.ts`: `AgentTranscript` applies ops, tracks pending
  interactions, emits change events, produces windowed snapshots.
- `src/store/transcriptStore.ts`: multi-agent roster per session.
- `src/granularity/`: `off | turn | block | delta`, op filtering, grade
  transitions.
- `src/pagination/paginate.ts`: turn-window pagination.
- `src/history/`: rebuild turns from history messages and fold wire facts.
- `src/view/registry.ts`: tool/input/marker renderer lookup with fallback.
- `src/contract/`: zod schemas, events, origin/media projection.

## Layering rules

- Leaf law: no `@hilbras/omnicode-*` imports.
- Runtime dependency is `zod` only.
- Keep the package framework-free and environment-free. No DOM, Node builtins,
  React, or TUI imports.

## Local constraints

- `scripts/check-no-comments.mjs` scans `src`, `test`, and `scripts` here and
  bans comments, JSDoc, and lint suppressions. Put rationale in this guide or
  `docs/`, never in source comments.
- Operations are idempotent. Upserts auto-vivify missing parents so any order
  converges; duplicate causal-order ops must not change the result.
- `append` is offset-addressed. A gap is reported and not applied; never rewrite
  or truncate existing text to force an append. Preserve `appendAtOffset`
  overlap semantics.
- Granularity upgrades need a reset; downgrades do not. `detachGrades` writes an
  explicit `off` so a wildcard default cannot resurrect a detached agent.
- History projection strips server-local paths and model-triggered skill
  activations. Tests assert `/private/` never appears in rebuilt payloads.
- Treat `contract/schema.ts` and `contract/events.ts` as wire contracts. Shape
  changes affect clients and replay.
- Stores expose readonly snapshots/maps; copy before mutating. The `#` private
  field style is local convention.

## Tests

Test root: `packages/transcript/test/`; Vitest project name: `transcript`.
There are two files: `layers.test.ts` (model/ops/granularity/pagination/view/
contract/history) and `store.test.ts` (agent/session store behavior).

```bash
pnpm --filter @hilbras/omnicode-transcript test
pnpm --filter @hilbras/omnicode-transcript exec vitest run test/store.test.ts
pnpm --filter @hilbras/omnicode-transcript typecheck
```

There are no UI or network tests here. UI renderers are tested in the app
packages that own them.

## Local traps
- Description names L1–L4; source paths are `model`, `ops`, `store`,
  `granularity`, `pagination`, `history`, `view`, and `contract`.
- `index.ts` re-exports every module; new exports are public API and can collide.
- Contract events are transcript projections, not engine `Event2`.
- `hasMoreOlder` is state, not a request hint. No comments: the guard fails.

## Belongs here vs neighbours

- Session/agent lifecycle and durable `Event2` state: `engine`.
- Persistence: `minidb` or the owning engine store.
- React/TUI rendering: `packages/app-*` or the CLI TUI.
- Wire transport: `API`/`rpc`.
