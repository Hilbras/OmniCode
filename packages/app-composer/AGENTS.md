# packages/app-composer — Agent Guide

## Role

Rich-text composer package for the Omnicode renderers and CLI surfaces. Owns the
plain-text ↔ rich-text projection, ProseMirror editor setup, mention/skill/quote
pills, attachment metadata, and the wire codec used between the editor and the
host. Source-only: `exports` points at `./src`.

Non-goals:

- no network calls, session submission, or draft persistence policy; the host app
  owns submit and storage
- no transcript rendering or message layout; that belongs in `app-components`
- no CLI/TUI controller or terminal rendering
- no product analytics or auth

## Entry points

- `.` — re-exports `./wire`, `./editor`, and `./mention-dom`.
- `./wire` — pure codec: serialization, parsing, offsets, and message-side
  classification. No DOM or ProseMirror dependency.
- `./text` — `composerTextDoc` and text projection helpers.
- `./editor` — ProseMirror editor surface, `TextFieldLike`, state cache, and
  `ComposerText.vue`.
- `./editorDoc` — editor document conversion.
- `./mention-dom` — mention pills, selection sync, tooltips, and DOM helpers.
- `./attachmentMeta`, `./attachmentTarget`, `./skillActivationEdit`,
  `./mentionTooltip` — narrow public helpers for hosts.

## The wire format is a contract

`docs/wire-format.md` in this package documents the text format exchanged
between the composer and message content. Treat it as an API:

- new rich-text content types join the wire codec plus one DOM module each
- keep parser and serializer changes in the same change
- update `docs/wire-format.md` when the grammar or marker set changes
- do not silently change how existing markers round-trip

## Ownership and boundaries

- Depend on `app-core` for shared helpers. Do not depend on `app-client`,
  `app-components`, `app-markdown`, `app-ui`, or `apps/*`; those sit above or
  beside this package.
- Keep `wire.ts` pure. If it needs a DOM type, the change belongs in
  `mention-dom.ts` or `editor.ts`.
- `app-client` legitimately depends on this package. Do not import back from
  `app-client`; pass host behavior through arguments or editor callbacks.
- ProseMirror transaction and selection logic stays in the editor modules; do not
  duplicate it in Vue components.

## Local constraints

- ProseMirror packages are direct dependencies; keep imports explicit rather than
  creating a barrel alias.
- `vue` is a peer dependency. `app-client` is a dev-only dependency used for
  tests and icon resolution.
- Tests use the `omnicode` custom icon collection from `app-client`; keep
  `vitest.config.ts` pointed at that collection.
- Avoid adding a second text model. The plain-text projection in `wire.ts` is the
  source of truth for what the host receives.

## Validation

```bash
cd packages/app-composer
../../node_modules/.bin/vitest run --config vitest.config.ts test/mention-match.test.ts
```

The package has 19 Vitest files under `test/` and its config resolves the virtual
icons used by `icons.ts`. Run a focused file while iterating, then the whole
suite for wire/editor changes. There is no package `typecheck` script; use the
consumer's bundler resolution if you need a type pass.
