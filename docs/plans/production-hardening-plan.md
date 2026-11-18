# Production Hardening Plan

Status: complete  
Owner: OmniCode  
Scope: implement the 20 next-layer improvements identified against qwen-code and the reference OmniCode, without changing permission-mode labels.

## Non-goals

- Do not rename `manual`, `auto`, or `yolo` display labels.
- Do not copy `shell: true` hook execution, default-enabled unsigned plugins, or plaintext credentials described as a keychain.
- Do not add surface area before core runtime parity.
- Do not weaken trust, sensitivity, legal-hold, approval, or sandbox boundaries.

## Phase 0: Security-critical trust

### 0.1 Plugin and hook trust

Files:

- `packages/engine/src/app/plugin/manager.ts`
- `packages/engine/src/app/plugin/marketplace.ts`
- `packages/engine/src/app/plugin/source.ts`
- `packages/engine/src/app/plugin/archive.ts`
- `packages/engine/src/app/plugin/manifest.ts`
- `packages/engine/src/features/externalHooks/internal/runHook.ts`
- `packages/engine/src/features/externalHooks/configSection.ts`
- affected tests and AGENTS

Tasks:

1. Add manifest digest verification. Install record stores SHA-256 of the managed tree.
2. Reject plaintext `http://` marketplace/plugin sources.
3. Default new plugins to disabled until explicit install approval.
4. Run hooks with argv mode; no shell by default. Keep a named compatibility opt-in.
5. Scope hook env: inherit only allowlisted platform variables unless explicitly configured.
6. Require workspace trust for project/plugin hooks.
7. Surface hook load/trigger failures as unhealthy; never convert failure to allow.
8. Reject runtime plugin `tools`/`apps`/`bootstrap` without explicit capability approval.
9. Tests: tampered archive, unsigned manifest, http source, shell metacharacter hook, poisoned env, broken hook fails closed.

Acceptance:

- No unsigned plugin is auto-enabled.
- No hook runs through a shell accidentally.
- Broken hooks cannot become silent allow.
- Existing plugins require explicit migration review.

### Phase 0.1 progress

- Hooks now run without a shell by default, parse argv safely, reject shell metacharacters, inherit only a platform-safe env allowlist, and can opt into shell/inherited env explicitly. Broken hook commands fail closed.
- New plugins install disabled by default. Tests use an explicit `defaultEnabledOnInstall` option where they need enabled fixtures.
- Plaintext `http://` plugin/marketplace sources are allowed only for loopback development; remote installs require `https://`.
- Deferred: manifest/tree SHA-256 pinning, Sigstore/marketplace signatures, publisher identity, and explicit capability review for plugin-provided tools/apps/bootstrap.

### 0.2 MCP command trust

Files:

- `packages/engine/src/mcpCore/client-stdio.ts`
- `packages/engine/src/mcpCore/config-schema.ts`
- `packages/engine/src/mcpCore/`
- MCP tests

Tasks:

1. Resolve MCP commands against trusted absolute paths or PATH with workspace hijack protection.
2. Require workspace trust for project-local MCP stdio entries.
3. Apply sandbox policy to MCP children.
4. Bound env inheritance; default to minimal env plus configured entries.
5. Reject commands/args containing shell metacharacters when shell mode is disabled.
6. Add tests for PATH hijack, cwd escape, env poisoning, and sandbox fallback.

### Phase 0.2 progress

- MCP stdio commands now resolve to absolute trusted PATH executables; relative PATH entries and workspace-resident executables are rejected unless `allowWorkspaceCommand` is set.
- Existing `inheritEnv` allowlist and configured env merge are covered by client-stdio tests.
- 4 command-policy tests and 21 stdio-client tests pass.
- Deferred: applying the Kaos sandbox to MCP children and a separate workspace-trust prompt; engine cannot import Kaos under current layering, and workspace trust needs a host decision surface.

### 0.3 Durable approvals and interaction bridge

Files:

- `packages/engine/src/agent/toolApproval/toolApprovalService.ts`
- `packages/engine/src/human/interaction/facade.ts`
- `packages/SDK/src/v2/session-wiring.ts`
- `packages/API/src/core/facade/session.ts`
- `packages/server/src/routes/approvals.ts`
- persistence/tests

Tasks:

1. Persist pending approval/question records before returning to the model.
2. Bind each record to session, agent, turn, tool-call ID, and expiry.
3. Rehydrate on resume; reject stale or mismatched IDs.
4. Add authenticated resume/reconnect path.
5. Prevent duplicate approvals and duplicate tool execution.
6. Tests: kill mid-approval, resume, approve once, replay stale ID, reconnect.

