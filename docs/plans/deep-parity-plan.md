# Deep Parity Plan

Status: active  
Owner: OmniCode-V  
Scope: close the next-layer gaps found against Codex, qwen-code, and the reference OmniCode. Preserve permission-mode labels and existing trust boundaries.

## Phase 0: Security and runtime composition

### 0.1 Symlink-safe path guards

Files:

- `packages/engine/src/tool/path-access.ts`
- `packages/Tools/src/os/{read,write,edit}/`
- `packages/Tools/src/patch/`
- tests

Tasks:

1. Resolve the nearest existing ancestor with `realpath`; re-check workspace and sensitive-target rules on the physical path.
2. Reject workspace symlinks that escape to outside paths or credential files.
3. Return the physical safe path for file operations.
4. Keep a documented opt-in for intentionally symlinked workspaces/additional dirs.
5. Tests: symlink-to-outside, symlink-to-sensitive, symlinked workspace, nonexistent child under symlinked parent, Windows case behavior.

### Phase 0.1 progress

- Path guards now resolve the physical target via `realpath` (nearest existing ancestor for new paths), re-check sensitive/workspace policy on the physical target, and reject symlinks escaping or resolving to credentials.
- Intentionally symlinked workspace roots are supported via physical workspace roots. 19 path-access tests pass, including symlink-to-outside, symlink-to-sensitive, missing child under symlinked outside dir, internal symlink, and symlinked workspace root.
- Remaining: OS-level no-follow/openat TOCTOU closure and explicit symlinked-workspace opt-in policy.

### 0.2 Session lease composition

Files:

- `packages/engine/src/app/sessionManager/sessionManagerService.ts`
- `sessionLease.ts`
- session/task tests

Tasks:

1. Acquire lease on create/resume.
2. Heartbeat at TTL/3.
3. Release on close.
4. Read-only or explicit takeover on live conflict.
5. Audit takeover and stale reclaim.
6. Tests: live conflict, restart, dead owner reclaim, no duplicate writes.

### Phase 0.2 progress

- `SessionManager` now acquires a lease before create/resume, heartbeats every 20s, releases on close/delete/dispose, and refuses a second live process with `session.busy`.
- Lease directory defaults under the Omnicode home; `OMNICODE_SESSION_LEASE_DIR` overrides it. Vitest uses no default lease unless injected.
- Added a two-manager conflict/release test. SessionManager suite: 15 passed.
- Remaining: read-only/takeover UI and audit telemetry.

### 0.3 Durable interaction composition

Files:

- `packages/engine/src/human/interaction/facade.ts`
- host bootstrap/session wiring
- API/SDK tests

Tasks:

1. Configure global interaction persistence at host startup.
2. Load pending approvals/questions before session attach.
3. Bind session/agent/turn/tool-call/expiry.
4. Reject stale IDs.
5. Re-drive one interrupted tool call with idempotency key.
6. Tests: crash/restart, approve once, stale replay, reconnect.

### Phase 0.3 progress

- `createOmnicodeHarness` now configures global interaction persistence under `<home>/interactions.json` and loads pending records at startup. `configureInteractionPersistenceForHome` is exported through API.
- Added API connectivity test proving pending approval persistence and removal after resolution. API connectivity: 5 tests pass.
- Remaining: stale-session/turn binding, authenticated reconnect, and idempotent interrupted-tool re-drive.

### 0.4 Channel runtime composition

Files:

- `packages/channels/`
- CLI/daemon startup
- tests

Tasks:

1. Instantiate `ChannelRuntimeService` from config.
2. Pass raw body/headers/signature proof from adapters.
3. Default signatures on; migration warning for unsigned.
4. Persist bindings through `FileChannelBindingPersistence`.
5. Sender allowlist and replay TTL.
6. Session/event reply bridge.
7. Tests: signed webhook, replay, unsigned rejection, restart binding, command lifecycle.

### Phase 0.4 progress

