# Deep runtime comparison: OmniCode vs. `/mnt/sda3/work/projects.old/cli`

Date: 2026-11-20
Method: four parallel read-only dives over all seven reference trees, then
cross-verification of every headline citation with `rg`/`Read` (all key paths
below were confirmed to exist; line counts spot-checked). This document
supersedes the high-level mechanism table in
[`competitive-study-2026-11-19.md`](./competitive-study-2026-11-19.md) for depth,
and complements — not replaces — the continuation-focused
[`agent-loop-continuation-study.md`](./agent-loop-continuation-study.md).

Path aliases used below:

| Alias | Root |
|---|---|
| `C/` | `/mnt/sda3/work/projects.old/cli/codex/` |
| `Q/` | `/mnt/sda3/work/projects.old/cli/qwen-code/` |
| `O/` | `/mnt/sda3/work/projects.old/cli/opencode/` |
| `H/` | `/mnt/sda3/work/projects.old/cli/hermes-agent/` |
| `X/` | `/mnt/sda3/work/projects.old/cli/minimax-code/` |
| `K/` | `/mnt/sda3/work/projects.old/cli/claude-code/` |
| `D/` | `/mnt/sda3/work/projects.old/cli/DeepSeek-Coder/` |
| `M/` | `/mnt/sda3/work/Hilbras/OmniCode/` |

## 0. What the references actually are

This matters: two of the seven are not runtimes.

