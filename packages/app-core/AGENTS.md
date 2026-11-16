# packages/app-core — Agent Guide

## Role

Shared core for the Omnicode web renderers. Owns the daemon transport, the pure
session/event state machine, transcript projections, contracts, and small
framework-agnostic helpers. Source-only: `exports` points at `./src`, so the
consumer's bundler transpiles it.

Non-goals:

- no Vue SFCs, design-system components, Pinia stores, router, or product flows
- no CLI/TUI behavior; that belongs to `apps/omnicode-cli`
- no concrete tracer, credential store, i18n instance, or icon registry; inject
  them through the contracts
- no runtime dependency on sibling `app-*` packages or `apps/*`; test-only
  devDependencies are allowed (the tests currently import `app-i18n`)

## Entry points

- `.` — barrel over `api`, `client`, `composables`, `contracts`.
- `./api` — `DaemonOmnicodeWebApi`, `DaemonHttpClient`, `DaemonEventSocket`,
  `createOmnicodeWebApi`, event reducer, wire mappers, and daemon types.
- `./client` — pure projections (`mainTranscriptToTurns`, `turnsProjector`,
  `applyRecordDiff`, `toolDiff`, `eventBatcher`) and `createOmnicodeWebClientCore`.
- `./contracts` — `Tracer`, `CredentialStore`, `ResolveImage`,
  `ResolveImageKey`, `Translator`, `ClientIdentity`.
- `./lib` — path, formatting, search, plan, session, and workspace helpers.
  `./lib/slashCommands` and `./lib/skillCommandPrefix` are narrow public subpaths.
- `./transcript` — re-exports `@hilbras/omnicode-transcript` plus
  `TranscriptChannel`.

## Ownership and boundaries

- `api/daemon/` is transport plus state reduction. It must stay independent of
  Vue components; dependencies arrive through constructor options.
- `client/` owns projection and client-state helpers. Keep it deterministic and
  test-friendly; do not add DOM or app-bootstrap code.
- `contracts.ts` is the injection boundary. A consumer implements these shapes;
  this package must not import the consumer.
- `lib/` helpers must remain free of app singletons. If a helper needs app state,
  pass it in as an argument.
- Never import `@hilbras/app-client`, `app-components`, `app-composer`,
  `app-ui`, `app-markdown`, or `apps/*` from `src/`. A sibling `app-*` package may
  appear only as a test devDependency.

## Local constraints

- TypeScript ESM, no build step in this package.
- `tsconfig.json` disables `noPropertyAccessFromIndexSignature` to match the
  renderer consumers; do not turn it back on for this package.
- `vue` and `shiki` are peer dependencies. Do not bundle or import consumer
  icons, themes, or locale instances.
- Keep event-reducer changes paired with the wire-type changes they consume.
- Do not hand-add exports to `src/index.ts` for internal helpers; add them to the
  owning sub-barrel or a new explicit subpath in `package.json`.

## Validation

Tests live in `test/` and cover the projections and daemon client heavily. The
package is wired into the root Vitest graph through its own `vitest.config.ts`
(project `app-core`, `test/**/*.test.ts`, `environment: 'node'`):

```bash
pnpm --filter @hilbras/app-core test
```

63 files, 831 tests as of the wiring.

Type-check with the bundler resolution the consumers use:

```bash
pnpm --filter @hilbras/app-core typecheck
```

`tsconfig.json` extends the **root** `tsconfig.json` for that resolution
(`tsconfig.base.json`'s `NodeNext` rejects this package's extensionless imports)
and includes `src` and `test`, so the suite is type-checked as well. The 34 errors
that used to keep `test/` out were all test-side: 25 reached into `events[0]?.task`
on the whole `AppEvent` union instead of narrowing to its `taskCreated` member (now
through a `taskCreatedOf` helper beside the imports), four assigned to the readonly
`items` of an `AgentTranscriptSnapshot` (now built in one spread expression), two
indexed `fetchMock.mock.calls[0][1]` without a guard, and three fixtures were stale —
`AppSession.status` is `busy`, `AppTask.busy` is `status` (whose union includes
`'running'`), and the `Intl.Segmenter` restore assignment needed the suppression its
first assignment already carried. What the tests assert did not change: 63 files and
831 tests still pass, and the narrowed sites resolve to the same `<taskCreated>`
event in every case — the `startedAt`/`backgroundTaskId` assertions would fail
otherwise.

`src/env.d.ts` declares `__OMNICODE_WEB_DESKTOP__`, the Vite `define` the
consuming app injects; without it the package could not be type-checked at all.