- CLI composition lives in `apps/omnicode-cli/src/cli/channels.ts` (`startConfiguredChannelRuntime`): reads `<home>/channels.json`, loads durable bindings from `<home>/channel-bindings.json`, builds the runtime with harness session callbacks, buffers `assistant.delta` per turn, and sends the assembled text back when `turn.ended` arrives. Started from `run-shell` and stopped on TUI exit; returns `undefined` when no channel config exists.
- Fails closed: an enabled channel whose adapter cannot be created (missing credentials) stops the runtime and throws instead of running half-configured.
- Signatures verify by default, opt-out with `OMNICODE_CHANNELS_REQUIRE_SIGNATURE=0`; provider secrets resolve from `TELEGRAM_WEBHOOK_SECRET`, `SLACK_SIGNING_SECRET`, `WECHAT_WEBHOOK_SECRET`, `DINGTALK_WEBHOOK_SECRET`, `FEISHU_WEBHOOK_SECRET`.
- Coverage in `apps/omnicode-cli/test/cli/channels.test.ts`: no-config no-op, command lifecycle, bound-message routing through a harness session, reply bridging, binding persistence, missing-credential failure.
- Deferred: the CLI process starts no HTTP webhook listener, so `handleInbound` is reachable only for hosts that deliver webhooks themselves, and adapter raw-body/header signature proofs are not yet threaded from an ingress layer. Sender allowlist and replay TTL come from the existing runtime security layer.

### 0.5 Workspace write lock and patch journal

Files:

- `packages/Tools/src/patch/`
- new `packages/engine/src/workspace/writeLock.ts`
- Team/Swarm/Tower write paths
- tests

Tasks:

1. Per-workspace lock keyed by canonical root.
2. Bounded waits with lock-owner diagnostics.
3. Stage patch writes as temp files; fsync/rename.
4. Journal intent and rollback/recovery after crash.
5. Tests: concurrent ApplyPatch, Write/Team conflict, crash recovery, dead-owner reclaim.

### Phase 0.5 progress

- `packages/engine/src/workspace/writeLock.ts` adds `acquireWorkspaceWriteLock` / `withWorkspaceWriteLock`: an in-process queue per canonical root, a cross-process lock file under `<OMNICODE_HOME|~/.omnicode>/locks/<sha256(canonical root)>.lock` (override with `OMNICODE_WRITE_LOCK_DIR`), bounded waits that raise `WorkspaceLockTimeoutError` with the owner's pid and lock path, and dead-owner reclaim through an atomic bid rename (the loser of a reclaim race never claims the lock).
- `packages/Tools/src/patch/patchJournal.ts` records each file's pre-write content under `<root>/.omnicode/patch-journal/<id>/` before the first mutation, drops the journal on success, and restores it on failure; `recoverPatchJournals(root)` heals a journal left behind by a crashed run.
- `applyPatch` accepts an optional `journal`; the `ApplyPatch`, `Write`, and `Edit` tools run their non-dry-run writes under the workspace write lock, and `ApplyPatch` runs crash recovery first and reports how many files it recovered.
- Tests: `packages/engine/test/workspace/writeLock.test.ts`, `packages/Tools/test/patch/patchJournal.test.ts`.
- Remaining: staged temp-file writes with `fsync`+rename are not implemented — tool writes still go through the host FS adapter. Team/Swarm/Tower sessions write through `Write`/`Edit`/`ApplyPatch`, so they inherit the lock rather than needing their own path.

## Phase 1: Context, loop, cancellation

### 1.1 Typed world-state diffs

Files:

- `agent/contextProjector/`
- `agent/contextMemory/contextOps.ts`
- `agent/replayBuilder/fold.ts`
- tests

Tasks:

1. Typed snapshots and merge-patch deltas.
2. Persist baseline per session.
3. Render transition-only sections.
4. Reset baseline at compaction.
5. Undiffable fallback.
6. Tests: replay equals full render, section deletion, compaction reset.

### 1.2 Post-compaction restoration

Files:

- `agent/fullCompaction/recentContext.ts`
- `contextRecovery.ts`
- tests

Tasks:

1. Restore recent files, state reminder, subagent snapshot.
2. Fence-safe rendering.
3. Failure cap and auto/warn/hard thresholds.
4. Tests: restored files, missing files, repeated failures.

### 1.3 Full loop detection

Files:

- `agent/loop/`
- `agent/toolDedupe/`
- tests

Tasks:

1. Streaming text n-grams, thought repeats, ABAB, long-period loops.
2. Result stagnation and stateful polling.
3. Read-churn requires a non-read tool before arming.
4. Code-block awareness.
5. Per-turn cap with retry rollback.
6. Tests: true positives, code generation false positives, cold start.

#### 1.3 progress

