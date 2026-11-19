# Architecture-Debt Remediation Plan

Status: active — driven by OmniCode goal `1d60b717-b087-4afe-9469-6b5c9200d00b`
in session `session_7dce8476-c282-4f7f-92a3-35a60c8b48d1` (started 2026-11-19;
the goal is created and active; driving begins once a default model is
configured on the host).
Scope: `packages/engine` (loop decomposition, goal/curator/lease/input-queue seams),
`packages/Kaos` (command resolution), `apps/omnicode-cli` + `packages/cli-ui` +
`packages/cli-commands` (extraction completion), `packages/API` (request-handler
split, broken scripts), `packages/server` (webhook verifier pin, remote-auth
decision), `packages/base` (dispose discipline), and root guards/docs. Does not
weaken permission verdicts, the memory trust model, or any published wire
contract.

Relationship to existing plans: successor-by-scope to
`deep-scan-remediation-plan.md` (closed 2026-11-18 — that pass fixed the scan
findings S1–S5 and F1–F29; nothing here duplicates a closed item). The
MCP-elicitation seam stays as decided in `strength-program.md` and is out of
scope. The findings below come from a four-area architecture review of the
engine, kernel packages, outer surfaces, and CLI/TUI, re-measured on
2026-11-19.

---

## 1. Goal

**Objective.** Every architecture-debt item named by the review is either
landed with a test or recorded as an explicit owner decision with a
consequence; the three god-files shrink through extracted collaborators
without behavior change; the repo's documented invariants (pre-trust spawn,
registration reachability, dispose discipline) become true at the layer that
owns them or the docs stop claiming them.

**Measurable outcomes.**

| # | Outcome | Measure |
|---|---|---|
| O1 | God-files decomposed | the three files shrink via collaborators; no published contract regenerates; affected suites green |
| O2 | CLI extraction lands or is rolled back | no uncalled scaffolding; `cli-ui`/`cli-commands` carry real tests that the root test graph runs |
| O3 | Pre-trust spawn invariant is true | `resolveCommandPath` lives in a kernel package; every host that spawns pre-trust routes through it or documents why it cannot |
| O4 | No documented dead seam | goal verifier wired, curator lifecycle exposed or closed, session lease wired or deleted, input queue drained or unregistered |
| O5 | Surface scripts truthful | every `package.json` script in scope either works or no longer exists |
| O6 | Silent traps made loud | tool-visibility guard, dispose discipline documented, strict-DI decided, test-graph claims corrected |
| O7 | Truthful baseline throughout | `pnpm check:guards` and `pnpm lint` exit 0 at every handoff |

**Execution rule.** Each task lands as its own commit with a test that fails
on the base and passes on the fix. Run the package-level definition of done
from the root `AGENTS.md` per change; `pnpm check:guards` before each handoff.

Success criteria:

1. `pnpm check:guards` and `pnpm lint` exit 0 on a clean tree.
2. No file among the three god-files keeps new logic; extractions are
   behavior-preserving and the owning suites stay green.
3. Every decision-gated task has a row in §6 with an owner answer and its
   consequence.
4. No guide in the tree claims an invariant a kernel package does not own.

Non-goals: redesigning the permission model, adding a second agent loop,
breaking a published SDK/server contract, changing the memory trust policy,
reopening decisions recorded in `strength-program.md`.

---

## 2. Findings (evidence, measured 2026-11-19)

Ordered by blast radius. Line counts from `wc -l` on this tree.

### A — God-files (architecture debt)

**A1. `packages/engine/src/agent/loop/loopService.ts` — 2,379 lines.**
The engine's single turn driver: submit/steer/notify/cancel, the step gate,
machine-event projection, settle evaluation, quiescence, steered-prompt
reconciliation, and error-handler retry in one class. The guides forbid a
second loop, which concentrates all turnaround logic here.

**A2. `apps/omnicode-cli/src/tui/omnicode-tui.ts` — 4,650 lines.**
The TUI coordinator. The controllers push (`src/tui/controllers/`) has moved
the heavy slices out, but slash-command dispatch bodies, approval/question
mounting, and layout/exit branches remain on the class.

**A3. `packages/API/src/requestHandler.ts` — 3,142 lines.**
`SDKRpcClientV2` implements the ~130-method v1 abstract surface plus the
interaction, MCP, connector, and management planes in one class.

### B — Invariant and ownership mismatches

