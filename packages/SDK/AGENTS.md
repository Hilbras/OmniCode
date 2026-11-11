# packages/SDK — Agent Guide

Read the root `AGENTS.md` first. This is the public library surface over the
engine, plus the harness the CLI and embedding hosts build on.

## 1. Role and non-goals

`@hilbras/omnicode-sdk` exposes `OmnicodeHarness`, `Session`, config/auth/log
helpers, model-provider utilities, and the v1-shaped `SDKRpcClientBase` used by
host adapters. `packages/API` re-exports this package and layers the `Klient`
transport contracts on top.

- It does not own engine behavior. Session/turn/tool logic stays in
  `packages/engine`.
- It does not serve REST/WS; `packages/server` does.
- It does not implement ACP; `packages/API` loads `packages/ACP` lazily.
- It must not import `@hilbras/omnicode-api`.

## 2. Public entry points and important modules

- `src/index.ts` — published barrel: `OmnicodeHarness`, `Session`,
  `SDKRpcClientBase`, auth/config/catalog/errors/logging/image/flag/media APIs.
- `src/omnicode-harness.ts` — session lifecycle: create, resume, reload, fork,
  delete, rename, list, export, plugins, capabilities, connectors.
- `src/session.ts` — per-session behavior: prompt/steer/cancel, approvals,
  questions, plan/swarm/tower, compaction, undo, memory, skills, tasks.
- `src/rpc.ts` — `SDKRpcClientBase`, the compatibility client surface; v2
  wiring lives in `src/v2/session-wiring.ts`.
- `src/v2/` — mapping/wiring between v1 wire shapes and v2 engine events:
  `event-mapper`, `session-mapper`, `config-mapper`, `resume-replay`,
  `import-context`, `global-mcp`.
- `src/config/` — config schema, TOML parsing, env/model resolution.
- `src/rpc-exports.ts` and `src/core-interop.ts`/`engine-interop.ts` — compatibility barrels for hosts, not a second public API.

Exports are `"."`, `"./core-interop"`, `"./engine-interop"`, and
`"./rpc-exports"`. The first is supported; the rest are compatibility plumbing.

## 3. Boundary rules

- SDK must not import API (enforced by `scripts/check-kernel-layering.mjs`);
  the reverse edge exists because API re-exports SDK.
- SDK may import `core`, `base`, and `engine` modules, but not `server`,
  `acp`, or app packages. Apps import `@hilbras/omnicode-sdk`, not engine
  internals; if an app needs more, add an SDK method rather than a deep import.
- `engine-interop` is not an invitation to mix `human/` and `llm-adapter/`
  internals; keep provider boundaries intact.

## 4. Contract and schema rules

- `src/index.ts` is the published API. Adding or removing an export changes the
  contract; `build:dts` rolls declarations through API Extractor
  (`api-extractor.json`, `scripts/build-dts.mjs`).
- Keep `rpc-exports.ts` intentional: it exists for host compatibility, not as a
  second public API. Config changes go through `src/config/schema.ts` and
  `resolve.ts`; do not accept unvalidated TOML.
- Event translation belongs in `src/v2/event-mapper.ts` and session wiring.
  Do not leak raw `DomainEvent` shapes into the v1 `Event` surface.
- There is no silent provider-wire fallback in the engine; SDK helpers must not
  invent one.

## 5. Tests

Tests live in `packages/SDK/test/` (`catalog`, `config`, `logging-formatter`,
`omnicode-model-provider`, `replay`, `rpc-event-listeners`, `session-*`,
`setup.ts`). The Vitest config aliases `@hilbras/omnicode-auth` to source and
sets `OMNICODE_LOG_LEVEL=off`; `test/setup.ts` imports the tools package.

`package.json` has no `test` script — run Vitest through the filter:

```bash
pnpm --filter @hilbras/omnicode-sdk typecheck
pnpm --filter @hilbras/omnicode-sdk exec vitest run
pnpm --filter @hilbras/omnicode-sdk exec vitest run test/catalog.test.ts
pnpm --filter @hilbras/omnicode-sdk build
```

Do not claim `... test` works. `build:dts` is also currently broken:
`@microsoft/api-extractor` is not installed.

## 6. Local traps and where new logic belongs

- New public SDK method: `src/index.ts` export → `rpc.ts` base method →
  `session.ts` or `omnicode-harness.ts` → `packages/API/src/requestHandler.ts`
  wiring for hosts. Add the v1/v2 mapper under `src/v2/` when shapes differ.
- New config field: `src/config/schema.ts` + `resolve.ts` + `rpc-exports.ts` if
  hosts need it; regenerate engine config manifests when the shape changes.
- New event mapping: `src/v2/event-mapper.ts` + `session-wiring.ts`; add a test
  that proves delivery order and payload shape.
- `#/` imports resolve through package `imports`; tests also rely on Vitest
  aliases. Adding a subpath requires both, plus a scripted-provider test.
- Tests use fake/scripted providers; do not introduce network calls or sleeps.

## 7. What must not be added here

- `@hilbras/omnicode-api` imports, REST/WS routes, or server lifecycle.
- ACP implementation code.
- Engine services, tools, permission policy, or storage backends.
- App/UI logic, CLI commands, or TUI components.
- New transport implementations; transports live in API.


## Sandbox surface

The SDK barrel re-exports `@hilbras/omnicode-kaos/sandbox` so host adapters can use backend selection, execution planning, shell policy, and status without importing Kaos internals.