- `agent/loop/textLoopDetector.ts` implements the streaming detector: `TextLoopDetector.push(chunk)` accepts text or thinking deltas and reports `repeated-phrase`, `alternating-blocks`, or `periodic-text`. Scans re-run at most every 64 characters of growth so a token-per-push feed stays linear-ish.
- Code-block awareness: `stripFencedBlocks` drops ``` and ~~~ fenced regions, including a fence that opens in one push and closes in a later one, so generated code cannot trip the detector.
- Thresholds are explicit and configurable (`minLength` 240, `maxPhraseRepeats` 4, `minPhraseLength` 24, `maxPeriodLength` 1200); `periodicSuffix` finds a repeated tail behind varied prose, and `exactPeriod` keeps the whole-string period primitive.
- Tests: `packages/engine/test/agent/loop/textLoopDetector.test.ts` — phrase/alternation/period true positives, cold start, varied prose, fenced-code false positives, chunked-vs-whole equivalence, reset, and the two period primitives.
- Wired into the loop through `agent/loop/textLoopWatchService.ts` (`AgentTextLoopWatchService`, agent scope, registered from the engine barrel): it subscribes to `AssistantDelta`/`ThinkingDelta`, resets the detector when the turn id changes, and queues at most one pending signal. The queued signal becomes a `text_loop` context-injection reminder rendered at the next step boundary — history is never mutated mid-stream and no turn is stopped, so a false positive costs one sentence of context. `OMNICODE_TEXT_LOOP_BREAKER=0` disables it.
- Tests: `packages/engine/test/agent/loop/textLoopWatch.test.ts` covers variant registration, quiet prose, phrase/period signals from text and thinking deltas, per-turn reset, pending-drop on `TurnEnded`, and the env kill switch.
- Result stagnation is wired: `AgentTextLoopWatchService` correlates `ToolCallStarted` (name + args) with `ToolResultEvent` by `toolCallId`, classifies read-only calls with the shared `isReadOnlyToolName` predicate, and feeds `ResultStagnationDetector`. Synthetic results (aborts, permission refusals, dedupe replays) are skipped — they describe the runtime, not workspace state. The signal is queued in its own `result_stagnation` reminder variant so a stalled tool run never masquerades as repeated prose; only one stagnation signal pends per turn and both pending slots are dropped on `TurnEnded`. Late results from an older turn (a `turnId` below the active one) are ignored. `OMNICODE_RESULT_STAGNATION_BREAKER=0` disables the tool channel only.
- Read-churn arming lives in `ResultStagnationDetector`: a non-read tool arms it and clears the read run, so re-reading the same path is only churn after something could have changed it.
- Per-turn cap: `OMNICODE_LOOP_REMINDER_CAP` (positive integer, default 3) bounds how many reminders both channels emit per turn; consuming a detection above the cap returns nothing and the budget refills on the next turn. `IAgentTextLoopWatchService.configure()` overrides the resolved config in-process without touching the environment. Configuration is resolved by the pure `resolveLoopWatchConfig(env)` in `agent/loop/textLoopWatch.ts`.
- Tests: `packages/engine/test/agent/loop/textLoopWatch.test.ts` now covers distinct-results quiet, repeated non-read result, read polling, one-signal-per-turn queueing, synthetic-result skipping, per-turn reset, the env kill switches, the shared cap (default, explicit, junk → default), refill after `TurnEnded`, and the runtime override.
- Retry rollback: `ResultStagnationDetector.snapshot()`/`restore()` let a caller retract an attempt's observations. The current wiring does not need it — a retried step only re-emits calls and results after the failed attempt's results were already emitted, so nothing is double-counted.

### 1.4 Input arbitration and abort contract

Files:

- `agent/loop/inputQueue.ts`
- `agent/toolExecutor/`
- `toolContract.ts`
- tests

Tasks:

1. Typed `steer | mail | tool_output`.
2. Mailbox/steer precedence and passive non-waking messages.
3. Per-tool `finishesOnAbort`.
4. Terminal latch; exactly one aborted result.
5. Release locks and attribute zero handler time.
6. Tests: abort pre-admission, mid-handler, late finish, steer during tool.

#### 1.4 progress

- `agent/toolExecutor/abortContract.ts` implements the terminal latch: `AbortContract` accepts one outcome per unit (completed or aborted), discards a late finish and a late abort with no state change, records whether the abort `handled` a running handler or never started it, and separates lock-release (`release()` wins once) from time attribution (`accounting()` → `handlerMs` 0 when the handler never ran, `drainMs` from abort to latch). Pure and synchronous; the executor still owns its own signal plumbing.
- Tests: `packages/engine/test/agent/toolExecutor/abortContract.test.ts` covers completion, abort-before-start, abort mid-handler with a late finish discarded, late abort after completion, repeated abort paths (one outcome, one release), error completion, drain accounting, and reset.
- Deferred in 1.4: typed `steer | mail | tool_output` input queue, mailbox/steer precedence, per-tool `finishesOnAbort`, and the executor adopting the latch. The executor today races the handler against a 2s abort grace and then lets the handler settle again, so adopting the latch changes emit ordering and needs its own executor-level test pass first.

### 1.5 Scheduler hardening

Files:

- `agent/toolExecutor/toolScheduler.ts`
- tests

Tasks:

1. Consecutive read/search/fetch batching.
2. Read-only shell classification.
3. Code-mode exemption.
4. Env concurrency cap.
5. Shared predicate with headless executor.

#### 1.5 progress

- Env concurrency cap implemented: `ToolScheduler` takes `maxConcurrency` and runs at most that many tasks at once, starting queued work as slots free (submission order preserved; conflict blocking unchanged). `parseToolConcurrencyCap` accepts a positive integer only.
- `AgentToolExecutorService` passes the cap resolved from `OMNICODE_TOOL_CONCURRENCY` when it creates each batch's scheduler; unset or invalid means unlimited, so the previous behavior is the default.
- Tests: `packages/engine/test/agent/toolExecutor/toolScheduler.test.ts` covers cap enforcement, slot release order, invalid-cap fallback, and the parser.
- Remaining here: consecutive read/search/fetch batching, read-only shell classification, code-mode exemption, and the shared predicate with the headless executor. These need a read-only classifier over the tree-sitter-bash command model plus a headless-side consumer; batching them without that classifier would only reshuffle conflicts the scheduler already handles.

## Phase 2: Approvals and provider economics

### 2.1 Exec-policy DSL

Files:

- `agent/permissionPolicy/execPolicy/`
- `tool/rule-match.ts`
- tests

Tasks:

1. Data-only AST and parser.
2. Prefix alternatives, resolved executable identity.
3. NFD+casefold canonical matching.
4. Network/host rules and amendments.
5. `allow | prompt | prompt-user | forbidden`.
6. Load-time match/not-match examples.
7. Tests: precedence, alternatives, amendments, opaque scripts.

### 2.2 Reviewer lane

Files:

- `agent/interaction/reviewer/`
- config section
- tests

Tasks:

1. Isolated reviewer profile/model.
2. Scope classifier.
3. Input/request budgets, resampling, checkpoints.
4. Circuit breaker and routing affinity.
5. Never satisfy human-required approval.
6. Tests: timeout, bypass attempts, MCP elicitation, fail-closed.

### 2.3 Pricing and fallback composition

Files:

- `packages/llm/src/`
- `agent/usage/`
- `llm-adapter/model/model-requester-impl.ts`
- TUI usage panel
- tests

Tasks:

1. Populate model prices from catalog.
2. Record per-turn/session/goal cost.
3. Enforce hard budget pre-call.
4. Provider key validation and quota circuit state.
5. Ordered fallback by capabilities/ownership; no loops.
6. Tests: cache pricing, unknown model, budget refusal, fallback compatibility.

## Phase 3: Tools, MCP, skills, sandbox

### 3.1 Patch semantics upgrade

Files:

- `packages/Tools/src/patch/`
- `agent/turnDiff/`
- tests

Tasks:

1. Verify-before-apply.
2. Duplicate-target rejection.
3. File moves.
4. Committed-delta result on failure.
5. Streaming parser.
6. Path abstraction for remote execution.
7. Turn diff tracker; `/diff` consumes it.

### 3.2 MCP resources/prompts/elicitation

Files:

- `mcpCore/`
- Tools MCP resource surface
- tests

Tasks:

1. `resources/list|read` with pagination and caps.
2. `prompts/list|get`.
3. Server instructions with trust labels.
4. Capability projection per server.
5. Elicitation/sampling behind explicit enable.
6. Tests: fixture server, unsupported, oversized, untrusted labels.

### 3.3 Skill enforcement and provenance

Files:

- `features/skill/`
- profile tool overlay
- tests

Tasks:

1. Filter visible tools during active skill turn.
2. Clear grants on deactivate.
3. Label project/plugin skill content untrusted.
4. Record provenance.
5. Tests: denied tool, wildcard, implicit invocation, built-ins unrestricted when metadata absent.

### 3.4 Sandbox matrix and network policy

Files:

- `packages/Kaos/src/sandbox/`
- Tools OS tools, MCP children, hooks, worktrees
- tests

Tasks:

1. macOS Seatbelt backend.
2. Windows AppContainer/Job Object.
3. Whole-agent sandbox: Write/Edit/LSP/MCP/hooks/worktrees.
4. Per-path grants, deny-read globs, merge/intersect.
5. Network proxy + credential broker + secret substitution after destination authorization.
6. No silent downgrade; explicit fallback status.

## Phase 4: TUI and product

### 4.1 Session search/diff/review

Files:

- `features/sessionSearch/`
- CLI command registry/controllers
- tests

Tasks:

1. Register local search service.
2. Add `SearchSessions` profile admission.
3. `/diff` final-turn/session diff.
4. `/review` structured review prompt.
5. Bound large diff rendering.
6. Tests: search index, pagination, empty/large diff, review payload.

### 4.2 Tool card actions and TUI stats

Files:

- `apps/omnicode-cli/src/tui/`
- tests

Tasks:

1. Retry/open diff/copy path/show full output/jump to artifact.
2. Context %, cache hit, latency, cost, error rate.
3. Live agent panel and loop-detection confirmation.

### 4.3 Speculation and goal verifier

Files:

- `agent/speculation/`
- `features/goal/`
- tests

Tasks:

1. Forked speculative follow-up with overlay writes.
2. Accept copies overlay; risky tools hit boundary.
3. Never bypass approvals.
4. Independent goal verifier with provenance-tagged evidence.
5. Tests: overlay merge, risk gate, missing evidence rejection.

### 4.4 Workflow runtime and skill curator

Files:

- `agents/runtime/workflow/`
- `skills/curator.ts`
- tests

Tasks:

1. Sandboxed workflow scripts, concurrency window, token budget.
2. Journal, replay, stall detection, checkpoints.
3. Skill usage, stale/archive/pin/restore, lockfile.
4. Race-safe bounded reads.

## Phase 5: Eval, observability, release, product surfaces

### 5.1 Hermetic eval harness

Files:

- `packages/engine/test/evals/`
- `apps/omnicode-cli/test/e2e/`
- scripts/CI

Tasks:

1. Fake OpenAI server: SSE, reasoning, disconnect, provider errors, usage.
2. Provider cassettes and rendered-context goldens.
3. First-output benchmark with AB/BA ordering and bootstrap.
4. Trajectory eval suite and CI gate.

### 5.2 OTLP and metric wiring

Files:

- `packages/telemetry/`
- engine/CLI call sites
- tests

Tasks:

1. OTLP/HTTP exporter.
2. Turn/tool/LLM/approval/sandbox spans.
3. Token/cost/retry/compaction/recall/fallback metrics.
4. Redaction and cardinality caps.

### 5.3 Release/product surfaces

Files:

- `apps/omnicode-desktop/`
- `apps/omnicode-inspect/`
- `plugins/`
- `docs/`
- release workflows

Tasks:

1. Desktop supervisor/updater.
2. Inspector panels.
3. Official plugins and marketplace CDN.
4. VitePress bilingual docs.
5. Changesets, OIDC publishing, Nix closure check, SBOM/digest.
6. CONTRIBUTING/SECURITY/templates.
7. Bundled skills.

## Validation

- `pnpm check:guards`
- affected package typechecks/tests
- targeted security suites
- `node scripts/preflight.mjs`
- `pnpm install --frozen-lockfile --offline`
- cross-platform CI where available

## Definition of done

All phases implemented or explicitly deferred with reasons. Symlink escapes blocked. Leases/approvals/channels/write locks composed. Context/loop/abort contracts hardened. Approvals and provider economics composed. MCP/skills/sandbox expanded. TUI/product improvements wired. Evals, OTLP, release gates and product surfaces in place. No trust boundary weakened.
