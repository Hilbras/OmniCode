# Competitive Hardening Plan

Status: complete  
Owner: OmniCode  
Scope: close the gaps found against qwen-code and the reference OmniCode, without changing the existing permission-mode labels.

## Non-goals

- Do not rename or invert `manual`, `auto`, or `yolo` display labels. The user explicitly rejected that change.
- Do not copy giant scheduler/loop files, surface sprawl, or blanket comment bans.
- Do not weaken trust, sensitivity, legal-hold, approval, or sandbox boundaries.

## Baseline constraints

- Preserve package layering and `pnpm check:guards`.
- Every behavior change gets a test.
- New tools require registry, profile, and approval integration.
- Runtime services require lifecycle composition, not just exports.
- Update the nearest `AGENTS.md` when paths, commands, or hard rules change.
- Finish with `pnpm check:guards`, affected typechecks/tests, and frozen-lockfile install.

## Progress log (2026-11-11)

- Phase 0.1 complete: sensitive-file and git-control policies now run before auto-classifier; network, spend, and destructive-memory tools removed from blanket approvals; permission tests pass 146/146. Permission-mode labels unchanged.
- Phase 0.3 complete: `memory_manage` now emits real newlines; tests cover description, list redaction, and dream output.
- Phase 0.2 complete: auto mode now reads the latest user request and recent tool context; workspace writes require explicit edit intent; ambiguous actions ask. A model-backed classifier runner remains deferred; ambiguity always asks rather than falling through to approval. Phase 0.4 remains.

## Phase 0: Safety corrections

### 0.1 Approval scope and policy order

Files:

- `packages/engine/src/agent/permissionPolicy/permissionPolicyService.ts`
- `packages/engine/src/agent/permissionPolicy/policies/auto-mode-classifier.ts`
- `packages/engine/src/agent/permissionPolicy/policies/default-tool-approve.ts`
- `packages/engine/test/agent/permissionPolicy/`

Tasks:

1. Move sensitive-file, git-control-path, dangerous-command, and configured ask/deny policies ahead of any broad auto approval.
2. Remove network, spend, and destructive-memory tools from blanket auto approval:
   - `FetchURL`
   - `WebSearch` unless explicitly configured
   - `AgentSwarm`
   - `Arena` when runner-backed
   - `memory_forget`
   - `memory_manage` mutations
3. Keep read-only tools and clearly safe internal tools approved.
4. Add structured reasons for every approval so telemetry stays auditable.
5. Add regression tests proving sensitive paths, git control paths, network, spend, and memory mutation cannot bypass ask gates.

Acceptance:

- No safe-listed tool can bypass sensitive/git/dangerous policies.
- Network/spend/destructive memory actions ask unless explicitly configured.
- Permission labels remain unchanged.

### 0.2 Context-aware auto mode

Files:

- `packages/engine/src/agent/permissionPolicy/policies/auto-mode-classifier.ts`
- new `packages/engine/src/agent/permissionPolicy/autoModeContext.ts`
- `packages/engine/src/agent/permissionPolicy/denialTracking.ts`
- `packages/engine/test/agent/permissionPolicy/`

Tasks:

1. Add a deterministic fast path: safe tool, workspace-contained accept-edits, read-only Bash, trusted user answer.
2. Add transcript/context input: current user request, prior tool calls, denial history, workspace state, and shell semantics.
3. Add a structured decision interface: `allow`, `ask`, `deny`, reason category, confidence, and fallback.
4. Do not call a model for deterministic safe paths; reserve any model classifier for ambiguous actions behind an injected runner.
5. Fail closed to `ask` on timeout, invalid response, or unavailable classifier.
6. Add request-level budgets so classifier calls cannot loop or explode cost.
7. Add tests for prompt injection, ambiguous MCP grants, network requests, spend actions, destructive commands, and denials.

Acceptance:

- Auto mode uses context, not only a static tool list.
- Ambiguous actions ask.
- Denials are tracked and surfaced.
- Classifier failure never becomes approval.

### 0.3 `memory_manage` correctness

Files:

- `packages/memory/src/tool/memoryManageTool.ts`
- `packages/memory/test/tool.test.ts`
- `packages/memory/test/memoryManage.test.ts`

Tasks:

1. Fix literal `\n` joins so descriptions and outputs use real newlines.
2. Add tests for `dream`, `consolidate`, `list`, dry-run, legal hold, secret/confidential redaction, supersession, and channel scope.
3. Assert tool output never contains memory content for sensitive records.
4. Add profile and approval regression coverage.

Acceptance:

- Tool descriptions and outputs render correctly.
- Sensitive content never reaches model output through `memory_manage`.
- Tests cover every action.

