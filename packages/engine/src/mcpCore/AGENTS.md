# mcpCore — MCP protocol and transport core

## Role and non-goals

`packages/engine/src/mcpCore` is the low-level Model Context Protocol layer:
stdio/HTTP/SSE clients, connection management, config schema and view, tool
naming, OAuth, errors, and endpoint/redirect security.

Not here: agent tool registration, session overlays, app config persistence,
management commands, prompts, permissions, or UI. Those live in `agent/mcp/`,
`session/mcp/`, `app/mcpConfig/`, `app/mcpManagement/`, and `app/mcpRegistry/`.

## Entry points and ownership

- `connection-manager.ts` owns connect/reconnect/initial-load status and exposes
  `McpConnectionView`; it coordinates clients and tool discovery.
- `client-stdio.ts`, `client-http.ts`, `client-sse.ts`, and `client-shared.ts`
  own transports and shared client behavior.
- `config-schema.ts` owns `McpServerConfig` validation, transports, env, headers,
  and timeout bounds; `configView.ts` is the redacted/public projection.
- `endpoint-policy.ts` and `remote-guard.ts` own URL admission and redirect
  protection.
- `tool-naming.ts` owns the `mcp__` qualified name format and collision-safe
  mapping back to server tools.
- `oauth/` owns the OAuth provider, callback server, token store, and service.
- `types.ts` owns MCP client/tool/result shapes used by callers.
- `errors.ts` owns MCP error construction.

## Registration and lifecycle rules

- This directory does not register scoped services, agent tools, features, or
  config sections. App and agent layers wrap these primitives.
- The connection manager does not own the process lifetime of a session; the
  caller disposes it. Session-scoped base/overlay managers are composed in
  `session/mcp/`, and app-scope management is composed in `app/mcpManagement/`.
- Tool definitions are validated before they enter the registry. Keep raw tool
  definitions alongside normalized `ToolDescription` values when callers need
  both.
- MCP status is reported through `McpConnectionView`, not through Event2. The
  agent layer maps status to `McpServerStatus` and `ToolListUpdated` events.
- Never fall back silently from one transport to another or from a rejected
  endpoint to an allowed one.

## Security rules

- `checkMcpEndpoint` rejects non-HTTP(S) schemes, non-loopback plain HTTP,
  private IPv4, link-local, unique-local, and link-local IPv6 unless
  `allowPrivateNetwork` is explicitly set.
- `createMcpRedirectGuardFetch` refuses cross-origin redirects so credentials
  are not forwarded. Do not replace it with a plain `fetch`.
- Stdio servers run through the host process/runtime seam; do not spawn by bare
  command name outside the trusted path, and pass argument arrays.
- Redact secrets from errors, logs, telemetry, and tool output. OAuth tokens and
  auth headers must never appear in `configView` or diagnostics.
- URL admission and redirect protection are load-bearing; do not weaken them to
  make a server connect.

## Import boundaries

- Engine rules apply: import leaf packages only (`base`, `auth`, `minidb`,
  `tree-sitter-bash`). Current code also uses `#/os/...`, `#/errors`, and
  `#human/llm/message` for tool descriptions.
- Keep this layer below `agent/`, `session/`, and `app/`; importing upward would
  invert the MCP stack and create cycles.
- Do not import `packages/Tools`, `packages/Addons`, `packages/memory`, `core`,
  `SDK`, `API`, `server`, or `ACP`.
- Run `pnpm --filter @hilbras/omnicode-engine lint:imports`.

## Generated manifests

There are no generated manifests owned by `mcpCore`. Its config schema is wired
into the app config section in `app/mcpConfig/`; changing that section requires
`pnpm --filter @hilbras/omnicode-engine gen:config-manifest`. MCP wire events
belong to `agent/mcp/mcpEvents.ts` and require `gen:wire-manifest`. Do not
hand-edit generated manifests.

## Tests

Tests live under `packages/engine/test/mcpCore/` and mirror the source:
`client-stdio.test.ts`, `client-http.test.ts`, `client-sse.test.ts`,
`connection-manager.test.ts`, `config-schema.test.ts`, `endpoint-policy.test.ts`,
`tool-naming.test.ts`, and `oauth/`. Stdio fixtures are in
`test/mcpCore/fixtures/`; stubs are in `test/mcpCore/stubs.ts`.

```bash
pnpm --filter @hilbras/omnicode-engine typecheck
pnpm --filter @hilbras/omnicode-engine exec vitest run test/mcpCore
pnpm --filter @hilbras/omnicode-engine test
```

## Local traps and where new logic belongs

- A new transport belongs here, wired into `connection-manager.ts`; a new agent
  tool wrapper belongs in `agent/mcp/`.
- A new config field belongs in `config-schema.ts`, then flows through
  `app/mcpConfig/` and the management/registry layers.
- A new session overlay belongs in `session/mcp/`; do not add session policy here.
- Keep timeouts bounded and cancellation wired; tests use fixture servers rather
  than sleeps.
- Preserve tool-name qualification in both directions; collisions are silent
  routing bugs.

## Do not add here

Do not add scoped services, agent tools, session merging, app config file I/O,
management commands, permission policy, prompt text, or UI behavior.
