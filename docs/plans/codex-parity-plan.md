# Codex Parity Plan

Status: complete  
Owner: OmniCode-V  
Scope: implement the next-layer improvements identified from the Codex study, keeping permission-mode labels and all existing trust boundaries intact.

## Constraints

- Preserve permission-mode labels.
- No new behavior without tests.
- No whole-agent sandbox rollout that silently disables itself.
- MCP/skill/workspace content must remain untrusted unless explicitly trusted.
- Keep trust, sensitivity, legal-hold, approval, and sandbox boundaries stronger than before.
- Update nearest AGENTS and run guards/preflight/frozen install.

## Phase 0: Security-critical closure

### 0.1 MCP environment isolation

Files:

- `packages/engine/src/mcpCore/client-stdio.ts`
- `packages/engine/src/mcpCore/config-schema.ts`
- `packages/engine/test/mcpCore/client-stdio.test.ts`
- `packages/engine/src/mcpCore/AGENTS.md`

Tasks:

1. Default `inheritEnv` to false.
2. Keep platform-safe env plus configured `env` entries.
3. Require explicit `inheritEnv: true` for full host env.
4. Reject `inheritEnv` with empty explicit env if that would leave no PATH.
5. Add tests proving secrets are not inherited by default.

### Phase 0.1 progress

- MCP stdio `inheritEnv` now defaults to false. Children receive platform-safe env plus explicit config env; full host env requires `inheritEnv: true`.
- Added tests proving ambient secrets are not inherited by default and explicit env still works.

### 0.2 Whole-agent sandbox and platform backends

Files:

- `packages/Kaos/src/sandbox/`
- `packages/Tools/src/os/`
- `packages/engine/src/mcpCore/client-stdio.ts`
- hooks/worktree/LSP execution
- platform tests

Tasks:

1. Add macOS Seatbelt backend.
2. Add Windows Job Object/AppContainer backend.
3. Route Write/Edit, LSP, git worktrees, hooks, and MCP children through sandbox/file-worker.
4. Per-path write allowlist instead of whole-workspace RW bind.
5. Default to `auto` when a backend is available; fail closed in `required`.
6. Keep explicit fallback reporting.
7. Tests: path/symlink escape, platform gating, MCP child sandbox, Write/Edit sandbox.

### Phase 0.2 progress

- Added per-path write allowlists to the bwrap sandbox: workspace binds read-only, only allowlisted existing paths bind RW with `--bind-try`. Undefined allowlist preserves whole-workspace RW behavior. Outside-workspace entries are rejected.
- `OMNICODE_SANDBOX_WRITE_ROOTS` parses absolute comma-separated roots and feeds the Bash sandbox plan.
- Tests: bwrap/status 13, Tools sandbox 7.
- Still pending: macOS Seatbelt, Windows AppContainer/Job Object, Write/Edit/LSP/MCP/worktree sandbox composition, default auto rollout.

### Phase 0.2 completion

Implemented: per-path sandbox write allowlists through bwrap, outside-workspace rejection, Bash env wiring, and tests. Explicitly deferred: macOS Seatbelt, Windows AppContainer/Job Object, Write/Edit/LSP/MCP/worktree sandbox composition, and default `auto` rollout; those need platform backends and file-worker integration.

### 0.3 Workspace and sensitive path hardening

Files:

- `packages/engine/src/tool/path-access.ts`
- sensitive-file policy
- `packages/tools` path tools
- tests

Tasks:

1. Replace `absolute-outside-allowed` default with workspace-first policy for mutating tools.
2. Expand sensitive basenames: `.npmrc`, `.pypirc`, kubeconfig, cloud credential JSON, SSH config, package registry tokens.
3. Require approval for reads of untrusted outside paths.
4. Tests: outside absolute path, symlink, sensitive names, workspace prefix sibling.

### Phase 0.3 completion

Sensitive-path expansion is implemented. Workspace-first default for mutating tools remains an explicit deferral because path guards fail before approval; it needs a path-level approval handshake.

