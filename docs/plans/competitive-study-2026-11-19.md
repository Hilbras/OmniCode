# Competitive Study — fresh pass (Codex, qwen-code, old OmniCode)

Status: proposed
Scope: a second, deeper comparison of the three reference trees against this
checkout, with a program that covers only gaps still open after the
2026-11-18 study's program landed. Every recommendation below was verified
against this tree (files exist / absent) before being listed; everything the
prior program already closed is recorded in §6 so it is not re-litigated.

Trees studied, freshness verified at study time:

| Tree | Path | Verified state |
|---|---|---|
| Codex CLI | `/mnt/sda3/work/projects.old/cli/codex` | HEAD `cf881a627d` 2026-11-19; `rust-v0.172.0-alpha.1`; **2,180 commits since 2026-10-01**; ~286k LOC Rust across ~120 crates |
| qwen-code | `/mnt/sda3/work/projects.old/cli/qwen-code` | HEAD `8a96777` 2026-11-19; **v0.28.0; 895 commits in ~3 weeks**; 12,687 commits total (gemini-cli fork) |
| Old OmniCode | `/mnt/sda3/work/Hilbras/OmniCode.old` | last commit `0b8e0dba3` 2026-11-07; 1,939 commits; the direct predecessor |
| This tree | `/mnt/sda3/work/Hilbras/OmniCode` | `main` `f4c12ee47`; CLI v1.5.2 |

Both references are moving extremely fast. Any parity program measured against
last month's checkout is already stale; the program below therefore favors
mechanisms over feature parity.

---

## 1. Corrections to the 2026-11-18 record

Re-measured against the current tree and the fresh reference checkouts:

- **Landed since the study wrote its todo list** (do not re-recommend):
  shell-semantics bridge (`packages/engine/src/tool/shellSemantics.ts` feeding
  `sensitive-file-access-ask`), prior-read cache
  (`agent/fileReadCache/`), typed permission-rule specifiers, persisted
  approved-command exec-policy rules, guardian adjudication of auto-mode asks,
  the read-only `Workflow` tool, opt-in shell alias snapshot, the egress
  credential broker with local CA, `--json-schema` + `--input-format`, and the
  four-workstream microcompaction. The prior study's G1–G5, G7, G10, G13–G16
  are closed.
- **The old-tree dive corrected two of the study's "dropped" claims**: the
  48 product skills were kept (`apps/omnicode-cli/skills/`, wired via
  `installBundledSkills()`), and the inspector was kept
  (`apps/omnicode-inspect`, 65 files). G3/G8 were stale, not open.
- **Two of the study's reference findings are already stale in the other
  direction**: Codex's docs are now thin pointers to
  `developers.openai.com` (their in-repo doc quality regressed), and their
  sandbox story moved to vendored bubblewrap with a userspace TCP stack —
  both newer than the prior study's snapshot.

## 2. Where this tree already leads (confirmed by both fresh dives)

