# OmniCode Advanced Strength Program

Status: executing — **P0 (WS1.1–WS1.7) complete**; P1 started (WS2.1). See the
inline execution log below for commits and real command output.
Scope: the whole repository — engine loop/prompt/lifecycle, permission and
trust systems, kernel packages, SDK/API/server, CLI/TUI and other surfaces,
guards/CI, docs, and product decisions. Changes behavior, architecture, and
governance; does not weaken permission verdicts, memory trust, layering, or
generated-artifact discipline.

Relationship to existing plans:
- Supersedes the **open items** of
  [`competitive-superiority-program.md`](./competitive-superiority-program.md)
  and [`strength-program.md`](./strength-program.md). Their closed items stay
  landed; do not re-litigate them.
- Incorporates the findings of
  [`agent-loop-continuation-study.md`](./agent-loop-continuation-study.md)
  (six reference CLIs), [`competitive-study-2026-11-19.md`](./competitive-study-2026-11-19.md),
  and [`architecture-debt-remediation-plan.md`](./architecture-debt-remediation-plan.md).
- Unplanned bug fixes from the current cycle (goal restart pause, Telegram
  setup) are recorded in the competitive program's "Unplanned fixes" section.

---

## Execution log (live)

### P0 — Stop the stalls: COMPLETE

| Item | Commit | Real evidence |
|---|---|---|
| WS1.1 prompt directive | `6d109478d` | system.md + both golden prompts regenerated; `systemPromptGolden` behavior test |
| WS1.2/WS1.3 stall guard + verification gate | `e160c19be` | `stallGuard.ts` (19 pure tests) + loop integration; fail-on-base 2 red; `OMNICODE_STALL_GUARD=0` opt-out |
| WS1.4 goal no-progress streak | `dd27bffdd` | `goal.test.ts` 126/126 pass; 3 idle continuations → `Paused after 3 goal turns with no new evidence`; fail-on-base proven |
| WS1.5 continuation prompt | `77a482593` | judge-previous-turn line reaches next LLM input; 126/126 goal tests; fail-on-base proven |
| WS1.6 Stop-hook cap 8 | `5614d69cf` | `integration.test.ts` 30/30; 8th continuation works, 9th settles, counter resets; fail-on-base proven; contract hash regenerated |
| WS1.7 headless awaiting-user | `d165f3707` | 41/41 (17 detector + 24 print); fail-on-base: harness "promise resolved undefined instead of rejecting", unit "Cannot find module #/cli/headless-awaiting-user" |

**Integrity repair (this session):** WS1.4/WS1.5/WS1.6 were originally committed
with tests only — the source implementations were left unstaged, so a fresh
checkout of those commits would have failed their own tests. Local history was
rebuilt (`dd27bffdd`, `77a482593`, `5614d69cf`) so each commit carries source +
test together; no remote/upstream contained the originals. Rebuilt tree verified:
goal 126/126, hooks 30/30, `pnpm check:guards` exit 0, `pnpm lint` exit 0
(no-comments 283 files; kernel layering 24 packages, no cycles; oxlint 70 frozen
findings / 0 new).

P0 KPIs O1–O4 are green: intent-ack nudges are bounded at 2 with an env escape
hatch; no-progress pauses after 3 evidence-free repeated continuations with an
explicit reason; headless awaiting-user now fails loudly; the default system
prompt carries the autonomy directive and the golden is byte-stable.

### P1 — Clean the house: IN PROGRESS

| Item | Commit | Real evidence |
|---|---|---|
| WS2.1 phantom-dependency guard | this commit | `scripts/check-phantom-deps.mjs` + `.d.mts` + shrink-only allowlist; 8 pure/fixture tests green; real bite proven by temporarily undeclaring `pathe` in `packages/base` → 3 phantom imports reported → restored → guard green; wired into `check:guards`; real tree 41 packages / 2677 source files |