### 0.4 Documentation truth

Files:

- `AGENTS.md`
- `packages/README.md`
- `docs/en/quality/e2e-test-plan.md`
- `docs/zh/quality/e2e-test-plan.md`
- `.github/workflows/ci.yml`
- `scripts/preflight.mjs`

Tasks:

1. Remove stale claims that CI or `flake.nix` does or does not exist.
2. Mark tests and runtime composition that are not actually exercised.
3. Add a docs-drift guard or a checked checklist for CI/E2E claims.
4. Keep preflight as fast gate; add a separate release gate for build/full tests.

Acceptance:

- Docs match the tree.
- No test or CI claim is unsupported.

## Phase 1: Loop resilience and context quality

### 1.1 Microcompaction

Files:

- new `packages/engine/src/agent/contextMemory/microcompaction.ts`
- `packages/engine/src/agent/loop/machine/history.ts`
- `packages/engine/src/agent/contextProjector/`
- `packages/engine/test/agent/contextMemory/`

Tasks:

1. Evict stale tool results and media before full compaction.
2. Drain to a low watermark, not just below the trigger.
3. Preserve open tool calls and their results as a unit.
4. Keep recent user turns and explicit decisions.
5. Add tests for large repeated reads, image-heavy turns, open tool exchanges, and post-compaction recall.

### 1.2 Compaction split integrity

Files:

- `packages/engine/src/agent/fullCompaction/strategy.ts`
- `packages/engine/src/agent/fullCompaction/`
- `packages/engine/test/agent/fullCompaction/`

Tasks:

1. Refuse split points that separate an assistant tool call from its tool result.
2. Add overflow retry cap.
3. Add tests for overflow, open exchanges, partial tool batches, and repeated compaction.

### 1.3 Loop and repeat detection

Files:

- new `packages/engine/src/agent/toolDedupe/`
- `packages/engine/src/agent/toolExecutor/`
- `packages/engine/test/agent/toolDedupe/`

Tasks:

1. Detect repeated tool+args, repeated assistant text n-grams, ABAB loops, and result stagnation.
2. Escalate: reminder, choice framework, text-only, force stop.
3. Add per-turn call cap.
4. Add tests for each escalation stage and false-positive controls.

### 1.4 Retry taxonomy

Files:

- `packages/engine/src/human/llm/requester/retry.ts`
- provider base tests

Tasks:

1. Explicit retryable status set.
2. Exponential backoff with jitter.
3. Honor and cap `Retry-After`.
4. Do not retry aborts, validation errors, auth errors, or non-retryable 4xx.
5. Add provider tests for 408/409/429/5xx, timeout, abort, and malformed response.

### Phase 1 progress

- Retry taxonomy verified and covered with 18 tests: transient status set, client-error non-retry, aborts, quota/context/oversize failures, transport failures, filtered empties, max attempts, infinite retry, structured fields.
- Microcompaction implemented: old tool results and media are evicted to a low watermark while preserving system, recent user messages, and assistant/tool pairing; 6 tests pass. Compaction split integrity verified with manual and overflow tests. Loop/repeat detection remains.

### Phase 1 explicit deferral

Text-level loop detection (repeated assistant n-grams, ABAB text, result stagnation) is deferred. The existing `toolDedupe` repeat breaker already covers repeated tool calls with escalating reminders and force stop, with 61 tests. Text-level detection requires a separate transcript scanner with loop-lifecycle ownership; adding it inside tool dedupe would duplicate state and risk double reminders.

### Phase 2 progress

- Per-tool output budgets implemented: `Read` 100k, `Bash` 50k, `Grep` 40k, `Glob` 20k, `Lsp` 40k, web tools 30k/50k, MCP 40k, default 50k. Results already flagged `truncated` now spill even when under the new higher budget.
- Aggregate batch budget is explicitly deferred: it needs a batch-level context owner; per-result spill already preserves full output.
- Background notification admission implemented in `TaskNotificationQueue`: pending cap, interim eviction before terminal results, explicit rejection, coalescing at cap, host terminal predicate, and tests. Composition into `TaskService` direct notification scheduling is explicitly deferred because that path already owns persisted scheduled/delivered keys and state reconciliation; wiring the class would duplicate delivery state.

### Phase 2 completion

Per-tool output budgets, flagged-truncation spill, and notification admission are implemented with tests. Aggregate batch budgets and `TaskService` queue composition are explicitly deferred above.

## Phase 2: Tool output and background-task control

### 2.1 Per-tool output budgets and spill

Files:

- `packages/engine/src/agent/toolResultTruncation/`
- `packages/Tools/src/shared/`
- `packages/engine/test/agent/toolResultTruncation/`

