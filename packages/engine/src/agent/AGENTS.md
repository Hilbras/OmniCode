# agent — agent-scope runtime

## Role and non-goals

`packages/engine/src/agent` holds the per-agent runtime: the state-machine loop,
context memory and compaction, tool registry/executor/policy, permissions,
prompts, profiles, media, agent-side MCP tools, tasks, undo, and agent state.

Not here: session lifecycle and profiles (`session/`), app bootstrap/config
(`app/`), MCP transports (`mcpCore/`), the pure LLM kernel (`human/`), or tool
implementations (`packages/Tools`).

## Entry points and ownership

- `loop/loopService.ts` drives turns; `loop/machine/` adapts the `human/` agent
  and tool machines and is the only agent path allowed to import their
  implementation modules.
- `contextMemory/` owns conversation history, tool exchanges, hooks, and
  compaction handoff; `fullCompaction/` and `contextProjector/` are separate
  services around it.
- `toolRegistry/` owns tool registration and the built-in assembly service;
  `toolExecutor/`, `toolPolicy/`, `toolApproval/`, `toolActivation/`,
  `toolDedupe/`, `toolSelect/`, and `toolResultTruncation/` own execution.
- `permissionPolicy/`, `permissionGate/`, `permissionMode/`, and
  `permissionRules/` own approval modes and rule matching.
- `profile/`, `prompt/`, `command/`, `runtimeBinding/`, `scopeContext/`, and
  `state/` own agent identity, prompts, commands, runtime leases, and state.
- `mcp/` turns MCP servers into agent tools and emits MCP events; it does not
  own transports or session overlays.
- `media/`, `task/`, `undo/`, `blob/`, `usage/`, `tokenCounting/`, and
  `replayBuilder/` own their named agent concerns.
- `team/` owns the in-memory team lifecycle and shared task list, arena model
  comparison, workflow budget ledger, forked-context cache, and background-task
  notification queue. `team/teamTools.ts` registers the `Team` tool and
  `team/arenaTool.ts` registers the `Arena` tool; both are admitted through
  profiles and permission rules.

## Registration, events, and session rules

- Tools are contributed with `registerAgentToolService` in
  `toolRegistry/toolContribution.ts`, or through `Feature.contributeTool`.
  `BuiltinToolAssemblyService` copies contributions into the agent scope.
- A tool is visible to the model only if the active profile lists its name in
  `packages/engine/src/session/agentLifecycle/profile/profiles.ts`. Approval is
  separate: safe additions go in `permissionPolicy/policies/default-tool-approve.ts`.
- Agent state is event-sourced. Durable `AgentEvent2` classes declare `type`,
  `durable`, and a zod schema; new state uses `defineState` and must be
  contributed by `AgentStateService`. Replay comes from `wire.jsonl`.
- The loop is turn-driven; do not add a second loop or a parallel step scheduler.
  Tool execution goes through the executor so permissions, truncation, dedupe,
  and event recording stay in one path.
- Session-owned data (session id, cwd, workspace context, MCP handle, profiles)
  is injected into the agent scope; do not reach into `session/` internals.

## Import boundaries

- This package is inside the engine, so the engine rules apply: import leaf
  packages only (`base`, `auth`, `minidb`, `tree-sitter-bash`).
- Never import `packages/Tools`, `packages/Addons`, `packages/memory`, `core`,
  `SDK`, `API`, `server`, or `ACP` from `src/`.
- `human/` is the pure kernel. Only `agent/loop/machine` may import its
  implementation; other agent code uses the vocabulary contracts exported through
  `#human/...` and the compatibility types under `#/llm-adapter/...`.
- Run `pnpm --filter @hilbras/omnicode-engine lint:imports` after moving imports.

## Generated manifests

- New or changed durable events: `pnpm --filter @hilbras/omnicode-engine
  gen:wire-manifest`.
- New agent state contribution or snapshot shape: `gen:state-manifest`.
- New config section under `agent/`: `gen:config-manifest`.
- Contract-surface changes: `gen:contract-types`.

