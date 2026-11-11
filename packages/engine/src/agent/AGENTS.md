# agent — agent-scope runtime

## Role and non-goals

`packages/engine/src/agent` holds the per-agent runtime: the state-machine loop,
context memory and compaction, tool registry/executor/policy, permissions,
prompts, profiles, media, agent-side MCP tools, tasks, undo, and agent state.

Not here: session lifecycle and profiles (`session/`), app bootstrap/config
(`app/`), MCP transports (`mcpCore/`), the pure LLM kernel (`human/`), or tool
implementations (`packages/Tools`).

## Entry points and ownership

- `loop/loopService.ts` drives turns; `loop/machine/` adapts the `human/` agent
  and tool machines and is the only agent path allowed to import their
  implementation modules.
- `contextMemory/` owns conversation history, tool exchanges, hooks, and
  compaction handoff; `fullCompaction/` and `contextProjector/` are separate
  services around it.
- `toolRegistry/` owns tool registration and the built-in assembly service;
  `toolExecutor/`, `toolPolicy/`, `toolApproval/`, `toolActivation/`,
  `toolDedupe/`, `toolSelect/`, and `toolResultTruncation/` own execution.
- `permissionPolicy/`, `permissionGate/`, `permissionMode/`, and
  `permissionRules/` own approval modes and rule matching.
- `profile/`, `prompt/`, `command/`, `runtimeBinding/`, `scopeContext/`, and
  `state/` own agent identity, prompts, commands, runtime leases, and state.
- `mcp/` turns MCP servers into agent tools and emits MCP events; it does not
  own transports or session overlays.
- `media/`, `task/`, `undo/`, `blob/`, `usage/`, `tokenCounting/`, and
  `replayBuilder/` own their named agent concerns.

## Registration, events, and session rules

- Tools are contributed with `registerAgentToolService` in
  `toolRegistry/toolContribution.ts`, or through `Feature.contributeTool`.
  `BuiltinToolAssemblyService` copies contributions into the agent scope.
- A tool is visible to the model only if the active profile lists its name in
  `packages/engine/src/session/agentLifecycle/profile/profiles.ts`. Approval is
  separate: safe additions go in `permissionPolicy/policies/default-tool-approve.ts`.
- Agent state is event-sourced. Durable `AgentEvent2` classes declare `type`,
  `durable`, and a zod schema; new state uses `defineState` and must be
  contributed by `AgentStateService`. Replay comes from `wire.jsonl`.
- The loop is turn-driven; do not add a second loop or a parallel step scheduler.
  Tool execution goes through the executor so permissions, truncation, dedupe,
  and event recording stay in one path.
- Session-owned data (session id, cwd, workspace context, MCP handle, profiles)
  is injected into the agent scope; do not reach into `session/` internals.

## Import boundaries

- This package is inside the engine, so the engine rules apply: import leaf
  packages only (`base`, `auth`, `minidb`, `tree-sitter-bash`).
- Never import `packages/Tools`, `packages/Addons`, `packages/memory`, `core`,
  `SDK`, `API`, `server`, or `ACP` from `src/`.
- `human/` is the pure kernel. Only `agent/loop/machine` may import its
  implementation; other agent code uses the vocabulary contracts exported through
  `#human/...` and the compatibility types under `#/llm-adapter/...`.
- Run `pnpm --filter @hilbras/omnicode-engine lint:imports` after moving imports.

## Generated manifests

- New or changed durable events: `pnpm --filter @hilbras/omnicode-engine
  gen:wire-manifest`.
- New agent state contribution or snapshot shape: `gen:state-manifest`.
- New config section under `agent/`: `gen:config-manifest`.
- Contract-surface changes: `gen:contract-types`.

Never hand-edit `packages/engine/docs/wire-manifest.d.ts`,
`packages/engine/docs/state-manifest.d.ts`, or
`packages/engine/docs/config-manifest.toml`.

## Tests

Tests mirror source under `packages/engine/test/agent/` — `loop/`,
`toolExecutor/`, `toolRegistry/`, `permissionPolicy/`, `permissionMode/`,
`contextMemory/`, `fullCompaction/`, `contextProjector/`, `mcp/`, `media/`,
`task/`, `undo/`, and the other sibling directories. Stubs and shared harness
live in `test/agent/*/stubs.ts`, `test/harness/`, and `test/stubs.ts`.

```bash
pnpm --filter @hilbras/omnicode-engine typecheck
pnpm --filter @hilbras/omnicode-engine exec vitest run test/agent
pnpm --filter @hilbras/omnicode-engine test
```

## Local traps and where new logic belongs

- Registering a tool without the profile allowlist creates a silent no-op.
- Adding a state key without contributing it to `AgentStateService` leaves it
  unreadable; adding a durable event without a schema fails registration.
- The loop and tool machines are stateful; do not bypass them for a quick
  synchronous path. LLM calls go through `llmRequester/`, not a provider SDK.
- Add permission logic to the policy chain, not to individual tools.
- Add tool implementations in `packages/Tools`; add agent-only services here.

## Do not add here

Do not add session-scope services, app bootstrap/config, MCP transports, tool
implementations, UI code, a second agent loop, or direct provider SDK calls.
