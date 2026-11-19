# OmniCode — Agent Guide

Hot path only. Read the nearest `AGENTS.md` for package detail before editing.
Deep architecture belongs in package guides and `docs/`, not here.

## Instruction file map

`AGENTS.md` is canonical. Other agent tools get compatibility pointers:

| Tool | File |
|---|---|
| Claude Code | `CLAUDE.md` → imports `@AGENTS.md` |
| Gemini CLI | `GEMINI.md` |
| Amp / generic `AGENT.md` | `AGENT.md` |
| Cursor | `.cursor/rules/omnicode.mdc`, legacy `.cursorrules` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Windsurf | `.windsurf/rules/omnicode.md` |
| Cline | `.clinerules/omnicode.md` |
| Roo | `.roo/rules/omnicode.md` |
| Continue | `.continue/rules/omnicode.md` |
| Aider | `.aider.conf.yml` → `AGENTS.md` + `CONVENTIONS.md` |

Compatibility files point here. Do not fork rules into them.

## Read order

1. This file.
2. Nearest `AGENTS.md`:
   - `apps/omnicode-cli/AGENTS.md`
   - `apps/omnicode-mobile/AGENTS.md`
   - `packages/memory/AGENTS.md`
   - `packages/minidb/AGENTS.md`
   - `packages/tui/AGENTS.md`
   - `packages/engine/src/human/llm/AGENTS.md`
   - `packages/engine/src/human/test/llm/AGENTS.md`
3. `packages/README.md` for the package map and package-addition checklist.
4. The owning source files and tests. Code is the source of truth.

If a guide contradicts `scripts/check-kernel-layering.mjs`,
`scripts/check-no-comments.mjs`, or `scripts/check-workspace-globs.mjs`, the
guard script wins. Fix the guide.

## What this repo is

TypeScript ESM monorepo. Kernel packages power an agent runtime; the CLI and
visualisation app are surfaces over the SDK.

- Package manager: `pnpm@12.5.1`
- Node: `.nvmrc` = `22`; package requires `>=22.19`
- Build: Turbo + tsdown
- Tests: Vitest, per-package configs aggregated by the root config
- Validation: zod `4.3.6`
- Workspace: `pnpm-workspace.yaml`

The root CI workflow is `.github/workflows/ci.yml`. It is a targeted gate, not full build/full-test validation. Do not claim a GitHub Actions run passed unless it actually ran.

## Hard laws

### 1. Kernel layering

Enforced by `scripts/check-kernel-layering.mjs`.

Leaves:

```text
base auth kaos llm minidb telemetry transcript tree-sitter-bash tui
```

Rules:

| From | May import |
|---|---|
| leaf packages | no other `@hilbras/omnicode-*` package |
| `rpc` | `base` only |
| `engine` | leaves only |
| `core` | `base` and `engine` only |
| `client-contract` | `engine` and `rpc` only |
| `sdk` | must not import `api` |
| `acp` | must not import `api` — API owns the ACP loader |
| anything | must not import `server` |
| anything except `api` | must not import `acp` |

No import cycles. `packages/core` is a facade over `packages/base` +
`packages/engine`; do not describe it as the DI engine.

Run:

```bash
pnpm check:architecture
```

### 2. App connection boundary

- `apps/omnicode-cli` uses `@hilbras/omnicode-api` (which re-exports the SDK)
  and its contracts. It does not import engine internals.
- `apps/omnicode-vis` is a deliberate read-only exception: it reads on-disk
  session artifacts and imports core types plus specific engine wire/context
  helpers. Do not extend that deviation or copy it into the CLI.

CLI chain:

```text
src/main.ts
  -> src/cli/commands.ts
  -> src/cli/run-shell.ts
  -> API/SDK OmnicodeHarness
  -> src/tui/omnicode-tui.ts
```

`OmnicodeTUI` coordinates. Logic sinks into `src/tui/controllers/`.

### 3. Feature registration is import-time

Feature seam:

```text
packages/engine/src/features/feature.ts
packages/engine/src/features/featureRegistry.ts
```

`registerFeature()` appends to a module-level array. A feature is active only
if its module is imported at the composition root. Silent non-registration is
the common bug.

Feature contributions include:

- services
- tools
- commands
- config sections
- agent/session models
- profiles

### 4. Tool registration

Tool seam:

```text
packages/engine/src/agent/toolRegistry/
packages/Tools/src/
```

