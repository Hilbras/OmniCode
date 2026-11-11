# human — pure LLM and agent kernel

## Role and non-goals

`packages/engine/src/human` is the pure kernel: message/model types, the four
LLM protocol bases and requester, provider definitions and catalog, xstate
agent/session/tool/interaction machines, event stores and slices, persistence,
credentials, media, models-dev import, todo, and tool protocols.

It does not know the DI container's v2 services, app config, session lifecycle,
feature registry, MCP transports, or host surfaces. `llm-adapter/` is the
compatibility boundary; `human/` must not import it.

## Entry points and ownership

- `human/index.ts` is the package surface for kernel types and machines.
- `llm/` owns a single request: `message`, `model`, `capability`, `thinking`,
  `usage`, `response-format`, `errors`, `requester/`, and `protocol/`.
- `llm/protocol/` owns shared protocol contracts, connection, format, stream,
  thinking, and the pattern rewriter. `llm/requester/bases/` owns OpenAI,
  OpenAI Responses, Anthropic, and Google GenAI.
- `llm/provider/` and `provider-catalog.ts` own provider definitions and the
  provider→models cache; `llm-omnicode/` is the Omnicode auth/quota trait.
- `agent/`, `session/`, and `tool/` own the xstate machines, slices, turn logic,
  and event stores. `interaction/` owns approval/question machines.
- `credentials/` owns credential providers and redaction; `store/`, `persist/`,
  and `eventStore/` own branch/tree persistence and replay.
- `media/`, `todo/`, `models-dev/`, and `xstate2.ts` own their named concerns.
- `test/` inside `human/` contains kernel tests and the cassette harness.

## Boundary and adapter rules

- `human/` may import `@hilbras/omnicode-base` helpers and `@hilbras/omnicode-auth`
  types only. It must never import v2 engine domains (`app`, `agent`, `session`,
  `features`, `state`, `wire`, `persistence`, `os`, `mcpCore`, `llm-adapter`).
- Only `llm-adapter/`, `agent/loop/machine`, and `session/agentLifecycle` may
  import `human/` implementation modules. Other v2 code uses the vocabulary
  modules listed in `packages/engine/scripts/check-import-boundaries.mjs`.
- Format and trait never import each other. Protocol `format`/`lower`/`patterns`
  are internal to the requester pipeline; only bases and tests may import them.
- No silent fallback between protocols, beta variants, or providers. Missing
  capability is an explicit error.
- Run `pnpm --filter @hilbras/omnicode-engine lint:imports`; it scans both `src`
  and `test`.

## Registration and state rules

- This is not a DI service directory. Do not add scoped services, features,
  profiles, or config sections here; put those in `app/`, `agent/`, `session/`,
  or `features/`.
- Human event-store events are not engine `Event2` events. Do not wire them into
  `registerEvent2Class` or `wire.jsonl`; the v2 event dispatcher is outside this
  kernel.
- The requester is stateless; the turn machine owns retries, recovery,
  accumulation, and abort. Keep retry/recovery policy in the human turn rather
  than adding an engine-side loop.
- Add provider customization through typed per-protocol traits, not a shared
  cross-protocol trait bag.

## Generated manifests

`human/` owns no engine manifest. Changes here do not require
`gen:state-manifest` or `gen:wire-manifest` unless the change also alters a v2
event, state, or config section. `gen:contract-types` may change if the exported
contract surface changes. Never hand-edit generated files under
`packages/engine/docs/`.

## Tests

Human kernel tests live in `packages/engine/src/human/test/` and are explicitly
included by `packages/engine/vitest.config.ts` despite being excluded from the
engine `tsconfig.json`. Additional protocol tests live in
`packages/engine/test/human/llm/protocol/`; adapter tests live in
`packages/engine/test/llm-adapter/`. Read the local guides
`packages/engine/src/human/llm/AGENTS.md` and
`packages/engine/src/human/test/llm/AGENTS.md` before changing provider tests.

```bash
pnpm --filter @hilbras/omnicode-engine typecheck
pnpm --filter @hilbras/omnicode-engine exec vitest run src/human/test
pnpm --filter @hilbras/omnicode-engine exec vitest run test/human test/llm-adapter
```

Provider tests use recorded cassettes and patch `globalThis.fetch`. Recording is
opt-in: `OMNICODE_CASSETTE_RECORD=1 pnpm --filter @hilbras/omnicode-engine test`.
The engine setup keeps only the cassette env key and clears the rest.

## Local traps and where new logic belongs

- New provider wire: `human/llm/` plus a matching adapter boundary; do not add a
  second protocol abstraction.
- New request feature: contract + trait + requester, with format stages kept
  internal to the pipeline.
- New durable v2 state and config belong outside `human/`.
- Cassettes match by method and URL, not body; assert `cassette.calls` when the
  outgoing body matters.
- Old docs may use outdated directory names; current path is
  `packages/engine/src/human/`.
- Keep `human/index.ts` exports intentional; every new export widens the kernel
  contract.

## Do not add here

Do not add DI services, app config, feature/profile registration, MCP
transports, tool implementations, UI code, v2 event classes, or imports from
`llm-adapter/` or other v2 domains.