- **C/** is a real Rust peer: `C/codex-rs/` holds ~130 crates (`core`, `prompts`,
  `rollout`, `execpolicy`, `skills`, `plugin`, `hooks`, `state`, `tools`). It is
  the deepest loop/state implementation in the set.
- **Q/** is a real TypeScript peer: `Q/packages/core/src/goals/` is the richest
  goal/continuation implementation; `Q/packages/core/src/permissions/` the
  most defensive rule engine.
- **O/** is a real TypeScript peer with a distinctive **idle-hook judge** and a
  write-ahead session inbox spec (`O/specs/v2/session.md`).
- **H/** is a real Python peer with the broadest guard suite (~8,668 Python test
  files) and the most elaborate stop-gate/compaction machinery.
- **X/** is a real TypeScript peer with strong *runaway detection* and
  host-level two-phase goal completion.
- **K/** is **not runtime source**. It is a 1.34 MB changelog, `feed.xml`,
  six first-party hook "mods" with readable `hooks/register.ts` files, a
  21,640-line extension-API declaration (`K/mods/types/claude-code.d.ts`),
  settings/MDM examples and a marketplace manifest. Runtime behavior below is
  marked *documented/API-declared*; hook code is marked *CODE*.
- **D/** is **not an agent runtime**. It has 32 Python files: benchmark
  harnesses (HumanEval, MBPP, DS-1000, LeetCode, PAL-Math), a fine-tuning
  script and a Gradio demo. No loop, tool registry, permissions or session
  state exists. The only transferable artifacts are prompt formats
  (`D/README.md:164-175`, `D/Evaluation/PAL-Math/prompts/gsm8k.md:1-40`) and a
  crude token trim (`D/demo/app.py:51-54`, default 4096 at `:13`). We do not
  claim parity with it anywhere.

## 1. Executive verdict

OmniCode is **competitive or ahead** on the original pain point (a task pausing
mid-way), on eviction safety, on egress/credential isolation, and on repo-wide
structural guards. It is **behind** on four structural capabilities that matter
for a "very strong" system:

1. **In-flight turn suspension and handoff** across workers (C).
2. **Idle-driven judge orchestration with boot fencing** around the verifier (O).
3. **Managed/admin policy tier and declarative per-agent specs** (K, Q).
4. **Durable delivery obligations and prepared-compaction identity** (H).

The earlier program's KPIs were correct but its ceiling was "bounded
continuation". The reference set shows the next ceiling is **durable,
verifiable, policy-governed autonomy**. Section 6 turns that into a backlog.

### Dimension summary

| Dimension | Ahead in | OmniCode status | Biggest gap |
|---|---|---|---|
| Loop & continuation | C, O, H | ahead on pure settle table + stall/verification | no in-flight turn suspension; no idle judge |
| Prompt architecture | C, H | ahead on autonomy text; validated per-model policy table | no untrusted objective wrapper; no cache-tier ordering |
| Lifecycle/state | C, O, H | event-sourced + goal resume | no write-ahead claim; no delivery ledger |
| Context management | H, Q | ahead on age-gap + cache disarm + world-state | no prepared-compaction structural identity; no cache clock |
| Permissions/trust | Q, K | ahead on hard-deny provenance; egress broker | no managed policy tier; no MCP grant ambiguity closure |
| Tool/MCP seams | C, Q, K | side-effect registration + profile allowlist | no permission aliases from tool defs; no marketplace |
| Testing/guards | H | 18 repo guards + constant pinning | no e2e idle/background suites |

## 2. Agent loop and continuation

### Codex (C) — suspend, don't just pause

Two nested loops: the outer steer loop at `C/codex-rs/core/src/tasks/regular.rs:152-177`
reopens a turn only when pending input exists and no terminal error, budget
exhaustion or sampling interrupt fired (`:166-175`). The inner step loop at
`C/codex-rs/core/src/session/turn.rs:555-720` drains input, snapshots a step
context, samples, then asks `should_retry` / `is_finished` (`:714-721`). Stop
hooks at `:1080-1129` carry a `stop_hook_active` recursion guard.

Budgets are **work/token based**, not step based: `C/codex-rs/core/src/rollout_budget/work_gate.rs:24-33`
is a shared `OnceLock` gate; `rollout_budget.rs:96+` posts charges and injects
budget reminders into history. This is a whole-thread-tree budget, unlike
`M/packages/engine/src/agent/loop/loopService.ts:1038-1044` (per-turn `maxSteps`)
plus goal budgets (`M/.../features/goal/goalService.ts:526-535`).

The standout mechanism is `C/codex-rs/core/src/session/turn_suspension.rs:14-118`:
on shutdown it flushes the rollout, cancels the task **without a terminal event**,
and records pending initial input (`:66-72`) so a replacement worker resumes the
*same* turn. OmniCode only resumes a paused goal on the next user turn
(`goalService.ts:541-554`); an in-flight turn is lost at close.

No dedicated intent-ack detector exists in Codex core (verified); its nearest
defenses are stream retry and content-filter guidance.

### qwen-code (Q) — one budget gate, bounded no-progress, hook cap

`Q/packages/core/src/goals/goal-runtime.ts:482-510` funnels every continuation
loop (turn cadence, verifier retries, budget) through one
`stopForSpentBudget()` gate. Continuation state at `:570-705` keeps
`verifierFeedback` and `objectiveUpdated` distinct from the permit. No-progress
is a bounded ledger: `Q/packages/core/src/goals/goal-protocol.ts:27` sets
`GOAL_NO_PROGRESS_TURN_LIMIT = 3`, pause reason at `:489`.

**OmniCode already has** the shape: `M/.../goalService.ts:133-135` (limit 3,
annotated "qwen's limit"), `:732-757` (exact-repeat `previousIdleText` streak),
`:830-854` (continuation launch), plus `M/.../turnSettlement.ts:45-81`.

`Q/packages/core/src/hooks/stopHookCap.ts:7-19` defaults to 8 consecutive
Stop/SubagentStop blocks, clamps to 100, env-overridable; enforced at
`Q/packages/core/src/core/client.ts:3898-3899` with an explicit pause reason at
`:4289-4290`. OmniCode has `STOP_HOOK_CONTINUATION_CAP = 8` but no blocking Stop
hook chain — different mechanism, same bound.

`Q/packages/core/src/tools/loop-wakeup.ts:59-61` returns `'ask'` (never
`'allow'`) so the AUTO classifier vets a scheduled prompt; `:133` caps a chain
at 24h; `:140` distinguishes 60–270s polling (inside the ~5-minute prompt-cache
window) from 1200–1800s fallback when a background task will deliver a real
notification. OmniCode has notification coalescing
(`M/.../agent/team/taskNotificationQueue.ts:92-151`) but no model-callable
cache-aware wakeup tool.

### opencode (O) — idle judge, boot fencing, wait verdict

`O/packages/core/src/plugin/goal.ts:104-136` is a **separate LLM reviewer call**
returning a schema-verified `done|continue|blocked|paused|wait` verdict
(`:470-475`), retried once on context overflow. The driver at `:138-207` runs
on `experimental.idle` (`:209-220`), fences on a per-process boot UUID
(`:20-23`, `:146-147`), respects a round cap (`:158-159`), compacts once on
reviewer overflow (`:171-180`), detects stalls via `sameReason` + `usedTools`
(`:188-191`) and injects a synthetic continuation at `:202-206`. A background
shell can earn a `wait` verdict (`:118-127`); a 30-minute watchdog
(`:18-19`, `:237-265`) pauses goals whose wake never arrived. Durable state is
`O/packages/schema/src/goal.ts:9-24` (`rounds`, `maxRounds`, `stalls`, `boot`).

OmniCode's verifier (`M/.../features/goal/verifier.ts:24-95`,
`verificationGate.ts:40-69`) is a **pure runtime-evidence gate** on a
model-proposed completion — stronger evidence semantics, weaker orchestration:
no idle trigger, no boot-generation fencing, no background-aware wait, no
compact-then-rejudge.

### Hermes (H) — classifier plus four stop gates

Final-text classification at `H/agent/turn_final_response.py:218-295` runs three
no-tool nudges with a shared cap of 2 (continue-intent `:231-234`, degenerate
fragment `:238-245`, Codex-style ack `:251-260`), appending an interim assistant
row plus a user nudge and clearing `final_response` (`:263-295`). Four stop gates
are ordered at `H/agent/turn_stop_gates.py:134-223` (late LSP verdict,
verify-on-stop, `pre_verify` plugin hook, kanban terminal guard), each keeping
the candidate answer as a budget-exhaustion fallback (`:144-159`). Verification
is opt-in with an `"auto"` surface-aware mode, default OFF
(`H/agent/verification_stop.py:62-88`), capped at two nudges (`:169-175`).

Additional guards OmniCode lacks: repetition/runaway detection with exact
constants (`H/agent/repetition_guard.py:17-23,141-194`), deterministic-empty
detection with a cost-aware retry cut (`H/agent/empty_response_guard.py:1-57`),
a 600s/15s liveness watchdog bound to generation+timestamp
(`H/agent/turn_liveness.py:23-25,90-140`), and a post-exhaustion
15/30/60/60/60s recovery ladder (`H/agent/turn_recovery_autorecover.py:1-11,44-61`).

### minimax-code (X) — runaway signals and two-phase completion

Pure turn-local runaway detection over six signals (exact repeat, same error
family, A-B-A-B, polling repeat, unchanged progress) at
`X/packages/agent-modules/runaway-guard/src/contracts.ts:3-11`, detector at
`src/guard.ts:19-73`, signals at `src/signals.ts:19-69`. Reminders fire **once
per run** (`src/reminder.ts:17-44`), are prioritized (`:10-15`), and explicitly
say "temporary … do not save this reminder or generalize it into Memory,
Skills" (`:52-100`). They gate on host-owned `verifiedProgress` /
`trustedToolProvenance` (`:24-60`), so verified work is never flagged.

Two-phase completion is explicit: `update_goal(complete)` no longer ends the
turn; the worker writes a final reply, tool calls are refused after acceptance,
and the host verifies afterwards (`X/.../goal/src/final-reply.ts:1-22,27-45,83-140`).
Verifier economics are route-derived — self-billed routes get a read-only
subagent, BYOK settles on the worker's proposal
(`X/.../goal/src/verification/verification-policy.ts:4-25`).

## 3. Prompt architecture

- **C**: catalog-vs-bundled resolution with source identity
  (`C/codex-rs/prompts/src/model_messages.rs:29-45,70-90`); per-model overlays
  (`model_instructions.rs:6-14`); *incremental tool declarations as world-state
  sections* (`model_messages/incremental_tools.rs:9-47`,
  `core/src/session/turn.rs:1969-2006`); bounded, catalog-overridable reminders
  (`model_messages.rs:52-55`); AGENTS.md composed root-to-cwd with a budget
  (`core/src/agents_md.rs:1-15,40-43`).
- **Q**: the strongest continuation prompt contract —
  `Q/packages/core/src/goals/goal-continuation-prompt.ts:69-96` wraps the
  objective in `<goal_runtime_data>` and frames it as untrusted data; `:98-108`
  deliberately splits one-shot "objective changed" from standing authority;
  `:117-149` pairs elapsed time with its ceiling; `:159-174` adds evidence,
  fidelity and completion-audit lines; `:185-188` adds a wind-down hand-off.
  `O/.../plugin/goal/judge.txt:1-20` and `kickoff.txt:9-11` similarly wrap the
  objective in `<untrusted_objective>`.
- **H**: three cache-stable tiers (stable/context/volatile, never re-rendered
  mid-session) at `H/agent/system_prompt.py:770-845`; three ordered per-model
  tables at `H/agent/prompt_builder.py:344-354,356-379,534-547`.
- **X**: strict Handlebars templates with capability flags and remote-managed
  prompt sets (`X/.../prompt-renderer.ts:15-65`).
- **M (OmniCode)**: profile templating
  (`M/.../app/agentProfileCatalog/profile-shared.ts:136-202`), a long
  autonomy/continuation prompt (`M/.../goalService.ts:142-175`), and a **validated
  per-model policy table that rejects weakening flags**
  (`M/.../agent/profile/modelPolicyTable.ts:9-48,71-75`) — a guard none of the
  references has. **Missing**: untrusted objective wrapper, one-shot/standing
  split, cache-tier ordering, wind-down prompt.

## 4. Lifecycle, state and durability

- **O**: `O/specs/v2/session.md:7-9` defines an inbox enqueue→delivery protocol
  with idempotent first-writer-wins IDs; `:68` commits a **write-ahead claim**
  on busy-period start and resumes claimed sessions on boot with a durable
  continuation instruction, bounded retries; `:116` states explicitly that an
  advisory wake is *not* crash recovery; `:74-80` requires tool calls durable
  before side effects. `Session.background()`
  (`O/packages/core/src/session.ts:526-544`) injects "Do not wait, sleep, poll".
- **H**: append-only persistence with turn leases
  (`H/agent/session_persistence.py:279-359`), adoption of an unanswered turn
  instead of duplication (`:112-146`), row-ID receipts
  (`H/agent/persisted_turn_receipt.py:20-65`), JSONL rescue when the store is
  replaced live (`H/agent/session_rescue.py:1-23`), and a **durable delivery
  obligation ledger** with ownership stamps, flood backoff and boot sweeps
  (`H/gateway/delivery_ledger.py:1-10,148-166,230-393`); injected notifications
  are marked non-user input (`H/gateway/run_notifications.py:93-107`).
- **X**: staged fork recovery with 30s ownership leases and compensation
  (`X/.../conversation-fork-recovery.ts:12-26,47-90`).
- **M**: schema-governed Event2 + `wire.jsonl`, generated state/wire manifests,
  goal pause-on-close resume, workflow journals with fingerprint assertions.
  **Missing**: write-ahead execution claim, delivery ledger, row-ID receipts,
  boot-generation fencing of extension state, store-replacement rescue.

## 5. Context management

- **H** leads on prepared compaction:
  `H/agent/prepared_compaction.py:1-36` builds a summary in the background and
  installs it only when **structural message-UID fingerprints** still match;
  `H/agent/prompt_cache_clock.py:1-45` models guaranteed/estimated cache
  windows; `H/agent/context_compressor.py:77-123,180-236` detects refusal and
  falls back deterministically, with archive watermarks at `:400-430`.
- **Q** leads on fail-closed identity:
  `Q/packages/core/src/services/microcompaction/microcompact.ts:154-164` maps
  file-path tools; `:194-221` uses an `UNPARSEABLE_CALL_IDENTITY` sentinel so a
  reused ID with unparseable siblings fails closed; `:260-290` accumulates all
  candidate paths and deliberately over-disarms; `:299-317` is an idle-time
  trigger (default 60 min, `-1` disables); `:738` names `force|idle|size`
  triggers; `:636-733` is a low-watermark size plan.
- **C** has cross-window retained tool outputs
  (`C/codex-rs/core/src/compact_retained_tool_outputs.rs:6-13`) and post-turn
  threshold compaction (`core/src/session/context_window.rs:85-100`).
- **M** is ahead on **eviction safety and lineage**: replayable per-message clock
  (`M/.../contextMessageTimes.ts:8-54`), age-gap trigger + `evictedReads`
  (`M/.../microcompaction.ts:34-52,195-218`), file-read cache disarm so a later
  write is refused until re-read (`llmRequesterService.ts:1040`;
  `fileReadCacheService.ts:82-94`), world-state merge-patch with baseline reset
  after compaction (`contextProjector/worldState.ts:105-149`), speculative
  compaction with fingerprint install (`speculativeCompaction.ts:28-52`).
  **Missing**: structural UID fingerprint for prepared summaries, cache clocks,
  "retained across windows" tool-output class.

## 6. Permissions, trust and extensions

- **C**: four-value execpolicy decision (`Allow/Prompt/PromptUser/Forbidden`,
  `C/codex-rs/execpolicy/src/decision.rs:9-19`), approval-policy granular flags
  (`protocol/src/protocol.rs:1205-1237`), LLM Guardian reviewer
  (`core/src/guardian/decision.rs:22-46`), patch-safety triage
  (`core/src/safety.rs:19-23,68+`).
- **Q**: ambiguous-MCP-grant closure —
  `Q/packages/core/src/permissions/rule-parser.ts:1809-1887` enumerates raw,
  normalized and legacy spellings of *other* registered tools; a lossy spelling
  may **restrict** every claimant but may not **grant** to them (`:1808`).
  Wired at `permission-manager.ts:448-459,507-539`; tested in
  `mcp-grant-ambiguity.test.ts` and `mcp-server-rule-collision.test.ts`.
  ACP mediator has a collision sentinel
  (`Q/packages/acp-bridge/src/permissionMediator.ts:57-61,380-423`).
- **H**: unconditional approval floors before yolo/off bypass
  (`H/tools/approval_floors.py:1-53`), contextvar-scoped approval identity
  (`tools/approval_context.py:22-51`), fail-closed secret scopes
  (`agent/secret_scope.py:1-10`), comprehensive redaction (`agent/redact.py:55-64,131-207`).
- **X**: six permission modes with evidence-typed decisions and an explicit
  deny→checker-deny→ask→bypass→allow precedence
  (`X/.../permission/src/permission-core.ts:163-298`), bypass-immune denial tags
  surfaced to the model (`reason-format.ts:296-314`).
- **K (documented/CODE)**: managed/MDM policy is the highest-precedence source,
  unoverridable (`K/examples/mdm/README.md:3-24`); `settings-hipaa.json:5-16`
  pins `allowManagedHooksOnly`, `allowManagedMcpServersOnly`,
  `strictKnownMarketplaces`, `disableSideloadFlags`; `:88-127` adds credential
  file/env-var deny lists and managed network allowlists. Hook budgets are
  10s/1s/5s (`K/mods/types/claude-code.d.ts:6298-6324`) with a managed-first
  ordered chain (`:1649-1651`). `AgentSpec` is declarative
  (`:817-879`); marketplace manifests are installable
  (`K/.claude-plugin/marketplace.json:2-191`).
- **M**: ordered 15-policy chain (`permissionPolicyService.ts:57-74`), fail-closed
  exec-policy, hard-deny taxonomy with bypass-after-denial (`denyTaxonomy.ts:1-28`),
  egress MITM credential broker (`app/egress/egressProxy.ts:20-43,91-106`),
  workspace trust, untrusted skill envelopes, side-effect tool registration,
  profile allowlists, a Claude hook-config converter
  (`claudeExtensionConverter.ts:45-89`), and a shrink-only safety ledger.
  **Ahead** on denial semantics and egress; **missing** managed policy tier,
  MCP grant ambiguity closure, permission aliases propagated from tool
  definitions, marketplace distribution, hook tiers/budgets/structured results.

## 7. Verification and guards

OmniCode's differentiator: 17–18 `scripts/check-*.mjs` guards wired into
`check:guards`, including generated-freshness, test-reachability, typecheck
coverage, hook-event coverage and a **shrink-only safety ledger** pinning the
stall cap (2), stop-hook cap (8), no-progress limit (3), microcompaction window
(30 min) and three recorded MCP gaps (`scripts/safety-ledger.json`). Hermes has
far more invariant tests (~8,668 Python test files) and minimax declares every
Vitest suite in `test/vitest-suites.json` with one canonical `scripts/verify.mjs`.
OmniCode has no e2e equivalent of opencode's idle/background suites.

**Honest status:** `M/docs/plans/advanced-strength-program.md:343-353` records
that `pnpm preflight` was not run end-to-end and the full test graph is not
green (one load-sensitive stress test and two pre-existing API failures). This
study is read-only; none of its recommendations were built or validated here.

## 8. Prioritized gap backlog

### P0 — directly relevant to "the agent must finish work"

1. **In-flight turn suspension/handoff** — study
   `C/codex-rs/core/src/session/turn_suspension.rs:14-118`. Flush journal,
   cancel without a terminal event, persist unclaimed initial input, resume in
   a replacement worker. OmniCode currently resumes only paused goals.
2. **Idle-judge orchestration around the existing verifier** — study
   `O/packages/core/src/plugin/goal.ts:104-220` plus `goal-watchdog` at `:237-265`.
   Keep OmniCode's pure evidence gate; add boot fencing, idle trigger,
   background-aware `wait`, compact-then-rejudge and stale-goal pause.
3. **Prepared compaction with structural identity** — study
   `H/agent/prepared_compaction.py:1-36`. OmniCode already has speculative
   compaction with a *source* fingerprint; upgrade to message-UID/structure
   fingerprints so an interleaved reply cannot install a stale summary.
4. **Untrusted continuation prompt wrapper + one-shot/standing split** — study
   `Q/.../goal-continuation-prompt.ts:69-108,159-188,251-267`. OmniCode's flat
   continuation string should wrap the objective as data and separate the
   one-time objective-change notice from standing authority.
5. **Write-ahead claim + durable continuation instruction** — study
   `O/specs/v2/session.md:68,116`. Makes "advisory wake ≠ crash recovery"
   explicit and prevents double execution after a restart.

### P1 — robustness and governance

6. **Managed/admin policy tier** — study `K/examples/settings/settings-hipaa.json:5-16,88-127`
   and `K/examples/mdm/README.md:3-24`. The largest structural absence against
   every mature reference.
7. **MCP grant ambiguity closure** — study
   `Q/packages/core/src/permissions/rule-parser.ts:1809-1887`; restrictions
   follow all spellings, grants require a unique claimant. Preserve OmniCode's
   hard-deny rule unchanged.
8. **Fail-closed microcompaction identity + over-disarm** — study
   `Q/.../microcompact.ts:194-290`. Unparseable sentinel, accumulated paths,
   redundant re-read preferred over a dangling placeholder.
9. **Approval floors before bypass + liveness watchdog** — study
   `H/tools/approval_floors.py:1-53` and `H/agent/turn_liveness.py:23-25,90-140`.
10. **Declarative per-agent spec** — study `K/mods/types/claude-code.d.ts:817-879`
    (model alias/inherit, permissionMode inheritance, maxTurns,
    autoCompactWindow, agent-scoped hooks). Complements code-defined profiles.

### P2 — distribution and ecosystem

11. **Installable plugin/marketplace manifest** — `K/.claude-plugin/marketplace.json:2-191`
    (sources, categories, renames, typed userConfig).
12. **Plugin-facing transcript cursor + UI seam** — `K/mods/types/claude-code.d.ts:3288-3330`
    (`session.messages({last, after, agentId})`) and `:12099` render components.
    OmniCode's journal is stronger; the stable consumer contract is missing.
13. **Delivery-obligation ledger** — `H/gateway/delivery_ledger.py:230-393`; gives
    at-least-once external delivery with ownership and flood backoff.
14. **Verified-progress-gated, non-durable runaway reminders** —
    `X/.../runaway-guard/src/contracts.ts:24-60` + `src/reminder.ts:10-100`.
15. **Cache-clock ordering and retained tool outputs** —
    `H/agent/prompt_cache_clock.py:1-45` and
    `C/codex-rs/core/src/compact_retained_tool_outputs.rs:6-13`.

## 9. What NOT to copy

- **Ambient memory capture / model-authored trust promotion** — violates
  OmniCode's trust algebra (memory trust ceiling `unverified`).
- **Model-decides-when-to-ask approvals** — OmniCode's hard-deny and fail-closed
  defaults must stay deterministic.
- **K's managed policy as a reason to weaken local guards** — it is an
  additional tier, not a replacement.
- **D's token-trim-only "context management"** — no eviction provenance, no
  cache coherence; OmniCode is far beyond it.
- **A second agent loop** — every mechanism above plugs into the existing
  one-loop settle path (`M/.../turnSettlement.ts:45-81`).

## 10. Verification of this study

All headline files were confirmed to exist with the expected scale (e.g.
`C/.../turn_suspension.rs` 160 lines, `Q/.../rule-parser.ts` 2180 lines,
`O/.../plugin/goal.ts` 497 lines, `H/.../prepared_compaction.py` 562 lines,
`K/mods/types/claude-code.d.ts` 21640 lines, `D/` 32 Python files). Line-level
claims come from the four sub-agent dives and were spot-checked for the paths
listed above. This is a study, not an implementation; no repository behavior
changed while producing it.