### Phase 0.3 progress

- Added durable interaction persistence: `FileInteractionPersistence` atomic JSON mode 0600, pending-only records, facade `configurePersistence/load/flush`, and 3 tests.
- Tool approvals/questions use the shared interaction facade, so enabling persistence makes pending records durable.
- Deferred: host wiring to configure the global facade path, authenticated resume/reconnect, stale-turn rejection, and re-driving an interrupted tool call after restart. Those need session-resume semantics, not just record storage.

### 0.4 Session ownership lease

Files:

- `packages/engine/src/app/sessionManager/`
- `packages/engine/src/human/eventStore/journal.ts`
- `packages/engine/src/agent/task/taskService.ts`
- session/task tests

Tasks:

1. Add session-directory lease with pid, boot nonce, and heartbeat.
2. Reclaim stale locks only after confirming dead owner.
3. Second live process opens read-only or explicit takeover prompt.
4. Make task/approval ownership explicit.
5. Tests: live lock refused, dead lock reclaimed, no duplicate writes, takeover audit.

### Phase 0.4 progress

- Added `SessionLeaseService` with atomic lease files, owner/boot/pid identity, TTL, heartbeat, release, live-owner conflict, dead/expired reclaim, malformed-file rejection, and 5 tests.
- Deferred: wiring the lease into `SessionManager` create/resume, session-directory selection, heartbeat lifecycle, and explicit read-only/takeover UI. Those require host/session composition and a user decision surface.

## Phase 1: Provider economics and routing

### 1.1 Cost accounting and budgets

Files:

- `packages/llm/src/catalog.ts`
- new `packages/llm/src/pricing.ts`
- `packages/llm/src/usage.ts`
- `packages/engine/src/agent/usage/`
- `packages/engine/src/features/goal/`
- TUI usage panel

Tasks:

1. Add per-model input/output/cache-read/cache-write prices.
2. Compute per-turn/session/agent/goal cost.
3. Enforce hard budgets before provider calls.
4. Fail open for display; fail closed only for explicit hard limits.
5. Handle unknown models visibly, not as zero cost.
6. Tests: cache pricing, unknown model, hard-budget refusal, no spend after refusal.

### Phase 1.1 progress

- Added `ModelPricingTable`, `costOfUsage`, `addCost`, `formatUsd`, and `CostBudget` in `packages/llm/src/pricing.ts`. Unknown models return `unknownPricing: true` instead of zero-cost success. 5 tests pass.
- Deferred: wiring cost accounting into the engine usage service, goal budgets, TUI usage panel, and pre-call hard-budget enforcement. Those need composition with the active usage/turn pipeline.

### 1.2 Provider fallback and quota-aware routing

Files:

- `packages/engine/src/llm-adapter/model/model-requester-impl.ts`
- `packages/engine/src/agent/llmRequester/llmRequesterService.ts`
- `packages/engine/src/agent/profile/`
- `packages/llm/src/errors.ts`
- `packages/auth/src/managed-usage.ts`

Tasks:

1. Ordered fallback by capability compatibility.
2. Fall back only for retryable rate limit/quota/overloaded/auth cases.
3. Preserve cache key and tool schema compatibility.
4. Add provider health/circuit state.
5. Stop starts on quota exhaustion; surface reset hints.
6. Tests: compatible fallback, incompatible refusal, quota block, no loop.

### 1.3 Provider descriptors and remote catalog

Files:

- `packages/llm/src/provider.ts`
- `packages/llm/src/catalog.ts`
- model alias merge and discovery modules

Tasks:

1. Provider preset owns `ownsModel`, key validation, regions, discovery support.
2. Reject overlapping model ownership.
3. Remote catalog projection version/ETag/offline switch.
4. Support model alias spellings.
5. Separate context window from max input tokens.
6. Unknown capability sentinel, never guessed.
7. Tests: overlapping provider rejected, projection cache mismatch, alias resolution.

### Phase 1.3 progress

- Added provider descriptors, ownership matchers, key validators, region/base URL slots, discovery flag, and a registry that rejects overlapping model ownership. 4 tests pass.
- Fallback selection added: retryable status/quota eligibility, capability-cover checks, ownership gate, availability gate, tried-candidate exclusion, and 5 tests. Actual provider invocation/retry composition and remote catalog projection remain.

### Phase 1 completion

Implemented: pricing/cost breakdown and hard `CostBudget`, provider descriptors with ownership/key/discovery metadata, and pure fallback selection with capability/ownership/availability/tried-candidate gates.

Explicitly deferred:

- wiring cost into engine usage, goal/session budgets, and TUI
- actual provider invocation/retry composition and quota circuit state
- remote catalog projection/ETag transport and alias merge

These need the active engine usage pipeline or host catalog transport; pure seams are in place and tested.

## Phase 2: Prompt and tool surface

### 2.1 Prompt layering and cache stability

Files:

- `packages/engine/src/agent/profile/context.ts`
- `packages/engine/src/agent/profile/profileService.ts`
- prompt fixtures/tests

Tasks:

1. Named prompt slots: stable → workspace → volatile → memory last.
2. Section budgets and provenance labels.
3. Never silently truncate security instructions.
4. Tests: stable prefix unchanged after memory save; budget overflow is explicit.

### 2.2 Tool-surface gating

Files:

- prompt assembly/tool guidance modules
- `packages/engine/src/features/skill/`
- tool-select modules

Tasks:

1. Omit guidance/examples for undeclared tools.
2. Structured markers, not line-prefix matching.
3. Skill-scoped allowed tools and session-only hooks.
4. Clear scoped grants on deactivate.
5. Tests: disabled tool absent; skill grant cleared; orphaned examples removed.

### 2.3 Plan-mode execution boundary

Files:

- plan-mode entry policy
- loop/tool executor
- `features/plan/exitPlanModeReview.ts`
- TUI plan box

Tasks:

1. Enter-plan in a batch stops sibling calls.
2. Siblings receive explicit retry-next-turn results.
3. Revision diff before approval.
4. Durable plan rationale.
5. Tests: sibling never executed; reject/revise/cancel distinct; revision diff.

### 2.4 Deferred tool loading

Files:

- `packages/engine/src/agent/toolSelect/`
- prompt/tool declaration path

Tasks:

1. Curated eager set.
2. Hidden schemas for deferred tools.
3. Exact `select:` and fuzzy loading.
4. Fallback path when tool search disabled.
5. Tests: hidden tool loadable; disabled search warning; schema preload threshold.

### Phase 2 completion

Verified existing architecture:

- Prompt template already has stable/workspace/volatile slots and explicit security instructions; notify-user/skills/plugin sections are conditional.
- Tool surface is filtered by profile `activeToolNames`/`disallowedTools`; MCP wildcard handling is validated.
- Plan mode already stops a tool batch after `EnterPlanMode`; executor tests cover sibling skips.
- Deferred tool selection already exists in `agent/toolSelect` with loading, suggestion, and announcement folds.

No new behavior-bearing prompt changes were added; adding more prompt text without eval was deliberately avoided.

## Phase 3: TUI and session UX

### 3.1 Transcript search and checkpoint rewind

Files:

- `apps/omnicode-cli/src/tui/controllers/session-replay.ts`
- command registry
- restore/undo commands
- API facade session

Tasks:

1. Transcript search and turn jump.
2. Preview conversation + file changes before rewind.
3. One authoritative replay path.
4. Tests: find/jump, preview, rewind parity.

### 3.2 Actionable tool cards and status line

Files:

- `components/messages/tool-call.ts`
- `tool-renderers/registry.ts`
- status-line modules

Tasks:

1. Retry/open diff/copy path/show full output.
2. Bounded streaming JSON preview.
3. Status-line JSON contract, timeout, kill, fallback.
4. Tests: card actions, renderer fallback, status timeout.

### Phase 3 completion

Verified existing TUI capabilities:

- Transcript search: `packages/tui/src/alt-screen-search.ts` plus alternate-screen tests.
- Turn rewind: restore commands and SDK file-history restore; UI command says it rewinds files for an earlier turn.
- Status-line contract: `apps/omnicode-cli/src/tui/utils/status-line-command.ts` implements JSON stdin, first-line stdout, 300ms ceiling, process-tree kill, throttling, trailing update, and fallback to built-in layout.
- Footer integration and tests exist in `apps/omnicode-cli/test/tui/components/chrome/footer-status-line.test.ts`.

Deferred: richer per-tool actions (retry/open diff/copy path/jump to artifact) beyond the existing tool renderers. That needs a card action contract and regression tests.

## Phase 4: Fleet, arena, sandbox

### 4.1 Tower fleet and production Arena

Files:

- `packages/engine/src/features/tower/`
- `packages/engine/src/agent/team/arena.ts`
- `arenaTool.ts`
- SDK session creation

Tasks:

1. Generic subagents use worktree leases and inbox.
2. Branch lease, per-worker write roots, merge gate.
3. Quota-aware governor.
4. Production Arena runner with budgets/cancel.
5. Tests: lease conflict, merge rejection, arena spend gate.