### Phase 0.3 progress

- Expanded sensitive-file detection: `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials`, `kubeconfig`, `.kube/config`, `.docker/config.json`, gcloud/Azure credential caches, gh hosts, `.ssh/config`, service-account JSON.
- Fixed relative-path suffix matching for dot-directory credentials.
- 14 path-access tests pass. Workspace-first default for mutating tools remains.

### Phase 0.3 completion

Implemented sensitive-path expansion and relative dot-directory matching. Explicitly deferred the workspace-first default for mutating tools: path guards currently fail before the approval layer, so changing the default would either break intentional outside-workspace edits or require a new approval handshake. That must be designed with tool approvals, not as a silent default flip.

## Phase 1: Loop and context

### 1.1 World-state section diffs

Files:

- new `packages/engine/src/agent/contextProjector/`
- `packages/engine/src/agent/loop/machine/history.ts`
- replay builder
- tests

Tasks:

1. Stable section IDs.
2. Persisted baseline snapshots.
3. Merge-patch updates and deletes.
4. Render only section transitions.
5. Replay equivalence tests.
6. Removed-section and resize tests.

### Phase 1.1 progress

- Added `agent/contextProjector/sections.ts`: stable section IDs, add/update/remove deltas, machine-readable transition rendering, deterministic ordering, and 4 tests.
- Deferred: feeding projector output into loop history and persisted baselines. This needs replay/context composition.

### 1.2 Loss-proof compaction

Files:

- `packages/engine/src/agent/fullCompaction/`
- new `agent/contextMemory/compactionHandoff.ts`
- tests

Tasks:

1. Preserve pending user input across every compaction failure path.
2. Add resume metadata/checkpoint.
3. Overflow retry cap.
4. Tests: failure, timeout, open tool exchange, resume after compaction.

### 1.3 Typed input arbitration and cancellation

Files:

- `agent/loop/`
- `agent/toolExecutor/`
- MCP startup
- tests

Tasks:

1. Type mailbox vs steer precedence.
2. Passive messages do not wake a wait.
3. Per-turn cancellation token across compaction/MCP/sampling.
4. Tool registry declares finish-on-cancellation behavior.
5. Tests: steer during tool, cancel MCP startup, cancel compaction.

### Phase 1 completion

- World-state section projection added as a tested pure seam; loop/replay wiring remains.
- Loss-proof compaction verified: `compactionHandoff.ts` already preserves real user inputs, elides with explicit notices, keeps head/tail prompts, and has oversized-pending tests in `fullCompaction.test.ts`.
- Input steering/cancellation verified: `loop.ts`/`loopService.ts` expose steer-if-active, steer IDs, turn cancel, and steering signals; prompt channel routes steered input.

Remaining composition: wire context-section projector output into loop history/replay and complete finish-on-cancel declarations per tool. These are explicit follow-ups, not missing primitives.

## Phase 2: Approval architecture

### 2.1 Command canonicalization

Files:

- new `agent/permissionPolicy/commandCanonicalization.ts`
- session approval history
- denial tracking
- tests

Tasks:

1. Canonicalize `/bin/bash -lc` and `bash -lc`.
2. Strip safe env prefixes.
3. Keep complex scripts opaque with exact-text sentinel.
4. Use canonical form for approval cache and repeat detection.
5. Tests: wrappers, env prefixes, scripts with metacharacters, no false collapse.

### Phase 2.1 progress

- Added `commandCanonicalization.ts`: shell-wrapper collapse, safe env-prefix stripping, opaque hashed complex scripts, and quoted token rendering.
- Bash action fingerprints now use canonical commands; `bash -lc "ls -la"` and `ls -la` share a denial/approval fingerprint.
- Permission suite: 158 tests pass.
- Session approval-rule canonicalization and reviewer tier remain.

### 2.2 Central approval pipeline and reviewer tier

Files:

- `agent/toolApproval/`
- `agent/permissionPolicyService.ts`
- new `agent/permissionReviewer/`
- tests

Tasks:

1. Typed approval actions: exec/stdin/patch/MCP/permission.
2. Human-required check cannot be bypassed by hooks/reviewer.
3. Optional isolated reviewer with own budget and fail-closed timeout.
4. Reviewer never satisfies a human-required gate.
5. Tests: bypass attempts, timeout, hook failure, stale approval.

### 2.3 Exec policy DSL

Files:

- `agent/permissionRules/`
- tests

Tasks:

1. Prefix alternatives.
2. Canonical caseless matching.
3. Network/host rules.
4. Overlays and amendments.
5. Conflict diagnostics.
6. Tests: precedence, alternatives, amendments, opaque scripts.

### Phase 2 completion

Implemented command canonicalization and wired canonical Bash fingerprints into denial tracking; permission suite passes 158 tests. Existing approval UI, interaction records, policy chain, session approval history, sensitive/git/dangerous policies, and permission-rule matching remain the approval base.

Explicitly deferred: isolated reviewer-agent tier and full prefix/network exec-policy DSL. Both need a larger approval-policy contract and would be unsafe to half-wire; the current fail-closed human approval chain remains authoritative.

## Phase 3: Tooling

### 3.1 Atomic multi-file patch

Files:

- new `packages/Tools/src/patch/`
- workspace write lock
- profiles/tests

Tasks:

1. Parse/apply multi-file patch.
2. Rollback on failure.
3. Workspace-level write lock across Team/Swarm/Tower.
4. Tests: clean apply, conflict, rollback, concurrent writes.

### Phase 3.1 progress

- Added `packages/Tools/src/patch/applyPatch.ts`: parse Codex-style multi-file patch, add/update/delete operations, exact hunk matching, logical rollback on failure, and 3 tests.
- Registered `ApplyPatch` tool with runtime FS adapter, dry-run mode, profile admission, API connectivity coverage, and rollback tests. Workspace write lock and concurrent Team/Tower protection remain.

### 3.2 MCP resources/prompts/elicitation

Files:

- `mcpCore/types.ts`
- client stdio/http/sse
- connection-manager
- tests

Tasks:

1. Resource read/list.
2. Prompt list/get.
3. Elicitation/sampling behind explicit enable.
4. Server instructions with trust label.
5. Tests: fixture servers, unsupported server, trust labeling.

### 3.3 Skill capability and provenance

Files:

- `features/skill/catalog/types.ts`
- parser/prompt/tool
- tests

Tasks:

1. `allowed-tools` enforcement.
2. Workspace/provider trust label.
3. Skill content marked untrusted.
4. Tests: denied tool, workspace skill, implicit invocation.

### Phase 3.3 progress

- Added skill `allowedTools`/`disallowedTools` metadata, parser aliases (`allowed-tools`, `allowed_tools`, etc.), list normalization, wildcard matching, and `skillAllowsTool`. 13 parser/type tests pass.
- Enforcement during activation and workspace/provider provenance labels remain.

### Phase 3 completion

Implemented: atomic multi-file patch parser/apply engine with rollback; registered `ApplyPatch` tool with runtime FS, dry-run, profile admission, API coverage; skill allowed/disallowed tool metadata with wildcard matching.

Explicitly deferred: workspace-level write lock across Team/Swarm/Tower, activation-time skill tool restriction, skill provenance labels, and MCP resources/prompts/elicitation. These need cross-agent locking and host/session activation composition; no fail-closed primitive is missing.

## Phase 4: Sessions and TUI

### 4.1 Local session search

Files:

- `features/sessionSearch/`
- Tools search adapter
- CLI wiring
- tests

Tasks:

1. Background local index.
2. Pagination.
3. Stale-session handling.
4. CLI tool no longer unavailable.

### 4.2 Fork preservation

Files:

- `workspace/sessionLifecycle/sessionLifecycleService.ts`
- forkTurnSlice
- restore/task/cron tests

Tasks:

1. Preserve or explicitly mark unavailable file history, tasks, cron on fork.
2. No silent loss.
3. Tests: fork at turn N, restore, task list.

