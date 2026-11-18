# Runtime Wiring Plan

Status: complete  
Owner: OmniCode  
Scope: wire the seven-workstream additions into real runtime paths without turning every feature into an agent tool. Preserve trust, sensitivity, legal-hold, permission, and sandbox boundaries.

## Integration model

| Kind | Needs tool? | Needs loop/lifecycle wiring? | Needs AGENTS update? |
|---|---|---|---|
| Agent tool | Yes: registry + profile + approval | No direct loop edit; registry feeds the loop | Yes |
| Runtime service | No | Yes: DI composition and lifecycle hook | Yes |
| Pure utility | No | No | Only when its documented contract changes |
| Docs/CI | No | No | Yes when commands or rules change |

Decisions:

- Channels are platform adapters, not agent tools.
- Sandboxing is an execution-policy seam, not an agent tool.
- Dream consolidation and relevance selection are memory lifecycle behavior, not new tools.
- Arena comparison is user/agent-invoked, so it gets one `Arena` tool. Team and `memory_manage` already exist.
- Workflow budgets, fork caching, and notification queuing stay automatic services; no new tools.

## Progress log (2026-11-11)

- Phase 1 complete: opt-in dream maintenance, config keys, relevance second-stage injection, tests, memory AGENTS.
- Phase 2 partially complete: `Arena` tool registered with profiles/approvals/API coverage; `[swarm]` turn/token/time budgets now reserve and settle per swarm; fork-cache and notification-queue composition are explicitly deferred (see below).
- Phase 3 complete: `BashSandboxService` probes/selects bwrap, `OMNICODE_SANDBOX_MODE=off|auto|required` and network switch are wired into `BashTool.spawn`, with tests. Phase 4 through Phase 5 pending.

### Phase 2 explicit deferrals

- Forked-context caching is not wired into `agentLifecycle.fork()`. The current fork path creates a distinct mutable agent scope; reusing a cached context across forked agents would alias state. This needs an explicit immutable snapshot API before it is safe.
- Background-task notification queue is not wired into the existing task notification path. Doing so would change delivery ordering globally and needs a separate lifecycle test matrix.

## Completion summary (2026-11-11)

- Phase 1: dream maintenance and second-stage relevance injection are wired and tested.
- Phase 2: `Arena` tool and per-swarm turn/token/time budgets are wired. Fork-cache and notification-queue composition are explicitly deferred above.
- Phase 3: Bash sandbox selection and fail-closed/fallback modes are wired and tested.
- Phase 4: channel runtime service, config loading, bindings, commands, and adapter tests are complete. CLI/daemon auto-start is explicitly deferred above until the session/event reply bridge exists.
- Phase 5: preflight/CI expanded to 17 steps; guards, typechecks, targeted tests, and frozen-lockfile install pass.

Validation: `node scripts/preflight.mjs` passed 17/17; `pnpm check:guards` passed; `pnpm install --frozen-lockfile --offline` passed.

## Phase 1: Memory lifecycle wiring

Files:

- `packages/memory/src/service/memoryMaintenance.ts`
- `packages/memory/src/service/appMemoryService.ts`
- `packages/memory/src/context/memoryInjectionService.ts`
- `packages/memory/src/retrieval/relevanceSelector.ts`
- `packages/memory/src/feature/configSection.ts`
- `packages/memory/test/`
- `packages/memory/AGENTS.md`

Tasks:

1. Add dream-consolidation options to the maintenance scheduler: interval, scope, dry-run default, and enable switch.
2. Run dream consolidation on a bounded interval after retention/evidence work; skip when memory is disabled.
3. Prefer repository scope by default; never consolidate canonical or task-state records.
4. Record a structured log line with scanned/groups/consolidated/superseded/skipped counts; never log memory content.
5. Apply `selectRelevantMemories()` as a second-stage relevance filter for auto-injection only, preserving the retriever's trust/sensitivity gates and explicit-search behavior.
6. Add config keys and config-manifest regeneration.
7. Add tests for interval scheduling, disabled memory, legal hold, scope default, relevance cutoff, and no secret content in logs.
8. Update memory AGENTS with the lifecycle and config rules.

