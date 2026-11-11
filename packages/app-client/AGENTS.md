# packages/app-client — Agent Guide

## Role

Vue client layer for the Omnicode renderers. Owns composables, Pinia stores,
client-side task/session state, and the platform injection seam on top of
`@hilbras/app-core`. Source-only: `exports` points at `./src`.

Non-goals:

- no daemon transport or wire types; those live in `@hilbras/app-core/api`
- no presentational Vue SFCs; those belong in `@hilbras/app-components`
- no CLI/TUI controllers or terminal-screen behavior; `apps/omnicode-cli` owns
  those
- no product-specific analytics or native bridge implementation; inject them

## Entry points

- `.` — composables plus contracts.
- `./client` — `setOmnicodeClientDeps`, `getOmnicodeWebApi`, `t`,
  `useOmnicodeWebClient`, `useWorkspaceState`, `useTaskPoller`, `useSideChat`,
  `useSessionAdmin`, `useModelProviderState`, and attachment conversion.
- `./composables` — scroll, composer, menus, layout, terminal, upload, OAuth,
  transcript, folding, and update-status composables.
- `./stores` — Pinia singletons: sessions, notifications, models, approvals,
  files.
- `./lib` — composer submit/attachments, IME, media preview, OAuth wake, quote
  selection, and file attachment helpers.
- `./contracts` — `ProductTracker` plus typed provide/inject keys such as
  `PinScrollKey`, `ResolveAgentTaskIdKey`, `OpenInServiceKey`.
- `./icons` — the single renderer icon registry.

## Ownership and boundaries

- App bootstrap must call `setOmnicodeClientDeps()` once. `getOmnicodeWebApi()`
  is a lazy proxy; the registry lives on `globalThis` so tests survive module
  resets.
- Keep stateful product behavior in `client/` and `composables/`; keep pure
  parsing in `lib/`.
- `app-client` may import `app-core`, `app-composer`, `app-ui`, and `app-i18n`.
  It must never import `app-components`: that would create a cycle, because
  `app-components` already depends on this package.
- Do not import `apps/*`, engine internals, or the CLI/TUI.
- Provide product hooks through `contracts.ts` rather than importing a desktop
  or web app module.

## Local constraints

- `vue` is a peer dependency; `pinia` is a direct dependency. Keep store
  creation behind `clientPinia`.
- `tsconfig.json` disables `noPropertyAccessFromIndexSignature` to match the
  renderer consumers; preserve that.
- Icon imports use the virtual `~icons/*`, `?raw`, and `?worker` forms supplied
  by `@hilbras/vite-preset`. Do not add a second icon registry.
- Prefer extending an existing composable test over creating a parallel suite.

## Validation

Run a focused test from the package directory so the package Vitest config wins:

```bash
cd packages/app-client
../../node_modules/.bin/vitest run --config vitest.config.ts test/task-poller.test.ts
```

Vitest covers 50+ files under `test/`. Tests that import the icon registry or
composer mention icons currently fail with `Icon ... not found` for
`~icons/tabler/*`, `~icons/ri/*`, and some `~icons/omnicode/*` entries; that is
an icon-resolution/setup problem in this checkout, not a passing baseline.

Type-checking the package directly also needs the consumer Vite virtual-module
types, so a clean `vue-tsc` run is not available in isolation. Validate changes
through the consuming app once this package is wired there.