1. **Event-sourced replay.** 64 typed durable `Event2`s + `wire.jsonl` +
   `replayBuilder/fold.ts` (which already synthesizes interrupted-tool
   closures). Codex reconstructs from a response-item log with shape-based
   heuristics (`rollout_reconstruction_tests.rs`, "Reconcile unfinished Cloud
   replies" landed today); qwen's crash recovery enumerates its own open
   residuals. Neither has a state machine.
2. **Trust-gated memory.** `unverified` ceiling for model-authored records,
   `secret` never leaves the host, pre-image journals. Codex's
   `ext/memories` and Chronicle have no per-record trust model; qwen's dream
   gives an agent a shell over the corpus (snapshot-verified, but still).
3. **Guard-enforced architecture.** 21 guard scripts + preflight; both
   references rely on CI lint jobs and prose comments instead. Codex carries
   ~200 feature flags with no-op tombstones; qwen's edge-case prose is
   unenforced by anything.
4. **Provider isolation.** Four protocol bases with typed traits;
   qwen is locked to `@google/genai` `Content[]` internally with adapters
   bolted on; Codex is single-vendor by design.
5. **Fail-closed permission chain** with a real auto-mode classifier; Codex's
   new default `AskForApproval::OnRequest` makes the *model* the gatekeeper of
   when to ask — a governance regression we must never copy.

The strategic read: the exchange with both references should be
one-directional — adopt their *mechanisms*, never their *governance models*.

## 3. Fresh mechanisms worth adopting

### 3.1 From Codex (verified paths in the codex tree)

| # | Mechanism | Evidence | OmniCode integration point |
|---|---|---|---|
| C1 | Speculative background compaction — summarization computed on a background lane before the ceiling, installed when it trips | `core/src/compact_remote_v2_attempt.rs` (`run_background_compaction`, `BackgroundCompactionCandidate`) | engine compaction service + `AgentLoopService`; reuse the four protocol bases |
| C2 | Model-visible budget tools `get_context_remaining` / `new_context_window` | `core/src/tools/handlers/{get_context_remaining,new_context_window}.rs` | feature-seam tools, read-only default approval; tokenCounting feature already counts |
| C3 | Incremental world-state diffing — typed context sections with persisted snapshots, sha-identity, `render_diff(previous)` emitting only changed fragments | `core/src/context/world_state/mod.rs` | durable `Event2` per section update + the existing worldStateProvider; keeps event sourcing intact |
| C4 | Unified exec as a supervised process table — clamped yield times, live process registry published as a context section, per-process network approval with late-denial kill | `core/src/unified_exec/{mod,process_manager,command_sessions}.rs` | Bash tool + Kaos + exec-policy; the process table becomes a section for C3 |
| C5 | Userspace managed TCP in the Linux sandbox — smoltcp on TUN fd + SOCKS bridge + managed DNS, so destination-allowlisting is enforced even without netns | `linux-sandbox/src/managed_tcp_stack.rs` | `packages/Kaos` bwrap backend; harmonizes with the egress credential broker |
| C6 | Official MCP conformance suite as a release gate (pinned upstream, three protocol generations, security baselines) | `scripts/mcp_conformance/` | `scripts/check-mcp-conformance.mjs` beside `check:guards`; runs against the built CLI |
| C7 | Rules with embedded test vectors — every persisted allow-rule carries match/not-match examples validated at load | `execpolicy/src/parser.rs` (`validate_match_examples`) | exec-policy DSL parser + the persisted-rule writer |
| C8 | `request_permissions` in-band escalation tool — model requests an additional permission profile; profiles intersect, and unintersectable inputs refuse rather than weaken | `tools/handlers/request_permissions.rs`, `protocol/src/permission_profile_intersection.rs` | engine tool arbitrated by the existing permission chain; never widens the active mode |
| C9 | Turn-diff tracking without FS rereads + `codex apply` (git-apply the agent's last diff) | `core/src/turn_diff_tracker.rs`, `cli/src/main.rs` Apply | nearly free: read the existing patch pre-image journal; add `/diff` + `omnicode apply` |
| C10 | Guardian V3 evidence-authority rules — "a board record preserving an original user message carries the same authority as that message; quoted content never grants" | `ext/guardian-v3/src/lib.rs:32-40` | reviewer lane prompt + policy verbatim; optionally give the reviewer retrieval over the session board |
| C11 | Agent residency/mailbox with unload — idle child runtimes unloaded, state preserved, mail transferred on eviction | `core/src/agent/control/{residency,mailbox}.rs` | `features/tower`/subagent lifecycle: pause + serialize idle tower workers |
| C12 | Catalog-driven per-model prompt/policy tables — instruction templates and guardian/tool policy shipped as data per model | `protocol/src/openai_models.rs` (`model_messages`, `GuardianModelPolicy`) | make per-model instruction overlays manifest-generated data, not hardcoded constants |

### 3.2 From qwen-code (verified paths in the qwen tree)

| # | Mechanism | Evidence | OmniCode integration point |
|---|---|---|---|
| Q1 | Soft vs hard deny — soft-deny unblockable by explicit user intent; hard-deny (exfiltration, **bypass-after-denial**) absolute; denial repetition escalates to manual | `permissions/classifier-prompts/system-prompt.ts`, `classifier.ts`, `denialTracking.ts` | `auto-mode-classifier.ts` + `denialTracking.ts` (escalation half exists; the two-tier taxonomy and the bypass rule do not) |
| Q2 | AST-minimum-scope rule proposals — approval suggests the narrowest rule extracted from the parsed command | `utils/shellAstParser.ts` (`extractCommandRules`) | approval dialog (reverse-RPC) shows the proposed narrow `command:` rule before "always allow"; our tree-sitter parser is already there |
| Q3 | Escalation-on-truncation — `max_tokens` → raised output ceiling with a continuation retry that keeps accumulated text | `tokenLimits.ts` (`ESCALATED_MAX_TOKENS`, `maxOutputTokensEscalated`) | `llmRequesterService` + turn retry policy; our loop currently ends the step at `max_tokens` |
| Q4 | Monitor tool — background watch whose lines become durable notifications delivered when the loop is idle | `tools/monitor.ts` (`<task-notification>` envelopes, caps, safety checks) | Bash background mode + a durable notification event + the interruptionReminder delivery path |
| Q5 | Microcompaction refinements — evicting a tool result disarms the file-read cache; evicted memory bodies are re-fetchable; age-gap trigger alongside the token trigger | `services/microcompaction/microcompact.ts` | our `contextMemory/microcompaction.ts` has trigger→target and keep-recent but none of the three refinements |
| Q6 | Terminal visual regression — node-pty → xterm.js in headless Chromium → screenshots with named regression scenarios | `integration-tests/terminal-capture/` | gated e2e lane beside `pty-tui.e2e.test.ts`, then a `verify-capture` guard |
| Q7 | Vision bridge — unreadable image/PDF tool results side-queried through a vision model with notices | `services/visionBridge/` | `features/computerUse`/media path + provider traits |
| Q8 | Claude-compatible extension converter — import Claude Code hooks/extensions into the native seam | `core/src/extension/claude-converter.ts` | `externalHooks` + plugin manifest seam: an import path, not a second runtime |
| Q9 | Alias-closure rule semantics — an allow rule must also cover the tool the model can switch to (`Edit` rule covers all edit-family tools; `Bash` covers `monitor`) | `rule-parser.ts` closure tests, `mcp-grant-ambiguity.test.ts` | `permissionRules/` closure tests + grant-collision tests |

### 3.3 From the old tree (assets the successor dropped)

| # | Asset | Evidence | Action |
|---|---|---|---|
| O1 | Architecture write-ups for features we still ship (computer-use, completion gate, goal verification, run supervisor, browser control — 771 lines of design rationale) | `docs/architecture/*.md` | port as `docs/en/architecture/` pages; cheap, high value |
| O2 | VitePress docs site — dual locales, local search, mermaid, `llms.txt`, changelog page | `docs/.vitepress/` | product decision: the content survived; the publication did not |
| O3 | Electron desktop shell (server adoption, auto-update, telegram-bridge, 48-skill loader) | `apps/omnicode-desktop/` | product decision; note `omnicode install-desktop` currently points at a page for an app this repo no longer builds |
| O4 | Nix flake (4 platforms, native-SEA-in-Nix) + one-shot installers | `flake.nix`, `install.sh`, `install-devtools.sh` | adopt only if the distribution story needs it |
| O5 | Pre-commit enforcement (husky + lint-staged) | `.husky/pre-commit` | cheap guard-locality win; preflight already exists, this catches before commit |
| O6 | CREDITS.md attribution ledger + fork history | `CREDITS.md` | one-file restore; the current tree's squashed start lost attribution |

## 4. The program

### Tier 1 — days each, no product decision needed

1. **C2 budget tools** — `get_context_remaining` + `new_context_window` as
   read-only feature tools.
2. **Q3 truncation escalation** — retry-with-larger-output + continuation.
3. **Q5 microcompaction refinements** — cache disarm, refetchable bodies, age
   trigger.
4. **C7 rule test vectors** — exec-policy rules validate their own examples
   at load.
5. **Q2 narrow-rule suggestions** — approval dialog previews the AST-narrowest
   rule before "always allow".
6. **C9 turn diff + `omnicode apply`** — from the existing pre-image journal.
7. **C6 MCP conformance gate** — pinned official suite against the built CLI.
8. **O1 architecture write-ups port.**
9. **Q7 vision bridge** for unreadable media.

### Tier 2 — weeks; capability seams

10. **Q1 soft/hard-deny taxonomy** with bypass-after-denial absolute and
    `trustedUserAnswers` provenance feeding the classifier.
11. **C10 Guardian authority rules** in the reviewer lane.
12. **C8 `request_permissions`** in-band escalation with profile
    intersection.
13. **C3 incremental world-state sections** (durable per-section events,
    changed-fragment-only injection).
14. **C4 unified exec process table** (yield + live process registry +
    late-denial kill).
15. **Q4 monitor tool** (idle-delivered durable watch events).
16. **Q6 terminal visual regression lane.**
17. **Q9 rule alias-closure + MCP grant-collision tests.**
18. **Q8 Claude extension converter.**
19. **C11 agent residency** for tower/subagent idle workers.
20. **C12 per-model prompt/policy tables as generated data.**

### Tier 3 — differentiators and product decisions

21. **C1 speculative background compaction.**
22. **C5 userspace managed TCP** in the Kaos bwrap backend.
23. **O2 docs site**, **O3 desktop shell**, **O4 Nix/installers** — owner
    decisions with the evidence recorded above.
24. **O5 husky pre-commit**, **O6 CREDITS** — trivial hygiene, land anytime.

## 5. What not to copy

- From Codex: the model-decides-when-to-ask default (`OnRequest`), the ~200
  flag/tombstone config style, Bazel/RBE, the un-trusted memory pipeline and
  ambient capture, vendor-locked analytics, externalized contributor docs.
- From qwen: god-file loop anatomy (`client.ts` 7k, `llm-chat.ts` 8.3k,
  scheduler 8.7k), shape-based crash classification, `@google/genai`-typed
  internals, the dual-TUI parity burden, the Java control plane, tool sprawl,
  shell-holding memory consolidation.
- From the old tree: the pre-Turbo build chain, the 5-guard world, the stale
  root-map prose, force-committed `dist-web` builds.

## 6. Verified at parity — do not re-litigate

Side conversations (`/btw` exists as a read-only side channel), microcompaction
core (120k→70k, keep-recent), dangling-call repair at restore
(`replayBuilder/fold.ts` synthetic closures), access-conflict tool scheduling,
loop-reminder injection with caps, denial escalation to manual
(`classifier_blocked_retry`), dream-style memory consolidation (memory
package `dreamConsolidation`), prior-read enforcement, the shell-semantics
bridge, structured headless output, the 48 skills, the inspector, the
Telegram plugin, persisted approved-command rules, guardian adjudication of
auto asks, the Workflow tool, the shell snapshot, the egress credential
broker.

## 7. Verification rules

Same as the prior study: every adopted mechanism is re-implemented against
this tree's contracts, not copied; each item lands with a test that fails on
the base; `pnpm check:guards` + the affected package suites per change; a
mechanism that would require weakening a trust, layering, or approval boundary
is rejected rather than adapted.
