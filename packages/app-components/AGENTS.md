# packages/app-components — Agent Guide

## Role

Product-facing Vue components shared by the Omnicode web renderers: chat turns,
tool cards, dialogs, settings panels, session rows, admin tables, and media
surfaces. Source-only: `exports` points at `./src`, so the consumer's bundler
transpiles the SFCs.

Non-goals:

- no new stores, daemon transport, or client-state machines; those belong in
  `@hilbras/app-client` or `@hilbras/app-core`
- no CLI/TUI components; `apps/omnicode-cli` owns terminal behavior
- no app-specific analytics, native bridge, or router wiring
- no direct `apps/*` imports

## Entry points

- `.` — the component barrel. Heavy components use `defineAsyncComponent`; keep
  that pattern so consumers can code-split them.
- `./support` — pure helpers only, with no `.vue` imports. Use this from Node
  tests or non-Vite consumers so xterm, Rive, and markstream workers are not
  pulled in.
- `src/chat/` — transcript rendering: turns, activity runs, tool calls, status,
  diagnostics, diffs, and side chat.
- `src/chat/tool-calls/` — per-tool renderers plus `toolArgs`,
  `askUserToolParse`, and `toolRegistry`.
- `src/dialogs/`, `src/admin/`, `src/settings/`, `src/mobile/` — focused surfaces.
- `src/lib/` — `toolMeta`, `activitySummary`, and `openInTarget`.

## Ownership and boundaries

- Depend on `app-core`, `app-client`, `app-composer`, `app-i18n`, `app-markdown`,
  and `app-ui`.
- Do not create an import cycle: lower-level packages (`app-core`, `app-client`,
  `app-composer`, `app-ui`, `app-markdown`, `app-i18n`) must never import
  `app-components`.
- Components receive state and callbacks through props and typed injection keys
  from `@hilbras/app-client/contracts`; they must not reach for app globals.
- Pure parsing, formatting, and classification belongs in `src/lib/` or a
  `support` module, not inside a component's setup block.
- Any new exported `.vue` file must also be added to `src/index.ts`; any pure
  module used by tests must be added to both `src/index.ts` and `src/support.ts`.

## Local constraints

- `sideEffects: false`; keep module scope free of side effects.
- `vue` and `shiki` are peers. Import design tokens from `@hilbras/app-ui`, not
  from an app stylesheet.
- Use `useOmnicodeI18n()`/`t()` rather than hard-coded user-facing English.
- Async components should keep the existing import shape; do not eagerly import
  xterm, Rive, or Markdown workers from the barrel.
- `tsconfig.json` extends the **root** config — not a standalone NodeNext one; the
  base's `NodeNext` resolution rejects this package's extensionless imports — and lists
  the sibling declaration files it needs (`../vite-preset/src/{icons,worker}.d.ts`,
  `../app-core/src/env.d.ts`, `../app-composer/src/env.d.ts`,
  `../app-client/src/env.d.ts`, `../app-markdown/src/env.d.ts`) because its program
  compiles the `app-*` sources it imports. `src/env.d.ts` declares the `?url` and `*.css`
  module shapes the Rive, xterm, and Markdown assets rely on.

## Validation

`test/openInTarget.test.ts` (7 tests) is wired into the root Vitest graph through
this package's `vitest.config.ts` (project `app-components`, `environment: 'node'`):

```bash
pnpm --filter @hilbras/app-components test
```

That suite installs a fake `localStorage` for the duration of each test, because
the node environment has none — keep that pattern for storage-touching logic
rather than reaching for a DOM environment. Component behavior is otherwise
covered by the consuming app's tests; add a focused test when extracting new pure
logic into `src/lib/` or `support.ts`.

Type-check is wired and green:

```bash
pnpm --filter @hilbras/app-components typecheck
```

`vue-tsc` is a devDependency, so the `.vue` sources are checked rather than skipped by
plain `tsc`; the first run reports **0 diagnostics**. Component behavior is still covered
by the consuming app's tests — this only proves the source type-checks.
