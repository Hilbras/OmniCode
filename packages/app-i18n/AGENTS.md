# packages/app-i18n — Agent Guide

## Role

Shared internationalization for the Omnicode web renderers. Owns the Vue I18n
factory, typed message bundles for English and Chinese, locale detection, and the
`OmnicodeI18nKey` injection used by lower-level packages. Source-only.

Non-goals:

- no product components or screen layout
- no daemon/client state, router, or store logic
- no CLI/TUI locale handling; `apps/omnicode-cli` owns terminal copy
- no per-app message overrides inside this package; hosts may add their own scope

## Entry points

- `.` — `createOmnicodeI18n`, `OmnicodeI18nKey`, `useOmnicodeI18n`, `messages`,
  and the `OmnicodeI18n` type.
- `src/locales/en.ts` and `src/locales/zh.ts` — aggregate the per-area bundles
  under `src/locales/en/` and `src/locales/zh/`.
- `src/OmnicodeI18nKey.ts` — resolution order: app-provided key, then the global
  Vue I18n composer, then an identity translator that returns the key.

## Message rules

- Every user-visible key must exist in both `en` and `zh`. A missing Chinese key
  is a regression, not an acceptable fallback.
- Keep keys grouped by the same domain names on both sides (`common`, `app`,
  `sidebar`, `admin`, `workspace`, `conversation`, `status`, `composer`, `login`,
  `providers`, `model`, `sessions`, `approval`, `question`, `tasks`, `thinking`,
  `filePreview`, `settings`, `commands`).
- Do not use `|` inside a message unless you intend Vue I18n plural syntax;
  literal pipes must be escaped.
- Do not rename or delete a key that is still referenced. Search the shared
  packages and the consuming app first. `test/i18n.test.ts` enforces this: it scans
  the `src/` of every workspace package that depends on this one, collects the
  literal keys passed to `t('…')`, and fails when a key resolves in neither bundle,
  when its first segment is not a namespace this package defines, or when the scan
  finds implausibly few keys (a gate that silently scans nothing is worse than no
  gate). Renaming a key in both bundles therefore fails until the call sites move
  with it.
- Locale detection persists to the `omnicode-locale` storage key. Keep it in sync
  with the host app's `STORAGE_KEYS.locale`; this package deliberately does not
  import the host.

## Ownership and boundaries

- This is a leaf among the app packages: it must not import `app-core`,
  `app-client`, `app-components`, `app-composer`, `app-markdown`, `app-ui`, or
  `apps/*`.
- Lower-level packages inject `OmnicodeI18nKey` or accept a `Translator`
  function; they must not import the global Vue I18n instance.
- `app-core` exposes the `Translator` contract. Reuse that shape for injected
  translators instead of inventing another.

## Local constraints

- `vue` is a peer dependency; `vue-i18n` is a direct dependency.
- Keep the composition-mode instance (`legacy: false`). The `OmnicodeI18n` type
  depends on that and exists so `.global` exposes a settable locale.
- `useOmnicodeI18n()` must never throw when no i18n is installed; return the
  identity translator.
- Prefer adding keys to an existing domain file over creating a new top-level
  namespace.

## Validation

Type-check with the bundler resolution the consumers use:

```bash
pnpm --filter @hilbras/app-i18n typecheck
```

`tsconfig.json` extends the **root** `tsconfig.json` (not `tsconfig.base.json`, whose
`NodeNext` resolution rejects this package's extensionless imports) and covers
`src` and `test`. `vue-tsc` is installed, but plain `tsc` is enough here: the package
ships no `.vue` files.

`vitest.config.ts` registers the package as the `app-i18n` project
(`include: ['test/**/*.test.ts']`), and the root config picks it up through the
`packages/*/vitest.config.ts` glob, so `pnpm --filter @hilbras/app-i18n test` and
the root run both execute `test/i18n.test.ts`.

That suite enforces the message rules above mechanically: every key must exist in
both `en` and `zh`; no key may be blank in **both** locales; and every literal key
referenced by a consuming package must resolve (see the rename rule above). An
individual locale may be empty on purpose — English leaves
`sidebar.archiveToastTail` and `tools.activity.liveDonePrefix` empty where Chinese
carries the suffix — so do not "fix" those into English text.
