# packages/vite-preset — Agent Guide

## Role

Shared Vite configuration for the Vue renderer packages. Wraps Vue SFC support,
the `omnicode` icon collection, raw-icon virtual imports, build-info defines, and
ES-module worker output.

Non-goals:

- no app runtime code, components, stores, or styles
- no product aliases or path resolution; consumers pass `root` and `iconsDir`
- no React or server build configuration
- no `app-*` runtime imports

## Entry points

- `.` — `omnicodeRendererViteConfig(options)` and
  `OmnicodeRendererViteOptions`.
- `./icons` — `declare module '~icons/*?raw'` so raw SVG imports type as
  `string` instead of a Vue component.
- `./worker` — `declare module '*?worker&type=module'` for ES module workers.
- `src/index.ts` — the preset implementation and the raw-icon plugin.

## What the preset guarantees

- `plugins` include `@vitejs/plugin-vue`, `unplugin-icons`, and the
  `omnicode-raw-icons` pre-plugin that resolves `~icons/*?raw` through the icon
  plugin's loader.
- `customCollections.omnicode` is loaded from the caller's `iconsDir`.
- `worker.format` is `'es'`; Markdown and Mermaid workers depend on this.
- `build.target` defaults to `es2022` and is overridable.
- `define` supplies `__OMNICODE_BUILD_TIME__`, `__OMNICODE_COMMIT_SHA__`, and
  `__OMNICODE_BRANCH__`, merged with caller defines.
- The preset does not add aliases. Callers own their own `resolve.alias`.

## Ownership and boundaries

- Vite, `@vitejs/plugin-vue`, and `unplugin-icons` are peer dependencies; keep
  the peer ranges aligned with the consumers.
- This package is tooling. Do not import `app-core`, `app-client`,
  `app-components`, `app-composer`, `app-markdown`, `app-ui`, `app-i18n`, or
  `apps/*`.
- The icon registry remains in `app-client`; this preset only teaches Vite how to
  load it.
- Do not add app-specific aliases, environment defines, or proxy rules. Pass them
  through the caller's Vite config instead.

## Local constraints

- `imports` maps `#/*` to `src/*.ts`; the test imports `#/index`.
- `resolveCommitSha()` and `resolveBranch()` must never fail a build. Keep the
  empty-string fallback for exported source trees and detached CI checkouts.
- Keep the raw-icon virtual id prefix and the `?raw` detection in sync; a change
  to one without the other breaks icon string imports.
- Do not add a package build step; `exports` points at `src`.

## Validation

The test file exists at `test/preset.test.ts` and covers worker format, target,
defines, the icon plugin, and raw-icon loading. There is no package
`vitest.config.ts` or `test` script, so the suite is not wired into the root
Vitest projects; running `vitest` from this directory resolves the root config
and fails. Add a package config before claiming it runs.

Until then, validate by importing the preset in a consumer's Vite config and
running that consumer's dev/build, and run `pnpm check:workspace` to confirm the
root project globs still resolve.
