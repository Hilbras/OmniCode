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

#### 1.1 progress

- `agent/contextProjector/worldState.ts` implements typed world-state snapshots over a flat map (string/number/boolean/null and string lists only — nested values are rejected, not coerced), RFC 7396 merge-patch deltas (`null` deletes), and `applyWorldStateDelta` with a tested round-trip (baseline + delta === next).
- `WorldStateTracker` owns the render baseline: full render first, deltas after, a forced full render every `maxDeltasBeforeFull` (default 8) so drift cannot silently accumulate, and `resetBaseline()` for compaction, after which the next render is full again.
- Undiffable fallback: `asWorldState` returns `undefined` for non-objects/nested/non-finite values and `renderUndiffableFallback` degrades to a full render labelled `unrenderable` instead of guessing a delta.
- Tests: `packages/engine/test/agent/contextProjector/worldState.test.ts` (10) covers type acceptance, add/change/remove deltas, round-trip equality, empty delta, full→delta→reset, periodic full render, baseline version stability, section deletion rendering, and the fallback.
- Wired into `contextProjectorService`: `renderWorldState(state)` seeds a full render on first call, returns deltas afterwards, and degrades to a labelled full render for undiffable input; `resetWorldStateBaseline()` forces the next render to be full again. `worldStateText()` renders the section. `WorldStateTracker.seed()` marks a state as already rendered without emitting.
- Tests: an integration case in `worldState.test.ts` drives the real `AgentContextProjectorService` through full → delta → reset (65 contextProjector tests pass).
- State source: `contextProjector/worldStateAssembler.ts` builds the section from the agent's goal (`goal.status/objective/turns_used/tokens_used`) and todo list (pending/in-progress/done counts plus up to ten open titles), clipping long objectives (160 chars). `WorldStateAssembler.next()` returns `undefined` when nothing changed, so a quiet turn costs zero tokens.
- Live provider: `contextProjector/worldStateProvider.ts` (`IAgentWorldStateProvider`, agent scope) reads `IAgentGoalService.getGoal()` and `IAgentTodoService.get()` and exposes `nextSection()` / `resetAfterCompaction()`. The baseline survives turns on purpose (a delta is only meaningful inside one rendering lineage) and resets on compaction.
- Tests: `worldStateAssembler.test.ts` and `worldStateProvider.test.ts` cover flattening, goal removal, clipping/caps, quiet turns, delta-only change, and full re-render after compaction (74 contextProjector tests pass).
- Request injection: `llmRequesterService` pulls `worldStateProvider.nextSection()` once per request and, when defined, appends it as a trailing `system` message. Because the provider returns `undefined` on an unchanged turn, a steady-state session adds no tokens.
- Compaction reset: the provider subscribes to `CompactionCompleted` and resets the assembler, so the first section after compaction is full. It binds itself into the requester through a lazy `IInstantiationService.invokeFunction` (injecting the requester would cycle, as with the skill grant).
- Tests: `worldStateProvider.test.ts` covers a `CompactionCompleted` reset; requester tests pass apart from a pre-existing 30s timeout test that fails identically on HEAD.
- Still open in 1.1: the baseline is in memory only (a process restart begins with a full render, which is safe but costs one section), and no test asserts the requester's appended system message directly.

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

#### 1.2 progress