| WS6.4 eval gate in CI | already landed (pre-program `ci.yml`) | Verified, no change made: `.github/workflows/ci.yml:230` defines an `eval-gate` job on PRs and pushes to main; it runs the eval Vitest suites then `run-eval-gate.mts`. Local run: `eval gate: PASS — All 3 required eval case(s) passed` (repair-task-reads-then-patches, compaction-recovery-stays-within-budget, plan-mode-stays-read-only), exit 0. The plan's premise "no CI job calls it" was stale |
| WS2.5 CLI extraction closure | this commit | Landed `createFlexibleCommandRegistry` as the ordering/normalization source in `OmnicodeTUI.getSlashCommands()` (same priority/name order as the legacy sort); source made injectable so collisions are rejected. CLI registry suite 21/21; fail-on-base: injected-collision test "expected [Function] to throw an error" against base. `cli-commands` 8/8 and `cli-ui` 5/5 real Vitest suites replace `echo "no tests yet"`; both projects auto-discovered by the root Vitest globs |

_Append each closed item with its commit and fail-on-base evidence as it lands._

### Architecture — IN PROGRESS

| Item | Status | Real evidence |
|---|---|---|
| WS2.2 loop decomposition | partial — this commit | Extracted two collaborators from `loopService.ts`: `turnSettlement.ts` (pure terminal-condition decision table, 11 tests) and `nudgeReconciliation.ts` (cursor arithmetic, 4 tests). The service now owns only side effects. Fail-on-base: "Cannot find module #/agent/loop/turnSettlement". Loop integration 72/72, stall guard 19/19, contract digest +2 entries. Machine-event projection (the third named collaborator) remains |
| WS2.3 / WS2.4 god-files | open | Not started |

### WS6 — Product and governance — IN PROGRESS

| Item | Status | Real evidence |
|---|---|---|
| WS6.5 safety-ledger guard | this commit | New `check:safety-ledger` pins seven fail-closed constants/gaps (stall cap 2, hook cap 8, goal no-progress 3, microcompaction age window, three MCP known gaps). Drift or a removed declaration fails; removing a pin requires an explicit ledger edit. Fail-on-base: module-not-found. Guard suite 4/4; real tree 7 pins OK |

### WS3 — Competitive leftovers — IN PROGRESS

| Item | Status | Real evidence |
|---|---|---|
| WS3.3 MCP conformance gaps | owner-gated / not changed | `pnpm check:mcp-conformance` output: 4 pass cells (initialize ×2, tools_call ×2), 3 recorded known gaps (sse-retry no-report, elicitation 0/6, auth/metadata 0/5), exit 0. Closing elicitation requires enabling a currently fail-closed server-initiated prompt consumer (`admitElicitation` defaults disabled), and the plan says "re-baseline only after review". No guard weakened; baseline left honest. Needs an owner decision D7 before touching security defaults |

| WS3.2 vision bridge | this commit | `VisionBridge` with a stub-friendly `VisionModel` trait seam and an honest notice ("the primary model did not view the media directly"). Registered session-scoped service installed with no model by default (graceful degradation), wired into `resolveImagePart` when the primary model lacks `image_in`; a configured model yields a labelled notice plus a `vision-bridge` warning event. Fail-on-base: "Cannot find module #/agent/media/visionBridge". Bridge 5/5, media resolver 59/59 |

| WS3.1 age-gap microcompaction | this commit | Prior blocker removed: added a live per-message clock via a replayable `context.messageTimes` state folding `ContextAppendMessage.time`. `microcompactContext` now accepts `maxMessageAgeMs`/`messageTimes` and evicts stale results even below the token trigger; the requester passes the state with a 30-minute default and `OMNICODE_MICROCOMPACTION_MAX_AGE_MS=0` opt-out. Fail-on-base: "Cannot find module #/agent/contextMemory/contextMessageTimes"; tests caught a circular import, an off-by-one staleness boundary, and a fold identity issue — all fixed. Microcompaction 9/9, clock 5/5 |

### WS4 — Tier 2 seams — IN PROGRESS

