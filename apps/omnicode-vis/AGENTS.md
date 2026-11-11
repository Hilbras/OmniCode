# apps/omnicode-vis — Agent Guide

Read the root `AGENTS.md` first. This app is a read-only debug visualizer for
persisted Omnicode sessions, not a runtime agent client.

## 1. Role and non-goals

`apps/omnicode-vis` has two sub-apps: `server/` (Hono API + SPA host) and `web/`
(React 19 + Vite UI). It inspects `OMNICODE_HOME` (`~/.omnicode`): `state.json`,
`wire.jsonl`, blobs, logs, tasks, cron metadata, and imported debug zips.

- It is not the production daemon; `packages/server` is the REST/WS server for
  live agents.
- It does not launch or drive an agent, and is not published or imported by
  other packages; it reads persisted artifacts and does not own semantics.
- Derived context/wire views reuse the engine's fold/migration helpers.

Current boundary reality: this app does not depend on `@hilbras/omnicode-sdk`.
The server imports `@hilbras/omnicode-core` types and specific engine fold/wire
modules; the web app talks HTTP only. This deviates from the root rule that
`apps/*` use the SDK. Do not extend it: new live features go through SDK/API.

## 2. Entry points and layout

- `package.json` — root orchestration only: `dev`, `build`, `prestart`, `start`.
- `scripts/dev.mjs` picks free API/web ports (defaults 5174/5173) and runs both
  packages via `concurrently`; `copy-web-dist.mjs` copies `web/dist` →
  `server/dist/public`.
- `server/src/index.ts` — CLI entry; `server/src/start.ts` — `startVisServer`;
  `server/src/app.ts` — Hono app and SPA fallback.
- `server/src/routes/` — `/api/sessions`, session detail, wire, agents, blobs,
  tasks, cron, logs, context, and `/api/imports`.
- `server/src/lib/` — readers/projectors: `session-store`, `wire-reader`,
  `blob-resolver`, `context-projector`, `agent-tree`, `import-store`,
  `zip-import`, `log-reader`, `task-store`, `cron-store`, `reveal`.
- `web/src/main.tsx` — React root with TanStack Query + BrowserRouter;
  `web/src/App.tsx` — routes; `web/src/pages/` — list/detail/subagent pages.

## 3. Boundary rules

- The web app must not read files or spawn processes; it calls `/api` only.
- `web/src/types.ts` type-imports `server/src/lib/agent-record-types.ts` by
  relative path. That file is the shared DTO contract — change both sides.
- The server may read session artifacts and use engine wire/context helpers; it
  must not write agent state. Its only destructive action is deleting a selected
  session directory (and imported bundles).
- Never trust ids from `state.json` or URLs: `isSafeAgentId` and directory-prefix
  checks exist because data can be hand-edited or imported.
- Do not import `packages/server` or `packages/API` here; this is not a live
  server client.

## 4. Build and runtime contracts

- `pnpm --filter @hilbras/omnicode-vis-server build` → `server/dist/server.mjs`;
  `pnpm --filter @hilbras/omnicode-vis-web build` → `web/dist/`.
- Root `build` runs both, then `copy-web-dist.mjs`; `start` runs the built server,
  which serves `dist/public` with SPA fallback.
- `VIS_SINGLEFILE=1` builds `web/dist-single/index.html` for embedding; normal
  `dist/` is unaffected.
- `VIS_AUTH_TOKEN` is required outside loopback; the URL token is scrubbed after
  storage. Runtime knobs: `OMNICODE_HOME`, `PORT`, `HOST`/`VIS_HOST`, `WEB_PORT`
  (see `server/src/config.ts` before adding another).

## 5. Tests

There is no root-level test file. The root `vitest.config.ts` includes
`apps/omnicode-vis/server` and `apps/omnicode-vis/web` as separate projects.

```bash
pnpm --filter @hilbras/omnicode-vis-server typecheck
pnpm --filter @hilbras/omnicode-vis-server test
pnpm --filter @hilbras/omnicode-vis-web typecheck
pnpm --filter @hilbras/omnicode-vis-web test
```

Server tests live in `server/test/{lib,routes}`; web tests in `web/test`. Neither
package has a browser/E2E suite; pure helpers and renderer tests cover behavior.

## 6. Local traps and where new logic belongs

- New API endpoint: `server/src/routes/<name>.ts` → mount in `app.ts` → reader
  in `server/src/lib/` → test under `server/test/routes/`.
- New UI tab: `web/src/components/<area>/` + hook in `web/src/hooks/` + method
  in `web/src/api.ts` + DTO in `web/src/types.ts`; keep `App.tsx` route wiring.
- Mount `contextRoute` after specific session routes: it has a catch-all stub
  that would otherwise shadow them.
- `/api/*` must 404 from the API router, never fall through to the SPA.
- Deleting a session removes the resolved directory recursively; resolve it from
  the session list, never concatenate the URL id.
- The server is often exposed beyond loopback during debugging; enforce the
  token and path checks rather than relying on local-only assumptions.

## 7. What must not be added here

- A production agent daemon, auth/token issuance, or TLS termination.
- New engine imports for live-agent behavior; use SDK/API instead.
- Writes to engine state, session metadata, or wire files.
- Shared packages that belong in `packages/` (create one only with the package
  checklist and workspace guards).
- Test scaffolding that depends on a real network or a hidden local home.