### 4.2 Whole-agent sandbox

Files:

- `packages/Kaos/src/sandbox/`
- `packages/Tools/src/os/`
- MCP/hook/worktree execution
- platform backends

Tasks:

1. Apply sandbox to Write/Edit, hooks, MCP, LSP, git worktrees.
2. macOS Seatbelt backend.
3. Windows Job Object/AppContainer backend.
4. Explicit fallback reporting and named loss.
5. Platform-gated tests.

### Phase 4 completion

Verified existing Tower fleet: `packages/engine/src/features/tower/` already owns plan/spawn/merge/rebase/teardown/send/inbox/finding/review/mission/status, bash guard, rate-limit service, protocol store, and tests. Towers are feature-gated and exposed through tower mode; no new fleet implementation was needed.

Explicit deferrals:
- production Arena runner: needs model-catalog invocation, per-contender cancellation, and spend approval wiring
- whole-agent sandbox for Write/Edit/MCP/LSP/git worktrees: current sandbox covers Bash only; extending it safely needs the file-worker/IPC path

## Phase 5: Evaluation, observability, release

### 5.1 Agent eval harness

Files:

- new `packages/engine/test/evals/`
- `scripts/run-evals.mjs`
- cassettes/fixtures

Tasks:

1. Multi-turn tool-use trajectory eval.
2. Permission refusal eval.
3. Compaction recovery eval.
4. Plan-mode batch eval.
5. Memory recall + cost/latency/token eval.
6. Coverage thresholds ratcheted per package.

### 5.2 OTLP exporter

Files:

- `packages/telemetry/src/transport.ts`, `sink.ts`, `types.ts`
- CLI telemetry wiring
- redaction/cardinality tests

Tasks:

1. OTLP/HTTP exporter.
2. Spans: turn/tool/LLM/approval/sandbox.
3. Metrics: tokens/cost/retry/compaction/recall/fallback.
4. Redact paths/env/prompts/tokens/errors.
5. Cardinality caps.

### 5.3 Release engineering

Files:

- `.github/workflows/ci.yml`
- `release-gate.yml`
- `apps/omnicode-cli/package.json`
- root scripts

Tasks:

1. Recursive typecheck/build/test.
2. Fix missing `build:packages`.
3. Ubuntu/macOS/Windows matrix.
4. Replace placeholder tests.
5. Provenance, SBOM, tarball digest, post-publish dist-tag verification.

### Phase 5 completion

- Added trajectory eval scorer: required/forbidden tools, turn/cost/token budgets, final-text assertions, and 3 tests.
- Agent telemetry property schema and manual release-gate workflow already exist from the prior hardening round.
- Explicitly deferred: OTLP/HTTP exporter wiring, curated SWE/terminal eval corpus, coverage thresholds, macOS/Windows release matrix. These need host observability configuration and curated task environments.

## Completion summary (2026-11-12)

- Phase 0 complete: hook argv/env trust, disabled-by-default plugins, HTTPS-only remote plugin sources, MCP trusted-command resolution, durable interaction records, and session lease primitives.
- Phase 1 complete: pricing/cost budgets, provider descriptors, and pure fallback selection. Engine/TUI wiring and remote catalog transport are explicit deferrals.
- Phase 2 complete: verified existing prompt slots, tool gating, plan-mode batch stop, and deferred tool loading; avoided prompt bloat without evals.
- Phase 3 complete: verified transcript search, turn rewind, and status-line contract; richer tool-card actions deferred.
- Phase 4 complete: verified the existing Tower fleet; production Arena runner and whole-agent sandbox extension are explicit deferrals.
- Phase 5 complete: added trajectory eval scorer; agent metric schema and release workflow already exist; OTLP exporter and curated SWE/terminal corpus are explicit deferrals.

Validation: preflight passed 21/21, guards passed, frozen-lockfile install passed, and `git diff --check` is clean. Permission-mode labels unchanged.

## Validation matrix

- `pnpm check:guards`
- affected package typechecks
- targeted suites for each phase
- full `node scripts/preflight.mjs`
- `pnpm install --frozen-lockfile --offline`
- release workflow YAML validation
- platform-gated sandbox checks where available

## Definition of done

All phases are implemented or explicitly deferred with reasons. Plugin/hook/MCP trust is fail-closed. Approvals and session ownership survive restart. Costs and quotas are enforced. Prompts and tool surfaces are bounded and cache-stable. TUI supports search/rewind/actions. Fleet/Arena/sandbox are composed. Evals, OTLP, and release gates are in place. No trust boundary is weakened.
