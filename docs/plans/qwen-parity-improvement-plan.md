# Qwen-Parity Improvement Plan

Status: complete — all seven workstreams implemented; targeted validation green.
Last updated: 2026-11-11  
Owner: OmniCode  
Scope: implement the seven workstreams needed to make OmniCode stronger than qwen-code while preserving its trust-gated kernel, strict typing, and guard discipline.

## Baseline

Current strengths to preserve:

- Trust-gated memory with provenance, sensitivity, retention, legal hold, audit, and history.
- Kaos execution environment plus tree-sitter-bash permission gating.
- Real computer-use feature.
- AgentSwarm parallel dispatch.
- Strict TypeScript flags and guard scripts.
- Event-sourced session/state with durable manifests.

Current gaps to close:

- Permission system lacks auto-mode classification, denial tracking, trusted answers, and MCP grant ambiguity handling.
- Memory lacks auto-extraction, dream consolidation, relevance selection, scopes, channel memory, and management tools.
- Channels are Telegram-only.
- Toolset lacks LSP, worktrees, notebook editing, task/team tools, artifact/source recording, retention/truncation diagnostics.
- Subagents lack teams, arena, workflow budgets, and forked-agent caching.
- Sandboxing lacks OS-level isolation and runtime shell policy.
- Delivery lacks CI, preflight, bilingual design docs, E2E plans, and an evaluation harness.

## Global rules

1. Preserve kernel layering and guard scripts.
2. Every behavior change needs tests that fail on base and pass on fix.
3. Do not weaken trust, sensitivity, retention, legal hold, or provenance.
4. Add tools to both registration and profile allowlists.
5. Mutating auto-approvals require an explicit safety argument.
6. Update nearest `AGENTS.md` when paths, commands, guards, or hard rules change.
7. Run targeted package checks after each slice and full guards before completion.

## Phase 0: Baseline and safety

Tasks:

- Record current guard output and targeted test baseline.
- Add a tracking document for deferred scope.
- Ensure no generated files are hand-edited.

Acceptance:

- `pnpm check:guards` passes.
- Affected package typecheck/test commands are recorded in the plan.

## Workstream 1: Permission auto-mode and auditability

Goal: make `auto` mode classify actions using transcript context while retaining manual/yolo modes and safe defaults.

Files:

- `packages/engine/src/agent/permissionPolicy/policies/`
- `packages/engine/src/agent/permissionPolicy/`
- `packages/Kaos`
- `packages/engine/src/agent/toolRegistry/`
- `apps/omnicode-cli/src/tui/reverse-rpc/`

Tasks:

1. Add permission classifier module with transcript input and structured decision.
2. Add denial tracking with escalation thresholds.
3. Add dangerous command/rule classification.
4. Add trusted user answer handling.
5. Add MCP grant ambiguity detection.
6. Add shell semantic classification tests.
7. Add rule parser tests.
8. Wire classifier into permission policy chain.
9. Add auto-mode telemetry that reports only safe categories, never raw commands or secrets.
10. Add tests for allow, deny, escalate, and ambiguity cases.

Acceptance:

- `auto` mode can approve safe read-only/memory tools.
- Dangerous or ambiguous actions escalate.
- Denials are tracked and surfaced.
- `pnpm --filter @hilbras/omnicode-engine typecheck`
- `pnpm --filter @hilbras/omnicode-engine test`

## Workstream 2: Memory auto-extraction, dream consolidation, and tools

Goal: add automatic memory lifecycle without weakening trust boundaries.

Files:

- `packages/memory/`
- `packages/memory/AGENTS.md`
- `packages/minidb/`
- `packages/engine/src/agent/tools/`
- `packages/Tools/src/`

Tasks:

1. Add extraction pipeline that creates only `unverified` memories.
2. Add evidence-gated promotion from `unverified` to trusted.
3. Add dream consolidation over scoped memory.
4. Add relevance selector.
5. Add memory scopes and channel scopes.
6. Add `memory_search`, `memory_save`, `memory_forget`, and `memory_manage` tools.
7. Add channel-scoped memory storage.
8. Add recall evaluation harness and metrics.
9. Add tests for extraction, promotion, consolidation, scopes, sensitivity, and egress.
10. Update memory AGENTS and guard references.

Acceptance:

- Model-authored memory never exceeds `unverified`.
- Trusted memory is required for auto-injection.
- `secret` memory never reaches a provider.
- Legal hold blocks destructive mutation.
- `pnpm --filter @hilbras/omnicode-memory test`
- `pnpm --filter @hilbras/omnicode-engine typecheck`

## Workstream 3: Channel platform beyond Telegram

Goal: replace Telegram-only integration with a channel platform.

Files:

- `apps/omnicode-cli/src/` Telegram integration
- `packages/engine/src/app/`
- `packages/remote/`
- new `packages/channels/` or `packages/remote/channels/`

Tasks:

1. Define base channel contract.
2. Refactor Telegram into the base contract.
3. Add DingTalk adapter.
4. Add WeChat adapter.
5. Add Feishu adapter.
6. Add Slack or Discord adapter.
7. Add channel session binding.
8. Add channel-scoped memory and config.
9. Add channel lifecycle commands.
10. Add adapter tests and integration smoke tests.

Acceptance:

- At least Telegram plus two additional channels work through one contract.
- Channel sessions bind to OmniCode sessions.
- Channel memory respects trust and sensitivity.
- Targeted channel tests pass.

## Workstream 4: Tooling expansion

Goal: add code-intelligence, workspace, task, and artifact tools.

Files:

- `packages/Tools/src/`
- `packages/Tools/src/index.ts`
- `packages/engine/src/agent/toolRegistry/`
- `packages/engine/src/session/agentLifecycle/profile/profiles.ts`
- `packages/engine/src/agent/permissionPolicy/policies/default-tool-approve.ts`

Tasks:

1. Add LSP tool.
2. Add git worktree tools.
3. Add notebook editing tool.
4. Add cron tools if missing or upgrade existing.
5. Add task and team tools.
6. Add artifact recording tool.
7. Add source recording tool.
8. Add tool result retention and truncation diagnostics.
9. Add context budget diagnostics.
10. Add profile allowlist entries and approval policies.
11. Add tool tests and integration smoke tests.

Acceptance:

- New tools are visible to the active profile.
- Read-only/safe tools are approved by default only when genuinely safe.
- Tool results are bounded and diagnostics are available.
- Targeted Tools and engine tests pass.

## Workstream 5: Subagent teams, arena, and workflow budgets

Goal: extend AgentSwarm into coordinated teams and model comparison.

Files:

- `packages/engine/src/session/`
- `packages/engine/src/agent/`
- `packages/engine/src/features/`
- `packages/Tools/src/`

Tasks:

1. Add team creation and lifecycle tools.
2. Add shared task list for teams.
3. Add arena multi-model comparison.
4. Add workflow budget ledger.
5. Add background task notification queue improvements.
6. Add forked agent caching.
7. Add subagent plan tool policy tests.
8. Add profile and permission integration.
9. Add tests for team lifecycle, arena, budgets, and notifications.

Acceptance:

- Teams can coordinate through a shared task list.
- Arena can compare models on the same task.
- Workflow budgets prevent unbounded spend.
- Targeted engine tests pass.

## Workstream 6: OS-level sandboxing

Goal: add local OS isolation without removing Kaos execution seams.

Files:

- `packages/Kaos`
- `packages/engine/src/agent/permissionPolicy/`
- `packages/Tools/src/`

Tasks:

1. Add bwrap-based sandbox execution.
2. Add landlock-based sandbox execution.
3. Add runtime shell policy.
4. Add file worker protocol and commit handling.
5. Add sandbox status diagnostics.
6. Integrate sandbox selection with permission modes.
7. Add tests for sandbox execution, path policy, and failure modes.

