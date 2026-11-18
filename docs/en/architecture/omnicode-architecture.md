# OmniCode architecture and workstreams

Status: active  
Scope: repository-wide architecture plus the implementation status of the seven workstreams in `docs/plans/qwen-parity-improvement-plan.md`.  
Source of truth: this English document. The Chinese mirror is `docs/zh/architecture/omnicode-architecture.md`. When the two diverge, reconcile them against this file.

Related documents:

- [End-to-end test plan](../quality/e2e-test-plan.md)
- [Memory recall evaluation baseline](../quality/memory-recall-evaluation.md)
- [Qwen-parity improvement plan](../../plans/qwen-parity-improvement-plan.md)

## Layer model

The kernel is a TypeScript ESM monorepo. Package boundaries are enforced by `scripts/check-kernel-layering.mjs`; run `pnpm check:architecture` after any import change.

Leaves are `base`, `auth`, `kaos`, `llm`, `minidb`, `telemetry`, `transcript`, `tree-sitter-bash`, and `tui`. A leaf package may not import another `@hilbras/omnicode-*` package.

| Package | May import |
|---|---|
| `rpc` | `base` |
| `engine` | leaf packages |
| `core` | `base` and `engine` |
| `sdk` | anything except `api` |
| `api` | anything except `server` and `acp` |
| other packages | must not import `server` |
| everything except `api` | must not import `acp` |

`packages/core` is a facade over `packages/base` plus `packages/engine`, not a dependency-injection engine of its own.

The CLI connects through `@hilbras/omnicode-api`, which re-exports the SDK. It must not import engine internals. The visualization app is the single read-only exception: it reads on-disk session artifacts and specific engine wire/context helpers. Do not extend that exception or copy it into the CLI.

## Runtime seams

### Features

Feature registration is an import-time side effect. `registerFeature()` appends to a module-level array, so a feature is active only when its module is imported at the composition root. A feature contributes services, tools, commands, config sections, agent/session models, and profiles.

The seam is `packages/engine/src/features/feature.ts` and `packages/engine/src/features/featureRegistry.ts`. Silent non-registration is the common defect: the code exists, no import pulls it in, and the feature is invisible at runtime.

### Tools

Built-in tools live in `packages/Tools/src/`. They activate through side-effect imports in `packages/Tools/src/index.ts`. A tool is visible to the model only when it is also admitted by the active profile in `packages/engine/src/session/agentLifecycle/profile/profiles.ts`.

Approval is a separate layer. Read-only and genuinely safe tools may be added to `packages/engine/src/agent/permissionPolicy/policies/default-tool-approve.ts`; a mutating tool needs an explicit safety argument.

### Sessions and state

Session and agent state is event-sourced with `Event2` classes. Durable events declare a static type, a durable flag, and a zod schema; state is replayed from `wire.jsonl`. Changing an event, config, or state shape requires regenerating the owning manifest. Generated manifests are never hand-edited.

### Memory trust

Memory records carry provenance, trust, sensitivity, retention, lifecycle, and legal-hold state. The invariants that surfaces must preserve:

- Model-authored memory cannot exceed `unverified`.
- Auto-injection requires trusted memory; explicit search may include unverified memory and must label it.
- `secret` memory never reaches a provider.
- Legal hold blocks destructive mutation, not reads.
- Destructive mutation writes a history pre-image.
- Retrieval reports complete or partial results honestly.

Read `packages/memory/AGENTS.md` before changing memory behavior.

## Delivery pipeline

`pnpm check:guards` runs the workspace glob check, kernel layering, comment-free zones, and agent-doc consistency. It is the default pre-handoff gate.

`node scripts/preflight.mjs` wraps the local gate: workspace and guard checks, package typechecks for engine, memory, channels, Tools, Kaos, API, and the CLI, then targeted permission-policy, memory-lifecycle, channels, API-connectivity, Tools, engine-team, and Kaos-sandbox tests. `--dry-run` prints the steps without running them; `--skip-typecheck` and `--skip-tests` narrow the run while iterating. The equivalent root script is `pnpm preflight`.