**B1. The pre-trust spawn invariant lives only in the app.**
Root `AGENTS.md` presents "never spawn an external command by bare name; use
`resolveCommandPath`" as a kernel law, but the only implementation is the
80-line `apps/omnicode-cli/src/utils/process/resolve-command.ts`;
`packages/Kaos/AGENTS.md` explicitly disclaims PATH-trust checks. No other host
surface (ACP, server, vis, inspect, mobile) contains an equivalent, so a second
host that spawns pre-trust re-opens the Windows cwd-hijack the CLI fixed.

**B2. Goal verifier is built and never called.** `NEW` (withdrawn 2026-11-19)
- Original claim: `packages/engine/src/features/goal/verifier.ts` (152 lines)
  had no caller from `goalService`, per the features guide's
  "Nothing calls it from `goalService` yet".
- Re-check: the guide note was stale. `goalService.markComplete` gates every
  model completion through `features/goal/verificationGate.ts`
  (`assertModelCompletionVerified`, `goalService.ts:448`), which calls
  `verifyGoalCompletion` from `verifier.ts` on the newest runtime-observed
  evidence and refuses non-zero exit runs with `GOAL_NOT_VERIFIED`.
- Conclusion: no change. W4.1 is withdrawn; the features guide's goal
  verification section is corrected to describe the wired gate.

**B3. Skill-curator lifecycle half is unreachable.**
`ISkillCuratorService` exposes only usage recording; archive/pin/stale-skills
(`packages/engine/src/features/skill/curator/lifecycle.ts`) has no runtime
caller and no host surface. Documented as a gap, still shipped as reachable
exports.

**B4. Session lease is not wired.**
`packages/engine/src/app/sessionManager/sessionLease.ts` (191 lines) provides
atomic lease files, TTL, heartbeat, stale reclaim;
`packages/engine/src/app/AGENTS.md` records "not yet wired into
`SessionManager`". The API request handler serializes access per session
in-process only; cross-process double-open is still last-writer.

**B5. Mid-turn input queue is registered but never drained.**
`packages/engine/src/agent/loop/inputQueueService.ts` (94 lines) types mid-turn
input (`steer | mail | tool_output`) with fixed precedence and caps;
`packages/engine/src/agent/AGENTS.md` records "`loopService.ts` does not drain
it yet — do not add a second path for the same input."

### C — Surface hygiene

**C1. `packages/API/package.json` carries five scripts that cannot run.**
`smoke`, `smoke:boundary`, `smoke:select-tools`, `stress:kosong-config` all
reference a missing `tsconfig.examples.json`; `docker:e2e` references a
missing `scripts/run-docker-e2e.sh`. The package's own `AGENTS.md` lists them
as known gaps; the example files themselves exist.

**C2. The Telegram webhook is the single unauthenticated POST on `/api/v1`.**
Its safety rests on one in-handler constant-time webhook-secret check. The
pairing bypass was closed by `6a6fcf4a0`; what is missing is a structural test
that a second unauthenticated POST cannot appear unnoticed.

**C3. Non-loopback binds allow token-only auth.**
`--insecure-no-tls` is the deliberate escape hatch, but with token-only auth
and no password the startup token is the only credential for a remote bearer.

### D — Silent-trap classes

**D1. Profile-allowlist invisibility.** A registered tool absent from every
profile allowlist is invisible to the model. The closed plan fixed the two
live instances (F23 `RestoreFile`, F24 computer-use); the class of bug has no
mechanical guard.

**D2. `Scope.dispose()` is fire-and-forget.** `packages/base/src/di/scope.ts`
documents that a caller reopening an exclusively-locked resource must await
`disposeAsync()` or the next open degrades to read-only; the rule lives in a
comment and in memory's `LazyMemoryStore` protocol, not in the guides other
consumers read.

**D3. Unknown-service resolution only warns.**
`InstantiationService` unknowns warn unless constructed strict
(`packages/base/src/di/instantiationService.ts`); a mistyped registration
flows `undefined` through the graph instead of failing fast.

**D4. Test-graph claims need re-measuring.**
`packages/tui` runs `node --test`, deliberately outside the root Vitest
project globs with a pinned `passWithNoTests` exception. Whether `pnpm test`
(turbo) runs its script must be stated precisely wherever the suite is
described; a misstated reachability claim is the exact failure mode
`check:tests` exists to prevent.

**D5. Non-interactive bootstrap drops `dangerous-command-ask`.**
`packages/engine/src/agent/permissionPolicy/permissionPolicyService.ts` skips
the policy when `bootstrap.args.nonInteractive` — deliberate, but undocumented
in the permission docs, and it changes `--print` behavior.

