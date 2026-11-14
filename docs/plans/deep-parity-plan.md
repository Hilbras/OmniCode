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
- Remaining in 1.1: the baseline is in memory only — a process restart begins with a full render, which is safe but costs one extra section.

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
- State reminder: `agent/fullCompaction/stateReminder.ts` renders `## State at Compaction` from the state the agent holds outside the conversation — its goal (status, objective clipped to 160 chars, turns used), todo counts pointing at the re-attached TODO List, and the running background-task count. Each line is omitted when the state is absent; the section caps at 2000 chars with a visible truncation marker; goal text is collapsed to a single line so it cannot forge headings in the footer.
- Subagent snapshot: `agent/fullCompaction/subagentSnapshot.ts` renders `## Subagents Before Compaction` — one line per spawned subagent (task id, description clipped to 120 chars and collapsed to one line, subagent type, status), capped at 8 entries and 4000 chars with a visible `N more subagent(s) not listed` note, plus a resume note when a settled subagent carries an agent id.
- Wired: `fullCompactionService` injects `IAgentGoalService` and `IAgentTaskService`; `renderRecoveryFooter` orders the footer files → state reminder → subagent snapshot → wire-recovery pointer. Both reads are wrapped so a goal/task service failure can never fail the compaction. The snapshot filters `list(false)` to `kind: 'agent'` and puts running subagents first so a long settled history cannot hide an active one behind the entry cap.
- Tests: `packages/engine/test/agent/fullCompaction/stateReminder.test.ts` (9) and `subagentSnapshot.test.ts` (8) cover rendering, one-line sanitization, clipping, caps with omission notes, junk-cap fallback, and the resume-note conditions. Service-level cases in `fullCompaction.test.ts` cover the footer carrying a live goal, the subagent snapshot, and running-first ordering over a capped history, using a stubbed `IAgentTaskService` so task lifecycle side effects (notifications, quiescence) stay out of the compaction tests. Two further service-level cases stub a throwing `IAgentGoalService` (the `goal.unsupported_agent` error a subagent's `getGoal()` really raises) and a throwing `IAgentTaskService`, and assert the compaction still completes with the section omitted and the remaining footer intact; with the swallows removed both tests fail, so the failure tolerance is tested behavior.
- Still open in 1.2: task 3's "auto/warn/hard thresholds" phrase. Only the auto and hard levels exist — `agent/fullCompaction/strategy.ts` declares `shouldCompact`/`shouldBlock`, and the failure cap (`maxFailuresPerPath`) plus the size caps are implemented — and no warn level exists anywhere. The gap already exists at HEAD e1d6203; it is not a regression of this item. The two restoration sections of task 1 are complete.

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
- Disk loading: `execPolicy/configSection.ts` registers the `execPolicy` config section (`{ path }`, strict; an invalid section is dropped by the config service with a warning diagnostic surfaced in TUI/stderr, which leaves the pass inert — the hard `config.invalid` failure applies to a configured policy file that fails to load) and `execPolicy/execPolicyLoader.ts` loads the file: `readExecPolicyFile` maps unreadable files and invalid JSON into `ExecPolicyLoadError` carrying the path, `resolveExecPolicyPath` expands `~` and resolves relative paths against the Omnicode home (never the workspace — the file carries approval rules, so a workspace must not be able to supply it), and `loadExecPolicyFromConfig` re-raises every load failure as `config.invalid`. `AgentPermissionPolicyService.composeExecPolicy` loads the configured file at agent-scope composition; a broken policy file fails agent creation with the load error instead of silently running without the exec policy. With no section the pass stays inert. `config-manifest.toml` regenerated (the run also picked up pre-existing hooks/swarm schema drift from HEAD source).
- Host amendment: `loadExecPolicy` now rejects a `hosts` amendment that would be silently dropped — an empty list, a blank host, or `hosts` on any decision other than `allow` is a load error, so a `prompt`/`forbidden` rule cannot carry hosts and run unrestricted after approval. `EXEC_POLICY_ALLOWED_HOSTS_KEY` / `execPolicyAllowedHostsFromMetadata` (in `execPolicy.ts`) type the amendment; the exec-policy rule attaches `{ execPolicyAllowedHosts }` to an `approve` whose matched rule carries `hosts`, and it reaches the tool through the existing `executionMetadata` seam (`permissionGateService` → `beforeToolExecuteEvent` → `execute({ metadata })`). `BashTool` reads it and refuses the command unless the sandbox seam can enforce it: `BashSandboxRequest.allowedHosts` makes `BashSandboxService.prepare` return `denied` with `hostRestrictionDenialMessage` (no backend can confine a process's network to specific hosts yet), and `BashTool` refuses directly when no sandbox service is present. Enforcement is therefore fail-closed refusal, not host scoping.
- Tests: loader/path-resolution/config-error cases in `execPolicy.test.ts`; amendment metadata and rule-level carry in `execPolicyRule.test.ts`; chain-level composition (allow/deny from a file, broken file fails the service, host amendment through the full chain) in `permissionPolicyService.test.ts`; `BashSandboxService` denial and `BashTool` refusal in `packages/Tools/test/os/bash/`.
- Still open in 2.1: actual per-host network confinement needs the 3.4 network proxy/credential broker — until then a `hosts` amendment is enforced by refusal, and no sandbox backend consumes `allowedHosts`.
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
- Scope classifier (2.2 task 2): `agent/interaction/reviewer/reviewerScope.ts` (`classifyReviewAsk`, `reviewerOutOfScope`) is deny-by-default. Only the `fallback-ask` origin is reviewable; `sensitive-file-access-ask`, `git-control-path-access-ask`, `dangerous-command-ask`, `auto-mode-classifier`, `exec-policy`, and `user-configured-ask` defer without calling the lane or spending guard budget. Surfaces outside local file read/write and diff (shell, network, delegation, interactive, unknown, protected paths via `isSensitiveFile`) are out of scope. A `search` display is refused: its only producer is the outbound WebSearch tool (local session search renders `generic`), so it is network-bound. Admission checks scope before `guard.begin()`, so an out-of-scope ask costs nothing.
- Isolated reviewer (2.2 task 1): `reviewerPrompt.ts` builds the whole input from the ask payload (tool, rule, display) under one prompt budget, and explicitly labels the payload untrusted data; it never sees the conversation. The answer parser accepts only one whole-reply JSON object (or a whole-reply fenced block), so prose or a payload-quoted `{"decision":"approve"}` is `unclear`. `llmReviewerLane.ts` (`LlmReviewerLane`) implements the lane over a `ReviewerModel` seam with its own model alias, prompt cap, timeout, and sample budget. `reviewerLaneService.ts` (`AgentReviewerLaneService`) composes it from the `reviewer` config section and installs it via `setReviewerLane`; the feature is `features/reviewer/reviewerFeature.ts`. The requester request is marked `isolated`, so the world-state section is neither injected nor consumed (previously an auxiliary request would have taken the pending delta from the next turn). Disabled by default; enabling it replaces the user prompt only for the reviewed local surface.
- Resampling and checkpoints (2.2 task 3): `reviewerSampling.ts` samples 1–3 times (config `samples`), requires unanimity to approve, stops at the first reject, treats a disagreement as `unclear`, and truncates an exhausted sample budget into `unclear` rather than approving on a partial set. Each run records a `ReviewerCheckpoint` (attempts, decisive, truncated) exposed by `LlmReviewerLane.checkpoint()`; the sample budget is a session-scoped ceiling (`ReviewerSampleBudget`). Guard budget (20 reviews, circuit after 3) is unchanged.
- Configurable timeout (2.2 task 3): `AgentToolApprovalService.consultReviewer` now passes the lane's own `timeoutMs`; `reviewer` config `timeoutMs` (also `OMNICODE_REVIEWER_TIMEOUT_MS`) flows into the lane, and `admitReviewer` falls back to the lane's value when no explicit deadline is given.
- Config (2.2): `agent/interaction/reviewer/configSection.ts` registers the strict `reviewer` section (`enabled`, `model`, `timeoutMs`, `samples`, `maxPromptChars`, `maxOutputTokens`) with env bindings; `config-manifest.toml` was regenerated. Defaults: disabled, 20s, 1 sample, 4000 prompt chars, 512 output tokens.
- MCP elicitation (2.2 task 5): `reviewerElicitation.ts` (`resolveElicitation`) runs `admitElicitation` first and never weakens it; an elicitation whose schema can require values (`properties`, `required`, `additionalProperties: true`, or any unknown keyword) is human-required and the lane is never consulted. Only a provably field-free schema may be auto-acknowledged by a reviewer approval; every other outcome goes to the user.
- Tests: `test/agent/interaction/reviewerLane.test.ts` (42) covers scope bands and refusals (including the network-bound `search` display), boundary origins, protected paths, budget-free refusal, lane-supplied timeout, prompt isolation and whole-prompt truncation, strict whole-reply parsing (prose and payload-quoted objects are `unclear`), resampling unanimity/reject/disagreement/budget truncation, lane model refusal, elicitation dispositions, service composition (disabled installs nothing, enabled installs the configured lane, dispose clears, request is isolated/tool-free and carries only the ask), and requester rejections. `test/agent/toolApproval/toolApproval.test.ts` (31) adds shell/boundary-origin refusals and the lane-timeout fallback; `test/agent/llmRequester/llmRequesterService.test.ts` (65) adds the isolated-request world-state test.
- Still open in 2.2: no MCP client transport implements elicitation, so `resolveElicitation` is a tested seam rather than a live path (same gap as 3.2); no TUI surface shows reviewer status/checkpoints; the reviewable scope is deliberately fixed and has no config knob to widen it.

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
- Per-turn/session/goal cost recording: `agent/usage/costLedger.ts` + `agent/usage/costLedgerService.ts` (`AgentCostLedgerService`, agent scope) prices every recorded usage through the cost gate's table and exposes `status()` as `{ spentUsd, unknownPricing, liveRecords, currentTurn, turns, goals }`; both modules are exported from the engine entry like the other usage surfaces. Session spend is priced from the persisted per-model usage state (`ISessionUsageService.status().byModel`) instead of accumulated live, so it survives replay exactly where session usage persists; the per-turn and per-goal breakdowns are live-session state, the same durability class as `UsageStatus.currentTurn`, and `liveRecords` is the reset signal — 0 after a replay while `spentUsd` is non-zero means the empty turn/goal maps were reset, not that the session had no per-turn spend. `unknownPricing` is a snapshot-wide honesty flag: one unpriced model makes every number in the snapshot a lower bound, and an observed turn is listed even when its priced spend is 0 for that reason.
- Goal wiring: `features/goal/goalService.ts` claims each goal-driven turn in the ledger via `attributeGoalTurn(goalId, turnId)` when the turn starts — live turns of an active goal, goal continuations (including a continuation turn whose goal completed before the turn started), and starter turns adopted mid-turn — so a turn's recorded cost, attributed before, between, or after its records, flows to the owning goal.
- Tests: `packages/engine/test/agent/usage/usage.test.ts` (new `AgentCostLedgerService` block) covers turn accumulation, state-derived session spend for records that predate the ledger plus the `liveRecords` reset signal, attribution across record order, re-attribution without double counting, unknown pricing and the unpriced-turn zero entry, the empty state, and session-scoped exclusion; `test/features/goal/goal.test.ts` ("AgentGoalService cost attribution") covers the active-goal turn, a turn adopted mid-flight by a newly created goal, and a continuation turn attributed to its completed goal, with non-goal turns staying out of the goal breakdown. The two non-active-goal cases were each verified by deleting their `goalService` claim and observing only the matching test fail.
- Still open for 2.3 task 1 (prices from the shared catalog): there is no price data to populate from and no seam to carry it. `packages/llm/src/pricing.ts` is mechanics only — a `ModelPricingTable` built from caller-provided entries — and `packages/llm/src/catalog.ts` (the models.dev-shaped catalog) models limits and capabilities but no price fields, so the shared catalog carries no prices today. The engine deliberately does not depend on the `llm` package, and shipping a generated price table inside the engine would contradict the gate's design that prices live in operator config (`costLimits.modelPrices`), because a shipped table goes stale silently. Revisit only if the `llm` catalog starts modeling models.dev `cost` data and a data-only seam (generated JSON import) is added for the engine.
- Provider key validation (2.3 task 4, key half): `llm-adapter/provider/provider-key.ts` adds `checkProviderApiKey` / `assertProviderApiKey`. It enforces what is locally decidable — non-empty, no leading/trailing whitespace, no whitespace or control characters inside the key (all invalid in an HTTP header) — and rejects a first-party signature used with the wrong provider (`sk-ant-*` outside anthropic, `AIza*` outside google-genai). Generic `sk-*` keys are deliberately not treated as OpenAI signatures because Anthropic-compatible gateways issue them; `omnicode` and custom provider types skip the family check. `ModelCatalog.buildModel` validates the raw model-level `api_key` and the raw provider `api_key` before they can be trimmed into a request, and the env branch validates the raw environment value at `resolve()` time, so surrounding whitespace is a refusal rather than a silent trim; the reported field follows the credential that is actually used (`models.<id>.api_key` when the model declares the key, `providers.<name>.api_key` for a provider key, plus the env var name). Every failure is `config.invalid`, names the field and never echoes the key. Named loss: a provider that accepted any bearer token now refuses a key shaped for another first-party provider; the error names the field, and the check is scoped to the four first-party provider types (`anthropic`, `openai`, `openai_responses`, `google-genai`) so managed and custom providers are unaffected.
- Tests: `packages/engine/test/llm-adapter/provider/providerKey.test.ts` (7) covers header-unsafe keys, first-party match/mismatch, gateway `sk-*` and managed providers, and the field-naming error; `test/llm-adapter/model/catalog.test.ts` ("provider key validation") covers a mis-pasted provider-level key at composition, a mis-pasted env key at resolve time, a valid env key, a mis-pasted model-level key (reported as `models.<id>.api_key`), and a model-level key with surrounding whitespace (86 tests in that file pass).
- Quota circuit state (2.3 task 4, circuit half): `agent/usage/quotaCircuit.ts` is a pure per-provider circuit. `quotaCircuitFailureKind` counts only quota-exhausted and auth rejections (rate limits, 5xx, timeouts stay transient); the circuit opens after repeated counted failures (`openAfterFailures`, default 3), reports `{ scope, state, consecutiveFailures, lastFailureKind, openedAt, reopensAt }`, auto-closes after `cooldownMs` (default 60s) while keeping the count so one more failure re-opens it immediately, and `recordSuccess` clears the scope. It never refuses the primary model on its own: the operator chose it, and an outage that heals must not need a restart. `llmRequesterService` records every request failure/success against the model's provider and reports `providerQuotaStates()` (added as an optional method on `IAgentLLMRequesterService`).
- Ordered fallback (2.3 task 5): `agent/usage/fallbackChain.ts` is the pure selector. `selectOrderedFallback` rejects any model already in the chain (including the primary), rejects capability loss (missing tool use, images, thinking, or a smaller context window is never silently degraded), requires ownership by default, rejects providers whose circuit is open, de-duplicates aliases, and ranks the remainder by capability score, then ownership, then configuration order. Ownership is the union of `declaresProviderOwnership` (the record names `providerId`, `provider`, or `baseUrl`) and the engine resolving the model to a configured provider (`IProviderService.get(model.providerName)`), so a model bound through the supported `defaultProvider` config is eligible instead of being permanently excluded.
- Fallback composition: `llmRequesterService.runWithModelFallback` wraps the request loop. Fallback is opt-in via `OMNICODE_MODEL_FALLBACK`, never runs when the caller pinned `overrides.modelAlias`, only fires for provider-side failures (quota, rate limit, overload, auth, 5xx, network, timeout — never context overflow, request-too-large, or abort), tries each configured model at most once, re-resolves and re-prices the candidate before anything is claimed: `onAttemptRetry` is signalled, `resolveRequest` and `assertCostBudget` run first, and only then is the `model-fallback` `WarningIssued` and log line emitted, so a candidate budget refusal or a candidate that fails to build leaves no switch claim. When no candidate is eligible the failure stays on the failed model and a warning log lists every rejection reason (`alias (reason, …)`). Tests: `test/agent/usage/fallbackChain.test.ts` (11) and `test/agent/usage/quotaCircuit.test.ts` (8); `test/agent/llmRequester/llmRequesterService.test.ts` ("model fallback", 11 cases) covers the switch and its warning, opt-in off, a pinned alias, a capability-mismatched candidate plus its rejection log, one attempt per model in a chain, circuit open/report/recover, `onAttemptRetry` on a switch, no warning or candidate call when the cost gate refuses, context overflow staying on the failed model, and a `defaultProvider`-bound model counting as owned. `packages/llm/test/fallback.test.ts` gained mid-chain and exhausted-chain cases (7 tests pass there).
- Still open in 2.3: the TUI usage panel does not render `providerQuotaStates()` or fallback switches yet (they are observable via the warning event and the requester accessor); fallback is opt-in and only per-request, with no persisted operator-configured fallback list or cross-request hysteresis beyond the circuit cooldown; the shared-catalog pricing seam above is unchanged.

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
- Tests: `packages/Tools/test/patch/patchSemantics.test.ts` covers "writes nothing when a later hunk fails", duplicate targets, move onto an existing file, plain move, update+move, committed-delta on a mid-patch write failure, and virtual dry-run isolation. Existing `applyPatch.test.ts` and `patchJournal.test.ts` still pass (23 total in `test/patch`).
- Streaming parser: `PatchStreamParser` (`packages/Tools/src/patch/patchStream.ts`) consumes patch text chunk by chunk — handles CRLF split across chunks, holds partial lines, and exposes finished operations through `operations()` before the patch closes; duplicate targets are checked at `*** End Patch`. `parsePatch` is now a wrapper over the same state machine, so whole-string and streaming parses cannot drift. Operation types and `patchOperationPaths`/`assertUniqueTargets` moved to `patchOperations.ts` and are re-exported from `applyPatch.ts`.
- Path abstraction: `packages/Tools/src/patch/patchPath.ts` adds `PatchPathMapper` (`toBackend`), `createPatchPathMapper`, `identityPatchPathMapper`, and `rootedPatchPathMapper` (rejects absolute patch paths and `..` escapes out of the root). `applyPatch(patch, fs, { paths })` resolves every read, write, delete, journal record, and post-write verify through the mapper while `changedFiles` keeps the patch-authored paths; a remote host can therefore apply a patch against its own tree. `ApplyPatchTool` passes its `resolvePathAccessPath` results as the mapper instead of mapping inside the FS adapter. Journal records now carry backend-resolved paths, so crash recovery (`recoverPatchJournals`) restores the real files; previously a relative patch path was journaled verbatim and restore resolved it against the process CWD.
- Turn diff tracker: `packages/engine/src/agent/turnDiff/` adds `IAgentTurnDiffService` + `AgentTurnDiffService` (agent-scoped, registered `OnScopeCreated`, exported from the engine entry). It captures pre-write content from `onWillExecuteTool` write/readwrite accesses, post-write content from the did-execute hook, re-reads every tracked path and closes the snapshot on `TurnEnded`. Snapshots report per-turn files with status/`additions`/`deletions` (bounded line LCS, `binary` and `oversize` flags) via `snapshot(turnId)`, `latest()` (live while open), `turns()`, and `activeTurn()`; retention is bounded. Data-only: the CLI `/diff` command is a later item and not built here.
- Tests: `packages/Tools/test/patch/applyPatch.test.ts` adds streaming cases (chunk-size invariance against `parsePatch`, incremental operation exposure, CRLF across chunks, malformed line, missing terminator, duplicate target at close); `patchSemantics.test.ts` adds path-seam cases (apply through a rooted mapper, mapped move destinations, traversal/absolute rejection). New `packages/engine/test/agent/turnDiff/` covers the tracker deltas (add/modify/delete, unchanged omission, first-capture-wins, binary/oversize, close/retain) and the service wiring (turn recording, live `latest()`, oversize marking, other-agent filtering) — 13 tests.
- Still open in 3.1: the CLI `/diff` command that consumes `IAgentTurnDiffService` (explicitly a later item).


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
- Tests: `packages/engine/test/mcpCore/resourceSurface.test.ts` covers capability projection, unsupported operations, page caps and cursors, body caps, prompt caps, trust envelopes, and elicitation admission.
- Transport reachability: `StdioMcpClient` now implements the `McpResourceTransport` seam — `listResources`/`readResource`/`listPrompts`/`getPrompt` with cursor passthrough (pages capped by `McpResourceSurface`, not the transport), plus `advertisedCapabilities()` from the initialize result. A server that lacks the capability surfaces as the SDK's local capability refusal or as wire-level `Method not found`; both map to `McpUnsupportedError` via `toMcpUnsupportedError` in `client-shared.ts`. HTTP and SSE clients still implement tools only.
- Agent tools: `agent/mcp/tools/surface.ts` adds `createMcpResourcesTool`/`createMcpPromptsTool` (`mcp__<server>__resources`, `mcp__<server>__prompts`), registered per connected server in `AgentMcpService.registerMcpServer` only when the server advertises the capability, with live-client resolution at call time and a server-authored tool with the same qualified name winning over the synthetic one. Model visibility rides the existing `mcp__*` source-`mcp` profile patterns — no profile change needed. Approval stays manual (qualified-name `approvalRule`); the tools are deliberately **not** added to `default-tool-approve.ts` because they execute server-defined reads and inject server-controlled content into the conversation, which does not meet the "genuinely safe" bar for auto-approval. List outputs carry an untrusted header; read/get outputs go through `labelResource`/`labelPrompt`.
- Sampling seam: `SamplingPolicy` + `admitSampling` mirror `admitElicitation` (denied unless the operator enabled sampling and the server is allowlisted; no empty request). It is a tested seam only — no transport handles `sampling/createMessage` yet.
- Tests: `test/mcpCore/client-stdio.test.ts` adds fixture-server cases for capability advertisement, cursor pagination across pages, text/blob reads, prompt non-text omission, unsupported mapping, and the surface composition (page/body caps through a real stdio transport); `test/mcpCore/resourceSurface.test.ts` adds `admitSampling` cases; new `test/agent/mcp/tools/surface.test.ts` covers the tool outputs, envelopes, unsupported/not-connected errors, and argument validation; `test/agent/mcp/mcp.test.ts` covers the registration rules (advertised → registered and executable, not advertised → absent, server-authored name claim wins).
- Still open in 3.2: HTTP/SSE transports do not implement the resources/prompts operations; sampling and elicitation remain policy seams without a live transport path; server instructions stay a pure-layer label (`labelInstructions`) with no transport or prompt wiring; surface-tool caps use `DEFAULT_MCP_LIMITS` with no config knob.

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
- Implicit invocation: `AgentSkillService.recordModelToolActivation` — the entry point the `Skill` tool calls mid-turn (`trigger: 'model-tool'` or `'nested-skill'`) — arms the enforcer before recording the activation. The grant comes from the same catalog entry the tool resolved; if the catalog no longer knows the name it arms from the origin identity without metadata (provenance recorded, tools unrestricted — no grant is invented). Clearing is the shared `TurnEnded` subscription, so an implicitly activated grant lasts exactly the rest of the turn, like an explicit one.
- Trust label on the model-tool path: `SkillTool` now wraps the rendered skill content with `labelSkillContent`/`skillTrust` before `renderModelToolSkillPrompt`, so project/extra skills delivered through the `Skill` tool carry the same untrusted envelope as user-slash activation (trusted sources unchanged).
- Tests: `test/agent/toolExecutor/toolExecutor.test.ts` adds a "skill grant guard" block (hidden tool refused by the executor while an allowed tool in the same batch runs; unrestricted grant passes everything; empty allowlist refuses everything). `test/features/skill/skill.test.ts` adds enforcer-arming and trust-envelope cases for the `Skill` tool plus an end-to-end harness case: a scripted turn calls the real `Skill` tool, the next request no longer offers the hidden tool and the executor refuses its call with the skill message while an allowed tool still runs, and the grant is cleared after the turn. The harness case fails on the pre-fix tree (hidden tool still offered and executed) and passes with the fix.
- Still open in 3.3: nothing. The `Skill` tool is approved by default (`default-tool-approve.ts`), and an implicitly armed grant applies from the next step onward — the batch containing the `Skill` call itself was already preflighted before the grant existed, which is inherent to mid-turn steer semantics.


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
- Tests: `packages/Kaos/test/sandbox/seatbelt.test.ts` (15 tests) covers profile shape, network gating, write-allowlist containment, path escaping/injection, probe states, argv shape, argv injection, and deny-read rules. Full `test/sandbox` suite passes (114).
- Per-path grants (task 4): `packages/Kaos/src/sandbox/grants.ts` adds `SandboxPathGrants` — `normalizeSandboxPathGrants` (absolute/contained validation, dedupe), `mergeSandboxPathGrants` (additive union; a source without a write allowlist widens the merge to whole-workspace RW), `intersectSandboxPathGrants` (conjunction across independent authorities; deny-read unions in both, so no composition can un-deny a read), `evaluateSandboxPathGrants` (one read/write check; deny-read never blocks a write), and the glob matcher (`*` segment-local, `**` crossing, `?` single) shared with the seatbelt regex projection. Tests: `packages/Kaos/test/sandbox/grants.test.ts` (26).
- Deny-read projection: `SandboxPolicy.denyReadPaths` flows into the seatbelt profile as `(deny file-read* (subpath ...))` / anchored `(regex ...)` rules placed after the read allow (deny precedence), and into `summarizeSandboxPolicy`. bwrap refuses a deny-read policy with `unsupported-operation` — bind mounts cannot hide bound content — so callers fall back explicitly instead of silently ignoring the grants; `createSandboxExecutionPlan` now builds per-backend plans (seatbelt plans carry `command: /usr/bin/sandbox-exec`). Tests in `grants.test.ts`, `seatbelt.test.ts`, `bwrap.test.ts`, `execution.test.ts`.
- Host backend selection (task 6, selection half): `selectSandboxBackend` takes `preferredBackend` (host config, env `OMNICODE_SANDBOX_BACKEND` at the call sites). A preferred backend is a hard choice: unavailable means `enabled: false`, reason `preferred-backend-unavailable`, and a `fallback { from, to: null, reason }` record naming the real probe failure — the selection never substitutes a different backend. The default preference order also records a `fallback` when it downgrades. `probeSandboxBackends` now probes seatbelt alongside bwrap/landlock. Tests: `selection.test.ts` (13), `availability.test.ts` (12).
- Whole-agent routing (task 3): the engine grows `os/sandbox/childSandbox.ts` (`prepareChildSandboxSpawn`, env-driven mode/backend/write-roots/deny-read/network, injected-probe seam, module probe cache plus a `setChildSandboxProbeForTests` override so consumer tests never exec the real backend binaries) and now depends on the kaos leaf. Wired consumers, all no-ops by default (`OMNICODE_SANDBOX_MODE=off`): MCP stdio children (`mcpCore/client-stdio.ts` — `required` fails the connection, `auto` runs direct with the reason pushed into the stderr tail as a `[sandbox]` line), external hooks (`features/externalHooks` — `required` blocks the hook, `auto` runs it with `HookResult.sandboxNote`, `shell: true` hooks always run unsandboxed with a note, the trigger cwd is the workspace), git worktree children (`packages/Tools/src/git-worktree` — required fails the git run, auto appends `[sandbox]` to the tool output), and in-process Write/Edit/ApplyPatch/NotebookEdit/RestoreFile through `packages/Tools/src/os/sandbox/pathGrants.ts` enforcing `OMNICODE_SANDBOX_WRITE_ROOTS` (ApplyPatch checks every operation path and refuses the whole patch; RestoreFile checks explicit targets and the chosen turn's file list before the history engine runs) and `OMNICODE_SANDBOX_DENY_READ` (Read/Lsp/notebook reads) with fail-closed invalid config: a non-absolute entry is a refusal naming the rejected entries for in-process checks, and for the child-process path raw entries reach the plan builder whose validation fails the plan with the entry named — neither silently shrinks the configured grants. `BashSandboxService` gains the same backend preference and deny-read knobs, and `BashTool` surfaces the fallback reason in its output (`[sandbox]` prefix; `sandbox:` line for background tasks).
- Tests: `packages/engine/test/os/sandbox/childSandbox.test.ts` (11), sandbox routing cases in `test/mcpCore/client-stdio.test.ts` (33 total in file) and `test/features/externalHooks/runner.test.ts` (17), `packages/Tools/test/os/pathGrants.test.ts` (10), backend-preference/fallback cases in `packages/Tools/test/os/bash/sandbox.test.ts` and `bashTool.test.ts`, worktree sandbox cases in `packages/Tools/test/git-worktree/git-worktree.test.ts`, and grant-enforcement cases for the patch/notebook/restore tools in `packages/Tools/test/patch/applyPatch.test.ts`, `packages/Tools/test/notebook/notebook.test.ts`, and the new `packages/Tools/test/restore-file/restoreFileTool.test.ts`.
- Network egress seam (task 5, seam half): `packages/Kaos/src/sandbox/network.ts`. `authorizeSandboxNetworkDestination` authorizes one destination (exact, case-insensitive host match with trailing-dot normalization, deny-by-default; wildcards, ports, and schemes in allow entries are rejected — the same shape as the exec-policy `hosts` amendment); `resolveSandboxNetworkEgress` projects the child env as `unrestricted`, `proxy-env` (sets `HTTPS_PROXY`/`HTTP_PROXY` in both cases and removes `NO_PROXY`/`no_proxy` from the caller-supplied env so the proxy cannot be bypassed), or `denied`. `createMapCredentialBroker` releases credentials only for an *enforced* authorization whose host matches the credential host — an unrestricted policy releases nothing, so a host-scoped secret cannot leak to any destination — and `substituteSandboxSecrets` fills `$OMNICODE_SECRET_<id>` / `${OMNICODE_SECRET_<id>}` placeholders from released credentials only; tokens without a release stay literal. The authorization → release → substitution order is structural: a denied destination produces no authorization value, so no release or substitution is reachable for it. `proxy-env` names itself: it is advisory routing (a child that ignores proxy env vars connects directly), not enforcement, so host-restricted shell commands still refuse and a restricted policy without a proxy is `denied`, never a silent downgrade. Tests: `packages/Kaos/test/sandbox/network.test.ts` (30).
- Windows backend (task 2): `packages/Kaos/src/sandbox/windows.ts`; kind `windows` registered in `SandboxBackendKind`, `createSandboxBackend`, `SANDBOX_BACKEND_PREFERENCE` (bwrap, seatbelt, windows, landlock), `probeSandboxBackends`, the execution-plan builder, and both `OMNICODE_SANDBOX_BACKEND` parsers (engine child sandbox, Tools Bash). `buildWindowsSandboxProfile` is the AppContainer/Job Object descriptor: `internetClient` capability only when the policy shares the network, Job Object kill-on-close with breakaway disabled, per-path rules (workspace read-write, or workspace read plus contained write-allowlist read-write, explicit system paths read; deny-read is literal-path-only because AppContainer ACLs cannot be globs; explicit tmpfs is refused). Creating an AppContainer child needs Win32 process-creation attributes (`STARTUPINFOEX` + `SECURITY_CAPABILITIES`) that a plain argv cannot carry, so `buildWindowsSandboxArgv` emits the run protocol `[helper, 'run', '--profile', <profile JSON>, '--', ...argv]` only when a host configured an absolute native helper path, and refuses with `backend-unavailable` otherwise — the same honesty class as landlock, so nothing runs unconfined behind a claimed sandbox. `probeWindowsSandbox` is honest: unavailable off win32 with the platform named (fallback `bwrap`), unavailable on win32 without a helper or probe (fallback `null` — nothing else exists on Windows), and the real probe outcome otherwise. Preferred-backend selection keeps the no-substitution rule: a preferred `windows` that is unavailable reports `preferred-backend-unavailable` with `fallback { from: 'windows', to: null, reason }`. Tests: `packages/Kaos/test/sandbox/windows.test.ts` (26).
- Still open in 3.4: an OS-enforced network proxy transport so exec-policy `hosts` amendments can run instead of refuse (the seam, credential broker, and substitution ordering are in place; `proxy-env` is advisory only); a native Windows helper implementing the `[helper, 'run', '--profile', <json>, '--', ...argv]` protocol so the windows backend can become available on win32; deny-read enforcement for Grep/Glob tree walks. The seatbelt deny-read projection relies on Seatbelt's documented deny-over-allow precedence, which can only be validated by running a profile on macOS — on this Linux host only the profile text is tested. No CLI/config-section surface yet beyond the env knobs. Pre-existing on HEAD and unrelated to this item: `lint:imports` reports 6 human-boundary violations in `fullCompactionService`, `loop`, `loopService`, `videoUpload`, `human/agent/origin`, and `externalHooksRunner.test.ts` has one failing telemetry test (verified identical with the hook sources reverted).

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
- Turn-diff render seam: `IAgentTurnDiffService.render(scope)` renders `latest` (the most recent turn, live while open) or `session` (every retained turn merged per path — first pre-image wins, last post-image wins, so a reverted path drops out) through `features/sessionSearch/diffRender.ts` at its default caps. `TurnDiffTracker.diffInputs` feeds only changed, non-binary, non-oversize paths with empty strings for missing sides (pure add/delete); `files()` keeps the binary/oversize entries so the view can name what renders no body. `renderableInput` mirrors `fileDelta` gate-for-gate — including the 4M-cell `countLineDelta` budget, whose excess `fileDelta` reports as `oversize` — so a path `files()` flags oversize never reaches the renderer while the panel note claiming "not rendered" stays truthful (caught in review: a <1MB file with a very large changed region used to render a capped body *and* the contradictory note). `TurnDiffView { scope, turnId?, text, truncated, files }` rides the engine entry exports.
- RPC: SDK `getTurnDiff` (`packages/SDK/src/rpc.ts` abstract + `Session.getTurnDiff({ scope })`), re-exported types in `packages/SDK/src/types.ts`, implemented in `packages/API/src/requestHandler.ts` through the main agent's `IAgentTurnDiffService` (same main-only resolution as file history). Rendered text keeps the RPC payload bounded; raw pre/post content never crosses the wire.
- `/diff` CLI command (`apps/omnicode-cli/src/tui/commands/diff.ts`): bare `/diff` shows the latest turn, `/diff session` the merged session view, in a transcript panel labeled with the turn id / scope; the renderer's truncation marker appears inline and one note per binary/oversize file explains why it renders no body. Anything else is a usage hint. Registered in the command registry with `always` availability (the tracker snapshot is queue-safe mid-turn) and lazy-creates the session like the other session-requiring commands.
- `/review` CLI command (`apps/omnicode-cli/src/tui/commands/review.ts`): `/review [session] [<focus>]` (`--` escapes the `session` keyword) fetches the turn diff and sends a structured review prompt — reviewer framing ("do not edit files"), scope line, focus, the diff as fenced data declared non-instructional with a fence longer than any backtick run inside it, a finding format (severity critical/major/minor/nit + file path + line/symbol reference + why + suggested fix, correctness → security → style order), and a forced final `Verdict: approve | request-changes` line. Refuses with a status when nothing was tracked and with `LLM not set` when no model is configured.
- `SearchSessions` profile admission: added to the `agent`, `coder`, and `explore` allowlists in `packages/engine/src/session/agentLifecycle/profile/profiles.ts`. The tool itself stays gated behind the `session_search` experimental flag and manually approved — it is not added to `default-tool-approve.ts`, because a model-initiated search can read other sessions' content without the user watching.
- Tests: `packages/engine/test/features/sessionSearch/localSessionSearch.test.ts` adds a pagination block (multi-page token walk with no losses or duplicates, token past the end, invalid/negative token fallback to the first page, page-size clamps 1–100, empty-query listing); `packages/engine/test/agent/turnDiff/turnDiff.test.ts` covers the tracker's `diffInputs`/`files` filtering and cross-turn session merge, plus the budget-exclusion case that keeps the oversize note truthful; `turnDiffService.test.ts` covers `render('latest')`/`render('session')`, the no-change view, and the renderer line cap through the real service; `packages/engine/test/session/agentLifecycle/profile/profiles.test.ts` asserts the admission; the two subagent-description expectations in `test/tool/tool.test.ts` gained `SearchSessions` (the `Agent` tool description embeds each profile's tool list, so the admission is prompt-visible behavior); the `llm.tools_snapshot` inline snapshot in `test/agent/loop/loop.test.ts` was regenerated for the same reason (`hash 117fe582… → ef8c8ed0…` plus the two `, SearchSessions` tool-list insertions — word-diff verified to contain nothing else); `apps/omnicode-cli/test/tui/commands/diff.test.ts` and `review.test.ts` cover the parsers, panel lines, prompt structure (including fence escalation against a diff containing its own code fence), scope mapping, error paths, and the nothing-to-review refusal.
- Local search registration note: the engine still registers only the unavailable fallback (`ISessionSearchService` on App scope); `LocalSessionSearchService` remains host-composed and is exported through `packages/API/src/runtime-primitives.ts` for hosts that own a transcript source. Model-side session search on the CLI therefore still depends on the `session_search` flag plus a bound source.
- Still open in 4.1: nothing from the task list; remaining niceties are `/diff`/`/review` argument autocompletion in the palette and a TUI surface that renders the truncated view interactively (the rendered text already says the view is partial).


### 4.2 Tool card actions and TUI stats

Files:

- `apps/omnicode-cli/src/tui/`
- tests

Tasks:

1. Retry/open diff/copy path/show full output/jump to artifact.
2. Context %, cache hit, latency, cost, error rate.
3. Live agent panel and loop-detection confirmation.

#### 4.2 progress

- Tool card actions (`/tools`, alias `/tool`): `apps/omnicode-cli/src/tui/controllers/tool-calls.ts` collects tool-call cards from the rendered transcript entries (same source `/copy` reads, so it works mid-turn, after compaction, and on resume without an engine round-trip) and drives a `CatalogBrowserApp` full-screen takeover listing them newest-first with the card header (tool + key argument), a result preview line, and done/failed/running badges. Per-card detail-page actions: `Show full output` (opens `components/dialogs/tool-output-viewer.ts`, a scrolling framed viewer in the tasks-browser style), `Open diff` (closes the palette and renders the card's own diff — Edit old/new strings, Write whole-file addition — through `renderDiffLinesClustered` uncapped into a transcript panel), `Copy path` (clipboard), `Jump to artifact` (OS opener via `openUrl`, the same path OSC-8 links use), and `Retry turn` (danger-toned, `y`-confirmed). Path extraction covers `path`/`file_path` args plus the `output_path` of a spilled result envelope (`isSpilledToolOutput`-gated, so ordinary output containing that text is not treated as a pointer). Retry semantics: the engine has no per-tool re-run API, so the honest retry available to the UI is re-sending the last real user prompt (shell-command echoes with an empty bullet are skipped); it is disabled while a turn streams or compaction runs. State slot `toolCallsBrowser` on `TUIState`; closed on session switch and stop.
- TUI stats: context % already existed (footer line 2, exact tokens when known). Added `apps/omnicode-cli/src/tui/utils/session-stats.ts` — a `SessionStats` accumulator fed by the session event handler (`turn.started`, `turn.ended` with `reason`/`durationMs`, `turn.step.completed` `llmFirstTokenLatencyMs`, `error` events; reset on session switch) and exposed to slash commands through an optional `sessionStatsSnapshot()` on `SlashCommandHost`. The `/usage` panel gains a `Session stats` section (turn counts with failed/error counts, error rate as failed/started, turn latency last+avg, first-token latency last+avg — a dimension with no samples renders no line) and a cache-hit line in the session section (`inputCacheRead / (inputOther + cacheRead + cacheCreation)`, preferring the RPC's `total`, falling back to the byModel sums for older payloads). Cost: no per-token pricing surface exists anywhere in the repo, so cost remains the plan-quota + wallet views already in `/usage`; a token-level cost line was deliberately not invented.
- Live agent panel (`/agents`, alias `/agent`): `apps/omnicode-cli/src/tui/controllers/live-agents.ts` lists every `SubagentActivityRecord` the in-memory store teed this session — foreground and background agents, including a foreground one detached via Ctrl+B that has no transcript card and never reaches the tasks browser — via `CatalogBrowserApp` with step/tool counters and status badges, refreshed by a 1s poll. The entry action opens the existing `AgentActivityViewer` full-screen (nested takeover, same viewer the tasks browser uses). `SubagentActivityStore.list()` added for the enumeration.
- Loop-detection confirmation: the engine's `AgentTextLoopWatchService` now publishes a new `LoopSignalDetected` Event2 (`loop.detected`, observable, non-durable, advisory — the turn keeps running and the model reminder channel is unchanged) once per newly detected signal on the agent bus, with kind `text_loop`/`result_stagnation`, detail, and turnId. It rides the existing v2→v1 event projection (`SDK/src/v2/event-mapper.ts` passes unlisted types through) into the CLI, which routes it to `OmnicodeTUI.handleLoopDetected`: one confirmation per turn (`LoopConfirmationDialog`, a continue/stop list dialog in the cache-hint visual style) mounted only when `fullscreenSurfaceOpen(state)` reports no competing surface — the shared predicate covers every editor replacement and takeover slot (tasks/tool-calls/live-agents/skills/subagents/connectors browsers, update recommender, MCP manager) plus the external-editor state, so over any of them the dialog degrades to a status hint instead of mounting invisibly or stealing input routing. `Stop the turn` cancels via `session.cancel()`; Esc continues. The SDK's exhaustive `session-event-types.test.ts` contract switch gained the new `loop.detected` case.
- Tests: `apps/omnicode-cli/test/tui/utils/session-stats.test.ts` (accumulator semantics, latency formatting, cache rate), extended `apps/omnicode-cli/test/tui/components/messages/usage-panel.test.ts` (stats section renders/omits, cache line), `apps/omnicode-cli/test/tui/controllers/tool-calls.test.ts` (card collection, path/spill extraction, diff payloads, last-user-prompt, palette render/actions/viewer/retry-confirm/gating through real key input, `ToolOutputViewer` rendering), `apps/omnicode-cli/test/tui/controllers/live-agents.test.ts` (listing, counters, viewer open/close, refresh pickup), `apps/omnicode-cli/test/tui/components/dialogs/loop-confirmation.test.ts` (dialog keys/render plus the `loop.detected` routing), and `packages/engine/test/agent/loop/textLoopWatch.test.ts` gained publish-assertions (one event per newly detected signal, correct kind, no re-announce while pending). The engine loop suite passes (124), SDK contract suite passes (9).
- Still open in 4.2: per-tool re-run (retry is turn-level because the engine exposes no tool re-run API); a token-level cost line (needs a pricing surface); `/tools` argument autocompletion is unnecessary (no args) but the palette does not yet remember its selected card across refreshes; the loop confirmation is not offered on the v1 engine path (the loop watch only exists on the v2 engine).

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
