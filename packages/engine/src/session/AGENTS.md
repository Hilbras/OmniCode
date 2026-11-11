# session — session-scope composition

## Role and non-goals

`packages/engine/src/session` owns session-scope services and the lifecycle of
agents inside a session: session context, agent creation/fork/close, profiles,
session state/log/metadata/title, tool policy, usage, terminal, subagents,
workspace context, and the MCP overlay handle.

Not here: the agent loop and tool execution (`agent/`), app-scope session
management and persistence (`app/sessionManager`, `app/sessionIndex`), MCP
transports (`mcpCore/`), or tools (`packages/Tools`).

## Entry points and ownership

- `sessionContext/` owns the session id, workspace id, directories, cwd, and
  scope keys.
- `agentLifecycle/` owns `IAgentLifecycleService`, main/forked/managed agents,
  agent scope creation, and agent close. `profile/profiles.ts` is the built-in
  profile and tool allowlist.
- `state/` owns session state; `sessionMetadata/`, `sessionLog/`, and
  `sessionTitle/` own metadata, log, and title services.
- `sessionToolPolicy/` and `sessionToolPolicyGate/` own session-level tool
  admission; `sessionActivity/` and `usage/`/`tokenCounting/` own activity,
  outcome, usage, and token accounting.
- `subagent/` owns spawn/run/fork/parity and subagent model validation.
- `workspaceContext/` and `workspaceInfo/` expose workspace data to tools.
- `mcp/` owns the session MCP handle, ephemeral server overlay, and merged
  connection view. `workspace/sessionLifecycle` wires the base and overlay.
- `sessionInit/sessionInitContract.ts` defines the AGENTS.md initialization
  contract; `packages/Addons` implements it.
- `terminal/` owns session terminal processes.

## Registration, events, and session rules

- Session services use `registerScopedService(LifecycleScope.Session, ...)` or
  `LifecycleScope.Agent`; app-wide services must stay in `app/`.
- Agents are created through `IAgentLifecycleService`; do not construct agent
  scopes directly. `MAIN_AGENT_ID` is the main agent.
- A tool reaches a model only if its name is in the active profile allowlist in
  `agentLifecycle/profile/profiles.ts`. Registering a tool elsewhere is not
  enough. Approval remains in `agent/permissionPolicy/`.
- Session state is event-sourced with `Event2`/`AgentEvent2`. Durable metadata
  events declare `type`, `durable`, and a zod schema. Replay comes from
  `wire.jsonl`; do not keep a parallel mutable source of truth.
- The MCP handle exposes a `McpConnectionView`. The merged view prefers overlay
  servers by name and preserves base status events for non-overlay servers.
  Ephemeral servers are seeded into the session scope, not written to app config.
- `sessionInit` is a contract here, not an implementation. Addons owns the
  service that spawns the init subagent and seeds the AGENTS.md reminder.

## Import boundaries

- Engine rules apply: import leaf packages only (`base`, `auth`, `minidb`,
  `tree-sitter-bash`); never import `Tools`, `Addons`, `memory`, `core`, `SDK`,
  `API`, `server`, or `ACP`.
- `session/agentLifecycle` is one of the sanctioned adapters allowed to import
  `human/` implementation (the agent/session machine). Other session code uses
  `#human/...` vocabulary contracts and `#/llm-adapter/...` compatibility types.
- `session/mcp` consumes `mcpCore/` primitives; it must not implement transports
  or app config persistence.
- Run `pnpm --filter @hilbras/omnicode-engine lint:imports`.

## Generated manifests

- Session state or snapshot changes: `pnpm --filter @hilbras/omnicode-engine
  gen:state-manifest`.
- Durable session/metadata events: `gen:wire-manifest`.
- Session config sections: `gen:config-manifest`.
- Contract-surface changes: `gen:contract-types`.

Generated outputs are `packages/engine/docs/state-manifest.d.ts`,
`wire-manifest.d.ts`, and `config-manifest.toml`; never hand-edit them.

## Tests

Tests live under `packages/engine/test/session/`: `agentLifecycle/`,
`sessionActivity/`, `sessionAgentProfileCatalog/`, `sessionLog/`,
`sessionMetadata/`, `sessionTitle/`, `subagent/`, `terminal/`, and
`workspaceContext/`. Shared harness and stubs live in `test/harness/` and
`test/stubs.ts`. `sessionInit` behavior is covered by Addons tests.

```bash
pnpm --filter @hilbras/omnicode-engine typecheck
pnpm --filter @hilbras/omnicode-engine exec vitest run test/session
pnpm --filter @hilbras/omnicode-engine test
```

## Local traps and where new logic belongs

- Profile allowlists are load-bearing; a tool missing there is invisible.
- Agent close must quiesce prompts and interactions before disposing the scope.
- Session MCP overlay ownership is by server name; do not merge by transport.
- Do not put workspace-level lifecycle in `session/`; it belongs to
  `workspace/sessionLifecycle`.
- New session-scope service: this directory with `LifecycleScope.Session`.
  New app-scope session registry: `app/sessionManager` or `app/sessionIndex`.
- Coverage gaps: `sessionContext`, `sessionToolPolicy`,
  `sessionToolPolicyGate`, `sessionInstructions`, `usage`, `tokenCounting`, and
  `workspaceInfo` have no dedicated suites under `test/session/`; add one beside
  the existing mirrored tests rather than a new test root.

## Do not add here

Do not add the agent loop, tool execution, app bootstrap/config, MCP transports,
tool implementations, UI code, or a second agent lifecycle.
