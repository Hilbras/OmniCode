# Unified Runtime Hardening Plan

Status: executing (2026-11-20)
Scope: every open gap recorded in the comparative reports under `docs/plans/`,
consolidated into one execution plan. Each item lands as its own commit with a
fail-on-base test and green gates. No guard may be weakened; baselines stay
shrink-only.

## Sources consolidated

| Report | What it contributes |
|---|---|
| `deep-runtime-comparison-2026-11-20.md` | 15 ranked mechanisms (P0/P1/P2) across 7 reference trees |
| `advanced-strength-program.md` | 2 unchecked verification items (`preflight`, full test graph) |
| `architecture-debt-remediation-plan.md` | residual W3–W6 seams not already closed by the strength program |
| `competitive-study-2026-11-19.md` | "what not to copy" governance rules |
| `agent-loop-continuation-study.md` | continuation root cause (already fixed; regression-lock here) |
| `decision-record.md` | owner-gated decisions D1–D9 (respected, not re-litigated) |

Explicitly out of scope (already decided): D3 installers, D7 MCP elicitation,
D9 userspace TCP. Explicitly preserved: hard-deny taxonomy, fail-closed MCP,
one-loop rule, generated-manifest discipline.

## Success criteria

1. Every numbered item below has a commit, a fail-on-base test and real command
   output in the execution log.
2. `pnpm check:guards`, `pnpm lint`, `pnpm typecheck` are green after every item.
3. By Phase D the full test graph is green (pre-existing failures repaired, not
   skipped) and `pnpm preflight` has been run end-to-end.
4. This document is updated inline as work closes.

---

## Phase A — finish-the-work (P0)

A1. **In-flight turn suspension/handoff** — journal-backed suspend record that
    allows a replacement worker to resume an unfinished turn without a terminal
    event. (Codex `turn_suspension.rs:14-118`)

A2. **Idle-judge orchestration around the verifier** — boot generation fencing,
    idle trigger, background-aware `wait`, stale-goal watchdog; keep the pure
    evidence gate. (opencode `plugin/goal.ts:104-265`)

A3. **Prepared compaction with structural identity** — install a background
    summary only when message UID/structure fingerprints still match.
    (Hermes `prepared_compaction.py:1-36`)

A4. **Untrusted continuation prompt wrapper** — wrap the objective as data;
    split one-shot objective-change notice from standing authority; add
    wind-down hand-off. (qwen `goal-continuation-prompt.ts:69-108,159-188`)

A5. **Write-ahead execution claim + durable continuation instruction** —
    prevent double execution after restart; state that an advisory wake is not
    crash recovery. (opencode `specs/v2/session.md:68,116`)

## Phase B — robustness and governance (P1)

B1. **Managed/admin policy tier** — a highest-precedence policy source with
    fail-closed flags (managed hooks/MCP only, credential deny lists); does not
    replace local guards. (Claude `settings-hippa.json:5-16,88-127`)

B2. **MCP grant ambiguity closure** — restrictions follow all name spellings,
    grants require a unique claimant. (qwen `rule-parser.ts:1809-1887`)

B3. **Fail-closed microcompaction identity + over-disarm** — unparseable
    sentinel, accumulated paths, redundant re-read over dangling placeholder.
    (qwen `microcompact.ts:194-290`)

B4. **Approval floors before bypass + liveness watchdog** — unconditional floors
    and a generation-bound turn watchdog. (Hermes `approval_floors.py:1-53`,
    `turn_liveness.py:23-25,90-140`)

B5. **Declarative per-agent spec** — JSON-defined agents with inherited
    permission mode, tool allow/deny, maxTurns, autoCompactWindow and scoped
    hooks; complements code-defined profiles. (Claude `claude-code.d.ts:817-879`)

## Phase C — ecosystem seams (P2)

C1. **Installable plugin/marketplace manifest** — sources, categories, renames,
    typed userConfig. (Claude `.claude-plugin/marketplace.json:2-191`)