Built-in tools activate through side-effect imports in
`packages/Tools/src/index.ts`. A tool must also be admitted by the active agent
profile:

```text
packages/engine/src/session/agentLifecycle/profile/profiles.ts
```

A contributed tool that is not in the profile allowlist is invisible to the
model. Approval is separate: add read-only/safe tools to
`packages/engine/src/agent/permissionPolicy/policies/default-tool-approve.ts`
only when the side effect is genuinely safe.

### 5. Generated files are not hand-edited

Regenerate from the owning script:

```bash
pnpm --filter @hilbras/omnicode-engine gen:contract-types
pnpm --filter @hilbras/omnicode-engine gen:config-manifest
pnpm --filter @hilbras/omnicode-engine gen:wire-manifest
pnpm --filter @hilbras/omnicode-engine gen:state-manifest
```

Generated manifests include `config-manifest.toml`,
`wire-manifest.d.ts`, `state-manifest.d.ts`, and
`contract-types.sha256` (the digest of the declarations `gen:contract-types`
emits; the declaration tree itself goes to a caller-supplied directory and is
never tracked). The client wire contract lives in
`packages/API/docs/wire-contract.json`, generated by
`pnpm --filter @hilbras/omnicode-api gen:wire-contract` from the zod contract
tables in `packages/client-contract/src/contract/`; its readable index
`packages/API/docs/wire-contract.md` comes from `gen:api-reference`. The CLI's
embedded web asset `apps/omnicode-cli/src/generated/vis-web-asset.ts` comes from
`pnpm --filter @hilbras/omnicode gen:vis-asset` (also the `prebuild` step), which runs
the vis web single-file build and encodes the result.

Do not hand-edit generated files. A state/manifest generator that prints
“stale” is a failure, not a warning to ignore; `pnpm check:guards` runs every
generator's `--check`, so drift fails CI.

### 6. Validation must actually run

`scripts/check-agents-docs.mjs` verifies this guide and the compatibility
files. `scripts/check-workspace-globs.mjs` catches patterns and Vitest projects that
resolve to zero packages/files. An unmatched Vitest project can leave a suite
green while running nothing. Its reverse is
`scripts/check-test-reachability.mjs` (`pnpm check:tests`): every test file must be
run by something — its package needs a `test` script and a Vitest config that matches
the file — so a `test/` directory with no config, or a config with no `test` script,
fails the gate instead of executing nothing for months.
`scripts/check-typecheck-coverage.mjs` (`pnpm check:typecheck`) closes the same hole
for types: every package with `src/` needs a `typecheck` script, or an entry in the
guard's exception list, because `pnpm typecheck` is `turbo run typecheck` and nothing
else checks a package's own sources.
`scripts/check-generated-freshness.mjs` re-runs each
engine manifest generator in `--check` mode, so a stale `config-manifest.toml`,
`wire-manifest.d.ts`, or `state-manifest.d.ts` fails the gate instead of landing.

Run:

```bash
pnpm check:guards
```

### 7. Comment-free zones are scoped

`scripts/check-no-comments.mjs` bans comments, JSDoc, and lint suppressions in:

```text
packages/core
packages/server
packages/transcript
```

Scanned roots: `src`, `test`, `scripts`.

This is not repo-wide. Outside those packages, comment only non-obvious
constraints and decisions; do not narrate the diff.

### 8. Security invariants

- Before workspace trust, never spawn an external command by bare name. Use
  `resolveCommandPath`; it refuses PATH hits inside cwd (Windows cwd hijack).
- Spawn with argument arrays, not shell strings.
- Redact secrets from logs, telemetry, errors, and tool output.
- Telemetry must not emit paths, env values, tokens, or raw error text.
- Memory trust: model-authored memory cannot exceed `unverified`; retrieval
  must report provenance and trust; `secret` memory never leaves the host.
- MCP private/link-local endpoints are rejected unless explicitly allowed.
- Do not weaken or bypass a guard to make a change land. Fix the underlying
  violation or report the blocker.

## Project map

