# packages/migration — Agent Guide

Read the root `AGENTS.md` first. This package is a one-way importer for legacy
omnicode-cli data; the CLI owns prompts and rendering.

## 1. Role and non-goals

`@hilbras/omnicode-migration` detects a legacy home, builds a `MigrationPlan`,
and imports config, MCP, user history, skills, plans, and sessions.

- It does not decide whether to prompt, render the TUI screen, or parse CLI
  flags; `apps/omnicode-cli/src/migration/` does that.
- It does not migrate OAuth credentials; `/login` re-establishes auth.
- It does not run the agent, import provider wires, or export back to legacy.

The source is caller-supplied. The CLI defaults to `~/.omnicode-v-legacy`
(`apps/omnicode-cli/src/migration/legacy-source.ts`) or `OMNICODE_V_SHARE_DIR`;
the target is the current Omnicode home. The package description's old-path
wording is stale.

## 2. Public entry points and important modules

- `src/index.ts` — `detectMigration`, `runMigration`, `shouldSuppressMigration`,
  `resolveMigrationScope`, `defaultPlansSourceDir`, and `types.ts` re-exports.
- `src/detect.ts` — scans legacy paths and builds `MigrationPlan` (counts,
  workdirs, sessions, failures, conflicts).
- `src/run-migration.ts` — orchestrates steps and writes report/errors/marker.
- `src/paths.ts` — source and target paths, sibling conflict targets, markers.
  Add new paths here, never inline joins.
- `src/steps/{config,mcp,user-history,skills,plans}.ts` — non-session imports.
- `src/sessions/` — `source` (v1 read/normalize), `classify`, `migrate-one`,
  `translator`, `state-writer`, `wire-writer`, `turn-structure`,
  `tool-call-display`, `close-tool-calls`, `subagents`, `workdir-bucket`.
- `src/omnicode-cli-schema.ts` — zod schemas for legacy JSON shapes.
- `src/marker.ts`, `src/report.ts`, `src/migration-errors-log.ts` and
  `src/atomic-write.ts` — idempotency, reporting, durable writes.
- `src/import/` — the separate foreign-tool import surface (T5.1); see section 8.
  It is not part of `MigrationPlan` or `runMigration`.

## 3. Boundary rules

- Only `apps/omnicode-cli` consumes this package. Do not import it from server,
  API, SDK, ACP, or the engine.
- Keep the decision logic (`prompt.ts`) free of rendering and process I/O.
- Session writers must produce the same state/wire shape the engine replays;
  when engine event/state schemas change, update the translator and fixtures
  together.
- Do not copy `credentials/` contents, token files, or other secrets.
- Keep writes atomic (`atomic-write.ts`) and idempotent; reruns must be safe.
- `test/fixtures/golden/` is a compatibility tripwire. Update it only with an
  intentional translation change, not to make a failing test green.

## 4. Contract and schema rules

- Legacy inputs are validated by `omnicode-cli-schema.ts`; malformed sources
  become plan failures, not crashes.
- Target config is TOML (`config.toml`, `tui.toml`); MCP is `mcp.json`. Target
  session index is `session_index.jsonl`.
- Conflicts do not overwrite user content: write the sibling
  `*.migrated-from-omnicode-cli.*` files defined in `paths.ts`.
- Session ids, workdir buckets, and subagent labels are derived. Preserve v1
  `labels` semantics and do not invent parent ids.
- Markers (`.migrated-to-omnicode`, `.skip-migration-from-omnicode-cli`) gate
  re-prompting. An explicit `migrate` run bypasses suppression in the CLI, not
  here.

## 5. Tests

Tests live in `packages/migration/test/`, mirroring `src/`, with fixtures under
`test/fixtures/`. Golden, integration, and resume tests are the real contract:

```bash
pnpm --filter @hilbras/omnicode-migration typecheck
pnpm --filter @hilbras/omnicode-migration test
pnpm --filter @hilbras/omnicode-migration test -- test/detect.test.ts
pnpm --filter @hilbras/omnicode-migration exec vitest run test/golden.test.ts
```

Coverage gaps: `src/steps/plans.ts` and `src/source-config.ts` have no dedicated
test file; `golden`/`integration` cover them indirectly. Add a direct case when
changing those files.