- `agent/fullCompaction/fileRestoration.ts` restores the files the agent was working in after compaction: `selectRestorableFiles` dedupes by path, prefers writes over reads, and caps the list; `restoreRecentlyTouchedFiles` reads each path with a bounded retry (`maxFailuresPerPath`, default 2) and records failures instead of failing the compaction; `renderRestoredFiles` emits a `## Files Touched Before Compaction` section under `### <path>`. Restoration has no filesystem discovery of its own — it only reads paths handed to it.
- Fence safety: `fenceFor` picks a backtick fence longer than any run inside the file body, so a file containing its own code fence cannot close the section or plant instructions.
- Caps: per-file (`maxCharsPerFile`, default 4000, marked `(truncated)`), files per compaction (`maxFiles`, default 5), and the whole section (`maxTotalChars`, default 16000) with a visible `N more file(s) not restored` note.
- Tests: `packages/engine/test/agent/fullCompaction/fileRestoration.test.ts` covers selection/dedupe/write preference, fence escalation, heading and omission notes, missing files, retry counts, per-file truncation, and the section cap.
- Wired: `agent/fullCompaction/touchedFilesTracker.ts` records successfully read/written paths from `ToolCallStarted` + `ToolResultEvent` (one entry per path, write survives a later read, 64-path bound), and `fullCompactionService.renderRecoveryFooter` now awaits it, restoring those files ahead of the wire-recovery pointer in the compaction summary. Read failures are swallowed so a missing file can never turn a successful compaction into a failed turn.
- Tests: `packages/engine/test/agent/fullCompaction/touchedFilesTracker.test.ts` covers recording, failure/tool/path filtering, write-wins, Edit/NotebookEdit, bounds, and clear.
- Still open in 1.2: the state reminder and the subagent snapshot sections; restoration currently covers files only.

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
- Deferred in 1.4: the input queue is not yet drained by `loopService.ts`, mailbox/steer precedence is not applied to the existing `notify()` path, per-tool `finishesOnAbort` is not declared, and the executor does not yet adopt the latch. The executor today races the handler against a 2s abort grace and then lets the handler settle again, so adopting the latch changes emit ordering and needs its own executor-level test pass first.
- `agent/loop/inputQueue.ts` + `agent/loop/inputQueueService.ts`: typed `steer | mail | tool_output` queue in the agent scope. `push` bounds each channel at 16 (oldest dropped) and ignores payload-free passive notices; `next(state)` drops tool output whose call is no longer in `toolCallIds` (and all of it when no turn is running), then offers one notice in fixed precedence `steer → tool_output → mail`, FIFO inside each channel. Steer and waking mail carry `wake: true`; tool output and passive mail never do.
- Tests: `packages/engine/test/agent/loop/inputQueue.test.ts` covers precedence, per-channel FIFO, the wake flag, stale tool-output dropping, empty payload handling, overflow, and clear.

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
- Read-only shell classification: `tool/read-only-shell.ts` is the single predicate (`isReadOnlyShellCall` / `classifyReadOnlyShell`) over the tree-sitter-bash model in `tool/read-only-command.ts`. It only answers for `Bash`, fails closed when the parser is missing or the args are malformed, returns `reason` (`not-a-shell-tool`, `no-parser`, `parse-miss`, `classified-write`, `read-only-command`) so callers can log why, and memoizes trimmed `command → verdict` in a 256-entry process cache (`clearReadOnlyShellCache()` for tests). The auto-mode classifier now calls it, so approval and scheduling share one answer.
- Tests: `packages/engine/test/tool/readOnlyShell.test.ts` covers read verbs and read-only git subcommands, writes/redirects/unknown verbs, missing parser, malformed args, non-shell names, and the write reason codes.
- Remaining here: consecutive read/search/fetch batching (folds read-only shell calls into the read lane), code-mode exemption, and the headless executor consuming the shared predicate. Batching alone would only reshuffle conflicts the scheduler already handles, so it lands together with the read lane and its tests rather than as a partial change.

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

#### 2.1 progress