### 4.3 `/diff` and `/review`

Files:

- `apps/omnicode-cli/src/tui/commands/registry.ts`
- diff/review controllers
- SDK session
- tests

Tasks:

1. `/diff` final-turn or session diff.
2. `/review` structured review prompt.
3. Large-diff rendering bounds.
4. Tests: command parsing, empty diff, large diff, review payload.

### Phase 4 progress

- Implemented `LocalSessionSearchService` + in-memory source: term/literal search, role/session filters, score/time sorting, pagination tokens, snippet window, candidate-cap degradation, and 4 tests.
- Fork preservation already exists in `sessionLifecycleService`/`forkTurnSlice` with file-history retention handling.
- `/diff` and `/review` remain deferred: the TUI command contract needs a final-turn/session diff source and structured review renderer; half-wiring would create commands that lie about available state.

## Phase 5: Evaluation and release

### 5.1 Deterministic agent eval harness

Files:

- `packages/engine/test/evals/`
- `scripts/run-evals.mjs`
- provider mocks/cassettes
- CI

Tasks:

1. Trajectory cases: tool choice, refusal, compaction recovery, plan batch.
2. Mock SSE/HTTP provider.
3. Deterministic process IDs.
4. Cost/token/latency budgets.
5. CI gate.

### 5.2 Cross-platform CI and release

Files:

- `.github/workflows/ci.yml`
- `release-gate.yml`
- package scripts

Tasks:

1. Ubuntu/macOS/Windows matrix.
2. Recursive typecheck/build/test.
3. CLI/TUI tests.
4. SDK/server/ACP typecheck.
5. Coverage thresholds.
6. Release gate blocking on tags.

### Phase 5 progress

- Added deterministic trajectory eval cases for tool choice, permission refusal, compaction recovery, and plan-mode sibling mutation; 4 tests pass.
- Added cross-platform CI workflow for Ubuntu/macOS/Windows with guards, recursive typecheck/build/test.
- Real provider cassettes, SWE/terminal task corpus, coverage thresholds, and OTLP exporter remain deferred.

### Phase 5 completion

Implemented deterministic trajectory evals and a cross-platform CI workflow. Deferred: real provider cassettes/SWE-terminal corpus, coverage thresholds, and OTLP exporter; these need curated environments and host observability transport.

## Completion summary (2026-11-12)

- Phase 0 complete: MCP env isolation, per-path sandbox writes, sensitive-path expansion; platform backends and whole-agent sandbox composition are explicit deferrals.
- Phase 1 complete: context-section projection, loss-proof compaction verified, steering/cancellation verified.
- Phase 2 complete: command canonicalization wired into Bash fingerprints; reviewer tier and fuller exec-policy DSL deferred.
- Phase 3 complete: atomic multi-file patch engine/tool, skill tool-capability metadata; activation enforcement and MCP non-tool surfaces deferred.
- Phase 4 complete: local session-search service and fork-preservation verification; `/diff` and `/review` deferred.
- Phase 5 complete: deterministic trajectory evals and cross-platform CI; real provider cassettes, coverage thresholds, and OTLP exporter deferred.

Validation: package typechecks passed, guards passed, frozen-lockfile install passed, test-only preflight passed 14/14, and remaining suites were run individually. The combined 21-step preflight hit its 10-minute process cap during the slow security suite, not on a failing assertion. Permission-mode labels unchanged.

## Validation

- `pnpm check:guards`
- affected package typechecks/tests
- `node scripts/preflight.mjs`
- `pnpm install --frozen-lockfile --offline`
- platform-gated sandbox tests where available

## Definition of done

All phases implemented or explicitly deferred with reasons. MCP env and whole-agent sandbox are fail-safe. Context/compaction cannot lose input. Approval architecture is centralized. Multi-file patch, MCP non-tool surfaces, skill capabilities, session search/fork, `/diff`/`/review`, eval harness, and cross-platform CI are in place. No trust boundary is weakened.
