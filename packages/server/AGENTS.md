# packages/server — Agent Guide

Read the root `AGENTS.md` first. This package is the top of the kernel graph: a
REST + WebSocket daemon for the web surface.

## 1. Role and non-goals

`@hilbras/omnicode-server` boots the engine scope, authenticates bearers,
registers `/api/v1` and `/api/v2` routes, streams session events over
`/api/v1/ws`, and emits OpenAPI/AsyncAPI documents for web clients.

- It is not a library other packages may import; nothing may import `server`.
- It does not own agent behavior or the SDK/Klient contract; routes drive core.

`packages/server` is a comment-free zone: `src`, `test`, and `scripts` must have
no comments, JSDoc, or lint suppressions (`pnpm check:architecture`).

## 2. Public entry points and important modules

- `src/index.ts` — `startServer`, `RunningServer`, `ServerStartOptions`, envelope
  helpers, `classify`, token rotation, instance registry. Import activates Addons,
  Tools, and Memory registrations.
- `src/start.ts` — composition root: Fastify, auth/host/origin hooks, engine
  bootstrap, remote-control manager, route registration, WS upgrade handling.
- `src/routes/registerApiV1Routes.ts` — mounts `/api/v1`; domain files live in
  `routes/<domain>.ts`. `registerApiV2Routes.ts` mounts `/api/v2`; `routes/v2/*`.
- `src/protocol/` — zod schemas, envelope, pagination, error codes, WS control
  frames, AsyncAPI. `src/middleware/` — routing, validation, auth, origin, rate
  limit, security headers.
- `src/transport/ws/v1/` — `/api/v1/ws`, registry, broadcaster, journal,
  resync/in-flight tracking.
- `src/services/` — auth tokens, transcript, messages, search, GUI store,
  model-catalog refresh, legacy status.

## 3. Boundary rules

- Nothing imports `server` (enforced by `scripts/check-kernel-layering.mjs`).
- Server may import `core`, `engine`, `base`, `auth`, `memory`, `tools`,
  `transcript`, `minidb`, and `remote`; it must not import `api` or `acp`.
- Web clients talk HTTP/WS; they do not import this package. The vis web app
  type-imports one DTO file — that is not a runtime dependency.
- Do not add engine features or providers here; handlers translate HTTP into
  existing core services. Auth, host, origin, and TLS checks run first.

## 4. Contract and schema rules

- Every JSON response uses `{ code, msg, data, request_id }`
  (`src/protocol/envelope.ts`); success is `0`, errors use
  `src/protocol/error-codes.ts`.
- Register routes through `defineRoute` with zod body/params/query and response
  schemas; it builds validation, JSON schema, and OpenAPI together.
- Pagination uses `src/protocol/pagination.ts` (`before_id`/`after_id`,
  `page_size`, `PageResponse`). Do not invent per-route cursor formats.
- Route schemas are the contract: changing one changes OpenAPI and tests.
  `test/apiSurface.snapshot.test.ts` pins the surface.
- WS event shapes live in `transport/ws/v1/events.ts`; control frames and
  AsyncAPI descriptions live under `protocol/`. Keep them in sync.
- Session state is event-sourced; this package projects and forwards.

## 5. Tests

Tests live in `packages/server/test/` mirroring `src/`, with route tests at the
top level (`sessions`, `prompts`, `approvals`, `questions`, `tasks`, `tools`,
`files`, `fs`, `workspaces`, `search`, `transcript`, `v2*`) and service/WS tests
under `services/`, `search/`, and `ws*`. Shared setup lives in `test/setup.ts`,
`test/globalSetup.ts`, and `test/helpers/`.

```bash
pnpm --filter @hilbras/omnicode-server typecheck
pnpm --filter @hilbras/omnicode-server test
pnpm --filter @hilbras/omnicode-server exec vitest run test/sessions.test.ts
pnpm --filter @hilbras/omnicode-server test:bench
```

`*.e2e.test.ts` boots real servers on ephemeral ports. Use
`test/helpers/sharedServer.ts`; never add sleeps to wait for readiness.

## 6. Local traps and where new logic belongs

- New REST route: `src/protocol/rest-<domain>.ts` schemas → `src/routes/<domain>.ts`
  via `defineRoute` → register in `registerApiV1Routes.ts` → route test. Add an
  error code only when no existing code fits.
- New WS event/control frame: `transport/ws/v1/events.ts` or `protocol/ws-control.ts`
  → broadcaster/connection handling → `protocol/asyncapi.ts` → WS test.
- New domain service projection: `src/services/<domain>/`; keep it read-only over
  core state.
- Non-loopback binds require TLS termination or `--insecure-no-tls`; remote
  shutdown and terminals are loopback-only unless explicitly allowed.
- Port `0` picks a free port; otherwise the server retries upward up to
  `PORT_RETRY_LIMIT`. Do not hardcode 58627 in tests.
- `apiSurface.snapshot.test.ts` fails on any route addition/removal. Update it
  deliberately; never hand-edit generated OpenAPI output.

## 7. What must not be added here

- Imports of `@hilbras/omnicode-api` or `@hilbras/omnicode-acp`.
- Engine services, tools, permission policy, provider wires, or persistence.
- CLI/TUI code, React components, or vis-specific routes.
- A second envelope/error-code scheme or ad-hoc JSON responses.
- Comments, JSDoc, or lint suppressions in `src`, `test`, or `scripts`.
