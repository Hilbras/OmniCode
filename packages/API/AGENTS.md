# packages/API — Agent Guide

Read the root `AGENTS.md` first. This package is the app-facing surface, not a
kernel package.

## 1. Role and non-goals

`@hilbras/omnicode-api` re-exports the public SDK (`@hilbras/omnicode-sdk`) plus
the side-effect packages that register tools, features, and memory, and it owns
the transport-agnostic request-handling layer used by host surfaces.

- It is a facade/transport package, not an engine.
- It does not own sessions, turns, tools, permissions, or persistence.
- It does not serve HTTP/WS. That is `packages/server`.
- It does not implement ACP. It loads `@hilbras/omnicode-acp` on demand.

The CLI currently imports `@hilbras/omnicode-api` directly. New apps should
prefer `@hilbras/omnicode-sdk`; either way, apps must not import engine
internals.

## 2. Public entry points and important modules

- `src/index.ts` — the main surface: `export *` from SDK, Addons, Tools, Memory,
  and Channels, plus `loadAcpServer()`. Importing it activates those packages'
  load-time registrations. SDK re-exports the Kaos sandbox surface.
- `src/core/klient.ts` — `createKlientFromChannel`, `Klient`, `SessionHandle`,
  `AgentHandle`. Every transport produces the same facade.
- `src/core/facade/global.ts`, `session.ts`, `agent.ts` — scoped facade shapes.
- `src/transports/memory/index.ts` — `createKlient({ scope })` over a live
  engine scope. `src/transports/memory/dispatcher.ts` does the DI dispatch;
  `serviceRegistry.ts` maps wire service names to DI tokens.
- `src/transports/ipc/index.ts` and `host.ts` — Unix-socket transport and host.
- `src/contract/` — zod wire contracts for global/session/agent services.
- `src/core/validation.ts` — input/output/chunk/event validation.
- `src/requestHandler.ts` — `createOmnicodeHarness` and `SDKRpcClientV2`, the
  v1-shaped request handler backed by the v2 engine.

Exports: `"."`, `"./ipc"`, `"./memory"`, and `"./*"` (to `src/*.ts`). Do not
add a public subpath without a consumer and a test.

## 3. Boundary rules

- `sdk` must never import `api`; API re-exports SDK, so that edge is a cycle.
- Only `api` may import `acp`. Keep the API → ACP edge dynamic through
  `loadAcpServer()`; an eager import boots the ACP engine on every CLI start.
- Nothing may import `server`. The devDependency on
  `@hilbras/omnicode-server` is for tests only — never import it from `src/`.
- Apps consume SDK/API, never `packages/engine/src/**` or `packages/core/src/**`.

Run `pnpm check:architecture` after touching imports.

## 4. Contract and schema rules

- Every facade method needs an entry in `src/contract/`; a missing entry throws
  `no contract registered for <service>.<method>`.
- Inputs are zod tuples over positional engine arguments; outputs are zod
  schemas of the resolved value (`maybe`/`noResult` normalize `null`/`undefined`).
- Transports never validate. Validation happens at the klient boundary so wire
  drift fails loudly. Event payloads are validated on delivery and reported.
- Changing a contract entry is an API change: adjust the conformance test and
  `test/contract-parity.ts`, and expect downstream SDK/CLI fallout.

## 5. Tests

Tests live in `packages/API/test/`, mirroring `src/`: `workstream-connectivity.test.ts` pins tool,
channel, memory, and sandbox exports through the public barrel; `facade`, `contract`,
`memory`/`ipc` transport conformance, `sdk-rpc-client-v2`, `session-*`, and
`test/e2e/` for harness-driven and legacy flows.

```bash
pnpm --filter @hilbras/omnicode-api typecheck
pnpm --filter @hilbras/omnicode-api test
pnpm --filter @hilbras/omnicode-api exec vitest run test/facade.test.ts
```

Known gaps: `smoke*` scripts reference a missing `tsconfig.examples.json`, and
`docker:e2e` references `scripts/run-docker-e2e.sh`, which is absent. Do not
report those scripts as passing.

## 6. Local traps and where new logic belongs

- New wire method: contract fragment → `src/contract/index.ts` for a new service
  → facade method → `serviceRegistry.ts` token if new → conformance test. Keep
  the wire argument order mechanical.
- New transport: implement `KlientChannel` under `src/transports/<name>/` and
  reuse `createKlientFromChannel`; add a host if another process serves it.
- New v1-compatible method: add it in `src/requestHandler.ts` and its mapper in
  `src/v2/`; do not leak v2-only shapes to v1 consumers.
- `createKlientFromChannel` validates by default; disabling it is a
  measured-hot-path decision, not a convenience.
- ACP session-not-found is `40404` on the klient wire; engine `Error2` codes are
  a different layer.

## 7. What must not be added here

- Engine services, tools, features, permission policy, or storage.
- REST/WS routes, auth middleware, or server lifecycle.
- ACP implementation code; only the lazy loader belongs here.
- Imports of `@hilbras/omnicode-server`.
- New app UI or CLI/TUI behavior.