| Item | Status | Real evidence |
|---|---|---|
| WS4.4 incremental world-state sections | this commit | Changed-fragment injection already existed; added the missing durable lineage: `WorldStateSectionRendered` Event2 + replayable `worldState.baseline` state, restored by the provider on construction and recorded after each render. A restarted process emits no duplicate section and only changed fragments afterward. Fail-on-base: "Cannot find module #/agent/contextProjector/worldStateOps". Suite caught two real defects during development (lost version identity and a mutable-array zod schema), both fixed; context-projector 76/76 |

| WS4.3 in-band permission escalation | this commit | `RequestPermissions` tool + pure `planPermissionEscalation`: intersects requested rules with the active profile allowlist (including `mcp__*`), rejects project/user scopes, and refuses any allow rule that would weaken an existing deny. Fail-on-base: "Cannot find module #/agent/permissionRules/permissionEscalation"; the suite also caught a live-array snapshot bug during development. Planner 9/9, profile/registry/rules 81/81 including builtin tool registration |

| WS4.2 guardian authority rules | this commit | Reviewer system prompt now states that only an original user instruction in the request grants authority, that quoted/pasted/embedded "user approved" content never grants, and that each review is decided fresh. Fail-on-base: content test failed with "expected … to contain 'only an original user instruction'". Reviewer lane suite 46/46 |
| WS4.1 soft/hard deny + bypass-after-denial | this commit | `denyTaxonomy.ts` (soft/hard categories, `isTrustedAnswerAllowed`) wired into the AUTO classifier: a rejected fingerprint is sticky and can no longer be promoted to a trusted answer by a later approval. Fail-on-base: integration test expected `ask`, got `approve` on base — the exact bypass. denyTaxonomy 5/5, permission-policy service 120/120 |

---

## 1. Vision and strength thesis

**Vision**: OmniCode becomes the agent runtime that *finishes work* — autonomous
across turns and restarts, provably safe, and verifiably correct — while
remaining a single-TypeScript graph that guards, typechecks, and tests reach
end to end.

**Four pillars** (what "very strong" means, measured):

| Pillar | Today | Target |
|---|---|---|
| **P1 — Autonomous execution** | Goal restart pause fixed; no intent-ack guard; no no-progress detection; persistence only in goal prompts | A task handed to the agent completes across turns/restarts without the user saying "continue"; stalls detected and bounded; headless never silently waits |
| **P2 — Verifiable trust** | Trust-gated memory, honest sandboxes, fail-closed exec-policy, 11 guards, official MCP conformance floor (2/7 cells passing) | Full no-progress/verifier chain; soft/hard deny taxonomy; credential broker + userspace TCP; conformance baseline shrinks as gaps close |
| **P3 — Architecture health** | Three god-files (2.4k/4.7k/3.1k lines); phantom deps found three times; mid-flight CLI extraction | God-files decomposed into collaborators; phantom-dependency guard; extraction completed or rolled back; no unowned seams |
| **P4 — Product & adoption** | Docs site internal-only; dangling `install-desktop`; mobile PREVIEW; no vision bridge | Bilingual published docs; desktop decision resolved; vision bridge; 48 skills + channels UX polished |

**Strategic rule**: adopt reference *mechanisms*, never their governance models.
Our moat is event-sourcing, trust algebra, and guard discipline — none of the
six references has all three.

## 2. Baseline — what is already true (do not redo)

- Competitive program: W0.1, S1.8, S1.1, S1.4, S1.2, S1.5, S1.6, S1.7 landed;
  S1.3 partially (per-request microcompaction + read-cache disarm; age-gap
  deferred); S1.9 open. Tier 2/3 open.
- Architecture program: W0.1, W4.1-withdrawn (verifier was already wired),
  other seams open (curator lifecycle, session lease, input queue).
- Bugs fixed this cycle: goal restart auto-resume (`603e23078`), Telegram
  logo/setup (`4ee53149c`), three phantom-dependency declarations.
- Guards 11/11; lint 70 frozen findings/0 new; official MCP conformance
  baseline green with three honest known failures (SSE retry, elicitation,
  unattended OAuth).