Never hand-edit `packages/engine/docs/wire-manifest.d.ts`,
`packages/engine/docs/state-manifest.d.ts`, or
`packages/engine/docs/config-manifest.toml`.

## Tests

Tests mirror source under `packages/engine/test/agent/` — `loop/`,
`toolExecutor/`, `toolRegistry/`, `permissionPolicy/`, `permissionMode/`,
`contextMemory/`, `fullCompaction/`, `contextProjector/`, `mcp/`, `media/`,
`task/`, `team/`, `undo/`, and the other sibling directories. Stubs and shared
harness live in `test/agent/*/stubs.ts`, `test/harness/`, and `test/stubs.ts`.

```bash
pnpm --filter @hilbras/omnicode-engine typecheck
pnpm --filter @hilbras/omnicode-engine exec vitest run test/agent
pnpm --filter @hilbras/omnicode-engine test
```

## Local traps and where new logic belongs

- Registering a tool without the profile allowlist creates a silent no-op.
- Adding a state key without contributing it to `AgentStateService` leaves it
  unreadable; adding a durable event without a schema fails registration.
- The loop and tool machines are stateful; do not bypass them for a quick
  synchronous path. LLM calls go through `llmRequester/`, not a provider SDK.
- Add permission logic to the policy chain, not to individual tools.
- Add tool implementations in `packages/Tools`; add agent-only services here.

## Do not add here

Do not add session-scope services, app bootstrap/config, MCP transports, tool
implementations, UI code, a second agent loop, or direct provider SDK calls.


## Auto-mode context

`permissionPolicy/autoModeContext.ts` extracts the latest genuine user request and recent tool names for auto mode. Workspace writes require explicit edit intent; injected/non-user messages do not count. Sensitive-file and git-control policies run before the auto classifier.


## Microcompaction

`contextMemory/microcompaction.ts` evicts old tool results and media before full compaction. It preserves system messages, recent user messages, recent turns, and assistant/tool pairing. `loop/machine/history.ts` applies it before converting context to loop history.


## Tool output budgets

`toolResultTruncation/toolResultTruncationService.ts` resolves per-tool output budgets via `resolveToolResultMaxChars`. Full output is spilled to disk with head/tail preview; flagged-truncated results spill even when below the current per-tool cap.


## Notification admission

`team/taskNotificationQueue.ts` caps pending notifications, coalesces by task id, evicts the oldest interim update before terminal results, and rejects a new update when every pending result is terminal. `TaskService` owns durable scheduled/delivered keys; the queue is the admission policy seam and is not yet composed into that direct scheduler.


## Team persistence

`team/teamPersistence.ts` provides atomic JSON persistence for teams, members, and shared tasks. `TeamService` supports `load`, `flush`, `exportState`, and `restoreState`; mutations queue saves. Production Arena runners and the worktree fleet remain explicit deferrals.


## Trajectory evals

`agent/evals/trajectory.ts` scores required/forbidden tools, turn/cost/token budgets, and final-text assertions. Use it for trajectory tests instead of brittle full-prose snapshots.


## Command canonicalization

`permissionPolicy/commandCanonicalization.ts` canonicalizes plain commands and shell wrappers, strips only safe env prefixes, and hashes complex scripts as opaque. Bash denial/approval fingerprints use the canonical form.


## Exec-policy rules

`permissionPolicy/execPolicy/execPolicy.ts` is the data-only shell approval DSL: `loadExecPolicy` validates a `version: 1` file (rules + `opaque` decision) and rejects any `examples` entry its own rule does not match or that another rule shadows. `matchExecPolicy` canonicalizes NFD+case, treats shell metacharacters and unresolved quoting as opaque (decision from the file, `forbidden` by default), prefers alternative argv over prefix and longer over shorter, keeps a sticky rule on a tie, and returns `prompt-user` when nothing matches. `policies/exec-policy-rule.ts` applies it in the chain after the sensitive-file and git-control policies and before the auto-mode classifier; it saves nothing on disk itself and `AgentPermissionPolicyService.setExecPolicy()` installs the policy.