Acceptance:

- Local commands can run under an OS sandbox when available.
- Sandbox failures are explicit and recoverable.
- Permission mode still controls approval.
- Targeted Kaos and engine tests pass.

## Workstream 7: Delivery, docs, and evaluation

Goal: make quality and release discipline enforceable.

Files:

- `.github/workflows/`
- `scripts/`
- `docs/`
- `integration-tests/` or equivalent

Tasks:

1. Add GitHub Actions for guards, typecheck, and targeted tests.
2. Add preflight script.
3. Add bilingual design docs where docs exist.
4. Add E2E test plans.
5. Add collocated tests for thin packages.
6. Add ESLint rules for package boundaries and filenames.
7. Add evaluation harness and baseline metrics.
8. Update `AGENTS.md` and package guides.
9. Run full validation.

Acceptance:

- CI runs `pnpm check:guards`.
- Preflight runs guards, workspace checks, affected package typechecks, and targeted tests.
- Design docs have English and Chinese mirrors.
- Evaluation baseline is recorded.
- `pnpm check:guards` passes.

Format, lint, and build steps are not part of preflight. The tree has no format script, root `pnpm lint` is a Turbo no-op with no package lint tasks, and builds are excluded from the fast local gate. Run `pnpm build` or `pnpm build:cli` separately when a build is required.

### Workstream 7 implementation status (2026-11-11)

Implemented:

- `.github/workflows/ci.yml` with two jobs: guards, and targeted typecheck plus targeted tests. It uses `pnpm install --frozen-lockfile`, the pnpm store cache, `contents: read`, and no secrets.
- `scripts/preflight.mjs` and the root `preflight` script. The runner covers `pnpm check:workspace`, `pnpm check:guards`, typechecks for engine, memory, channels, Tools, Kaos, API, and the CLI, then permission-policy, expanded memory-lifecycle, Bash-sandbox, channels, API-connectivity, Tools, engine-team, and Kaos-sandbox tests. `--dry-run`, `--skip-typecheck`, and `--skip-tests` are supported.
- Bilingual design docs: `docs/en/architecture/omnicode-architecture.md` and `docs/zh/architecture/omnicode-architecture.md`.
- Bilingual E2E plan: `docs/en/quality/e2e-test-plan.md` and `docs/zh/quality/e2e-test-plan.md`.
- Evaluation baseline: `docs/en/quality/memory-recall-evaluation.md` and `docs/zh/quality/memory-recall-evaluation.md`, grounded in `packages/memory/src/retrieval/evaluation.ts`.
- `docs/AGENTS.md` and `scripts/AGENTS.md` updated for the new areas and command.

Deferred:

- ESLint/oxlint boundary and filename rules. There is no ESLint config, `oxlint` is not installed, `.oxlintrc.json` references stale `packages/omnicode-*` paths, and root `pnpm lint` matches no package task. Adding rules would need a new dependency and unrelated config repairs, and the rules could not be validated. Kernel layering remains enforced by `scripts/check-kernel-layering.mjs`.
- New collocated tests. No test scaffolding was added: packages that already have runners keep their existing tests, while `scripts/` and `docs/` have no test runner and must not grow one just to host WS7 assertions.
- Automated E2E cases for Workstreams 3 through 6. Their modules are implemented and targeted package tests pass, but no cross-process E2E runner was added; the E2E plan records the manual/automation boundary.
- Full validation. Guards, engine/memory/CLI typechecks, and targeted suites for permissions, memory, channels, Tools, engine teams, and Kaos sandbox were run. The full Turbo test graph and production builds were not run.

Validation run for this workstream:

- `node scripts/preflight.mjs --dry-run` — OK, 21 steps listed.
- `node scripts/preflight.mjs --skip-typecheck --skip-tests` — OK; guards passed (workspace 4 patterns, 4 Vitest projects, 2552 source files; layering 22 packages, no cycles; comments 283 files; agent docs 56 referenced paths).
- `node scripts/preflight.mjs` — OK, all 21 steps passed. Guards reported 2559 source files; engine, memory, channels, Tools, Kaos, API, and CLI typechecks passed; permission-policy tests passed 136/136, memory-lifecycle 21/21, channels 8/8, API-connectivity 3/3, Tools 66/66, engine-team 29/29, and Kaos sandbox 59/59.
- `pnpm --filter @hilbras/omnicode-engine exec vitest run test/agent/permissionPolicy` — 3 files, 136 tests passed.
- `pnpm --filter @hilbras/omnicode-memory exec vitest run test/evaluation.test.ts test/dreamConsolidation.test.ts test/relevanceSelector.test.ts` — 3 files, 19 tests passed.
- `pnpm --filter @hilbras/omnicode-memory typecheck` — passed.
- YAML and JSON syntax checks for `.github/workflows/ci.yml` and `package.json` — passed.
- The CI workflow was not executed. Do not treat this as a CI result.

## Completion summary (2026-11-11)

All seven workstreams are implemented in the working tree.

- WS1: `auto-mode-classifier`, denial tracking, trusted-answer handling, MCP ambiguity handling, telemetry, dangerous-command escalation, and tests.
- WS2: auto-capture/promotion already existed; dream consolidation, `memory_manage`, channel scope tier, relevance selector, recall metrics, and tests were added.
- WS3: `packages/channels/` contract, registry, bindings, lifecycle commands, and Telegram/DingTalk/WeChat/Feishu/Slack adapters with tests.
- WS4: `Lsp`, worktree, notebook, task-board, team, artifact/source, and tool-result/context diagnostics in `packages/Tools`.
- WS5: team service, arena, workflow budget ledger, forked context cache, notification queue, `Team` tool, and tests.
- WS6: bwrap backend, explicit landlock-unavailable adapter, shell/path policy, file worker, selection, status, and tests.
- WS7: CI workflow, preflight, bilingual architecture/E2E/evaluation docs, and baseline metadata.

Explicitly deferred:

- Discord adapter and automated cross-process channel E2E.
- Refactoring the existing daemon Telegram service onto the new channel adapter. The adapter is implemented and tested; the daemon service remains for backward compatibility.
- Real landlock syscall enforcement; the adapter fails closed and reports unavailability.
- Wiring the sandbox selection seam into `LocalKaos.exec` and the engine permission chain. Selection is pure and tested; the existing execution path is unchanged.
- Type-aware LSP semantics; the `Lsp` tool is a deterministic local fallback.
- Subagent plan-tool policy tests. Existing permission-policy tests cover plan-mode tool approval, but no new subagent-specific policy suite was added.
- ESLint/oxlint boundary rules, because the tree has no working lint configuration.

Validation: `pnpm check:guards`, engine/memory/CLI/Tools/Kaos/channels typechecks, and targeted permission, memory, channels, Tools, engine-team, and Kaos-sandbox tests pass. CI was not executed, and the full Turbo test graph/build graph was not run.

## Phase order

1. Workstream 1
2. Workstream 2
3. Workstream 4
4. Workstream 5
5. Workstream 3
6. Workstream 6
7. Workstream 7

## Validation matrix

- Guards: `pnpm check:guards`
- Preflight: `pnpm preflight` (or `node scripts/preflight.mjs --dry-run`)
- Architecture: `pnpm check:architecture`
- Workspace: `pnpm check:workspace`
- Agent docs: `pnpm check:agent-docs`
- Engine: `pnpm --filter @hilbras/omnicode-engine typecheck` and test
- Memory: `pnpm --filter @hilbras/omnicode-memory test`
- CLI: `pnpm --filter @hilbras/omnicode typecheck` and build
- TUI: `pnpm --filter @hilbras/omnicode-tui` node tests

## Definition of done

All seven workstreams are implemented or explicitly deferred with a documented reason. Targeted tests pass. Full guards pass. Documentation and AGENTS guides are updated. No trust or security invariant is weakened.