Acceptance:

- Dream consolidation runs without the model calling `memory_manage`.
- `memory_manage` still works for explicit runs.
- Auto-injection uses the selector but explicit search results are unchanged.
- Secret/confidential content never enters logs or the selector output.

## Phase 2: Arena tool and swarm service wiring

Files:

- `packages/engine/src/agent/team/arena.ts`
- `packages/engine/src/agent/team/teamTools.ts`
- `packages/engine/src/agent/team/workflowBudget.ts`
- `packages/engine/src/agent/team/forkedAgentContextCache.ts`
- `packages/engine/src/agent/team/taskNotificationQueue.ts`
- `packages/engine/src/features/swarm/`
- `packages/engine/src/session/subagent/`
- `packages/engine/src/session/agentLifecycle/profile/profiles.ts`
- `packages/engine/src/agent/permissionPolicy/policies/`
- `packages/engine/test/agent/team/`
- `packages/engine/AGENTS.md`

Tasks:

1. Register an `Arena` tool in the agent team module and expose it through engine/API.
2. Inject an `ArenaRunner` from the active profile/model catalog; keep the described-only fallback for tests and unconfigured hosts.
3. Require at least two contenders and isolate failures.
4. Compose one `WorkflowBudgetLedger` per session and pass it into `AgentSwarm` dispatch and subagent runs.
5. Reject launches or reservations that exceed the budget before spawn.
6. Wire `ForkedAgentContextCache` into subagent spawn planning so repeated forks reuse prepared context and invalidate on parent/context changes.
7. Wire `TaskNotificationQueue` into background/subagent completion notification delivery with dedupe/coalescing.
8. Add `Arena` to profiles and default approval only for read-only/described comparisons; runner-backed comparisons require approval if they spend tokens.
9. Add tests for budget refusal, cache reuse/os, notification ordering, Arena failure isolation, and profile admission.
10. Update engine/agent AGENTS and the profile/approval docs.

Acceptance:

- Arena is callable and converts contender failures into structured results.
- AgentSwarm cannot overspend its workflow budget.
- Repeated subagent forks reuse cached prepared context.
- Completion notifications are deduped and ordered.
- No new tool is added for budget, fork cache, or notification queue.

## Phase 3: Sandbox execution wiring

Files:

- `packages/Kaos/src/sandbox/`
- `packages/Tools/src/os/bash/bashTool.ts`
- `packages/Tools/src/os/bash/sandbox.ts` (new)
- `packages/Tools/test/os/bash/`
- `packages/Tools/package.json`
- `packages/engine/src/agent/permissionMode/`
- `packages/engine/src/agent/permissionPolicy/`
- `packages/Kaos/AGENTS.md`
- `packages/Tools/AGENTS.md`

Tasks:

1. Add a cached `BashSandboxService` that probes bwrap/landlock availability and selects a backend from permission mode and config.
2. Add sandbox config/env: `off`, `auto`, `required`; default `off` to preserve current behavior until explicitly enabled.
3. In `off`, execute exactly as today.
4. In `auto`, use bwrap when available; otherwise run unsandboxed through the normal permission chain and report the fallback.
5. In `required`, fail closed with an explicit error if no backend is available.
6. Build the sandbox command with argv mode for direct commands and an explicit allowed shell mode for `bash -c`, with workspace read-write, system paths read-only, and network denied by default.
7. Keep permission-mode approval ahead of sandbox execution; sandboxing never grants approval.
8. Preserve background tasks, cwd, timeout, env, and output streaming.
9. Add tests for off/auto/required selection, unavailable backend, path containment, shell policy, fallback, and fail-closed behavior.
10. Update Kaos/Tools AGENTS and sandbox docs.

Acceptance:

- With sandbox off, behavior is unchanged.
- With sandbox auto, bwrap is used when available.
- With sandbox required and no backend, execution fails explicitly.
- No new agent tool is added.

## Phase 4: Channel runtime startup

Files:

- `packages/channels/`
- `apps/omnicode-cli/src/`
- `packages/API/src/`
- `packages/server/src/` only if the daemon owns startup
- `packages/engine/src/app/telegram/` only if the legacy service is replaced
- `packages/channels/AGENTS.md`
- `apps/omnicode-cli/AGENTS.md` or nearest guide
- `docs/en/quality/e2e-test-plan.md`, `docs/zh/quality/e2e-test-plan.md`

Tasks:

1. Add `ChannelRuntimeService` that reads channel config, registers adapters, starts enabled adapters, and stops them on disposal.
2. Wire the runtime into CLI/daemon startup only when channel config exists; never open network listeners in tests.
3. Bind channel conversations to existing OmniCode sessions through `ChannelSessionBindingService`.
4. Route inbound messages to `OmnicodeHarness`/session prompt APIs.
5. Route outbound replies through the bound adapter; keep the legacy Telegram connector working until parity is proven.
6. Implement `/new`, `/stop`, `/status`, `/sessions`, `/bind`, `/unbind`, `/help`.
7. Use `channelMemoryScope()` for channel-scoped memory and keep sensitivity/trust gates.
8. Add config schema, redaction of tokens in logs, adapter timeout handling, and explicit startup errors.
9. Add adapter tests plus one CLI startup smoke test with a fake transport.
10. Update channel/CLI AGENTS and bilingual E2E docs.

Acceptance:

- Telegram plus two additional adapters can be registered and started through one runtime.
- Channel conversations bind to sessions and can run lifecycle commands.
- Disabled or unconfigured channels do not start network clients.
- Channel memory uses the `channel` scope tier and never bypasses sensitivity.
- No channel adapter is exposed as an agent tool.

### Phase 4 explicit deferral

CLI/daemon auto-start is deferred. Starting adapters is safe, but routing inbound prompts and streaming assistant replies requires a session/event bridge that creates or resumes a `Session`, subscribes to its events, and sends only the final assistant output. Wiring that partially would create duplicate or orphaned sessions, so the runtime service is shipped and the host composition waits for that bridge.

## Phase 5: Integration and release gates

Files:

- `scripts/preflight.mjs`
- `.github/workflows/ci.yml`
- `packages/API/test/workstream-connectivity.test.ts`
- `docs/plans/runtime-wiring-plan.md`
- affected AGENTS files

Tasks:

1. Extend preflight with the new runtime tests.
2. Add an API connectivity assertion for Arena, channel runtime startup, sandbox selection, and memory maintenance composition.
3. Run the full targeted matrix: engine, memory, channels, Tools, Kaos, API, CLI.
4. Run `pnpm check:guards` and `pnpm install --frozen-lockfile`.
5. Update the original improvement plan with implemented/deferred runtime status.
6. Record any host-only limitation explicitly, especially landlock and real network adapters.
7. Do not report CI as passing unless GitHub Actions actually ran.

Acceptance:

- All affected package typechecks pass.
- Targeted suites pass.
- Guards pass.
- Frozen-lockfile install passes.
- No trust, sensitivity, retention, legal-hold, approval, or sandbox boundary is weakened.
- Remaining deferrals are explicit and have a reason.

## Validation matrix

- Engine: `pnpm --filter @hilbras/omnicode-engine typecheck` and targeted tests.
- Memory: `pnpm --filter @hilbras/omnicode-memory typecheck` and tests.
- Channels: `pnpm --filter @hilbras/omnicode-channels typecheck` and tests.
- Tools: `pnpm --filter @hilbras/omnicode-tools typecheck` and tests.
- Kaos: `pnpm --filter @hilbras/omnicode-kaos typecheck` and tests.
- API: `pnpm --filter @hilbras/omnicode-api typecheck` and connectivity test.
- CLI: `pnpm --filter @omnicode/cli typecheck`.
- Preflight: `node scripts/preflight.mjs`.
- Guards: `pnpm check:guards`.
- Lockfile: `pnpm install --frozen-lockfile --offline`.

## Definition of done

Memory maintenance runs automatically, Arena/swarm services are composed, sandbox selection affects Bash when enabled, channel adapters start from config, and all targeted checks pass. Features that should not be tools remain tools-free, and every runtime seam has explicit tests and documentation.
