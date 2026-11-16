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
- `src/core/klient.ts` — `createKlientFromChannel`; `Klient`, `SessionHandle`,
  `AgentHandle` and the facade shapes are re-exported from
  `@hilbras/omnicode-client-contract`. Every transport produces the same facade.
- `src/core/facade/global.ts`, `session.ts`, `agent.ts` — facade implementations;
  the interfaces and value types live in `@hilbras/omnicode-client-contract`.
- `src/transports/memory/index.ts` — `createKlient({ scope })` over a live
  engine scope. `src/transports/memory/dispatcher.ts` does the DI dispatch;
  `serviceRegistry.ts` maps wire service names to DI tokens.
- `src/transports/ipc/index.ts` and `host.ts` — Unix-socket transport and host.
- `packages/client-contract/src/contract/` (in `@hilbras/omnicode-client-contract`)
  — zod wire contracts for global/session/agent services. They moved out of this
  package so the ACP host can consume them without importing API.
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

- Every facade method needs an entry in the contract tables under
  `packages/client-contract/src/contract/`; a missing entry throws
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

## 5a. The client wire contract artifact

`docs/wire-contract.json` is the whole client boundary in one diffable file:
every service method's input tuple schema plus its resolved output (or the
chunk schema for a streaming procedure), and every registered `global`,
`session`, and `agent` event with its registration kind and payload schema.

It is generated from the zod contract tables in
`packages/client-contract/src/contract/` — those tables are the source; the
artifact is never hand-edited:

```bash
pnpm --filter @hilbras/omnicode-api gen:wire-contract          # rewrite
pnpm --filter @hilbras/omnicode-api gen:wire-contract -- --check  # fail on drift
```

Alongside it, `gen:api-reference` renders the same contract tables as a
human-readable Markdown index at `packages/API/docs/wire-contract.md` — a table
per service (method, kind, shallow input and output summaries) plus the three
event scopes. It is deliberately shallow: the full JSON Schema stays in
`packages/API/docs/wire-contract.json`. Both artifacts are listed in
`scripts/check-generated-freshness.mjs`, so `pnpm check:generated` fails when
either drifts from the contract source. It lives in this package rather than
under `docs/` because `docs/AGENTS.md` keeps generated reference tables out of
the repo-level docs tree.

`test/wireContract.test.ts` asserts the artifact matches `renderWireContract()`,
and `pnpm check:generated` (inside `pnpm check:guards`) runs the `--check` mode,
so drift fails both the package suite and CI.

`test/wireContractConformance.test.ts` gates the shape the artifact depends on:
every registered event carries a payload schema, every `stream` registration
names its source stream (a missing `type` is deliberate — it means "forward the
whole stream"), and every procedure declares an input plus an output or chunk.
An event whose `type` is absent from the engine's emitted set cannot be checked
here: klient event names are a mapped namespace, `EVENT2_REGISTRY` holds only
transient `Event2` classes at runtime, and `docs/wire-manifest.d.ts` lists
durable records only. Closing that gap needs a producer-side mapping table,
which does not exist yet.

A `null` schema in the artifact means the entry has no JSON Schema
representation: 50 procedures resolve with no value (`z.void()` results), which
JSON Schema cannot express. Adding or removing a contract entry, changing an
event payload, or adding a schema field all show up as a named diff line
(`procedures.<service>`, `events.<scope>.<name>`).

Known gaps: `smoke*` scripts reference a missing `tsconfig.examples.json`, and
`docker:e2e` references `scripts/run-docker-e2e.sh`, which is absent. Do not
report those scripts as passing.

## 6. Local traps and where new logic belongs

- New wire method: contract fragment → `packages/client-contract/src/contract/index.ts`
  for a new service → facade method → `serviceRegistry.ts` token if new →
  conformance test. Keep the wire argument order mechanical.
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


## Hardened runtime primitives

`src/runtime-primitives.ts` exposes engine/LLM primitives that hosts need before they are composed into a running service: local session search, session leases, interaction/team persistence, context projection, trajectory scoring, pricing/cost budgets, provider descriptors, and fallback selection. These are API exports, not proof of runtime composition.


## Durable interactions

`createOmnicodeHarness` configures the global interaction facade with `FileInteractionPersistence` under `<home>/interactions.json` and loads pending records at startup. `configureInteractionPersistenceForHome` is exported for hosts. Stale-turn binding and interrupted-tool re-drive remain separate session-resume work.