## 6. Local traps and where new logic belongs

- New migrated artifact: `paths.ts` → `detect.ts` plan fields → `steps/<name>.ts`
  → `run-migration.ts` ordering → `types.ts`/`report.ts` → tests + fixture.
- New session shape: `sessions/translator.ts` + `state-writer.ts`/`wire-writer.ts`
  → `migrate-one.ts` → golden test. Keep v1 wire migration ordering intact.
- Non-local kaos buckets, placeholder/empty sessions, and missing workdirs are
  skipped by design; record the reason in the summary instead of failing the run.
- Detection failure must never block CLI startup (`detect-pending.ts` swallows
  it); run-level failures belong in `migration-errors.log`.
- Writes can conflict with a concurrently running app. Preserve the atomic-write
  and conflict-sibling strategy; do not switch to plain overwrite.

## 7. What must not be added here

- TUI screens, prompts, argument parsing, or telemetry.
- Credential/token migration or secret copying.
- Engine, server, API, SDK, or ACP imports.
- Reverse migration or a live dual-write path.
- Hand-edited golden fixtures used to mask a translation regression.

## 8. Foreign-tool importers (T5.1)

`src/import/` imports Claude Code, OpenAI Codex, and Qwen Code layouts beside the
legacy migration. It reads caller-supplied directories only: no network, no
writes, no `MigrationPlan` involvement.

- `schema.ts` — the unified zod contract. `ImportedSource` is
  `claude-code | codex | qwen`. `ImportBundle` carries `source`, `root`
  (absolute), `agents`, `skills`, `config`, and `warnings`; every entry has a
  `sourcePath` relative to `root`. Names and all text reject NUL bytes and empty
  names. `ImportedConfig.settings` is a flattened record of scalar values
  (`a.b` keys); MCP servers are separate and carry their own `sourcePath`.
- `sources/{claude-code,codex,qwen}.ts` — one adapter each:
  `detect(root)` / `read(root)`. Layouts: Claude `agents/*.md` (YAML
  frontmatter), `skills/<name>/SKILL.md`, `settings.json`, `CLAUDE.md`; Codex
  `config.toml`, `AGENTS.md`, `prompts/*.md`, `skills/`; Qwen `settings.json`,
  `QWEN.md`, `commands/*.{toml,md}`, `skills/`. `CLAUDE.md`, `AGENTS.md`, and
  `QWEN.md` become agents whose `instructions` are the file body; prompt and
  command files become agents/skills. Unknown or malformed files become coded
  warnings (`malformed-json`, `malformed-toml`, `malformed-frontmatter`,
  `invalid-entry`, `unrecognized-entry`, `missing-name`, `duplicate-name`,
  `unreadable-file`); only a structurally invalid bundle throws.
- Frontmatter is parsed locally (`frontmatter.ts`), not with a YAML dependency.
- `archive.ts` — `extractArchive({ kind?, archivePath, destDir })` for `zip`,
  `tar`, and `tar.gz` (`yauzl` + `tar`; `yazl` is test-only). It is deliberately
  stricter than `packages/engine/src/app/plugin/archive.ts`:
  - entry validation completes before `destDir` is created; any security
    violation throws `ArchiveError` with a stable `code`;
  - absolute paths, drive/UNC paths, every `..` segment after backslash
    normalisation, empty names, and NUL bytes are rejected;
  - symlink, hardlink, device, and FIFO entries are rejected, never resolved;
  - each destination is checked lexically (`path.resolve` containment) and after
    `mkdir` by `realpath`; files are written with `O_NOFOLLOW` and pre-existing
    symlinks are refused;
  - `MAX_ARCHIVE_ENTRIES` (10 000) and `MAX_ENTRY_BYTES` (256 MiB) are exported
    and enforced from archive metadata before any write;
  - directories use default permissions and archive mode bits are never
    applied (`chmod: false` for tar).
- Tests: `test/import/archive.test.ts` (hostile archives built with `yazl` and a
  raw tar header writer; each case asserts the error code and that the parent of
  `destDir` stayed empty), `test/import/sources/` (fixtures under
  `test/import/fixtures/<source>/`), and `test/import/import.e2e.test.ts`
  (fixture → zip/tar/tar.gz → extract → adapter, compared to the direct read).