| Path | Role |
|---|---|
| `apps/omnicode-cli` | CLI + TUI. Entry, commands, controllers, components, reverse-RPC. |
| `apps/omnicode-mobile` | Expo/RN on-device agent app. BYOK chat UI, Hilbras design system. |
| `apps/omnicode-inspect` | Read-only inspector over the loopback `/api/v1/debug` service channels: services, DI graph, events, transcript, search, model catalog. |
| `apps/omnicode-vis/server` | Hono visualisation daemon. |
| `apps/omnicode-vis/web` | React 19 + Vite visualisation app. |
| `apps/omnicode-web` | React 19 + Vite client app; first-class client over `app-core`'s daemon API (in the root Vitest graph). |
| `packages/base` | DI container, scopes, fibers, collections, logging. |
| `packages/auth` | Authentication primitives. |
| `packages/Kaos` | Execution environment: filesystem, processes, SSH, sandbox seams. |
| `packages/llm` | Pure LLM provider kernel and protocol wires. |
| `packages/engine` | Agent engine: loop, tools, permissions, MCP, sessions, memory context. |
| `packages/core` | Re-export facade over `base` + `engine`. |
| `packages/rpc` | Transport layer above `base`. |
| `packages/SDK` | Public SDK and harness. |
| `packages/API` | Connection/API surface; re-exports SDK and owns request handling. |
| `packages/client-contract` | Client-facing types shared by `API` and `ACP` (the extraction that breaks their build cycle). May import `engine` and `rpc` only. |
| `packages/ACP` | Agent Client Protocol host. |
| `packages/server` | REST/WS server for the web surface. |
| `packages/Tools` | Built-in agent tools. |
| `packages/Addons` | Small composition add-ons. |
| `packages/features-integration` | Cross-package integration tests for engine, Tools, Addons, and memory; test-only. |
| `packages/memory` | Trust-gated persistent memory, retrieval, tools, control. |
| `packages/minidb` | Durable JSON/minidb store. |
| `packages/transcript` | Transcript types and replay. |
| `packages/telemetry` | Telemetry transport. |
| `packages/tui` | Shared terminal primitives; uses `node --test`, not Vitest. |
| `packages/app-*` | Reusable UI/composer/markdown/client packages. |
| `packages/migration`, `packages/remote` | Data migration and remote transport. |

## Where new logic goes

| Change | Home |
|---|---|
| New built-in tool | `packages/Tools/src/<tool>/` + tool registration + profile allowlist + approval policy if safe |
| New feature | `packages/engine/src/features/` + `registerFeature()` + composition-root import |
| New provider wire | `packages/engine/src/human/llm/` + adapter boundary |
| New session/agent state | `packages/engine/src/agent/` + durable `Event2` + state manifest regeneration |
| New REST/WS route | `packages/server/src/routes/` + `protocol/` + API wiring |
| New SDK method | `packages/SDK/src/rpc.ts` + `session.ts` + API request handler |
| New CLI/TUI screen | `apps/omnicode-cli/src/tui/components/` or `controllers/`; command in `commands/` |
| New memory behavior | `packages/memory/`; read its `AGENTS.md` first |
| New persistence | `packages/minidb/` |
| New docs | `docs/` for plans and architecture; add bilingual mirrors only when they already exist |
| New project skill | `.agents/skills/<name>/SKILL.md` (plus supporting files next to it). The engine discovers `.agents/skills` as a project skill root — see `packages/engine/src/features/skill/catalog/skillRoots.ts` and `packages/engine/test/features/skill/catalog/skillRoots.test.ts` |

## Adding a package

There is no `flake.nix` in this tree. Do not follow stale instructions that
require one.

Required edits:

1. Create `packages/<name>/package.json` and `src/`.
2. `pnpm-workspace.yaml` already globs `packages/*`.
3. Root `vitest.config.ts` must resolve the package project.
4. Run `pnpm check:workspace`.

If the package is part of the kernel graph, add its role to the layering guard
and the table above. Run `pnpm check:architecture`.

## Commands

Install:

```bash
pnpm install
```

CLI development:

```bash
pnpm dev:cli
pnpm dev:server
```

Build:

```bash
pnpm build
pnpm build:cli
```

Typecheck:

```bash
pnpm typecheck
pnpm typecheck:cli
pnpm typecheck:tui
```

Targeted package checks — preferred while iterating:

```bash
pnpm --filter @hilbras/omnicode-engine typecheck
pnpm --filter @hilbras/omnicode-engine test
pnpm --filter @hilbras/omnicode-memory test
pnpm --filter @hilbras/omnicode typecheck
pnpm --filter @hilbras/omnicode exec vitest run test/tui/path/to/file.test.ts
```