**D6. `packages/base` imports external packages it does not declare.**
`pathe` (four modules, e.g. `src/utils/fs.ts:5`) and `socks`
(`src/utils/proxy.ts:8`) were runtime imports with no `package.json` entry.
Resolution relied on pnpm's hidden hoist (`node_modules/.pnpm/node_modules`),
which plain-ESM dev entries do not consult, so tsx-driven source entries
failed outside Vitest. `scripts/check-deps-consistency.mjs` catches
declared-but-unused, not used-but-undeclared, so the class was invisible to
the guards. Outcome during goal start (2026-11-19): both declared
(`pathe@^2.0.3`, `socks@^2.8.9`, matching engine/Kaos) and installed; the
manifest + lockfile change sits in the working tree awaiting its own commit.

### E — In-flight extraction (CLI)

**E1.** `apps/omnicode-cli/src/tui/commands/flexible.ts:5`
`createFlexibleCommandRegistry()` has no callers.
**E2.** `BUILTIN_SLASH_COMMANDS` (`src/tui/commands/registry.ts`) is still the
dispatch source; the `@omnicode/cli-commands` `CommandRegistry` is not used by
the shipped path.
**E3.** `packages/cli-ui/package.json` and `packages/cli-commands/package.json`
both carry `"test": "echo \"no tests yet\""` placeholder scripts while already
owning shipped code (the theme/palette re-export).

---

## 3. Workstreams

Each task: change, migration, verify. Decision-gated tasks ask the owner
before landing; the default recommendation is named but is not a decision.

### W0 — Baseline (blocking)

- [ ] W0.1 Record a clean tree, `pnpm check:guards`, and `pnpm lint` outputs
      (including the frozen oxlint finding count).
- [ ] W0.2 Pin the suites this plan touches most:
      `pnpm --filter @hilbras/omnicode-engine exec vitest run test/agent/loop test/features/goal test/app/sessionManager`,
      plus `pnpm --filter @hilbras/omnicode-api test` and the CLI
      `test/tui/commands` suite.

Verify: recorded outputs; no unexplained dirty state.

### W1 — God-file decomposition (A1–A3)

Rules: behavior-preserving; no published contract changes; the owning suite
runs per extraction; tests move with the logic; each extraction is its own
commit.

- [ ] W1.1 (A1) Extract from `loopService.ts`:
      (a) machine-event projection → `agent/loop/projection.ts` (pure mapping
      of machine events to `Event2` dispatches and loop-event appends),
      (b) turn settlement / settle evaluation → `agent/loop/turnSettlement.ts`,
      (c) steering/nudge reconciliation → `agent/loop/steering.ts`.
      `AgentLoopService` keeps the service surface and orchestration only.
      Constraint: one loop, single submit/steer/cancel entry points — no
      second driver.
- [ ] W1.2 (A2) Continue the controllers push: move the remaining
      `handleBuiltInSlashCommand` bodies into `src/tui/commands/` modules and
      the approval/question mounting into a controller; new logic never lands
      on the `OmnicodeTUI` class. Follow the `write-tui` skill for placement.
- [ ] W1.3 (A3) Split `requestHandler.ts` by domain (sessions, MCP,
      connectors, config, interactions) into modules composed into the same
      exported `SDKRpcClientV2` class; the v1 abstract surface is unchanged
      and `packages/API/docs/wire-contract.json` must not need regeneration.

Verify: per extraction, the owning package suite plus
`pnpm --filter @hilbras/omnicode-engine typecheck` /
`pnpm --filter @hilbras/omnicode-api typecheck`; after W1.3,
`pnpm --filter @hilbras/omnicode-api exec vitest run test/wireContract.test.ts`.

### W2 — Finish or roll back the CLI extraction (E1–E3)

- [ ] W2.1 (E1) Decision: land `createFlexibleCommandRegistry()` as the
      dispatch path behind `BUILTIN_SLASH_COMMANDS`, or delete
      `flexible.ts` and the `@omnicode/cli-commands` dependency.
      Recommendation: land — the theme extraction already shipped this way and
      a rolled-back half-extraction is the worse steady state.
- [ ] W2.2 (E2) Migrate `BUILTIN_SLASH_COMMANDS` onto the `CommandRegistry`
      keeping availability/priority semantics; extend
      `test/tui/commands/` to cover alias normalization, duplicate rejection,
      and priority order.
- [ ] W2.3 (E3) Replace the placeholder test scripts with real suites:
      `cli-ui` (palette tokens, light-theme WCAG ratios, custom-theme
      loading) and `cli-commands` (registry dedup/priority/completion). Wire
      both into the root Vitest project globs so `check:workspace` and
      `check:tests` cover them, or record the chosen runner with a reason.

