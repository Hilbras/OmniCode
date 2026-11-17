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
- `check-command-paths.mjs` — every workspace `package.json` script and every
  `scripts/preflight.mjs` step names the test path it runs, and a moved test leaves
  that path pointing at nothing. Preflight asked the engine for
  `test/os/backends/node-local/tools/bash.test.ts` long after the test moved to
  `features-integration`, so it failed with `No test files found` instead of testing
  anything. The guard resolves each `--filter` to its package directory and fails when
  a named path is not there; the bite was proven by restoring that exact stale filter
  (`preflight step "test:bash-sandbox": names ... which is not in packages/engine`).
  It checks 40 packages and 26 distinct test paths today, costs a fraction of a
  second, and is part of `pnpm check:guards`. Run `pnpm check:command-paths`.
- `check-test-reachability.mjs` — the reverse direction of the above: every test
  file in the workspace must be run by something. Reachable means its workspace
  package has a `test` script (`pnpm test` is `turbo run test`; nothing invokes a root
  `vitest run`) **and** that package's `vitest.config.*` matches the file. Failing
  either half is silent otherwise: a `test/` directory with no config executes
  nothing (862 tests across three `app-*` packages), and a config with no `test`
  script executes nothing either (955 tests across `SDK`, `auth`, `Kaos`).
  `check-workspace-globs.mjs` cannot see either, because nothing declares those
  suites. Workspace packages come from `pnpm-workspace.yaml` rather than the nearest
  `package.json`, so nested helper manifests
  (`packages/engine/src/human/package.json`) do not steal ownership of the tests
  engine's own script runs. Files known to execute nowhere sit in a shrink-only list
  with a reason each, matched by path or prefix; an entry that matches nothing fails
  the guard, so a fix cannot leave a stale exception. Costs a few seconds. Run
  `pnpm check:tests`.
- `check-typecheck-coverage.mjs` — the same class of hole one gate over: every
  workspace package with `src/` must have a `typecheck` script, because
  `pnpm typecheck` is `turbo run typecheck` and runs only the packages that declare
  the script. Nothing else type-checks a package either — the consumer apps run plain
  `tsc` (not `vue-tsc`) over their own `src`, which cannot check `.vue` sources, and
  the bundler that transpiles those sources does not type-check at all — so a package
  without the script can carry thousands of diagnostics no command reports, which is
  where `app-client`, `app-composer`, and `app-components` sat. Those three are wired now
  and the exception list is **empty** — every package with `src/` type-checks, and
  `pnpm check:typecheck` reports `39 wired, 0 documented`. The list is still shrink-only
  and still exists for a future decision: wiring a package without removing its entry
  fails the guard, and so does an exception whose directory vanished. Costs well under a
  second. Run `pnpm check:typecheck`.
- `check-deps-consistency.mjs` — four dependency rules a lockfile cannot enforce on its
  own: every workspace package that declares a dependency has a `pnpm-lock.yaml`
  importer (the absence is exactly what `ERR_PNPM_OUTDATED_LOCKFILE` reports at install
  time), workspace dependencies use the `workspace:` protocol, a declared workspace
  dependency is imported somewhere inside the package, and one external package is not
  declared with two different specifiers across manifests. Deliberate divergences live
  in `deps-consistency-allowlist.json`, one reason each, and the list is shrink-only: an
  entry that stops diverging fails the guard. A package with no dependencies at all is
  exempt from the importer rule because pnpm omits its importer. Costs a few seconds.
  Run `pnpm check:deps`.
- `check-kernel-layering.mjs` — parses static and dynamic
  `@hilbras/omnicode-*` imports, enforces the leaf/`rpc`/`engine`/`core`/
  `client-contract`/`sdk` rules, confines `features-integration` to `engine`,
  `tools`, `addons`, `memory` and `base`, forbids imports of `server`, restricts
  `acp` to `api` and forbids `acp` → `api`, and rejects import cycles. Run
  `pnpm check:architecture`.
