# packages/app-ui — Agent Guide

## Role

Presentational design system for the Omnicode web renderers: tokens, base
components, icons, dialog/menu stacks, and the IME composition helper.
Source-only: `exports` points at `./src`, and consumers transpile it.

Non-goals:

- no product components (chat turns, settings panels, session rows). Those belong
  in `@hilbras/app-components`.
- no stores, daemon client, routing, or app bootstrap
- no CLI/TUI rendering; terminal primitives live in `packages/tui` and the CLI app
- no concrete icon collection or theme switcher; the consumer provides both

## Entry points

- `.` — `Button`, `Input`, `Dialog`, `Menu`, `Select`, `Toast`, `Icon`, and the
  rest of the base component set.
- `./style.css` — design tokens; the consumer imports it once at app start.
- `./fonts.css` — bundled fonts (generated assets also live under
  `src/assets/fonts/`).
- `IconResolverKey`, `SIZE_PX`, and `IconSize` — the icon bridge contract.
- `openDialogCount` / `openSheetCount` and the menu-stack helpers — small UI
  infrastructure exported alongside components.
- `useImeComposition()` — reusable IME composition state.

## Contract with consumers

- The consumer must register the `omnicode` unplugin-icons collection and provide
  `IconResolverKey` mapping a name to a component. `<Icon>` renders empty for an
  unknown name; it must not throw.
- Dark/light mode comes from `<html data-color-scheme>`; this package does not
  own the attribute or persist a preference.
- `openDialogCount` / `openMenuCount` are reactive counters. Consumers use them
  to yield root Esc handling while a Dialog or Menu is open; do not duplicate
  that state in app code.
- Tokens live in `style.css`. Component styles should consume tokens rather than
  hard-coding product colors.

## Ownership and boundaries

- This is a lower-level app package. It must not import `app-client`,
  `app-components`, `app-composer`, `app-markdown`, or `apps/*`.
- It currently depends only on `app-i18n`. Keep it that way unless a new
  dependency is genuinely presentational.
- Do not add product copy, analytics, network calls, or persistence here.
- Do not make `<Icon>` own a registry; the resolver is injected by the consumer.

## Local constraints

- `vue` is a peer dependency. Components must work in both web and desktop
  renderers without importing either app.
- Keep the props/emits surface small and reusable; product-specific variants
  belong in `app-components`.
- `Dialog` and `Menu` must update the shared stacks when `open` changes, and the
  release functions must stay idempotent.
- `prepare-fonts.mjs` writes into `src/assets/fonts/`; do not hand-edit generated
  WOFF2 files. See `scripts/AGENTS.md`.

## Validation

Type-check, which currently passes with the consumers' bundler resolution:

```bash
cd packages/app-ui
./node_modules/.bin/vue-tsc --noEmit -p tsconfig.json --module ESNext --moduleResolution bundler
```

`test/` has three files (`menuStack`, `selectMenu`, `useImeComposition`), but the
package has no `vitest.config.ts` and no `test` script, so they are not in the
root Vitest projects. Running Vitest from this directory resolves the root config
and fails. Add a package config before claiming the suite runs.
