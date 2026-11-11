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
- There is no `tsconfig.json` in this package. Consumers type-check the source
  with their bundler resolution; do not invent a standalone NodeNext config.

## Validation

Only `test/openInTarget.test.ts` exists, and there is no package
`vitest.config.ts` or `test` script, so the suite is not wired into the root
Vitest projects. Running `vitest` here resolves the root config and fails.
Treat component behavior as covered by the consuming app's tests and add a
focused test when extracting new pure logic into `src/lib/` or `support.ts`.

Until test wiring exists, validate by type-checking and building the consuming
app after the component is imported there. Do not report this package's test
script as green; it has none.