- 8/27 competitive todos done, S1.3 in progress.

## 3. Outcomes and KPIs

| ID | Outcome | Measure |
|---|---|---|
| O1 | Autonomous task completion | A scripted model emitting "I did X; next I'll do Y" with no tool call triggers a nudge and a second request; 3 repeated intent-acks settle with visible reason; fails on base, passes on fix |
| O2 | No silent stalls | Goal no-progress pauses after 3 evidence-free continuation turns with an explicit reason; headless awaiting-user fails with a non-zero exit; stop-hook continuation bounded at 8 |
| O3 | Restart continuity | Active goals survive close/reopen automatically; intentional pauses remain paused; persisted-wire evidence |
| O4 | Prompt persistence | Default system prompt contains the autonomy directive; byte-stable; injected context rides user messages |
| O5 | Architecture | No file over ~1,500 lines among the three god-files; phantom-dependency guard wired; CLI extraction closed |
| O6 | Safety leads | Soft/hard-deny + bypass-after-denial tests; guardian authority rules; credential broker + sandbox TCP; MCP conformance baseline shrinks by ≥3 cells |
| O7 | Product | Bilingual docs published; desktop/install-desktop decision recorded; vision bridge shipped |
| O8 | Governance | Eval gate in CI; every guard bite-tested; zero stale exceptions; preflight green on the finished tree |

## 4. Workstreams

### WS1 — Autonomous execution core (P1, start first)

**WS1.1 Prompt-level persistence directive.** Add the autonomy/persistence text
from Codex's system prompt to OmniCode's default system prompt at the owning
seam (`IAgentProfileService.getSystemPrompt()` / profile default). Text:
continue autonomously until the user's outcome is achieved; do not stop at an
intermediate result; verify before declaring completion. Keep in the stable
system prompt, not injected mid-turn. Verify: prompt test; systemPromptGolden
regenerated deliberately.

**WS1.2 Intent-ack stall guard (the core fix).** At the settle boundary
(`AgentLoopService.evaluateSettle` / xstate `llm.done` no-tool branch): when a
step ends with a text-only final response that matches a progress/intent-ack
shape (announced next action, partial status without evidence, bare
acknowledgment), inject a short user-origin reminder — "Take the next concrete
step with a tool; do not restate status" — and let the machine run another step.
Bound: 2 nudges per turn; env opt-out (`OMNICODE_STALL_GUARD=0`). Detection
mirrors Hermes `turn_final_response.py:218-295` and minimax `NO_TOOL_NUDGE`.
Verify: fail-on-base loop test (1 request vs 2), cap test, disabled test.

**WS1.3 Verification stop gate.** If the turn wrote files (journal/patch
history) but no verification tool ran (test/Read/diff), inject a bounded
"verify before finishing" nudge. Hermes `turn_stop_gates.py` reference.
Verify: feature-integration loop test with scripted edit + no test.

**WS1.4 Goal no-progress streak.** In `goalService.handleTurnEnded`, count
continuation turns with **zero evidence-bearing tool results** (exclude
memory/goal self-talk, per qwen `chatRecordingService.ts:3250-3263`); after 3,
pause with reason `no-progress` (durable `goal.update`, journal). User turns
reset the streak; hand-off turns exempt. Verify: goal test with 3 scripted
idle continuations → paused with reason; 2 → still active.

