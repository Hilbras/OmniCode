# packages/app-markdown — Agent Guide

## Role

Chat Markdown renderer for the Omnicode web renderers. Wraps `markstream-vue`
for streaming Markdown and Shiki code blocks, and wires KaTeX, Mermaid, a local
diff renderer, file-path links, and code-block controls. Source-only: the
consumer bundles `Markdown.vue` and its workers.

Non-goals:

- no daemon transport, session state, or composer logic
- no general-purpose documentation renderer; this is tuned for chat turns
- no CLI/TUI Markdown output; the terminal renderer lives in the CLI app
- no app shell, theme switcher, or image authorization policy

## Entry points

- `.` — `Markdown`, an async component with a `Markdown.vue` loading placeholder.
- `./lib/filePathLinks` — file-path link detection used by hosts.
- `src/lib/` — code wrapping, code selection, clipboard, frontmatter, inline
  math, streaming link guard, table width, worker, and performance helpers.
  Unit tests live beside these modules as `*.test.ts`.

## Consumer requirements

The host app must:

1. install the locked `markstream-vue`, `stream-markdown`, Shiki, KaTeX, and
   Mermaid versions; the renderer enables KaTeX/Mermaid at module scope
2. set `worker: { format: 'es' }` so markstream's module workers and Mermaid's
   dynamic imports work
3. provide `ResolveImageKey` from `@hilbras/app-core/contracts` to authorize and
   rewrite local image sources
4. set `<html data-color-scheme>`; dark mode comes from `useIsDark()`

## Ownership and boundaries

- May import `app-core` contracts and helpers and `app-client` icons. Do not
  import `app-components`, `app-client` stores, or `apps/*`.
- `Markdown.vue` owns renderer wiring. Parsing and decoration helpers belong in
  `src/lib/` with a colocated test.
- Do not move image fetching or auth into this package. The host supplies a
  resolver; leave local images untouched when it is absent.
- Do not import `markstream-vue` internals that are not part of its public
  entry; the package version is pinned deliberately.

## Local constraints

- Keep the async wrapper. Importing `Markdown.vue` eagerly would pull workers
  into the host's initial bundle.
- `vue` and `vue-i18n` are peers. Shiki is a peer by way of the consumer.
- The diff renderer is local; do not replace it with a second Markdown pipeline.
- Streaming helpers must tolerate partial Markdown. If a change assumes complete
  input, gate it behind `streaming`.
- Colocated tests are intentional here; keep new parser/helper tests beside the
  module rather than creating `test/`.

## Validation

```bash
cd packages/app-markdown
../../node_modules/.bin/vitest run --config vitest.config.ts src/lib/frontmatter.test.ts
```

The package config includes `src/**/*.test.ts` and supplies the virtual icons
used by code-wrap helpers.

Type-check and tests are wired and green:

```bash
pnpm --filter @hilbras/app-markdown typecheck
pnpm --filter @hilbras/app-markdown test
```

Its `tsconfig.json` extends the root config with DOM libs and lists the sibling
declaration files (`../vite-preset/src/{icons,worker}.d.ts`,
`../app-core/src/env.d.ts`, `../app-composer/src/env.d.ts`), because this package's
program compiles the `app-*` sources it imports and those declarations live beside
them rather than in an ambient package. There is no `test/` directory: all eight
suites are co-located with their modules under `src/lib/`, so `include: ["src"]`
type-checks them as well.

The suite was dark until recently: no `@iconify-json/*` collection was installed, so
three of its eight files died in transform with
`Icon `tabler/adjustments-horizontal` not found`. `@iconify-json/{ri,tabler}` are
devDependencies here now, and `test` runs 8 files / 277 tests green.