- `check-no-comments.mjs` — bans comments, JSDoc, and tooling directives in
  `packages/core`, `packages/server`, and `packages/transcript` under
  `src`, `test`, and `scripts`. Outside those packages, comment only non-obvious
  constraints. Run `pnpm check:architecture`.
- `check-agents-docs.mjs` — verifies the canonical root `AGENTS.md`, its
  compatibility pointers, all referenced paths, and rejects stale `Kernel`
  directory references in every `AGENTS.md`. Run `pnpm check:agent-docs`.
- `check-docs-claims.mjs` — rejects stale CI, flake, and E2E coverage claims when
  the corresponding files or tests are absent. Run `pnpm check:docs-claims`.
- `check-oxlint-baseline.mjs` — runs `oxlint --type-aware` and fails on any
  finding not present in `scripts/oxlint-baseline.json` (frozen pre-existing
  debt). The baseline is shrink-only: the check also fails when a fix makes the
  stored entries stale, which is the signal to regenerate. Run as part of
  `pnpm lint`.
- `build-docs.mjs` — renders the reader-facing documents to `docs-site/` with `marked`
  (already the workspace's renderer; no site framework) and, in `--check` mode, validates
  them: relative links resolve and every `docs/zh/<path>` has its `docs/en/<path>` source.
  Part of `pnpm check:guards` as `pnpm docs:check`, so a dead link fails the gate rather
  than sitting in a document nobody reopens. Costs under a second.
- `check-generated-freshness.mjs` — runs each generator in its `--check` mode
  (`gen:config-manifest`, `gen:wire-manifest`, `gen:state-manifest`,
  `gen:contract-types` in `@hilbras/omnicode-engine`, `gen:wire-contract` and
  `gen:api-reference` in `@hilbras/omnicode-api`, `gen:vis-asset` in
  `@omnicode/cli`) and fails when an on-disk artifact no longer matches what its
  generator produces. Seven artifacts today: the three engine manifests, the engine
  contract-types digest, the API wire contract JSON, the generated API reference at
  `packages/API/docs/wire-contract.md`, and the CLI's embedded vis web asset
  (`apps/omnicode-cli/src/generated/vis-web-asset.ts`). Six of them render in
  memory (or into a scratch dir), so the guard never rewrites the tree it is
  checking; `gen:vis-asset` is the exception in shape, not in effect — it must run a
  `vite build` of the vis web app (~4 s) to know what the current source produces,
  then compares without writing. That build writes the untracked intermediate
  `apps/omnicode-vis/web/dist-single/index.html`, which is why that path is ignored.
  Total cost about two minutes, mostly `tsc` over the engine source.
  `gen:contract-types` emits 1 126 declaration files for an external consumer, so
  what is tracked in-repo is a digest manifest
  (`packages/engine/docs/contract-types.sha256`, one `sha256  path` line per
  emitted file) rather than the files themselves; a drift report names the
  changed declarations. Run `pnpm check:generated`.
- `check-package-hygiene.mjs` — for every workspace package that declares
  `publishConfig`, runs `publint`, and — when that package's
  `publishConfig.exports` ships declarations — packs it with `pnpm pack` and runs
  `attw --profile esm-only` on the tarball, so the check measures the artifact a
  consumer receives rather than the source tree. It runs **pnpm**-packed
  tarballs on purpose: `npm pack` ignores `publishConfig.exports`, and attw on an
  npm-packed SDK/TUI tarball reports `NoResolution` in every mode because the
  packed manifest points `.` at `src/index.ts`, which `files` excludes. That
  makes the check both the pnpm-path gate and the detector for "someone
  published with npm". It builds nothing, so run it after the packages are
  built; it is not part of `pnpm check:guards` for that reason. Run
  `pnpm check:package`.
- `check-cli-artifact.mjs` — the other half of measuring what ships, and the only
  check that runs the CLI binary. Four things, all against
  `apps/omnicode-cli/dist/main.mjs`: a bare import of a workspace package
  (`@hilbras/*`, `@omnicode/cli-ui`, `@omnicode/cli-commands`) must not survive
  bundling — that is what made the artifact resolve the **private** SDK's
  TypeScript source at runtime and die on `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`;
  `node dist/main.mjs --version` must exit 0 with the version in the CLI's own
  `package.json`; and `--help` must work for `acp`, `web`, and `vis`, the groups
  that pull the heaviest packages and used to load lazily, so they are what a
  bundling change breaks first. Static `import … from`, `export … from`, dynamic
  `import()`, and side-effect `import "…"` are all scanned. Verified in both
  directions: removing `noExternal` from `apps/omnicode-cli/tsdown.config.ts`
  makes it exit 1 naming the four leaked specifiers, and unregistering `acp`
  makes it exit 1 with `omnicode acp --help` exited 0 with
  "Usage: omnicode [options] [command]". It builds nothing, so it runs in CI's
  `package-hygiene` job after the CLI build, not in `check:guards`. Run
  `pnpm check:cli-artifact`.
- The SDK's committed API report (`packages/SDK/etc/omnicode-sdk.api.md`) is gated
  the same way: `pnpm --filter @hilbras/omnicode-sdk build:dts` runs API Extractor
  in check mode and fails when the report drifts from `src/index.ts`. It is not a
  `check:*.mjs` script and not part of `pnpm check:guards` because it costs about
  40 s and needs the declarations built; CI's `package-hygiene` job already runs
  that exact command on every PR and push, so a stale report cannot land. Rewrite
  the report with `build:dts:update` after an intentional public-API change.
- `check:skills` (root script, no file of its own) — runs the project skill
  library's own test files with `node --test ".agents/skills/*/*.test.cjs"`. Two
  skills ship validators: `security-audit` (report validators
  `validate-findings.cjs`, `validate-coverage-ledger.cjs`) and `review-pr`
  (`validate-surfaces.cjs`, which resolves every path cited by
  `review-pr/surfaces.md` against the tree so the review checklist cannot rot into
  false facts); 75 tests today. Without this step those tests exist and never run.
  It is part of `pnpm check:guards` and costs about two seconds. A skill directory
  with no `.test.cjs` contributes nothing, so the pattern is safe to widen when
  another skill arrives with validators.
- `gen-oxlint-baseline.mjs` — regenerates the baseline after fixing findings.
  Only run it when the intent of the change is "the baseline shrinks"; never run
  it to make a new violation pass.
- `pnpm check:guards` runs workspace + architecture + deps-consistency + docs-claims +
  agent-docs + generated-freshness + tests + typecheck-coverage + skills together. This
  is the default pre-handoff guard command.
- `preflight.mjs` — local delivery gate. Runs the workspace check, guards, the
  type-aware lint gate (`pnpm lint`, which CI runs as its own job),
  typechecks for engine, memory, channels, Tools, Kaos, API, and the CLI, then targeted
  permission-policy, memory-lifecycle, channels, API-connectivity, Tools, engine-team, and Kaos-sandbox tests,
  and finally the eval gate
  (`pnpm --filter @hilbras/omnicode-engine exec tsx scripts/run-eval-gate.mts`),
  which is the same command the CI `eval-gate` job runs, so a failing eval suite
  is caught before CI instead of only by it. `--dry-run` prints the steps, `--skip-typecheck`
  and `--skip-tests` narrow the run while iterating (`--skip-tests` skips the eval
  gate too). Root script:
  `pnpm preflight`. It is a runner, not a guard; it does not replace the
  package test suites.

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
pnpm check:docs-claims
pnpm check:agent-docs
pnpm check:tests
pnpm check:typecheck
pnpm check:guards
node scripts/preflight.mjs --dry-run
```

Run the narrow guard while iterating, then `pnpm check:guards` before handoff.
`pnpm preflight` adds package typechecks and targeted tests. There is no test
suite for these scripts; a guard change is validated by running it against this
tree and, when changing detection logic, against a deliberate local violation
that you remove afterward.
