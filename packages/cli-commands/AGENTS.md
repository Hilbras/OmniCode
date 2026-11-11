# packages/cli-commands — Agent Guide

## Role

Lower-level command registry for the Omnicode CLI. Owns command definitions,
name and alias normalization, enable/disable state, listing, completion, and
execution dispatch. It is plain TypeScript with no runtime framework.

Non-goals:

- no terminal rendering, key handling, or TUI screens; `@omnicode/cli-ui` and
  `apps/omnicode-cli` own those
- no SDK, engine, session, or daemon imports
- no `app-*` imports; this package is below the renderer packages
- no command implementations; callers register their own definitions

## Entry points

- `.` — `CommandRegistry`, `createCommandRegistry`, `normalizeName`, and the
  public types.
- `src/registry.ts` — registry behavior: registration, alias resolution,
  unregister, list/sort, completion, enablement, and `execute`.
- `src/types.ts` — `CommandDefinition`, `CommandContext`, `CommandResult`,
  `CommandAvailability`, and completion item shapes.

## Behavior contract

- `normalizeName()` trims whitespace, strips leading `/`, and lowercases. Names
  and aliases all pass through it.
- Duplicate names or aliases throw at registration time. Empty names throw.
- `list()` sorts by priority descending, then name ascending. Hidden and disabled
  entries are filtered unless explicitly requested.
- `execute()` never throws for an unknown, disabled, or handler-less command; it
  returns `{ ok: false, message }`. A handler exception is converted the same
  way.
- `complete()` returns slash-prefixed values. `completeArguments()` returns
  `null` when the command has no argument completer, not an empty array.
- Disabling is per command name and survives alias lookup.

## Ownership and boundaries

- Keep the package dependency-free. Node built-ins are acceptable; engine, SDK,
  and app packages are not.
- `CommandContext` is open-ended (`[key: string]: unknown`) so the CLI can pass
  session data without this package importing the engine. Keep runtime use
  defensive.
- Do not import from `apps/omnicode-cli`. The dependency direction is
  `apps/omnicode-cli` to this package.
- Do not add rendering helpers or chalk colors here; use `@omnicode/cli-ui` in
  the caller.

## Local constraints

- Emitted as ESM with `tsc` to `dist`. Use `.js` extensions on relative imports;
  `moduleResolution` is `Bundler` for authoring but the output is Node ESM.
- Public exports are declared in `src/index.ts`; add new public types there.
- Keep registry mutations synchronous. Async work belongs in `execute` handlers.
- Preserve the existing failure messages; the CLI surfaces them to users.

## Validation

```bash
pnpm --filter @omnicode/cli-commands typecheck
pnpm --filter @omnicode/cli-commands build
```

There are no unit tests yet; `pnpm --filter @omnicode/cli-commands test` is a
placeholder that only echoes `no tests yet`. If you change registry semantics,
add a Vitest file under `test/` and a package `vitest.config.ts`, or extend the
CLI-side tests that exercise the registry through `apps/omnicode-cli`. Do not
report the placeholder script as a passing test suite.
