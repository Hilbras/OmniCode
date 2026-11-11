# packages/cli-ui — Agent Guide

## Role

Lower-level terminal styling for the Omnicode CLI. Owns the `ColorPalette`
tokens, dark/light palettes, and the `Theme` class plus its global singleton.

Non-goals:

- no React/Ink/Vue components, layout, or key handling
- no command registry; that is `@omnicode/cli-commands`
- no CLI app state, session logic, or SDK/engine imports
- no `app-*` imports; this package sits below the renderer packages

## Entry points

- `.` — re-exports `theme/colors` and `theme/theme`.
- `./theme/colors` — `ColorPalette`, `darkColors`, `lightColors`,
  `ResolvedTheme`, and `getBuiltInPalette`.
- `./theme/theme` — `Theme`, `ColorToken`, and the `currentTheme` singleton.
- Consumers also import the subpaths directly:
  `@omnicode/cli-ui/theme/colors` and `@omnicode/cli-ui/theme/theme`.

## Behavior contract

- `currentTheme` is a module-level singleton initialized with the dark palette.
  Switching themes calls `setPalette`; do not recreate the singleton, or
  already-rendered transcript rows will keep the old colors.
- Components call helpers at render time (`currentTheme.fg('primary', text)`),
  not at module scope, so a palette switch affects the next frame.
- Every palette token is semantic. Keep dark and light values in sync for the
  same token and preserve WCAG AA contrast in the light palette.
- `warning` must remain distinguishable from `primary`; the footer renders both
  permission badges next to each other.
- Keep `roleUser` and `shellMode` as their own hues; they are not aliases for
  `primary`.

## Ownership and boundaries

- `chalk` is the only runtime dependency. Do not add a second styling library.
- Colors belong here. The CLI app may define app-specific theme variants, but it
  should compose these tokens rather than copy hex values.
- Do not import from `apps/omnicode-cli` or any `packages/app-*` package.
- Do not put user-facing strings here; this package formats text, it does not
  own copy.

## Local constraints

- Relative imports use `.js` extensions because the package emits Node ESM.
- `src/index.ts` is the public barrel; subpaths in `package.json` are explicit.
  Add a new public entry only when a consumer needs it.
- Token names are API. Renaming one requires updating every CLI component that
  calls `fg`/`bg`/`color`.
- Keep the palette type exhaustive so adding a token fails type-check until both
  palettes implement it.

## Validation

```bash
pnpm --filter @omnicode/cli-ui typecheck
pnpm --filter @omnicode/cli-ui build
```

There are no unit tests yet; `pnpm --filter @omnicode/cli-ui test` is a
placeholder that echoes `no tests yet`. Verify palette or theme changes through
the CLI's existing theme/rendering tests under `apps/omnicode-cli/test/tui/`.
Do not report the placeholder script as a passing suite.
