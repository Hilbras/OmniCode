# Competitive Superiority Program

Status: active — driven by OmniCode goal `23aa8487-4f24-48a3-b866-3ecb716b6ded`
in session `session_72961235-c88c-487d-b4df-1ee44a9896e4` ("Competitive
superiority program"); the session's todo list tracks all 27 tasks. Source
study: [`competitive-study-2026-11-19.md`](./competitive-study-2026-11-19.md) —
every task below cites the reference evidence there and in the reference
trees directly.

Scope: engine loop/compaction/tools/permissions, Kaos sandbox, TUI approval
and diff surfaces, CLI headless, guards, and docs. Companion programs: the
[`architecture-debt-remediation-plan.md`](./architecture-debt-remediation-plan.md)
stays active for its own items (god-file decomposition, CLI extraction,
phantom-dep guard); the two share the W0 baseline. Does not weaken any trust,
layering, approval, or sandbox boundary; does not copy any reference
governance model (study §5).

Non-goals: no second agent loop, no second permission language (every rule
change migrates the existing chain), no published-contract break, no
dual-renderer TUI, no Rust rewrite, no ambient capture, no vendor-locked
analytics.

**Execution rule** (same as every program in this repo): each task lands as
its own commit with a test that fails on the base; `pnpm check:guards` before
each handoff; generated manifests regenerate via their owning scripts.

---

## Goal

**Objective.** Every task below is either landed with its verification command
green, or recorded in the decisions table with an owner answer and its
consequence. When the program closes, OmniCode holds Codex-grade context
economics and process supervision and qwen-grade permission expressiveness on
top of the event-sourced, trust-gated, guard-enforced core that neither
reference has.

**Outcomes.**

| # | Outcome | Measure |
|---|---|---|
| O1 | Context economics lead | budget tools + truncation escalation + world-state diffing + background compaction shipped; long-run sessions survive ceilings without stalls |
| O2 | Auto mode is the most defensible in the industry | soft/hard-deny taxonomy + guardian authority rules + in-band permission requests; every closed hole has a regression test |
| O3 | Process supervision is first-class | live process table + monitor tool + late-denial kill, all durable |
| O4 | Product content restored | architecture write-ups ported; docs-site/desktop decisions recorded; CREDITS restored |
| O5 | Guards keep telling the truth | MCP conformance gate + visual regression lane + rule-example validation bite on planted violations |

## W0 — Baseline (blocking)

- [x] W0.1 Baseline recorded 2026-11-19: the D6 dependency fix landed as
      `f5166a90c`; `pnpm check:guards` exit 0 (all 11 steps, 41 packages);
      `pnpm lint` exit 0 (70 frozen findings, 0 new).

## W1 — Quick wins (days each, no product decision)

- [x] S1.1 **Model-visible budget tools.** `GetContextRemaining` and
      `NewContextWindow` landed 2026-11-19 in
      `packages/Tools/src/features/contextBudget/` (schema + tool + description
      per tool), registered through the tool seam, admitted to the `agent` and
      `coder` profiles, and added to `default-tool-approve` (one read-only; the
      other triggers only the auto-source compaction the engine already runs —
      turn-aware, per-turn capped). Reference: codex
      `core/src/tools/handlers/{get_context_remaining,new_context_window}.rs`.
      The context-window metadata *section* (beside the world-state section) is
      deferred to S2.4, where sections become durable.
      Verify: 12 tool tests + 3 extended engine tests green
      (159/159 Tools suite excluding the two pre-existing offline-ripgrep
      files, which fail identically on base); typecheck, layering,
      workspace, and contract-types freshness all green.
- [x] S1.2 **Escalation-on-truncation.** Landed 2026-11-19 as truncation
      continuation: a turn whose last step ends `truncated` with no tool calls
      continues once (the partial text stays in history; the model finishes),
      with an observable `output-escalation` warning. An optional cap raise
      (`escalateTurnOutput`) applies only with genuine headroom and never past a
      user-set `maxCompletionTokens` cap; the default budget already equals the
      model limit, so the continuation is the value. The old immediate-end
      contract is preserved under `OMNICODE_OUTPUT_ESCALATION=0` (the legacy
      max-tokens test now pins that path). Reference: qwen `tokenLimits.ts`.
      Verify: 3 integration tests through the real loop (fail on base with
      `[1]` steps vs `[1, 2]`); 6 requester + 10 pure tests; engine loop/
      requester suites green; features-integration agent suites 607/609 (the
      2 failures are the pre-existing offline-ripgrep Glob tests, proven to
      fail on the clean base).
- [ ] S1.3 **Microcompaction refinements.** Evicting a tool result disarms
      the matching `fileReadCache` entry; evicted memory bodies are
      re-fetchable with a pointer; age-gap trigger beside the token trigger.
      Reference: qwen `services/microcompaction/microcompact.ts`.
      Integration: `agent/contextMemory/microcompaction.ts` + `fileReadCache/`.
      Verify: eviction test proving a post-eviction Edit re-reads instead of
      trusting a stale fingerprint; age-trigger test.
- [x] S1.4 **Rule test vectors.** The loader half already existed
      (`loadExecPolicy` rejects examples that contradict their rule or are
      shadowed, both `matches` directions); the persistence half landed
      2026-11-19 as `f40086f32`: `appendAllowPrefix` pins a self-test pair on
      every persisted rule (approved command as `matches: true`, mutated last
      token as `matches: false`), so a later hand-broadened prefix fails agent
      creation. Reference: codex `execpolicy/src/parser.rs`.
      Verify: 4 new writer tests including the hand-broadening regression;
      permission-policy suite 213/213; typecheck; agent-docs OK.
- [x] S1.5 **Narrow-rule suggestions in the approval dialog.** Landed
      2026-11-19 as `8df44477f`: `ruleSuggestion.ts` derives the minimum-scope
      rule (root + known subcommand, arguments wildcarded; subcommand tables
      for git/npm/pnpm/yarn/docker/cargo/kubectl/gh/go/pip/uv, docker-compose
      nesting), the Bash tool attaches it to the command display, the approval
      panel previews it on the always choice ("Saves rule: git log *"), and the
      writer trusts it only as a strict prefix of the canonical tokens
      (display-sourced data can narrow, never widen). Example pinning
      generalizes: the match example is the approved command; the not-match
      probe mutates the persisted prefix, so hand-broadening a *suggested* rule
      still fails at load. Contract-types digest, SDK API report (also
      recording a pre-existing `scope` drift truthfully), and state manifest
      regenerated. A third D6 phantom (`server`'s `pathe`) landed as its own
      fix (`72ee04a45`). Reference: qwen `utils/shellAstParser.ts`.
      Verify: 17 derivation + 5 writer + 2 persistence + 2 adapter tests;
      permission-policy suite 235/235; loops/bash integration 123/123;
      guards 11/11; lint 70/0.
- [x] S1.6 **Turn diff + `omnicode apply`.** The live `/diff` already existed
      (`agent/turnDiff/` — the study's claim was half stale), so the gap closed
      2026-11-19 as `4aef23ddd` was the *durable machine artifact*: the new
      `AgentFileHistoryService.patch` renders the durable checkpoints as a
      complete, uncapped git-apply-able unified diff (`patchRender.ts` —
      binary/oversize excluded and reported, never faked), exposed through the
      SDK (`Session.getFileHistoryPatch`) and driven by the new
      `omnicode apply` subcommand (`--turn`, `--session`, `--reverse`,
      `--stdout`, `--check`). Reference: codex `turn_diff_tracker.rs` + Apply.
      Verify: 10 renderer tests including two **real `git apply` round-trips**
      (one with a missing final newline); 6 service tests through the checkpoint
      harness; 10 CLI tests; contract digest + SDK API report regenerated; the
      stale `ApprovalResponse.scope` type test fixed to the truth.
- [x] S1.7 **MCP conformance gate.** Landed 2026-11-19 as `92ce869e9`: the
      official `@modelcontextprotocol/conformance` suite is pinned (0.1.16, root
      devDependency), driven against the engine's real `HttpMcpClient`/
      `SseMcpClient` through `packages/engine/scripts/mcp-conformance-client.mts`.
      Measured reality: `initialize` and `tools_call` **pass at both protocol
      versions** (2025-06-18, 2025-11-25); `sse-retry` does not terminate
      (recorded as the expected no-report state — the engine client holds the
      raw SSE stream); elicitation fails on the known missing consumer
      (-32601); auth fails with no unattended OAuth in the harness. The
      baseline (`scripts/mcp-conformance-baseline.json`) is reviewed,
      shrink-only, keeps known failures visible with reasons, and the gate
      fails on new failures, missing reports, and suite-version drift.
      Reference: codex `scripts/mcp_conformance/` (the current suite ships two
      protocol generations, not codex's older pin's three — recorded honestly).
      Integration: `scripts/check-mcp-conformance.mjs` + the CI guards job,
      beside `check:audit` (both deliberately outside `check:guards`).
      Verify: the gate runs green in ~1 min; a planted skipped tool call fails
      it naming `tool-add-numbers` in both spec versions; lint 70/0; guards
      11/11; the mcpCore oauth suite passes isolated (earlier reds were
      load-flakiness from concurrent runs on this machine).
- [x] S1.8 **Port the old tree's architecture write-ups** — done 2026-11-19.
      Five write-ups ported to `docs/en/architecture/` with re-verified
      current-tree status sections: the completion gate and goal verifier are
      wired in this tree (`goalService.markComplete` → `assertModelCompletionVerified`
      → `verificationGate.ts`), the run supervisor drives goal continuation,
      browser tools remain unwired. The stale engine-guide note and the
      architecture-debt plan's W4.1 were corrected on the same evidence.
      Verify: `pnpm docs:check` OK (79 files); `pnpm check:agent-docs` OK
      (72 paths).
- [ ] S1.9 **Vision bridge.** Unreadable image/PDF tool results are
      side-queried through a configured vision model with an honest notice;
      failure degrades to today's behavior.
      Reference: qwen `services/visionBridge/`.
      Integration: media path + provider traits.
      Verify: media test with a stub vision model; no-vision-model test
      proving graceful degradation.

## W2 — Capability seams (weeks)

- [ ] S2.1 **Soft/hard-deny taxonomy.** Soft-deny is unblockable by explicit
      user intent (provenance-tagged, from genuine user messages and
      collected answers); hard-deny — exfiltration and
      **bypass-after-denial** (retrying a denied action via any other tool,
      indirection, or encoding) — is absolute; repeated denials escalate to
      manual.
      Reference: qwen `classifier-prompts/system-prompt.ts`,
      `denialTracking.ts`, `trustedUserAnswers`.
      Integration: `auto-mode-classifier.ts` + `autoModeContext.ts` (already
      excludes injected origins) + `denialTracking.ts` (escalation half
      exists).
      Verify: chain test — deny `cat .env`, then `python3 -c` equivalent
      fails closed without a second ask; explicit user intent unblocks the
      soft case.
- [ ] S2.2 **Guardian authority rules in the reviewer lane.** Adopt the
      evidence-authority contract verbatim (originals carry user authority;
      quoted content never grants; fresh decision per review; check later
      revocations); give the reviewer retrieval over the session board
      instead of a flattened transcript.
      Reference: codex `ext/guardian-v3/src/lib.rs:32-40`.
      Integration: `agent/interaction/reviewer/`.
      Verify: reviewer test — a request whose only "user" evidence is a
      quoted message is refused.
- [ ] S2.3 **`request_permissions` in-band escalation.** A tool the model
      calls to request an additional permission profile; profiles intersect,
      and unintersectionable inputs refuse rather than weaken.
      Reference: codex `tools/handlers/request_permissions.rs` +
      `permission_profile_intersection.rs`.
      Integration: new engine tool arbitrated by the existing permission
      chain; never widens the active mode.
      Verify: intersection tests (refuse-on-weakening); approval round-trip
      through reverse-RPC.
- [ ] S2.4 **Incremental world-state sections.** Typed context sections with
      persisted per-section snapshots and changed-fragment-only injection;
      a durable `Event2` per section update keeps replay intact.
      Reference: codex `context/world_state/mod.rs` (`render_diff`,
      `Placement`, sha1 identity).
      Integration: `contextProjector/worldStateProvider` + a section store.
      Verify: replay test — restore reproduces the same assembled context;
      diff test proves unchanged sections cost zero tokens.
- [ ] S2.5 **Unified exec process table.** Clamped yield times; a live
      process registry (running/exited/in-use) published as a context section;
      per-process network-approval binding with late-denial termination.
      Reference: codex `core/src/unified_exec/{mod,process_manager}.rs`.
      Integration: Bash tool + Kaos + exec-policy.
      Verify: supervisor test — yield, poll, exit; late-denial test proving
      the process is killed and the model told.
- [ ] S2.6 **Monitor tool.** Background watch whose lines become durable
      notification events delivered when the loop is idle; caps and safety
      checks.
      Reference: qwen `tools/monitor.ts`.
      Integration: Bash background mode + durable event + the
      interruptionReminder delivery path.
      Verify: monitor test — lines arrive at idle, not mid-turn; cap test.
- [ ] S2.7 **Terminal visual regression lane.** node-pty → xterm.js in
      headless Chromium → screenshots, named regression scenarios, gated e2e
      beside `pty-tui.e2e.test.ts`.
      Reference: qwen `integration-tests/terminal-capture/`.
      Verify: lane runs on the current tree; a planted render regression
      fails it.
- [ ] S2.8 **Rule alias-closure + grant-collision tests.** An allow rule must
      cover the tool the model can switch to (edit family, shell family);
      MCP grant ambiguity and server-name collision are pinned.
      Reference: qwen `rule-parser.ts` closure + collision tests.
      Integration: `agent/permissionRules/` semantics + tests.
      Verify: closure test — allowing `Edit` covers `Write`-family switches;
      collision tests fail on ambiguous grants.
- [ ] S2.9 **Claude extension converter.** Import Claude Code
      hooks/extensions into the `externalHooks`/plugin seam — an import path,
      not a second runtime.
      Reference: qwen `core/src/extension/claude-converter.ts`.
      Verify: converter test with a representative Claude hooks.json; a
      skill/command import round-trip.
- [ ] S2.10 **Agent residency.** Idle tower/subagent workers unload with
      state preserved and mail queued; wake on messages.
      Reference: codex `core/src/agent/control/{residency,mailbox}.rs`.
      Integration: `features/tower` + subagent lifecycle.
      Verify: tower test — an idle worker unloads, receives mail, restores.
- [ ] S2.11 **Per-model prompt/policy tables as generated data.** Per-model
      instruction overlays and tool-policy overlays become manifest-generated
      data instead of hardcoded constants.
      Reference: codex `protocol/src/openai_models.rs`.
      Integration: provider catalog + a generated manifest with
      `--check` freshness.
      Verify: `check:generated` fails when a model overlay drifts.

## W3 — Differentiators and product decisions (owner-gated)

- [ ] S3.1 **Speculative background compaction.** Summarization computed on a
      background lane before the ceiling, installed when it trips.
      Reference: codex `compact_remote_v2_attempt.rs`.
      Verify: long-session test — the ceiling never stalls the foreground
      loop; background result matches the installed history.
- [ ] S3.2 **Userspace managed TCP in the Kaos bwrap backend.** smoltcp on
      TUN + SOCKS bridge + managed DNS so destination allowlisting is
      enforced without netns; harmonizes with the egress credential broker.
      Reference: codex `linux-sandbox/src/managed_tcp_stack.rs`.
      Verify: sandbox test — a denied destination is unreachable, an allowed
      one flows through the bridge.
- [ ] S3.3 **D1: docs site.** Publish `docs/en|zh` as a searchable site
      (VitePress local search, mermaid, `llms.txt`) or record "internal
      only" with the consequence. Evidence: old tree `docs/.vitepress/`.
- [ ] S3.4 **D2: desktop shell.** Restore an Electron surface (old-tree
      `apps/omnicode-desktop`: server adoption, auto-update, telegram-bridge)
      or record "no" and remove the dangling `omnicode install-desktop`
      command, which today points at a page for an app this repo does not
      build.
- [ ] S3.5 **D3: Nix + one-shot installers.** Restore `flake.nix`
      (4-platform, native-SEA-in-Nix) and `install.sh` or record the
      distribution decision. Evidence: old tree root.
- [ ] S3.6 **Hygiene: pre-commit hook + CREDITS.** Husky/lint-staged
      pre-commit running the no-comments + type-aware lint on touched files;
      restore an attribution ledger for the fork lineage.
      Verify: `git commit` on a file with a new oxlint finding fails.

## Sequencing, effort, risk

| Phase | Work | Estimate | Risk |
|---|---|---|---|
| W0 | baseline + the D6 commit | 0.5 day | low |
| W1 | S1.1–S1.9 | 1.5–2 weeks total | low-medium; each lands independently |
| W2 | S2.1–S2.11 | 4–7 weeks | medium-high; S2.1/S2.4 touch the loop and classifier |
| W3 | S3.1–S3.6 | 3–4 weeks + decisions | high; S3.1/S3.2 are deep mechanisms |

Rollback: every task is a separate commit; no task depends on an
unlanded earlier task except S2.4 (which S2.5 builds on for the process
section) and W1.5 (which builds on the landed rule persistence).

## Definition of done

- [ ] Every S-task is landed with its verification command green, or has a
      row in the decisions table with an owner answer.
- [ ] `pnpm check:guards`, `pnpm lint`, and `pnpm preflight` exit 0 on the
      finished tree.
- [ ] No adopted mechanism weakened a trust, layering, approval, or sandbox
      boundary — verified by the boundary suites after each risky task.
- [ ] The study doc's §6 at-parity list still holds (no regressions into
      re-implementing landed work).
- [ ] The plan records outcomes inline as tasks close, the way the deep-scan
      plan does.

## Decisions owed

| # | Decision | Default recommendation | Blocks |
|---|---|---|---|
| D1 | Publish a docs site or keep internal | publish (adoption) | S3.3 |
| D2 | Desktop shell or remove `install-desktop` | restore small shell; otherwise remove the command | S3.4 |
| D3 | Nix + installers or record the distribution plan | restore installers only | S3.5 |
| D4 | Reviewer retrieval surface (S2.2 second half) | session board read-only | S2.2 |
| D5 | Escalation ceiling for S1.2 (per-turn cap) | one escalation per turn, config override | S1.2 |