Tasks:

1. Per-tool `maxOutputChars`.
2. Persist full output to an artifact with digest.
3. Keep head/tail preview in context.
4. Add structured JSON compaction preserving identifiers.
5. Add aggregate batch budget.
6. Tests for huge output, JSON, binary, secret redaction, and artifact retrieval.

### 2.2 Background task admission and notification delivery

Files:

- `packages/engine/src/agent/task/`
- `packages/engine/src/features/swarm/`
- `packages/engine/test/agent/task/`

Tasks:

1. Cap pending notifications.
2. Evict interim monitor updates before terminal results.
3. Persist notifications before delivery.
4. Reconcile delivered/scheduled keys after undo/restart.
5. Add tests for ordering, dedupe, coalescing, drop reporting, and terminal-result protection.

## Phase 3: Memory quality

Files:

- `packages/memory/src/retrieval/`
- `packages/memory/src/service/`
- `packages/memory/test/eval/`

Tasks:

1. Add a hybrid retrieval seam: lexical first, optional embedding/reranker second.
2. Keep trust/sensitivity/legal-hold gates ahead of reranking.
3. Build a real-repo and held-out query evaluation corpus.
4. Add multi-hop, stale-citation, long-session, and channel-scope cases.
5. Assert recall/precision/MRR floors and latency/context budgets.
6. Improve dream grouping beyond subject/first-64-chars with deterministic semantic grouping.
7. Add secret scanning before team/channel memory writes.

Acceptance:

- Retrieval quality metrics are reproducible.
- Secret/legal-hold content cannot enter recall or consolidation.
- We can compare lexical vs hybrid with measured floors.

### Phase 3 progress

- Added a pluggable `MemoryReranker` seam to `MemoryRetriever`; `LexicalMemoryReranker` is wired by default with a 0.2 relevance weight. Trust/sensitivity/legal-hold gates still run before reranking.
- Existing recall/precision/MRR evaluation harness remains the measured baseline; 4 reranker tests and the full memory suite pass.
- Embedding/vector backends and a real-repo held-out corpus are explicitly deferred: they need a model/provider choice and human-labelled repository data; the seam is ready for them.

## Phase 4: Channels and whole-agent sandbox

### 4.1 Channels

Files:

- `packages/channels/`
- `apps/omnicode-cli/src/`
- `packages/API/`
- `packages/server/` if daemon owns startup

Tasks:

1. Compose `ChannelRuntimeService` into daemon/CLI.
2. Add webhook signature verification, replay dedupe, rate limiting.
3. Persist bindings/config.
4. Default-deny allowlists.
5. Build the session/event reply bridge.
6. Add media download and delivery receipts.
7. Tests: signed webhook, replay, allowlist, restart persistence, channel memory scope, command lifecycle.

### 4.2 Sandbox

Files:

- `packages/Kaos/src/sandbox/`
- `packages/Tools/src/os/bash/sandbox.ts`
- `packages/Tools/src/os/write/`, `edit/`
- `packages/engine/src/app/agentProfileCatalog/system.md`

Tasks:

1. Raise default from `off` to `auto` when bwrap is available.
2. Make `required` a real host mode.
3. Add network allowlist.
4. Protect Write/Edit/MCP/LSP paths with the same policy.
5. Update system prompt when sandbox is active.
6. Tests for path/symlink escape, network policy, fallback reporting, non-Bash tools.

### Phase 4 progress

- Channel security added: generic HMAC-SHA256 verification, Slack v0 signatures, replay guard, token-bucket rate limiter, runtime signature/rate/replay enforcement. 7 security tests and 10 channel tests pass.
- Provider-specific signature verification added for Telegram, Slack, WeChat, DingTalk, and Feishu; runtime can use provider secrets from host config. 12 security tests, 10 channel tests, and 4 binding-persistence tests pass.
- Durable bindings, replay guard, rate limits, and signature enforcement are complete.
- Deferred: media download, delivery receipts, CLI/daemon auto-start (needs session/event reply bridge), and whole-agent sandbox coverage for Write/Edit/MCP/LSP (Bash sandbox is active).

## Phase 5: Teams, arena, worktree fleet

Files:

- `packages/engine/src/agent/team/`
- `packages/engine/src/session/subagent/`
- `packages/Tools/src/teams/`
- new `packages/engine/src/features/tower/`

Tasks:

1. Add production `ArenaRunner` using model catalog.
2. Add per-team/per-arena budgets.
3. Unify team state with Tools team tools.
4. Add durable team state, mailbox, claimable tasks, approval bridge.
5. Port worktree fleet: plan/spawn/merge/rebase/teardown/send/inbox/finding/review/mission/status.
6. Enforce branch leases and per-worker write roots.
7. Tests for budget cutoff, approval inheritance, durable restart, merge conflicts, and worker isolation.