C2. **Plugin-facing transcript cursor API** — read-only `messages({last, after,
    agentId})` over the wire journal with a stable contract. (Claude
    `claude-code.d.ts:3288-3330`)

C3. **Delivery-obligation ledger** — at-least-once external delivery with
    ownership stamps and flood backoff. (Hermes `delivery_ledger.py:230-393`)

C4. **Verified-progress-gated, non-durable runaway reminders** — once per run,
    never promoted to memory/skills. (minimax `runaway-guard/src/reminder.ts:10-100`)

C5. **Cache-clock ordering + retained tool outputs** — prompt-cache warm/cold
    windows and a "survives compaction" tool-output class. (Hermes
    `prompt_cache_clock.py:1-45`; Codex `compact_retained_tool_outputs.rs:6-13`)

## Phase D — residual architecture debt and test infrastructure

D1. **Pre-trust spawn invariant** — `resolveCommandPath` as a Kaos export; audit
    every pre-trust spawning host. (architecture plan W3.1–W3.3)

D2. **Session lease wired into the open path** — or closed with a recorded
    reason. (architecture plan W4.3)

D3. **Input queue drained at step boundaries** — or unregistered. (architecture
    plan W4.4)

D4. **Tool-visibility guard** — enumerate registered vs profile-admitted tools
    in a test. (architecture plan W6.1)

D5. **Full test graph green** — repair the load-sensitive llm stress test and
    the two pre-existing API session-prompt-event failures; no test skipped.

D6. **`pnpm preflight` end-to-end** — run the 17-step local delivery gate and
    record real output.

## Execution log

_Each item appends: commit hash, fail-on-base evidence, gates output._

- **A1** — pending commit — 7/7 tests; fail-on-base module-not-found; engine
  typecheck exit 0, pnpm lint exit 0, check:guards exit 0 after contract digest
  regeneration.
- **A2** — pending commit — 6/6 tests; fail-on-base module-not-found; engine
  typecheck, check:guards, pnpm lint all exit 0.
- **A3** — pending commit — 5/5 tests; fail-on-base module-not-found; engine
  typecheck, check:guards, pnpm lint all exit 0.
- **A4** — pending commit — 6/6 tests; fail-on-base module-not-found; engine
  typecheck, check:guards, pnpm lint all exit 0.
- **A5** — pending commit — 5/5 tests; fail-on-base module-not-found; engine
  typecheck, check:guards, pnpm lint all exit 0.
- **B1** — pending commit — 5/5 tests; fail-on-base module-not-found; engine
  typecheck, check:guards, pnpm lint all exit 0.
- **B2** — pending commit — 5/5 tests; fail-on-base module-not-found; engine
  typecheck, check:guards, pnpm lint all exit 0.
- **B3** — pending commit — 3/3 tests; fail-on-base module-not-found; engine
  typecheck, check:guards, pnpm lint all exit 0.
- **B4** — pending commit — 5/5 tests; fail-on-base module-not-found; engine
  typecheck, check:guards, pnpm lint all exit 0.
- **B5** — pending commit — 5/5 tests; fail-on-base module-not-found; engine
  typecheck, check:guards, pnpm lint all exit 0.
- **C1** — pending commit — 3/3 tests; fail-on-base module-not-found; engine
  typecheck, check:guards, pnpm lint all exit 0.
- **C2** — pending commit — 4/4 tests; fail-on-base module-not-found; engine
  typecheck, check:guards, pnpm lint all exit 0.
- **C3** — pending commit — 4/4 tests; fail-on-base module-not-found; engine
  typecheck, check:guards, pnpm lint all exit 0.
- **C4** — pending commit — 4/4 tests; fail-on-base module-not-found; engine
  typecheck, check:guards, pnpm lint all exit 0.
- **C5** — pending commit — 3/3 tests; fail-on-base module-not-found; engine
  typecheck, check:guards, pnpm lint all exit 0.
