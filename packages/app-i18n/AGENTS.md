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
  packages and the consuming app first.
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
cd packages/app-i18n
./node_modules/.bin/vue-tsc --noEmit -p tsconfig.json --module ESNext --moduleResolution bundler
```

`test/i18n.test.ts` covers the EN/ZH lookup and injection precedence, but the
package has no `vitest.config.ts`, so it is not in the root Vitest project list.
Its `pnpm test` script currently fails because Vitest resolves the root config
from this directory. Add a package config before relying on that script.