Verify: `pnpm check:workspace`; `pnpm check:tests`;
`pnpm --filter @omnicode/cli-ui test`; `pnpm --filter @omnicode/cli-commands test`;
CLI `test/tui/commands` suite.

### W3 — Pre-trust spawn invariant (B1)

- [ ] W3.1 Move `resolveCommandPath` from
      `apps/omnicode-cli/src/utils/process/resolve-command.ts` into
      `packages/Kaos/src/` (pure Node, no new dependencies — Kaos is a leaf),
      export it from `@hilbras/omnicode-kaos`, re-export through the SDK barrel
      (the sandbox surface is the precedent), and reduce the CLI module to a
      re-export. Move/extend its tests to Kaos.
- [ ] W3.2 Audit every host that spawns external commands before workspace
      trust: ACP host, `packages/server` (verify the `fileLaunch.ts` fix from
      the closed plan still routes every launch through argv arrays and
      resolved paths), vis server, inspect, mobile. Each host either routes
      through the kernel helper or documents in its `AGENTS.md` why it cannot
      spawn pre-trust.
- [ ] W3.3 Align the docs: root `AGENTS.md` hard-law wording and
      `packages/Kaos/AGENTS.md` disclaimer describe the same ownership.

Verify: `pnpm --filter @hilbras/omnicode-kaos test`;
`pnpm check:architecture` (leaf export added);
CLI `test/utils` suite; `pnpm check:agent-docs` after doc edits.

### W4 — Wire or close engine seams (B2–B5)

Each task is decision-gated: wire with tests, or delete the module and its
exports with the reason recorded here.

- [x] W4.1 (B2) **withdrawn 2026-11-19** — the verifier is wired:
      `goalService.markComplete` → `assertModelCompletionVerified` →
      `verificationGate.ts` → `verifyGoalCompletion`, enabled by default
      (`OMNICODE_GOAL_VERIFIER=0` disables). The stale guide note that
      produced this finding is corrected; no change needed.
- [ ] W4.2 (B3) Expose the curator lifecycle or close it: either a read-only
      host surface (CLI skills-browser action listing stale/archived/pinned,
      archive/pin behind explicit user action) or stop exporting the
      lifecycle modules as reachable and record the curator as usage-only.
- [ ] W4.3 (B4) Wire `SessionLeaseService` into the session open path
      (`SessionManager`, or the API request handler's per-session access
      queue) with read-only/takeover behavior, or delete
      `sessionLease.ts` and its `runtime-primitives` export.
      Tests: concurrent acquire; stale-owner reclaim; release on close.
- [ ] W4.4 (B5) Drain the input queue at step boundaries as the single
      mid-turn input path (fixed precedence `steer → tool_output → mail`),
      or unregister and delete `inputQueueService.ts`. The agent guide's rule
      stands either way: exactly one path for the same input.

Verify per wiring: `pnpm --filter @hilbras/omnicode-engine exec vitest run test/features/goal test/app/sessionManager test/agent/loop`;
per deletion: `pnpm check:generated` after any manifest-affecting removal.

### W5 — Surface hygiene (C1–C3)

- [ ] W5.1 (C1) Add `packages/API/tsconfig.examples.json` so the four
      `smoke*`/`stress` scripts run against the existing example files; for
      `docker:e2e`, write the minimal `scripts/run-docker-e2e.sh` against
      `docker-compose.yml` or delete the script entry. After this task every
      `package.json` script in scope either runs or no longer exists.
- [ ] W5.2 (C2) Pin the webhook: a route test asserting 401 on a
      missing/incorrect secret with the constant-time compare, plus a
      structural test that enumerates unauthenticated POST routes under
      `/api/v1` and fails if a route other than the Telegram webhook appears
      without a documented verifier.
- [ ] W5.3 (C3) Decision: require a password for non-loopback binds (keeping
      `--insecure-no-tls` as the explicit TLS escape hatch), or record
      token-only remote auth as an owner decision with the warning text
      naming the exact risk.

Verify: `pnpm --filter @hilbras/omnicode-api test`;
`pnpm --filter @hilbras/omnicode-server test`; `pnpm check:command-paths`
after script changes.

### W6 — Trap hardening (D1–D5)

- [ ] W6.1 (D1) Tool-visibility guard: an engine test that enumerates
      registered `AgentToolContribution`s and asserts each appears in at
      least one profile allowlist or sits in a documented shrink-only hidden
      list with a reason. This makes the F23/F24 bug class mechanical.
- [ ] W6.2 (D2) Document the await-`disposeAsync()` rule in
      `packages/base/AGENTS.md` (exclusively-locked resources, the
      read-only-degradation failure mode). Decision: whether to add a
      dev-mode unawaited-dispose warning to `Scope.dispose()`.