- `agent/permissionPolicy/execPolicy/execPolicy.ts`: data-only `ExecPolicyFile` (`version: 1`, `rules`, `opaque`) with `loadExecPolicy` validating every field and every `examples` entry at load time (a rule whose own example does not match, or whose example is shadowed by a more specific rule, is a load error — never a silent non-match). `ExecPolicyLoadError` carries the failing path.
- Matching: `matchExecPolicy(command, policy, {parser?})` resolves the argv through `canonicalizeCommand` (undoing only the canonicalizer's quoting), treats shell metacharacters, newlines, and unresolved quoting as opaque, and answers `opaque` for them — never an allow. Specificity: an exact `alternatives` argv match (`1000 + length`) beats a `prefix` match (`length`); a longer prefix beats a shorter one; on a tie a `sticky` rule wins, otherwise the first declared rule stays. Unmatched commands return `prompt-user`/`default`; `EMPTY_EXEC_POLICY` therefore prompts for everything and treats opaque scripts as `forbidden`.
- Canonicalization: `canonicalTokenText` is NFD → lowercase → NFC on both sides. `hosts` on a rule are normalized the same way and returned on the matched rule (`api.example.com`) so a network amendment can be enforced by the caller.
- Decisions are exactly `allow | prompt | prompt-user | forbidden`; the default for opaque commands is `forbidden` unless the file sets `opaque`.
- Tests: `packages/engine/test/agent/permissionPolicy/execPolicy.test.ts` covers malformed files, non-matching and shadowed examples, prefix/alternative matching, alternative-beats-prefix, sticky ties, opaque metacharacters and unbalanced quotes, NFD/case folding, the `prompt-user` default, host carry, and executable-vs-prefix confusion.
- Wired into the chain as `agent/permissionPolicy/policies/exec-policy-rule.ts` (`ExecPolicyPermissionPolicyService`), placed after the sensitive-file and git-control policies and before the auto-mode classifier, so a rule can only narrow what path protection already allows and `forbidden` cannot be re-opened by the classifier's safe-tool fast path. `AgentPermissionPolicyService.setExecPolicy(policy)` installs or clears it; with no policy the pass returns nothing and the chain is unchanged. `allow` approves, `forbidden` denies with a do-not-retry message, `prompt` asks, `prompt-user` asks with `requires_human: true`, and opaque commands take the file's `opaque` decision.
- Tests: `packages/engine/test/agent/permissionPolicy/execPolicyRule.test.ts` covers inert-without-policy, non-shell tools, allow/ask/deny, human-required prompts, opaque denial, clearing, and malformed args.
- Still open in 2.1: nothing loads an `exec-policy.json` from disk into `setExecPolicy`, and the network/host amendment path has no caller — `hosts` is carried on the matched rule only.
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

#### 2.2 progress

- `agent/interaction/reviewer/reviewerLane.ts` implements the reviewer *admission seam*: `admitReviewer` only ever sees an `ask`. Policy `approve`/`deny` are final and never offered for review, so a reviewer cannot un-deny a sensitive-file rule or bypass a `forbidden` exec rule. An ask carrying `requires_human: true` (exec-policy `prompt-user`) is deferred to the user, never reviewed.
- Fail-closed: no lane, a reviewer exception, an `unclear` or `reject` answer, and a timeout all produce `defer` — the original ask goes to the user. Timeout (`DEFAULT_REVIEWER_TIMEOUT_MS` 20s, overridable, junk values ignored) aborts the lane and races the answer, so a lane that ignores its `AbortSignal` cannot hang the approval path (fixed after a test caught the hang).
- Tests: `packages/engine/test/agent/interaction/reviewerLane.test.ts` covers policy-decision bypass attempts, human-required asks, approval, reject/unclear, no-lane, exception, timeout-with-abort, and junk timeout.
- Wired ahead of the human prompt: `AgentToolApprovalService.consultReviewer` runs before `requestToolApproval` dispatches `PermissionApprovalRequested`. A reviewer `approve` is applied through `resolveApproval` plus the normal resolution path (so hooks still run) and the user prompt never appears; a human-required ask is skipped without consulting the lane at all; every other outcome falls through to the unchanged prompt. `setReviewerLane(lane)` installs or clears it; telemetry event `permission_reviewer_result` records `approved`/`deferred` with the reason.
- Tests: `packages/engine/test/agent/toolApproval/toolApproval.test.ts` (reviewer lane block) covers reviewer-approved skip, human-required never offered, and defer falling back to the user prompt.
- Budget and breaker: `ReviewerGuard` (in `reviewerLane.ts`) caps reviews per session (`maxReviews`, default 20) and opens a circuit after a run of consecutive non-decisive answers (`failureThreshold`, default 3; timeouts, errors, and `unclear` count, a real approve/reject resets it). Exhausted budget and an open circuit both `defer` to the user. The approval service owns one guard per agent scope.
- Routing affinity: an approval is applied only if the reviewed ask still matches the identity of the call being resolved (`toolCallId` + approval rule + policy reason). A stale answer for a different call cannot approve it.
- Tests: reviewer guard behaviour is covered in `test/agent/interaction/reviewerLane.test.ts` (budget exhaustion, circuit open/reset, unclear counts as failure).
- Still open in 2.2: there is no `ReviewerLane` implementation (isolated reviewer profile/model, scope classifier, resampling, checkpoints), the reviewer timeout is not configurable, and MCP elicitation has no reviewer path.

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

#### 2.3 progress

- `agent/usage/costGate.ts` is the pre-call half of hard budgets: `projectedCallCost` prices prompt tokens at the input rate plus one output token (a floor, so an empty prompt still moves the meter), `checkPreCallCost` refuses when spend-so-far plus that projection is already over the limit, and `assertPreCallCost` throws `UsageError('usage.budget_exceeded')` naming the model, spend, limit, and projection. An unknown price never blocks a call — it returns `reason: 'unknown-pricing'` so the caller can keep the meter visibly incomplete.
- New error code `usage.budget_exceeded` is registered in `agent/usage/errors.ts`, added to the engine error union, and mirrored in `packages/server/src/protocol/events-zod.ts`.
- Tests: `packages/engine/test/agent/usage/costGate.test.ts` covers the output floor, fitting calls, refusal before the call, refusal at exactly the limit, unknown-model pass-through, the typed error payload, and the success verdict.
- Wired pre-call: `agent/usage/costGateService.ts` (`AgentCostGateService`) reads `costLimits` config — `limitUsd` plus `modelPrices` per model (input/output and optional cache read/write per million USD). No limit, or a limit ≤ 0, disables the gate; an unpriced model is never refused but reports `unknown-pricing`. `usage/modelPriceTable.ts` is the engine-side rate table (the engine does not depend on the standalone `llm` package), pricing cache reads/writes at the input rate when unset.
- `llmRequesterService.requestWithTrace` calls `assertCostBudget(prepared)` before `runRequest`: it sums the agent's recorded `byModel` usage through the gate's prices, estimates prompt tokens from the token counter, and throws `usage.budget_exceeded` when spend plus the projected call cost is over the limit. The dependency is optional so test harnesses that build the requester without the config section keep working.
- Tests: `packages/engine/test/agent/usage/costGateService.test.ts` covers price table cache rates, no-limit pass-through, zero/negative limit as disabled, priced refusal once spend reaches the limit, unknown-model pass-through, and usage pricing.

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

#### 3.1 progress

- Verify-before-apply: `applyPatch` now plans every operation against the pre-patch tree (reads of every touched path, including move destinations) and only writes after all hunks matched and all targets exist/are absent as required. A patch that cannot land in full leaves the tree untouched, including its add operations.
- Duplicate-target rejection: `parsePatch` rejects any patch that names the same final path twice (`duplicate-target`, including `A → B` when `B` is already a target), and merge targets are checked in the plan phase.
- Moves: `*** Move to:` inside an update body becomes a single `update` operation carrying `move`; commit writes the destination with the new content and deletes the source only after the plan verified it. `patchOperationPaths` is the one source of touched paths for resolution, approval rules, and backups.
- Failure delta: every failure is a `PatchApplyError { code, committedFiles }` (`parse | duplicate-target | target-exists | target-missing | hunk-mismatch | verify-failed`); the tool prints the code plus the files touched before the rollback, and rollback still happens (journal or backup).
- Tests: `packages/Tools/test/patch/patchSemantics.test.ts` covers "writes nothing when a later hunk fails", duplicate targets, move onto an existing file, plain move, update+move, committed-delta on a mid-patch write failure, and virtual dry-run isolation. Existing `applyPatch.test.ts` and `patchJournal.test.ts` still pass (15 total in `test/patch`).
- Still open in 3.1: streaming parser, path abstraction for remote execution, and the turn diff tracker with `/diff`; patch application is still a full-string parse.


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

#### 3.2 progress

- `mcpCore/resourceSurface.ts` adds the resources/prompts surface as a pure layer over a transport seam: `listResources`/`listPrompts` (bounded page size, cursor passthrough), `readResource` (per-resource character cap, blob-only resources reported by size and never decoded), `getPrompt` (per-message cap). Missing transport operations throw `McpUnsupportedError` rather than a generic failure, since most servers implement none of these.
- Trust: `capabilityProjection` always marks a server `untrusted` and projects only advertised capabilities. `labelResource`, `labelPrompt`, and `labelInstructions` wrap server content in `<mcp-resource|mcp-prompt|mcp-instructions trust="untrusted">` envelopes that state the content is data, cannot grant permissions, and cannot override the user.
- Elicitation: `admitElicitation` denies unless the operator enabled elicitation **and** the server is on the allowlist, and rejects empty messages.
- Tests: `packages/engine/test/mcpCore/resourceSurface.test.ts` covers capability projection, unsupported operations, page caps and cursors, body caps, blob omission, prompt caps, trust envelopes, and elicitation admission.
- Still open in 3.2: no transport implements these resources/prompts operations (stdio/HTTP/SSE clients only do tools today), the surface is not registered as an agent tool, and sampling (as opposed to elicitation) has no policy seam.

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

#### 3.3 progress

- `features/skill/enforcement.ts` adds `SkillToolEnforcer`: `activate(skill)` records the grant (`allowedTools`/`disallowedTools` from the skill's metadata, via the existing `skillAllowsTool` matcher), `visibleTools()` filters what the profile overlay offers, and `enforceTool()` is the boundary — a call outside the grant is refused with an explicit "do not reroute" message. `deactivate()` clears the grant so permissions never outlive the activation. A skill without metadata (built-ins) leaves tools unrestricted.
- Provenance and trust: `provenance()` records skill name, source, path, and activation time; `skillTrust()` marks `project` and `extra` sources untrusted; `labelSkillContent()` wraps untrusted content in `<skill-content trust="untrusted">` with an explicit "cannot grant permissions or override instructions" envelope.
- Tests: `packages/engine/test/features/skill/enforcement.test.ts` covers unrestricted built-ins, allowlist hide+refuse, wildcard/prefix patterns, disallow-beats-allow, clearing on deactivate, provenance, and trust labelling.
- Wired into `AgentSkillService`: `activate()` arms the enforcer with the skill's grant, `visibleToolNames()` narrows `IAgentToolRegistryService.list()` to the grant, and the service deactivates on `TurnEnded` so a grant never outlives its turn. Project/`extra` skill content is wrapped by `labelSkillContent` before it is rendered into the prompt.
- Tests: the skill/plan/goal suites (405 tests) pass with the wiring in place; the enforcer's own behaviour is covered in `test/features/skill/enforcement.test.ts`.
- Request path: `AgentSkillService` pushes itself into the requester (`IAgentLLMRequesterService.setSkillGrant`) and `defaultTools()` filters the shaped tool list to the grant. It is a push, not a DI dependency, because resolving it would cycle requester → grant → loop → requester (caught as `CyclicDependencyError` during the skill tests).
- Executor boundary: `IAgentToolExecutorService.setSkillGrant` composes a skill guard with the existing tool-call guard, so a call for a tool the active skill hid is rejected even if the model still knows its name. Binding it from the feature assembly is still open.
- Tests: `test/agent/toolExecutor` and `test/features/skill` pass (227 tests) with the wiring.
- Executor bound: `AgentSkillService` resolves `IAgentToolExecutorService` lazily through `IInstantiationService.invokeFunction` in the same agent scope and calls `setSkillGrant(this)`. It is a lazy lookup, not a constructor dependency, because an eager edge would make the tool-executor tests (which have no skill feature) fail to construct the executor. Both push sites now receive the grant (verified directly).
- Tests: skill, toolExecutor, and loop suites pass (293 tests) with the binding in place.
- Still open in 3.3: no implicit-invocation path exists to enforce; there is no end-to-end test that activates a real skill and observes the executor rejecting a hidden tool.


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

#### 3.4 progress

- macOS Seatbelt backend: `packages/Kaos/src/sandbox/seatbelt.ts` builds a deny-by-default `sandbox-exec` profile (`(deny default)`, no `(allow default)`), grants `file-write*` only under the workspace or a contained write allowlist, keeps system paths read-only, and adds `(allow network*)` only when the policy shares the network. Paths are escaped for the Seatbelt string syntax and a quote in a workspace path cannot inject a rule (covered by test). `SeatbeltSandboxBackend.buildArgv` emits `sandbox-exec -p <profile> -- <argv>`; newline/NUL in argv is rejected.
- Availability is honest: `probeSeatbelt` is unavailable off darwin, unavailable without an injected probe, and reports the real probe outcome otherwise. Added `'seatbelt'` to `SandboxBackendKind`, `createSandboxBackend`, and `SANDBOX_BACKEND_PREFERENCE` (`bwrap`, `seatbelt`, `landlock`).
- Tests: `packages/Kaos/test/sandbox/seatbelt.test.ts` (11 tests) covers profile shape, network gating, write-allowlist containment, path escaping/injection, probe states, argv shape, and argv injection. Full `test/sandbox` suite passes (73).
- Still open in 3.4: Windows AppContainer/Job Object backend, whole-agent sandboxing (Write/Edit/LSP/MCP children/hooks/worktrees), per-path grants with deny-read globs and merge/intersect, and the network proxy/credential broker. Seatbelt is not selected by any host config yet.

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

#### 4.1 progress

- Bounded diff rendering: `features/sessionSearch/diffRender.ts` renders unified diffs with a `Diff: N file(s) changed, +A -R` header, `--- a/… / +++ b/…` per file, hunk grouping with `contextLines` (default 3), and a line-level LCS that degrades to whole-region replacement above `lcsCellBudget` instead of going quadratic. Caps: `maxLinesPerHunk` (200, elided with `… N more line(s) in this hunk`), `maxLines` (600, `(diff truncated at N lines)`), `maxLineChars` (400, `… (+N chars)`). Every cap sets `truncated` so the UI can say the view is partial.
- Tests: `packages/engine/test/features/sessionSearch/diffRender.test.ts` covers the edit script and cell-budget fallback, no-change output, the unified format, per-hunk elision, the global cap, and long-line clipping.
- Still open in 4.1: `/diff` command wiring in the CLI, `/review`, pagination tests for the search index (the index service exists), and `SearchSessions` profile admission.


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

#### 4.3 progress (goal verifier)

- `features/goal/verifier.ts` verifies completion independently of the model's own claim: each `VerificationCheck` lists required evidence ids, whether it demands an external observation, and an optional `notBefore` freshness bound. `isAcceptableEvidence` rejects provenance-free records, run evidence without an exit code, `agent_claim` or model-observed records on external checks, and stale records. `verifyGoalCompletion` returns `verified` only when every check passes; any failure yields `partial` (or `rejected` when nothing passed or the goal has no checks) with a per-check reason in the summary.
- Tests: `packages/engine/test/features/goal/verifier.test.ts` covers the acceptance rules and the four verdict paths, including "model says it is done" being rejected.
- Still open in 4.3: speculation/overlay writes and the risk gate, wiring the verifier into `goalService`, and feeding it runtime-observed evidence automatically.

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

#### 5.1 progress

- Fake OpenAI-style provider + SSE server already exists in `packages/llm/test/e2e/fake-provider-harness.ts` (streaming, errors, abort) and is used by the provider e2e suites — no duplicate harness added here.
- Suite runner and gate: `agent/evals/suite.ts` (`runEvalSuite`) runs each `EvalCase` (async factory + `scoreTrajectory` expectation), treats a throwing case as a failure rather than a skip, treats an **empty suite as a failure**, and lets a case be marked optional (reported but not gating). `evalGateExitCode(report)` gives CI its 0/1 decision.
- Tests: `packages/engine/test/agent/evals/suite.test.ts` covers all-pass, required failure, optional failure, throwing case, empty suite, and async factories. Existing `test/evals/agentBehavior.test.ts` still passes (13 tests across both).
- Still open in 5.1: no CI job invokes the suite, there are no provider cassettes or rendered-context goldens, and the first-output AB/BA benchmark with bootstrap is not implemented.

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

#### 5.2 progress

- `packages/telemetry/src/otlp.ts` provides the OTLP/HTTP payload shape without owning transport: `OtlpExporter.exportSpan/exportMetric` build OTLP JSON (`resourceSpans` / `resourceMetrics`, gauge data points) that a host posts. The exporter never opens a socket, so tests need none and auth/endpoint stay with the caller.
- Redaction: only attributes on an explicit allowlist survive and only JSON primitives do — nested objects, arrays, non-finite numbers, and unknown keys (paths, commands, prompts) are dropped, not stringified. Span and metric allowlists are exported constants.
- Cardinality: buffered spans are capped (`maxBufferedSpans`, default 1000, oldest dropped and counted) and each metric name accepts `maxMetricSeries` distinct attribute sets (default 500); beyond that, points fold into a single `overflow=true` series and are counted.
- Tests: `packages/telemetry/test/otlp.test.ts` covers primitive/allowlist redaction, span JSON redaction (a `command` attribute never leaves), the span buffer cap, metric overflow folding, and non-finite metric rejection.
- `packages/telemetry/src/otlpSender.ts` adds the HTTP sender: posts to `<endpoint>/v1/traces` and `/v1/metrics`, resolves the endpoint and bearer token per send (a login/logout takes effect without rebuilding), retries 5xx with bounded backoff (250ms/1s/4s) but never retries 4xx, honours a request timeout, and swallows every failure (`flush` never throws) so observability cannot fail a turn or shutdown. No endpoint means "not configured" — it never falls back to a default collector.
- Tests: `packages/telemetry/test/otlpSender.test.ts` covers signal paths, no-endpoint no-op, per-send endpoint/token resolution, 5xx retry vs 4xx no-retry, and network-failure containment.
- Still open in 5.2: no engine/CLI call sites emit spans or metrics, so no turn/tool/LLM/approval/sandbox spans or token/cost/retry metrics are recorded yet; nothing constructs `OtlpHttpSender` from host config.

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
