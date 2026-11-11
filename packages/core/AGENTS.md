# packages/core — Agent Guide

Read the root `AGENTS.md` first. `core` may import `base` and `engine` only.

## Role and non-goals

Compatibility facade: a single package that re-exports kernel APIs so existing
consumers keep importing `@hilbras/omnicode-core`.

`core` is **not the DI engine** and owns no implementation. The DI container,
scopes, fibers, and logging live in `base`; the agent loop, tools, permissions,
sessions, and provider compatibility boundary live in `engine`.

Non-goals: no services, no wrappers, no new types, no state, no adapters, and no
side effects beyond re-exporting.

## Entry point

- `src/index.ts` is the only source file.
- `package.json` exports `.` and `./package.json` only. There are no subpaths.
- Current barrel: `export * from '@hilbras/omnicode-engine';`
- `package.json` declares `@hilbras/omnicode-base` and
  `@hilbras/omnicode-engine`; `tsconfig.json` also includes
  `../engine/src/env.d.ts` and `../base/src`.

Root `AGENTS.md` defines `core` as a facade over `base` + `engine`. Today the
barrel re-exports only `engine`; base is a declared dependency but its symbols
are not automatically re-exported. Do not assume a base symbol is available from
`@hilbras/omnicode-core` unless it is also exported by `engine` or explicitly
added here.

## Layering rules

- `core` may import `base` and `engine` only. Do not import `llm`, `auth`,
  `Kaos`, `transcript`, `SDK`, `API`, `server`, or `acp` directly.
- Never create an implementation layer to avoid adding one line of re-export.
  Fix ownership in the source package instead.
- No import cycles. `engine` must not depend on `core`, and `base` must not
  depend on either.

## Local constraints

- `scripts/check-no-comments.mjs` scans `packages/core/src`, `test`, and
  `scripts` and bans comments, JSDoc, and lint suppressions. Add no comments
  here, including rationale comments above exports.
- Keep `src/index.ts` a re-export barrel. No functions, constants, classes, or
  type aliases belong in this package.
- Prefer an explicit named re-export when adding a missing base surface. Avoid
  new `export *` layers unless the owning package already presents a stable
  barrel.
- Every added export is a public API change. Check downstream imports (ACP, API,
  tests, apps) before widening the facade.
- Do not add path aliases or a second tsconfig target; the existing tsconfig
  intentionally includes engine env declarations and base sources.

## Tests

There are no package-local tests: no `test/` directory, no `vitest.config.ts`,
and no `test` script. Do not invent a test command or claim the facade is
covered by its own suite.

```bash
pnpm --filter @hilbras/omnicode-core typecheck
```

Downstream tests import `@hilbras/omnicode-core`, including
`packages/ACP/test/*` and `packages/API/test/e2e/invalid-input-matrix.test.ts`.
Changes to the barrel should be validated through those packages and with
`pnpm check:architecture`.

## Local traps

- The name "core" is historical; it does not mean the DI kernel. Use
  `@hilbras/omnicode-base/di/*` for container APIs.
- The barrel's current engine-only export is narrower than the package
  description. Do not document base re-exports as already present.
- There are no deep imports. A consumer needing
  `@hilbras/omnicode-core/something` is using a path that does not exist.
- Because `export *` is used, a new engine export becomes a core export
  automatically. Watch for name collisions and accidental API growth.
- The tsconfig includes source outside this package; typecheck failures may
  originate in `base` or `engine`.

## Belongs here vs neighbours

- DI/scopes/fibers/logging: `base`.
- Agent loop, tools, permissions, sessions, MCP: `engine`.
- LLM provider wires: `llm`.
- Public application surface: `SDK`; connection handling: `API`.
- Behavior changes should land in the owning package, not in `core`.