Guards — `pnpm check:guards` runs all of these; run one directly while iterating:

```bash
pnpm check:workspace
pnpm check:architecture
pnpm check:deps
pnpm check:phantom-deps
pnpm check:docs-claims
pnpm check:agent-docs
pnpm docs:check
pnpm check:generated
pnpm check:tests
pnpm check:command-paths
pnpm check:typecheck
pnpm check:skills
```

`pnpm check:package` and `pnpm check:cli-artifact` are not in that chain: both need
a build first, so CI runs them in its `package-hygiene` job.

The local delivery gate is `pnpm preflight` (install check, guards, lint, a full-graph
typecheck, fourteen targeted suites, eval gate — 17 steps). Its typecheck step is
`pnpm typecheck`, the same command the CI `full-suite` job runs, so a type error in any
package fails preflight too; the old hand-picked seven-package list left `transcript`,
`minidb`, `SDK`, `server`, `ACP`, and the web app to CI alone.

Known command gaps:

- Root `pnpm lint` runs the no-comments guard, the kernel-layering guard, and
  `oxlint --type-aware`. Pre-existing type-aware findings are frozen in
  `scripts/oxlint-baseline.json`; the gate fails only on violations that are not
  in the baseline, and the baseline may only shrink. Regenerate it with
  `node scripts/gen-oxlint-baseline.mjs` after fixing findings.
- `apps/omnicode-cli` `test` / `e2e` now call `pnpm -w run build:cli` (defined at the
  root), so they build the CLI and then run Vitest; the earlier warning about a
  nonexistent `build:packages` is obsolete. `pnpm test` therefore runs the CLI suite
  through its own script — the last full-graph run reported CLI `4 421 passed |
  3 skipped`. To iterate without that build, run Vitest directly:
  ```bash
  pnpm --filter @hilbras/omnicode exec vitest run test/...
  ```
- `pnpm test` runs the root Turbo graph; prefer targeted package tests unless you are
  validating the whole graph.
- `packages/tui` runs `node --test`; it is not part of the root Vitest run.
- `pnpm build` (`turbo run build`) is runnable again: `--concurrency=1` reports
  `Tasks: 23 successful, 23 total`. The last cycle was
  `engine` → Tools / Addons / memory, closed only by test-only `devDependencies`;
  those tests now live in `packages/features-integration`, so the engine has no
  build edge to them. The earlier `api` ↔ `acp` and `app-client` ↔ `app-composer`
  cycles are also gone (API owns the ACP loader; ACP consumes
  `@hilbras/omnicode-client-contract`, and the dead `app-composer` devDependency
  was removed). CI runs a full workspace build only in the `cross-platform` workflow
  (`pnpm -r --if-present build`, on Linux, macOS, and Windows); `ci.yml` keeps
  targeted builds — `pnpm build:cli`, `pnpm --filter <pkg> build`, and the SDK's
  `build:dts`.

## Testing rules

- Tests live under `packages/<pkg>/test/` or `apps/<app>/test/`, mirroring
  `src/`.
- Prefer adding cases to the nearest existing test file over creating a new
  file.
- Naming:
  - `*.test.ts` — unit/behavior
  - `*.e2e.test.ts` — end-to-end
  - `*.integration.test.ts` — integration
- Engine setup clears `OMNICODE_*` env vars except the cassette key. Provider
  tests use recorded HTTP cassettes; recording is opt-in:
  ```bash
  OMNICODE_CASSETTE_RECORD=1
  ```
- CLI e2e is gated:
  ```bash
  OMNICODE_E2E=1
  OMNICODE_E2E_REAL=1
  ```
- Use `vi.stubEnv()` in `beforeEach` and `vi.unstubAllEnvs()` in `afterEach`.
  Unset a var by stubbing it to `''`.
- Do not use sleeps or timeouts to synchronize tests. Wait for an explicit
  signal or observable state.
- Do not write tests that read source text or assert snapshots as a proxy for
  behavior.
- Guard tests are normal tests: printable keys and chalk colors are enforced
  in `apps/omnicode-cli/test/tui/`.

## Coding rules

TypeScript is strict, including:

```text
noUncheckedIndexedAccess
noImplicitOverride
noPropertyAccessFromIndexSignature
noFallthroughCasesInSwitch
verbatimModuleSyntax
```

Follow the local file. Do not introduce a new style because it is common
elsewhere.

