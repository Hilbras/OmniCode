# packages/ACP — Agent Guide

Read the root `AGENTS.md` first. This package is the Agent Client Protocol host:
an editor-facing surface, not a general-purpose server.

## 1. Role and non-goals

`@hilbras/omnicode-acp` turns the klient facade into an ACP agent over stdio
(or a supplied stream). It handles `initialize`, session lifecycle, prompts,
cancel, config options, slash commands, approvals, questions, and replay.

- It is an adapter, not an engine; it drives the engine through `@hilbras/omnicode-api`.
- It is not a REST/WS server; `packages/server` owns that.
- It is not imported by apps. Only `packages/API` may import ACP; it exposes
  `loadAcpServer()`. ACP does not own auth token storage.

## 2. Public entry points and important modules

- `src/index.ts` — `AcpServer`, `createAcpAgentApp`, `runAcpServer`,
  `runAcpServerWithStream`, `AcpSession`, conversion/event helpers, modes,
  slash parsing, approval/question bridges.
- `src/start.ts` — composition root: `bootstrap()` → `createKlient()` → bind
  `IAcpConnection` → `AcpServer`; owns shutdown drains.
- `src/server.ts` — ACP method handlers and capability negotiation; routes calls
  to `klient.global.sessions` and `klient.session(id).agent('main')`.
- `src/session.ts` — prompt flow and event-stream → `session/update` translation.
- `src/events-map.ts` — tool/thinking/assistant deltas, tool-call lifecycle,
  plan/todo updates, stop reasons.
- `src/convert.ts` — ACP content ↔ `ContentPart`, MCP servers, tool results,
  image compression. `approval.ts`/`question.ts`/`interaction-bridge.ts` bridge
  permission and elicitation flows.
- `src/acp-fs/`, `src/acp-terminal/` — client filesystem and terminal reverse-RPC.
- `src/slash.ts`, `src/builtin-commands.ts`, `src/config-options.ts`,
  `src/model-catalog.ts`, `src/modes.ts`, `src/replay.ts`.

## 3. Boundary rules

- Only `packages/API` may import ACP (`scripts/check-kernel-layering.mjs`).
  ACP importing API is expected and allowed.
- Do not import `server`, `apps/*`, or UI packages.
- Keep engine access behind `Klient`; if a facade method is missing, add it in
  API/SDK rather than importing an engine service into ACP.
- Stdout is the ACP JSON-RPC channel. `start.ts` redirects `console.*` to
  stderr; new logging must use `src/log.ts` and never write stdout.
- The connection can reverse-RPC into the editor. Do not assume a local terminal
  or filesystem when the client advertises capabilities.

## 4. Contract and schema rules

- ACP wire shapes come from `@agentclientprotocol/sdk`; keep SDK-specific type
  names in `src/types.ts` and the conversion modules.
- Protocol version negotiation lives in `src/version.ts`; capability
  advertisement belongs in `server.ts`.
- Translate internal events to ACP updates in `events-map.ts`/`session.ts`; do
  not leak engine event names or `DomainEvent` payloads to the editor.
- Slash commands are a contract: parsed names, aliases, and builtin handling
  live in `slash.ts`/`builtin-commands.ts`.
- `KLIENT-GAP` markers in `session.ts` document missing facade capabilities
  (`/mcp`, `/compact`, turn-result settlement). Remove one only when the facade
  gains the capability; do not fake live data.

## 5. Tests

Tests live in `packages/ACP/test/`, with helpers under `_helpers/`
(`acpClient`, `scriptedProvider`, `fakeModelConfig`, `png`). The Vitest config
includes `test/**/*.{test,e2e}.ts`, applies the raw-text plugin, and resolves
`#/` imports per owning package.

```bash
pnpm --filter @hilbras/omnicode-acp typecheck
pnpm --filter @hilbras/omnicode-acp test
pnpm --filter @hilbras/omnicode-acp exec vitest run test/approval.test.ts
```

`e2e-turn.test.ts` drives a full turn through a scripted provider; prefer it
over real network calls. Do not add sleeps; wait for the protocol message.

## 6. Local traps and where new logic belongs

- New ACP method: extend `AcpServer` in `server.ts` → expose through
  `createAcpAgentApp` → add the session/agent helper → add a protocol test.
- New content/tool rendering: `convert.ts` and `events-map.ts`; test both text
  and image/tool-result paths.
- New slash command: `builtin-commands.ts` plus `slash.ts` parsing; keep the
  editor-facing command list in sync.
- New config option: `config-options.ts`, `model-catalog.ts`, and `modes.ts`;
  verify `setSessionConfigOption` round-trips.
- Auth is gated before session creation unless `disableAuth` is set (tests/dev
  only). Do not disable it in production paths.
- Session close must dispose klient subscriptions before `core.dispose()` and
  drain the append log, mirror, query store, and log closes in the existing
  order; changing the order causes teardown races.

## 7. What must not be added here

- REST/WS routes or a new network server.
- Imports from `@hilbras/omnicode-server` or `apps/*`.
- Engine services, tools, provider wires, or persistence.
- Editor-specific UI, login UI, or filesystem assumptions.
- Writes to stdout or a second logging path.
