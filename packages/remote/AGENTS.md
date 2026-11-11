# packages/remote — Agent Guide

Read the root `AGENTS.md` first. This package is the Remote Control tunnel
client: it registers a machine with a relay and forwards HTTP/WS traffic to the
local Omnicode server.

## 1. Role and non-goals

`@hilbras/omnicode-remote` owns the relay WebSocket connection, request/response
forwarding, reconnect/backoff, and the single-instance lock. `manager.ts` wraps
that tunnel in a small state machine (`off`, `starting`, `on`, `stopping`).

- It is not a server or a reverse proxy for arbitrary origins; it forwards only
  to the configured local origin.
- It does not issue auth tokens, terminate TLS, or decide who may use Remote
  Control. `packages/server` gates the feature and supplies the local token.
- It does not define REST/WS routes; it forwards the local server's routes.
- It does not persist session or agent data; only auth device identity and the
  lock file.

## 2. Public entry points and important modules

- `src/index.ts` — re-exports `remote-control`, `lock`, and `manager`.
- `src/remote-control.ts` — `startRemoteControl`, `RemoteControlHandle`, relay
  URL resolution (`OMNICODE_REMOTE_CONTROL_RELAY_URL`, default
  `https://code-rc.omnicode.com`), registration, HTTP/WS forwarding, gzip,
  reconnect, and shutdown.
- `src/manager.ts` — `createRemoteControlManager`, `RemoteControlManager`
  (`status`, `enable`, `disable`, `close`), xstate2 machine, tunnel exit handling.
- `src/lock.ts` — `acquireRemoteControlLock`,
  `RemoteControlAlreadyRunningError`, `remoteControlLockPath`,
  `~/.omnicode/server/rc.json` format and stale-lock recovery.
- Consumers: `packages/server/src/start.ts` creates the manager;
  `packages/server/src/routes/remoteControl.ts` exposes status/enable/disable;
  the CLI imports status/types.

## 3. Boundary rules

- Nothing imports `server`; this package may not depend on it. `server` imports
  this package, never the reverse.
- Keep the tunnel origin-agnostic: it forwards to `localOrigin`, not to engine
  internals or route handlers.
- Do not import API, SDK, ACP, or app packages.
- Auth/device identity comes from `@hilbras/omnicode-auth`; do not invent a
  second credential store.
- Remote Control is server-gated: loopback-only, unavailable with
  `--dangerous-bypass-auth`, and disabled when the server has no local token.
- Never weaken the header blocklist or size caps to make a payload work.

## 4. Contract rules

- The relay protocol is a fixed frame vocabulary. Add a frame in
  `remote-control.ts` only with a compatible fallback/ignore path for older
  relays.
- The lock file is a cross-process contract: disk keys are snake_case
  (`local_origin`, `device_id`, `started_at`); `rc.json` must remain readable by
  older CLIs.
- Request headers `authorization`, `cookie`, `host`, `origin`, and hop-by-hop
  headers are stripped/rewritten deliberately. Responses strip hop-by-hop
  headers. Preserve the local token injection path.
- Caps are part of the contract: 64 KiB headers, 10 MiB request body, 30 s
  request timeout, 30 s reconnect ceiling, 300 s relay-silence timeout.
- Gzip only above 1 KiB and for compressible types.

## 5. Tests

The only test file today is `packages/remote/test/remote-control.test.ts`
(Vitest timeout 30 s). There are no dedicated `manager.test.ts` or `lock.test.ts`
files — add them when changing lifecycle or lock semantics.

```bash
pnpm --filter @hilbras/omnicode-remote typecheck
pnpm --filter @hilbras/omnicode-remote test
pnpm --filter @hilbras/omnicode-remote exec vitest run test/remote-control.test.ts
```

Do not use real relay/network calls in tests; use a local fake relay/WS server
and wait for observable frames, not sleeps.

## 6. Local traps and where new logic belongs

- New relay frame/behavior: `remote-control.ts` + test; keep the manager's
  `tunnel.exited` transition intact.
- New lifecycle state: `manager.ts` machine, not ad-hoc booleans in callers.
- Lock changes: `lock.ts`; preserve stale-PID detection and nonce-checked
  release, otherwise two machines/processes can claim one tunnel.
- Reconnect must back off and re-register; do not reconnect without re-reading
  the current local token and configured OAuth key.
- A tunnel that exits spontaneously must transition the manager to `off`
  (rather than leaving a dead `on` state) and surface the error.
- `enable()` while already on/starting should be idempotent; `disable()` during
  starting must await the start and then close it.

## 7. What must not be added here

- REST/WS routes, auth middleware, TLS termination, or bind classification.
- Imports of `@hilbras/omnicode-server`, API, SDK, ACP, or app code.
- Session/agent state, engine services, tools, or persistence.
- A second lock/credential store or a bypass of the header blocklist.
- Arbitrary proxy behavior (forwarding to hosts other than the local origin).