**WS1.5 Continuation prompt enrichment.** Add qwen's "judge your previous goal
turn — take a different concrete action instead of restating status" and
completion-audit lines to `GOAL_CONTINUATION_PROMPT`. Add a paused-goal reminder
so intentional pauses are not silently restarted by ordinary user messages
(WS1.4's auto-resume stays limited to the close-specific reason). Verify:
prompt content tests; goal lifecycle tests.

**WS1.6 Stop-hook continuation seam.** Extend `externalHooks` with a blocking
Stop event whose hook result can inject continuation text; on block, append a
`HookPrompt`-style context message and continue the step. Cap 8 consecutive
blocks (Codex/qwen/Claude standard); exceeding cap pauses an active goal with
`stop-hook-cap`. Verify: feature-integration loop test with a scripted hook.

**WS1.7 Headless awaiting-user policy.** Audit `run-v2-print` for paths that
leave a pending approval/question at turn end; make them fail with a clear exit
code and message (minimax `awaiting-user-continuation` → failure). Verify:
print-mode test with unanswered approval → non-zero exit.

### WS2 — Architecture health (P3)

- **WS2.1** Phantom-dependency guard: every bare import in a package's source
  must be declared in its `package.json` (devDeps for test-only imports), with
  a shrink-only allowlist. Wire into `check:guards`. Evidence: three instances
  found manually this cycle.
- **WS2.2** Decompose `loopService.ts` (2,379 lines): extract turn settle,
  machine-event projection, and nudge reconciliation into collaborators under
  `agent/loop/`, preserving the one-loop rule. Tests move with the logic.
- **WS2.3** Decompose `omnicode-tui.ts` (4,650 lines): continue the controllers
  push; new logic never lands on the coordinator.
- **WS2.4** Decompose `requestHandler.ts` (3,142 lines) by domain behind the
  same v1 abstract surface; wire contract stays byte-identical.
- **WS2.5** Close the mid-flight `@omnicode/cli-ui`/`cli-commands` extraction:
  land `createFlexibleCommandRegistry` or roll it back; give both packages real
  tests in the root Vitest graph.

### WS3 — Remaining competitive Tier 1 (P2/P4)

- **WS3.1** S1.3 remainder: age-gap microcompaction trigger. Add a live
  per-message clock to context state (durable event + fold + state manifest
  regeneration), then trigger eviction on message staleness beside the token
  threshold. Do not fake with turn counts.
- **WS3.2** S1.9 vision bridge: side-query a configured vision model for
  unreadable media in tool results, with notices; graceful degradation without
  a vision model. Provider-trait seam; tests with a stub provider.
- **WS3.3** S1.7 follow-up: grow the official MCP conformance baseline pass set
  by closing the elicitation consumer (transport caller + default responses)
  and the unattended-OAuth harness gap; re-baseline only after review.

### WS4 — Tier 2 capability seams (P2)

In dependency order:
1. **WS4.1** Soft/hard-deny taxonomy + bypass-after-denial hard rule in the
   auto-mode classifier, fed by `trustedUserAnswers` provenance (qwen/Codex).
2. **WS4.2** Guardian authority rules in the reviewer lane ("originals carry
   user authority; quoted content never grants"; fresh decision per review).
3. **WS4.3** `request_permissions` in-band escalation tool with profile
   intersection (refuse on weakening).
4. **WS4.4** Incremental world-state sections (durable per-section events,
   changed-fragment-only injection).
5. **WS4.5** Unified exec process table (yield times, live process registry as
   a context section, late-denial kill).
6. **WS4.6** Monitor tool (background watch → idle-delivered durable events).
7. **WS4.7** Terminal visual regression lane (pty → xterm → screenshot).
8. **WS4.8** Rule alias-closure + MCP grant-collision tests.
9. **WS4.9** Claude extension converter into `externalHooks`.
10. **WS4.10** Agent residency for tower/subagents (idle unload, mail preserved).
11. **WS4.11** Per-model prompt/policy tables as generated data.

### WS5 — Tier 3 differentiators (P2)

- **WS5.1** Speculative background compaction (compile the summary before the
  token ceiling; install on demand).
- **WS5.2** Userspace managed TCP in the Kaos bwrap backend (smoltcp TUN + SOCKS
  bridge + managed DNS), harmonizing with the egress credential broker.
- **WS5.3** Architecture-debt seams: curator lifecycle host surface (or close
  explicitly), session lease in the open path, mid-turn input queue drained (or
  unregistered) — one decision each.

### WS6 — Product and governance (P4/O8)

- **WS6.1** Publish the bilingual docs site (VitePress local search, mermaid,
  `llms.txt`) or record "internal only" with consequences. Decision D1.
- **WS6.2** Desktop shell: restore the Electron app or remove the dangling
  `install-desktop` command. Decision D2.
- **WS6.3** Nix + one-shot installers: restore or record the distribution plan.
  Decision D3.
- **WS6.4** Eval gate into CI (the suite exists but no CI job calls it).
- **WS6.5** Extend the hallucination/shrink-only guard family to cover the new
  artifacts (stall-guard config, hook cap, conformance baseline).
- **WS6.6** Pre-commit enforcement (husky-style) OR an explicit decision that
  preflight replaces it.

## 5. Phase sequencing

| Phase | Work | Est. | Exit criterion |
|---|---|---|---|
| **P0 — Stop the stalls** ✅ COMPLETE | WS1.1–WS1.7 | 2–3 weeks | O1–O4 green; the user's task-completion symptom reproduced as a passing test — see execution log |
| **P1 — Clean the house** | WS2.1, WS2.5, WS6.4 | 2 weeks | Guard covers phantom deps; no god-file growth; eval gate in CI |
| **P2 — Deepen safety & capability** | WS3, WS4.1–WS4.4 | 4–6 weeks | O6 partially green; MCP baseline shrinks |
| **P3 — Differentiate** | WS4.5–WS4.11, WS5 | 4–8 weeks | O6 fully green; no-boundary regressions |
| **P4 — Product** | WS6.1–WS6.6 | 2–4 weeks + decisions | O7 green or decisions recorded |

Dependencies: P0 first — everything else assumes an agent that finishes work.
WS2.2 (loop decomposition) should ride alongside WS1 (the stall guard touches
the same settle path), not after it. WS4.4 (world-state sections) precedes
WS4.5 (process table as a section). WS5.1 (speculative compaction) assumes
WS3.1's clock work is not required (independent).

Rollback: each workstream item is its own commit with a fail-on-base test.
Feature flags for new behavior (`OMNICODE_STALL_GUARD`, `OMNICODE_OUTPUT_ESCALATION`,
etc.) are the named escape hatches. A flipped default names its loss in the
commit message.

## 6. Decisions owed (owner-gated)

| # | Decision | Default recommendation | Blocks |
|---|---|---|---|
| D1 | Published docs site or internal-only | publish (bilingual search) | WS6.1 |
| D2 | Desktop shell restore or remove command | restore small shell; else remove `install-desktop` | WS6.2 |
| D3 | Nix/installers or distribution decision | restore installers only | WS6.3 |
| D4 | Stall-guard default on/off | on with cap 2 + env opt-out | WS1.2 |
| D5 | No-progress cap (3 turns) | 3, matching qwen/Codex | WS1.4 |
| D6 | Curator lifecycle: expose or close | expose read-only host surface | WS5.3 |
| D7 | Enable fail-closed MCP elicitation to grow the conformance pass set | keep fail-closed until a reviewed transport caller + default-response policy exists | WS3.3 |

## 7. Definition of done

- [ ] O1–O8 measured green (or explicitly waived by an owner decision with
      consequence recorded in §6).
- [ ] Every workstream item has a test that fails on the base and passes on
      the fix; no guard weakened; baselines shrink-only.
- [ ] `pnpm check:guards`, `pnpm lint`, `pnpm preflight`, full uncached test
      graph, package hygiene, CLI artifact, and official MCP conformance all
      run and pass with recorded results.
- [ ] The plan is updated inline as work closes, like the deep-scan plan.
- [ ] No new unowned seam: every registered tool/feature/event/config has an
      admission path, a test, and a guard where a guard is possible.

## 8. Non-goals

- No Rust rewrite, no second agent loop, no dual-renderer TUI, no parallel
  permission language.
- No weakening of memory trust, approval verdicts, kernel layering, or the
  generated-manifest discipline.
- No feature parity pursuit that costs the moat: if a reference mechanism
  requires ambient memory capture, model-authored trust promotion, or
  model-decides-when-to-ask approvals, do not port it.
- Do not re-implement closed items from the prior programs (see §2).
