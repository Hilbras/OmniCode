# packages/rpc — Agent Guide

Read the root `AGENTS.md` first. `rpc` may import `base` only, and currently
does so only for the DI `ServiceIdentifier` type.

## Role and non-goals

Transport half of the kernel: the `KlientChannel` SPI, scope/event references,
NDJSON frame codec and IPC client, plus a host-side dispatcher helper.

Non-goals: no service implementations, no scope resolution, no facade, no
authentication, and no HTTP/WS transport. Memory/HTTP/WS transports and the IPC
host live in `API`.

## Entry points

There is no root barrel: `src/index.ts` is empty. The package maps `./*` to
`src/*.ts`, so import concrete subpaths:

```ts
import type { KlientChannel, ScopeRef } from '@hilbras/omnicode-rpc/channel';
import { createDispatcher } from '@hilbras/omnicode-rpc/dispatch';
import { RPCError } from '@hilbras/omnicode-rpc/errors';
import { trimTrailingUndefined } from '@hilbras/omnicode-rpc/args';
import { encodeFrame, NdjsonDecoder } from '@hilbras/omnicode-rpc/ipc/codec';
import { IpcChannel } from '@hilbras/omnicode-rpc/ipc/channel';
```

- `channel.ts`: `KlientChannel` (`call`, `stream`, `listen`, `close`),
  `ScopeRef`, `EventSourceRef`, `CallOptions`, `IDisposable`.
- `dispatch.ts`: `createDispatcher`, `DispatchHost`, `ResolvedScope`,
  `wireClone`.
- `errors.ts`: `RPCError` with a numeric wire code.
- `args.ts`: `trimTrailingUndefined`.
- `ipc/codec.ts`: NDJSON encode/decode and `IpcFrame`.
- `ipc/channel.ts`: Unix-socket client with handshake, call deadlines, streams,
  subscriptions, no reconnect.

## Layering rules

- `rpc` may import `base` only. Never import `engine`, `SDK`, `API`, or any leaf
  directly.
- Do not add business logic here; the dispatcher is a generic host adapter.
- No import cycles. Transport code must not know which facade method triggered a
  frame.

## Local constraints
- Relative imports use `.js` extensions (`./channel.js`). Preserve that.
- `ScopeRef` is an empty object for core scope plus optional `workspaceId` /
  `sessionId` / `agentId`. Do not invent a separate scope kind.
- Event sources are a named stream or a service `on[A-Z]...` property; invalid
  names are `RPCError(40001)`.
- Wire values must be JSON-cloneable (`wireClone` round-trips JSON): no `Date`,
  `Map`, `Set`, `undefined` entries, or class instances.
- NDJSON is JSON: trim trailing `undefined` args or server defaults break.
- IPC calls default to 30 s; `0` disables it. No reconnect; close rejects
  in-flight work.
- `listen` reports async failures via `onError`; validation may throw.
- `RPCError.code` is the cross-wire branch key; no `instanceof` across
  processes.

## Tests
No package-local tests: no `test/` dir, no `vitest.config.ts`, no `test` script.
```bash
pnpm --filter @hilbras/omnicode-rpc typecheck
```
Behavior is exercised by `packages/API/test/memory.test.ts`,
`packages/API/test/facade.test.ts`, and API transports. If you change the
dispatcher/channel contract, also run those API tests.
## Local traps
- No root barrel. `import { ... } from '@hilbras/omnicode-rpc'` fails.
- The `dispatch.ts` base import is type-only; runtime DI access deepens it.
- `stream()` is lazy: start resolves on first `next()`, cancel on `return()`.
- Malformed NDJSON lines are dropped by design; don't throw without review.
- `scopeKindOf` collapses scope coordinates to one kind; IDs still travel.
## Belongs here vs neighbours
- IPC host, service registry, scope resolution, facades/routing: `API`.
- HTTP/WS/memory transports: `API`. DI primitives: `base`.
