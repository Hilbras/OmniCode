# apps/omnicode-vis/web — Agent Guide

Read the root `AGENTS.md` and `apps/omnicode-vis/AGENTS.md` first. This is the
React UI for the vis debugger.

## 1. Role and non-goals

The web app renders persisted session data served by `../server`: session list,
session detail, context/compaction, wire records, subagent trees, tasks, cron,
and logs. It is a read-only inspector, not an agent client.

- It does not talk to a running agent/engine/WebSocket; `node:fs` is test-only.
- It does not implement business logic that belongs on the server.
- It does not own authentication issuance; it stores and sends the provided
  bearer token.

## 2. Public entry points and important modules

- `src/main.tsx` — React root: `QueryClientProvider`, `BrowserRouter`, theme.
- `src/App.tsx` — routes: `/`, `/sessions/:sessionId`,
  `/sessions/:sessionId/agents/:agentId`.
- `src/api.ts` — the only HTTP client: `fetch('/api/...')`, bearer token,
  `ApiError` handling, zip import, delete/reveal.
- `src/types.ts` — client DTOs; type-imports
  `../../server/src/lib/agent-record-types`.
- `src/hooks/` — TanStack Query bindings: `useSession`, `useWire`,
  `useContext`, `useSubagents`, `useTasks`, `useTheme`.
- `src/pages/` — `SessionListPage`, `SessionDetailPage`, `SubagentDetailPage`.
- `src/components/` — `sessions/`, `context/`, `wire/`, `subagents/`, `tasks/`,
  `logs/`, `layout/`, `shared/`.
- `src/lib/` — pure helpers: `analysis.ts`, `issues.ts`; `src/util/time.ts`.
- `src/theme.css` — Tailwind v4 entry.

Vite config: dev server defaults to `WEB_PORT=5173`, proxies `/api` to
`PORT || 5174`; `VIS_SINGLEFILE=1` builds `dist-single/` with inlined assets.

## 3. Boundary rules

- Browser code uses `/api` only. Do not add direct filesystem, process, or
  engine access.
- `types.ts` is the single cross-package type bridge to the server. Do not
  import server modules elsewhere in `src/`.
- Do not import `@hilbras/omnicode-sdk`, API, ACP, or live-server packages;
  this app has no runtime agent connection.
- Keep `App.tsx` as routing/layout wiring. Put data shaping in `src/lib/` and
  data fetching in `src/hooks/`.
- The server already migrates wire protocol versions. Do not reimplement engine
  wire migrations in the browser.

## 4. Contract and schema rules

- The API contract is plain JSON (`{ error, code }` on failure), not the
  `packages/server` envelope. Read failures through `api.ts`.
- `types.ts` re-exports server DTOs; changing `agent-record-types.ts` can break
  this app's typecheck. Treat it as a shared contract.
- Wire records include both raw and migrated shapes; renderers must tolerate
  unknown/new record types rather than crash the whole tab.
- Query keys are part of the cache contract (`['sessions']`,
  `['session', id, 'wire', agentId]`, etc.). Invalidate the exact keys mutated by
  delete/import.
- The auth token comes from `?token=`/`#token=` or local storage and is removed
  from the URL. Do not log it or place it in query keys.

## 5. Tests

Tests live in `apps/omnicode-vis/web/test/` (`analysis`, `api`, `issues`,
`renderers`, `time`, `zip-drop`). Vitest runs with `environment: 'node'`, not
jsdom; the suite covers pure helpers and renderers rather than DOM interaction.

```bash
pnpm --filter @hilbras/omnicode-vis-web typecheck
pnpm --filter @hilbras/omnicode-vis-web test
pnpm --filter @hilbras/omnicode-vis-web exec vitest run test/analysis.test.ts
```

There is no browser/E2E or component-interaction suite. Add a renderer case to
the nearest existing file instead of introducing a DOM harness for one test.

## 6. Local traps and where new logic belongs

- New tab/section: `src/components/<area>/` + hook in `src/hooks/` + method in
  `src/api.ts` + DTO in `src/types.ts`; mount the tab in the detail page.
- New derived data: pure function in `src/lib/` with a `test/` case; do not
  compute it inside a component body.
- New endpoint usage: add the method to `api.ts`; never call `fetch` from a
  component.
- API errors are plain `{ error, code }`; `api.ts` throws `Error` with the
  message. Do not assume a `msg` field.
- Queries are cached for the session lifetime (`staleTime: Infinity`). Mutations
  must explicitly invalidate; otherwise the UI shows stale data.
- `types.ts`'s relative server import means web typecheck also type-checks
  server source (decorators enabled in `tsconfig.json`).

## 7. What must not be added here

- Direct engine/SDK/API/ACP imports or a live-agent WebSocket client.
- Server routes, readers, or filesystem access.
- Auth issuance, server token storage, or TLS/proxy behavior.
- A second API client or ad-hoc response envelope.
- DOM/browser test infrastructure unless the app adopts browser tests broadly.