- No `any` widening or `@ts-expect-error` to bypass a real type problem.
- Pass `undefined`; do not build conditional spreads just to omit a key.
- Do not widen optional properties with `| undefined`.
- Do not add a one-parameter options object for uniformity.
- Prefer extending an existing test over exploding test-file count.
- Match naming, imports, and error handling in the same directory.
- Public-facing text replaces internal project names when the surrounding code
  does so.

## Session, events, and providers

- Session/agent state is event-sourced with `Event2` classes.
- Durable events declare `static type`, `static durable`, and a zod schema.
- State is replayed from `wire.jsonl`.
- A change to event/config/state shape requires manifest regeneration.
- Provider layer: four protocol bases — OpenAI legacy, OpenAI Responses,
  Anthropic, Google GenAI. No silent fallback between wires.
- Format/trait isolation is enforced by
  `packages/engine/scripts/check-import-boundaries.mjs`.
- `human/` is the pure kernel; `llm-adapter/` is the compatibility boundary.
  Do not mix them.

## Permissions and trust

- Modes: `manual`, `auto`, `yolo`.
- Policy chain: `packages/engine/src/agent/permissionPolicy/policies/`.
- Approval/questions bridge through
  `apps/omnicode-cli/src/tui/reverse-rpc/` and SDK permission/interaction
  adapters.
- Workspace trust gate runs before command execution. Pre-trust code must not
  resolve bare command names.
- Safe default approvals include read-only and memory tools. Adding a
  mutating tool to auto-approve needs an explicit safety argument.

## Memory

Read `packages/memory/AGENTS.md` before changing memory.

Hard points:

- Records carry provenance, trust, sensitivity, retention, lifecycle.
- Model-authored memory cannot exceed `unverified`.
- Auto-injection requires trusted memory; explicit search may include
  unverified and must label it.
- Retrieval reports complete/partial honestly.
- `secret` memory never reaches a provider.
- Legal hold blocks destructive mutation, not reads.
- History writes a pre-image for destructive mutations.
- Agent tools are `memory_search`, `memory_save`, `memory_forget`; they must be
  in the profile allowlist to be visible.

## Definition of done

For a normal code change:

```bash
pnpm check:guards
pnpm lint
pnpm --filter <affected-package> typecheck
pnpm --filter <affected-package> test
```

For a CLI/TUI change, also:

```bash
pnpm --filter @hilbras/omnicode typecheck
pnpm --filter @hilbras/omnicode build
```

For a memory change:

```bash
pnpm --filter @hilbras/omnicode-memory test
pnpm --filter @hilbras/omnicode-engine typecheck
```

For a package-graph change:

```bash
pnpm check:workspace
pnpm check:architecture
```

Report the real result. A skipped suite, an unmatched project, or an existing
failure is not “green.”

## Review rules

- Enumerate changed behavior, not only changed lines.
- A flipped default needs a named loss and an escape hatch.
- Prompt text is behavior.
- Contract files are tripwires: changing them changes the API.
- Silent failure outranks a crash.
- A refactor or port carries the old feature inventory; silently dropping a
  feature is a regression.
- Bug fixes and behavior changes need a test that fails on the base and passes
  on the fix.
- Do not self-approve a `major` release or a breaking API change.

## Workflow

- Read the nearest guide and the owning tests first.
- Reproduce through the real entry point before editing.
- Prefer `rg` for discovery.
- Scratch and handoff files go under `.tmp/`; never stage them.
- Keep diffs focused. Do not reformat unrelated files.
- Update the nearest `AGENTS.md` when you change a documented path, command,
  guard, or hard rule.
- Do not commit generated outputs unless the owning script and guard expect
  them.

## Known traps

- Stale `Kernel` directory references exist in old docs and comments. Current
  paths are `packages/*`.
- `apps/omnicode-cli/AGENTS.md` may mention `apps/omnicode`; the current app is
  `apps/omnicode-cli`.
- Root `vitest.config.ts` project paths are load-bearing. `pnpm check:workspace`
  exists to stop silent test skipping.
- `packages/memory/AGENTS.md` is intentionally long; keep this file short and
  point to it instead of duplicating memory rules.
- Environment home resolution can make two runs use different data stores.
  When debugging persistence, verify which home the process actually resolved.
- A model tool that is registered but absent from the profile allowlist does
  not exist from the model's point of view.
