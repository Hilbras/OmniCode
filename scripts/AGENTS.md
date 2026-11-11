# scripts/ — Agent Guide

## Role

Repository guard scripts and developer utilities. These are `.mjs` Node scripts,
run from the repository root. They enforce workspace/test wiring, kernel layering,
comment-free zones, and agent-doc consistency, and they prepare dev assets.

Non-goals:

- no application runtime code or package exports
- no business logic that belongs in a `packages/*` package
- no replacement for tests; guards catch structural mistakes only

## Guard scripts and commands

- `check-workspace-globs.mjs` — expands every `pnpm-workspace.yaml` pattern and
  every root Vitest project path, and fails when one resolves to zero packages,
  files, or testable TypeScript sources. This is what stops a suite from going
  green while running nothing. Run `pnpm check:workspace`.
- `check-kernel-layering.mjs` — parses static and dynamic
  `@hilbras/omnicode-*` imports, enforces the leaf/`rpc`/`engine`/`core`/`sdk`
  rules, forbids imports of `server`, restricts `acp` to `api`, and rejects
  import cycles. Run `pnpm check:architecture`.
- `check-no-comments.mjs` — bans comments, JSDoc, and tooling directives in
  `packages/core`, `packages/server`, and `packages/transcript` under
  `src`, `test`, and `scripts`. Outside those packages, comment only non-obvious
  constraints. Run `pnpm check:architecture`.
- `check-agents-docs.mjs` — verifies the canonical root `AGENTS.md`, its
  compatibility pointers, all referenced paths, and rejects stale `Kernel`
  directory references in every `AGENTS.md`. Run `pnpm check:agent-docs`.
- `pnpm check:guards` runs workspace + architecture + agent-docs together. This
  is the default pre-handoff guard command.

## Fix the violation, not the guard

Never weaken, skip, comment out, or bypass a guard to make a change land. That
includes widening a workspace glob, removing a Vitest project, adding an ignore
case, or deleting a layering rule. Fix the underlying import, path, config, or
comment. If a guard is genuinely wrong, change it in a separate, explicit change
with a test or a documented reason, and call out the behavior change.

## Utility scripts

- `prepare-fonts.mjs` — downloads pinned font sources, subsets/compresses them,
  verifies SHA-256 hashes, and writes into `packages/app-ui/src/assets/fonts/`.
  Do not hand-edit generated WOFF2 files; regenerate instead. Uses a lock
  directory to avoid concurrent runs.
- `fix-node-pty-perms.mjs` — restores the executable bit on pnpm's `node-pty`
  `spawn-helper` prebuilds. Idempotent and never fails install.
- `omnicode-dev.mjs` — dev wrapper that sets `OMNICODE_HOME` and strips a leading
  `--`. Its `apps/omnicode` path is stale in this tree; the current app is
  `apps/omnicode-cli`. Prefer `pnpm dev:cli` unless this script is updated.
- `check-nix-workspace.mjs` — legacy Nix workspace check that reads `flake.nix`.
  This tree has no `flake.nix` and no root script invoking it. Do not treat it as
  an active guard or add a `flake.nix` just to satisfy it.

## Local constraints

- Scripts run with Node 22 and may use `import.meta.dirname`. Keep them ESM and
  dependency-free unless a root devDependency is already present.
- Resolve paths from the repository root; do not depend on a caller's cwd beyond
  the documented `process.cwd()` usage.
- Guards must exit non-zero on violations and print the offending path. Keep
  messages actionable.
- Do not add generated files or scratch output under version control. Use
  `.tmp/` for scratch work.

## Validation

```bash
pnpm check:workspace
pnpm check:architecture
pnpm check:agent-docs
pnpm check:guards
```

Run the narrow guard while iterating, then `pnpm check:guards` before handoff.
There is no test suite for these scripts; a guard change is validated by running
it against this tree and, when changing detection logic, against a deliberate
local violation that you remove afterward.