- [ ] W6.3 (D3) Strict-DI spike: construct the CLI composition root with
      strict instantiation in a branch, count the fallout, then decide —
      fix the unknowns and go strict by default, or add an opt-in flag.
      Unknown-service resolution should not be a silent warning in shipped
      hosts.
- [ ] W6.4 (D4) Measure the test graph precisely: whether `pnpm test` runs
      `packages/tui`'s `node --test` script through turbo, and correct every
      doc that misstates it (root `AGENTS.md`, `scripts/AGENTS.md`, README).
      A reachability claim that survives only because nobody re-measured it is
      the failure mode `check:tests` exists to prevent.
- [ ] W6.5 (D5) Document the `nonInteractive` drop of `dangerous-command-ask`
      in the engine permission docs (one paragraph; behavior unchanged).
- [ ] W6.6 (D6) Land the base dependency declarations already in the working
      tree as their own commit, then extend
      `scripts/check-deps-consistency.mjs` with the reverse rule: an external
      package imported anywhere in a package's `src` must be declared in that
      package's `package.json` (a phantom-dependency check), using the existing
      allowlist pattern for deliberate divergences. This turns the D6 fix into
      the guard that prevents the class.

Verify: the new guard test bites (a planted unlisted tool fails it);
`pnpm check:agent-docs` after guide edits.

---

## 4. Sequencing, effort, risk

| Phase | Work | Estimate | Risk |
|---|---|---|---|
| W0 | baseline | 0.5 day | low |
| W6.1/W6.4/W6.5 | quick trap wins first | 0.5 day | low |
| W3 | kernel command resolution | 1 day | low-medium; leaf export, CLI re-export, host audit |
| W2 | CLI extraction completion | 1–2 days | medium; dispatch path change, new package tests |
| W5 | surface hygiene | 1 day | low-medium; W5.3 is a decision |
| W4 | engine seams | 3–5 days | high; each is a design choice, verifier changes goal completion |
| W1 | god-file decomposition | 5–8 days, staged | high; must stay behavior-preserving, done last so W4 wiring lands on the settled seam set |

Rollback: every task is a separate commit; extractions are additive moves, so
a revert never drags unrelated work.

---

## 5. Definition of done

- [ ] `pnpm check:guards` and `pnpm lint` exit 0 on a clean tree.
- [ ] A1–A3 shrink via collaborators; owning suites green; wire contract
      unchanged (W1.3) with `test/wireContract.test.ts` passing without
      regeneration.
- [ ] No uncalled scaffolding remains (E1 resolved either way); `cli-ui` /
      `cli-commands` tests run by the root graph.
- [ ] `resolveCommandPath` is a Kaos export; every pre-trust spawning host is
      audited; docs match reality.
- [ ] B2–B5 each landed with tests or closed with a recorded reason.
- [ ] C1 scripts work or are gone; the webhook verifier test exists and the
      unauthenticated-POST inventory is pinned; C3 has an owner decision.
- [ ] D1 guard test bites on a planted violation; D2/D5 documented; D3 has a
      spike result and a decision; D4 claims re-measured and corrected; D6
      declarations committed and the phantom-dependency guard bites.

---

## 6. Decisions owed

| # | Decision | Default recommendation | Blocks |
|---|---|---|---|
| DE1 | `CommandRegistry` as the shipped dispatch path, or roll back (W2.1) | land it | W2.2, W2.3 scope |
| DE2 | Curator lifecycle: host surface or usage-only (W4.2) | read-only host surface | W4.2 |
| DE3 | Session lease: wire or delete (W4.3) | wire into the session open path | W4.3 |
| DE4 | Remote auth beyond loopback: password required, or recorded token-only decision (W5.3) | require password | W5.3 |
| DE5 | Input queue: single drained path or delete (W4.4) | drain as the single path | W4.4 |
| DE6 | Strict DI at composition roots (W6.3) | spike, then strict-by-default | W6.3 |
| DE7 | Dev-mode unawaited-dispose warning (W6.2) | add behind a dev flag | W6.2 second half |

---

## 7. Non-goals

- No permission-model redesign, no second agent loop, no new event loop path
  alongside the machine engine.
- No published SDK/server contract change; W1.3 must keep the v1 abstract
  surface and the wire-contract artifact byte-identical.
- No memory trust policy change; no reopening of decisions recorded in
  `strength-program.md` (MCP elicitation stays an intentional seam; generated
  client TS stays deferred).
- No TUI renderer rewrite; W1.2 continues the existing controllers pattern.
