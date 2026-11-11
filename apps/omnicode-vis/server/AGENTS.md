# apps/omnicode-vis/server — Agent Guide

Read the root `AGENTS.md` and `apps/omnicode-vis/AGENTS.md` first. This is the
Hono API + SPA host for the vis debugger.

## 1. Role and non-goals

The server exposes read-only views over persisted Omnicode session data:
summaries/detail, migrated wire records, agent trees, blobs, context, tasks,
cron metadata, logs, imported debug zips, the built SPA, and optional bearer auth.

- It is not the live agent server; `packages/server` owns REST/WS for running
  agents.
- It does not boot an engine scope or mutate agent state.
- It does not implement the SDK/Klient contract.
- It does not own UI behavior; `../web` does.

Current boundary: it imports `@hilbras/omnicode-core` types and specific engine
wire/context helpers. It does not depend on SDK/API. Treat that as a debugger
exception, not a pattern for live features.

## 2. Public entry points and important modules

- `src/index.ts` — process entry. `src/start.ts` — `startVisServer` (`host`,
  `port`, `homeDir`, `authToken`, optional in-memory `webAsset`).
- `src/app.ts` — `createApp`: `/api/*` router, bearer middleware, SPA fallback,
  filesystem `public/` serving.
- `src/config.ts` — `OMNICODE_HOME`, `resolveHost`/`resolvePort`,
  `resolveVisAuthToken`, loopback detection, URL host formatting.
- `src/routes/` — `sessions`, `session-detail`, `wire`, `subagents`, `blobs`,
  `tasks`, `cron`, `logs`, `context`, `imports`.
- `src/lib/session-store.ts` — bucket/session scanning, detail, path-safe ids.
- `src/lib/wire-reader.ts` — `wire.jsonl` parsing + protocol migration.
- `src/lib/blob-resolver.ts` — media references to served blobs.
- `src/lib/context-projector.ts` — derives context/compaction views.
- `src/lib/agent-tree.ts` — parent/subagent tree from state metadata.
- `src/lib/import-store.ts`, `zip-import.ts` — imported debug bundles.
- `src/lib/{log-reader,task-store,cron-store,reveal,web-asset,agent-record-types}.ts`.

## 3. Boundary rules

- Web clients use HTTP only; no package imports across the app boundary.
- Do not import `@hilbras/omnicode-server`, API, SDK, ACP, or app packages.
- Engine imports must stay narrow and read-only (`wire/migration`, context fold
  ops). Do not add engine services, session boot, or tool execution.
- The only writes are: imported bundle extraction, `reveal` (opens the OS file
  manager), and recursive session deletion. Never write `state.json`/`wire.jsonl`.
- Validate every path component from a URL or `state.json` (`isSafeAgentId`,
  session-id regex, `publicDir + sep` prefix checks). Data can be hand-edited.
- Non-loopback binds require `VIS_AUTH_TOKEN`; do not add a bypass.

## 4. Contract and schema rules

- `src/lib/agent-record-types.ts` is the shared DTO source of truth; the web app
  type-imports it. Changing it changes the UI contract.
- API responses are plain JSON, not the `packages/server` `{code,msg,data}`
  envelope. Errors use `{ error, code }` with HTTP status. Do not mix schemes.
- Wire records are returned in both raw and migrated forms (`WireEntry`); protocol
  versions are handled best-effort with warnings, never rejected silently.
- Import zips are capped at 500 MiB compressed; the uncompressed cap lives in
  `zip-import.ts`. Keep both checks.
- `createApp({ webAsset })` serves an in-memory single-file SPA; otherwise it
  serves `public/` next to the compiled server and falls back to `index.html`.

## 5. Tests

Tests live in `apps/omnicode-vis/server/test/` with `lib/` and `routes/`
mirroring `src/`. Fixtures live in `test/fixtures/` (`build.ts`, sample sessions).

```bash
pnpm --filter @hilbras/omnicode-vis-server typecheck
pnpm --filter @hilbras/omnicode-vis-server test
pnpm --filter @hilbras/omnicode-vis-server exec vitest run test/routes/imports.test.ts
```

Gaps: no route tests for `sessions`, `session-detail`, `subagents`, or `wire`;
no direct tests for `zip-import`/`web-asset` beyond what `imports`/`start`
exercise. Add cases before changing those paths.

## 6. Local traps and where new logic belongs

- New endpoint: `src/routes/<name>.ts` returning a Hono `Hono` → mount in
  `app.ts` → pure reader in `src/lib/` → route test.
- Mount `contextRoute` last: its catch-all stub shadows more specific routes.
- `/api/*` misses must return 404 JSON; they must never fall through to the SPA.
- Resolve a session directory from `listSessions`/`readSessionDetail`, never by
  joining the URL id to `OMNICODE_HOME`.
- `OMNICODE_HOME` is evaluated at module load; tests pass `homeDir` explicitly
  to `createApp`/`startVisServer` instead of mutating env.
- Import extraction must reject zip-slip and symlink escapes; keep normalization
  and size checks together.
- Reveal opens the folder on the server host; it is meaningless for remote users.

## 7. What must not be added here

- Agent execution, engine bootstrap, session writes, or tool invocation.
- The `packages/server` envelope/auth stack or its route schemas.
- SDK/API/ACP imports or a live-agent client.
- A second static-file scheme or an unauth non-loopback mode.
- New dependencies for unbounded parsing/rendering of untrusted artifacts.