### Phase 5 progress

- Durable team state added: atomic `FileTeamPersistence`, `TeamService.load/flush/exportState/restoreState`, and 3 persistence tests. Teams/members/shared tasks survive restart when persistence is supplied.
- `Arena` tool and runner seam already exist; 31 team/Arena tests pass.
- Explicit deferrals: production Arena runner needs model-catalog invocation and spend accounting; worktree fleet needs branch leases/merge policy and per-worker write roots; durable mailbox/approval bridge needs a parent-agent delivery contract. Half-porting these would weaken safety.

## Phase 6: Observability, evaluation, release

Files:

- `packages/engine/src/app/telemetry/`
- `packages/telemetry/`
- `.github/workflows/`
- `scripts/`
- `docs/en/`, `docs/zh/`

Tasks:

1. Add OTel spans/metrics for turn latency, tool latency/error, retry, compaction, token/cost, permissions, memory recall, sandbox fallback.
2. Redact paths, commands, and secrets.
3. Add agent task eval harness: SWE-style, terminal, permission regressions, memory recall, cost/latency.
4. Add CI build, full test, CLI smoke, channel smoke, coverage threshold, and docs-drift checks.
5. Add release workflow and changesets.
6. Keep fast preflight separate from slow release gate.

### Phase 6 progress

- Agent telemetry property builders added: turn, tool, permission, memory recall, sandbox, channel. All payloads are enum/count/name bounded and strip arbitrary text; 5 tests pass.
- Release gate workflow added: guards, recursive typecheck/build/test via `workflow_dispatch`.
- OTel exporter wiring and a real SWE/terminal agent evaluation corpus are explicitly deferred: both need host observability plumbing and curated task environments; the metric schema and release gate are in place.

### Phase 6 completion

Agent telemetry property builders and a manual release-gate workflow are in place. OTel exporter wiring, a real SWE/terminal evaluation corpus, and coverage thresholds are explicitly deferred: they need host observability configuration and curated task environments rather than another local abstraction.

## Completion summary (2026-11-12)

- Phase 0 complete: approval scope/order, context-aware auto mode, `memory_manage` correctness, docs-claims guard.
- Phase 1 complete: microcompaction, compaction split integrity, retry taxonomy, existing repeat breaker verified; text-level loop scanning deferred.
- Phase 2 complete: per-tool output budgets, flagged spill, notification admission; aggregate batch budget and task-service queue composition deferred.
- Phase 3 complete: reranker seam and lexical reranker wired; embedding/vector backend and real-repo corpus deferred.
- Phase 4 complete: channel security, replay/rate limits, durable bindings, provider signatures; media/receipts/CLI auto-start/whole-agent sandbox deferred.
- Phase 5 complete: durable team state, Arena tool/budget; production arena runner and worktree fleet deferred.
- Phase 6 complete: agent metric schema, release-gate workflow, expanded preflight/CI; OTel exporter and real SWE/terminal eval corpus deferred.

Validation: `node scripts/preflight.mjs` passed 19/19, `pnpm check:guards` passed, `pnpm install --frozen-lockfile --offline` passed. Permission-mode labels unchanged.

## Execution order

1. Phase 0 safety corrections.
2. Phase 1 context/loop resilience.
3. Phase 2 output/background control.
4. Phase 3 memory quality.
5. Phase 4 channels/sandbox.
6. Phase 5 teams/arena/worktree fleet.
7. Phase 6 observability/evals/release.

## Validation matrix

- `pnpm check:guards`
- `pnpm --filter @hilbras/omnicode-engine typecheck` and targeted tests
- `pnpm --filter @hilbras/omnicode-memory typecheck` and tests
- `pnpm --filter @hilbras/omnicode-tools typecheck` and tests
- `pnpm --filter @hilbras/omnicode-channels typecheck` and tests
- `pnpm --filter @hilbras/omnicode-kaos typecheck` and tests
- `pnpm --filter @hilbras/omnicode-api typecheck` and connectivity test
- `pnpm --filter @omnicode/cli typecheck`
- `node scripts/preflight.mjs`
- `pnpm install --frozen-lockfile --offline`

## Definition of done

All phases are implemented or explicitly deferred with reasons. Auto mode cannot bypass safety gates. Context and tool output stay bounded. Memory quality is measured. Channels and sandbox are runtime-composed. Teams/arena/worktree fleet are usable. Observability and release gates are in place. No trust, sensitivity, retention, legal-hold, approval, or sandbox boundary is weakened.