`.github/workflows/ci.yml` runs the same guard and targeted-test surface on pull requests and pushes to `main`. It installs with `pnpm install --frozen-lockfile`, uses the pnpm store cache, and declares `contents: read` permissions. It deliberately does not run the full Turbo test graph, builds, or release steps.

## Workstream status

| Workstream | Status in this tree | Evidence and remaining work |
|---|---|---|
| 1. Permission auto-mode | Implemented | `policies/auto-mode-classifier.ts`, `denialTracking.ts`, dangerous-command escalation, trusted user answers, and MCP ambiguity handling feed the policy chain. Tests live in `packages/engine/test/agent/permissionPolicy/`. |
| 2. Memory lifecycle | Implemented core | Auto-capture and promotion exist in `packages/memory/src/layers/` and `service/memoryService.ts`; dream consolidation and the relevance selector are in `service/` and `retrieval/`; `tool/memoryManageTool.ts` exposes management actions. Channel-scoped storage uses the `channel` scope tier. |
| 3. Channel platform | Implemented core | `packages/channels/` contains the contract, registry, session binding, lifecycle commands, and Telegram plus webhook-based DingTalk, WeChat, Feishu, and Slack adapters, with tests in `packages/channels/test/`. Channel-scoped memory uses the `channel` scope tier. Discord and automated cross-process E2E remain deferred. |
| 4. Tooling expansion | Implemented | `packages/Tools/src/` has `code-intelligence/lsp`, `git-worktree`, `notebook`, `tasks`, `teams`, `records` (artifact and source), and `diagnostics`. Registration exists in `packages/Tools/src/index.ts`; profiles and default/auto approvals include the new tools, with mutating file/worktree tools left out of automatic approval. |
| 5. Teams, arena, budgets | Implemented | `packages/engine/src/agent/team/` has the team service, arena, workflow budget, task notification queue, forked-agent cache, and registered `Team` tool, with tests. The targeted team suite passes. |
| 6. OS-level sandboxing | Implemented core | `packages/Kaos/src/sandbox/` has bwrap execution, shell policy, path policy, selection, availability probing, and the file worker, with tests. The landlock backend reports that enforcement is unavailable in pure TypeScript and falls back explicitly instead of pretending to isolate. |
| 7. Delivery, docs, evaluation | Implemented with one deferral | This change adds the CI workflow, preflight script, bilingual architecture and quality docs, the E2E plan, and the recall evaluation baseline. Lint boundary and filename rules are deferred; see below. |

Workstreams 3 through 6 are implemented and their targeted package tests pass. Cross-process automated E2E remains deferred; the [E2E test plan](../quality/e2e-test-plan.md) records the intended cases and the manual/automation boundary.

## Deferred lint enforcement

Package-boundary and filename lint rules are not enabled. The deferral is deliberate:

- The repository has no ESLint configuration file and no package `lint` scripts.
- Root `pnpm lint` invokes `turbo run lint`, which currently matches no package task and is a no-op.
- `.oxlintrc.json` exists, but `oxlint` is not a dependency and no binary is installed. The file also references historical paths such as `packages/omnicode-minidb` and `packages/omnicode-server`, which do not match this tree.

Adding rules now would require a new dependency and repairs to an unrelated stale configuration, and the rules could not be validated. Once lint is restored, the deferred rules are: a no-restricted-import rule mirroring the kernel layering table, and a filename convention rule for package source files. Kernel layering remains enforced meanwhile by `scripts/check-kernel-layering.mjs`.

## Validation

```bash
pnpm check:guards
node scripts/preflight.mjs --dry-run
pnpm --filter @hilbras/omnicode-engine typecheck
pnpm --filter @hilbras/omnicode-memory typecheck
pnpm --filter @hilbras/omnicode typecheck
pnpm --filter @hilbras/omnicode-engine exec vitest run test/agent/permissionPolicy
pnpm --filter @hilbras/omnicode-memory exec vitest run test/evaluation.test.ts test/dreamConsolidation.test.ts test/relevanceSelector.test.ts
```

Run the narrow command while iterating and `pnpm preflight` before handoff. Do not report CI results from this document; only a workflow run can report them.