## Read-only shell predicate

`tool/read-only-shell.ts` is the one answer for "can this shell call overlap": `isReadOnlyShellCall({name,args}, parser)` / `classifyReadOnlyShell` accept only `Bash`, delegate parsing to `tool/read-only-command.ts`, fail closed without a parser or with malformed args, and memoize trimmed command text in a bounded process cache. The auto-mode classifier uses it — do not call `isReadOnlyBashCommand` directly from permission or scheduling code.

## Tool scheduling

`toolExecutor/toolScheduler.ts` runs the tool calls of one batch, blocking only on conflicting accesses — non-conflicting calls start together. `OMNICODE_TOOL_CONCURRENCY` (positive integer, resolved when the batch scheduler is created) caps how many run at once and queued calls start as slots free; unset or invalid means unlimited. Conflict blocking is unchanged by the cap.

## Loop detection

`loop/textLoopDetector.ts` is the streaming text-loop detector: feed it assistant text or thinking deltas and it reports repeated phrases, alternating blocks, or a periodic tail, with fenced code excluded so generated code cannot trip it. It is pure — the caller owns the reaction. `loop/resultStagnationDetector.ts` is the tool-result detector: identify each call by name+args and each result by its output, mark reads with the shared `isReadOnlyToolName` predicate, and it reports `repeated-result`, `stateful-polling`, or `read-churn` (churn needs a non-read tool to arm first). `loop/textLoopWatchService.ts` is the caller in the agent scope for both: it watches the delta events plus `ToolCallStarted`/`ToolResultEvent` (correlated by `toolCallId`, synthetic results skipped, late results from an ended turn ignored), keeps one pending signal per channel per turn, and turns each into a `text_loop` or `result_stagnation` context-injection reminder at the next step boundary. A shared per-turn cap `OMNICODE_LOOP_REMINDER_CAP` (default 3) bounds both channels, and `OMNICODE_TEXT_LOOP_BREAKER=0` / `OMNICODE_RESULT_STAGNATION_BREAKER=0` disable one channel each. It never mutates history mid-stream and never stops a turn. Register a new channel by adding a variant constant in `loop/textLoopWatch.ts` and a pending slot in the watch service — do not mutate history or throw from the handlers.

## Mid-turn input queue

`loop/inputQueue.ts` + `loop/inputQueueService.ts` type mid-turn input as `steer | mail | tool_output`. Precedence at a step boundary is fixed (`steer → tool_output → mail`), FIFO inside a channel, each capped at 16 with the oldest dropped. Tool output is last-writer data: it is discarded unless its `toolCallId` is still in the running set, and passive mail only wakes a loop when its producer sets `wake`. The service is registered in the agent scope but `loopService.ts` does not drain it yet — do not add a second path for the same input.

## Cost gate

`usage/costGate.ts` is the pre-call budget check: `projectedCallCost` is a lower bound (prompt tokens at the input rate plus one output token), `checkPreCallCost` refuses when spend plus projection exceeds the limit, and `assertPreCallCost` throws `usage.budget_exceeded`. Unknown pricing never refuses; it returns `reason: 'unknown-pricing'`. Nothing calls it yet.

## Abort terminal latch

`toolExecutor/abortContract.ts` (`AbortContract`) latches one terminal outcome per abortable unit: the first of complete/abort/fail wins, a late finish or late abort is discarded, `aborted.handled` says whether a running handler was cut short or none started, `release()` is true once for lock accounting, and `accounting()` reports `handlerMs` (0 when never started) and `drainMs` separately. It is pure; the executor still owns signal plumbing and event emission.

## Symlink-safe path guards

`tool/path-access.ts` resolves physical targets with `physicalPathForGuard` (nearest existing ancestor for new paths), re-checks sensitive/workspace rules on the physical path, rejects escaping symlinks, and supports intentionally symlinked workspace roots via `physicalWorkspaceConfig`.
