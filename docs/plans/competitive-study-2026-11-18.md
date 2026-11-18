# Competitive Study — Codex, qwen-code, and the old OmniCode tree

Status: proposed
Scope: comparative study of three reference implementations against this tree,
with a prioritized program to close the gaps that matter and protect the areas
where this tree already leads. Evidence is file-level; each claim was checked in
the reference tree and, where it concerns us, re-checked in this checkout.

Trees studied:

| Tree | Path | Shape |
|---|---|---|
| Codex CLI | `/home/gin/work/projects.old/cli/codex` | Rust core (`codex-rs`, 207 crates), TS SDK/launcher, Bazel |
| qwen-code | `/home/gin/work/projects.old/cli/qwen-code` | TypeScript monorepo, 2 760 test files, 101 integration files |
| Old OmniCode | `/home/gin/work/Hilbras/OmniCode.old` | TypeScript monorepo, 1 053 test files, desktop + inspector + docs site |
| This tree | `/home/gin/work/Hilbras/OmniCode-V` | TypeScript monorepo, 1 349 test files, 11 guards + preflight |

---

## 1. Where this tree already leads (do not regress)

- **Gate honesty.** `pnpm check:guards` (11 gates) + `preflight` (17 steps) +
  shrink-only `oxlint-baseline.json` + generated-artifact freshness + test
  reachability + typecheck coverage. Codex has contract fixtures and a clean-
  worktree check; qwen has custom ESLint and a test-growth ratchet; neither has
  the same breadth of "a gate that passes without running is a bug" enforcement.
- **Kernel layering as code.** `scripts/check-kernel-layering.mjs` (24 packages,
  no cycles). Codex checks one UI boundary; qwen uses custom ESLint rules.
- **Trust-gated memory.** Provenance, trust levels, evidence freshness,
  sensitivity ceilings, legal hold, and the new quote-anchored writer. None of
  the three references has a comparable trust model — this is a differentiator,
  not a gap.
- **Generated wire contract + generated payload types.** Codex commits schema
  fixtures and asserts regeneration equality; we now do the same for the client
  wire contract and its TypeScript payloads.
- **Event-sourced state and DI.** On par with the old tree, stronger than both
  references in explicit kernel layering.
- **Cross-platform CI + audit gate.** Codex and qwen have more jobs, but our
  `cross-platform.yml` + `check:audit` are real and recently exercised.

The strategic read: we are not behind on architecture. We are behind on a small
number of **capability seams** and on **product content**, and ahead on trust and
gate discipline. The program below spends effort where the references are
demonstrably stronger, not on a rewrite.

---

## 2. Comparative matrix

| Dimension | Codex | qwen-code | Old tree | This tree | Verdict |
|---|---|---|---|---|---|
| Agent loop | Turn loop + mailbox/steer queue + compaction as a turn | Turn event stream, steer lease, microcompaction | Same kernel as ours | Event2 loop, input queue seam, compaction | Behind on **steer lease** and **compaction tooling**; otherwise close |
| Approval model | Session cache + persisted exec-policy rule + Guardian reviewer | 5 modes, typed rules, 4-layer auto pipeline | Same chain as ours | manual/auto/yolo, session history, classifier, reviewer lane | Behind on **persisted rules** and **auto adjudication** |
| Shell safety | Per-OS sandbox + Starlark exec policy + credential broker | Shell-semantics bridge into path/domain rules | Same heuristic as ours | Token-based sensitive check | **Weakest here** — highest-priority fix |
| Editing | apply_patch grammar, streaming parser | Prior-read + changed-since-read enforcement | — | ApplyPatch + Edit | Behind on **stale-write protection** |
| Subagents/workflows | Multi-agent v2, wait/interrupt, roles | JS-authored workflows with budgets/journal | — | Subagents + DAG runtime (no model tool) | Behind on **scriptable orchestration** |
| Tools | shell snapshot, unified exec, code mode, tool_search | PTY shell, LSP, tool_search, code mode | — | PTY bits, LSP, disclosure | Mixed; **shell snapshot/code mode** missing |
| Extensions | 14 hook events, plugins, skills with policy | 22 hook events, 10 component kinds, converters | Marketplace payloads + 48 skills | 20 hook event types, features, plugins, skills | Event list is strong; **payloads and converters** missing |
| Headless | `--json`, output schema, app-server | `--json-schema`, stream-json in/out, budgets | — | `--output-format stream-json` | Behind on **structured output contract** |
| TUI tests | VT100 backend | node-pty → xterm → screenshot | — | PTY boot e2e + frame budget | Behind on **visual regression** |
| Docs/product | Strong docs site | docs-site + i18n enforcement | 31 EN + 31 ZH pages | 669 lines, 26 md | **Far behind on user docs** |
| Inspector | — | — | 64-file React inspector | Backend only | **Missing UI** |
| Release | Post-publish verification, staged binaries | Script tests, release automation | OIDC + tarball + npm view check | changesets + gate, no post-publish check | Small gap |
| Skills content | Built-in skill library | Curated + curator | 48 bundled skills | 9 dev skills, dead `OMNICODE_BUNDLED_SKILLS_DIR` | **Large content gap** |

---

## 3. Gaps, ranked

### P0 — correctness and cheap wins (next 2 weeks)

**G1. Shell-semantics permission bridge.** `SHELL SEMANTICS`
- Reference: qwen `packages/core/src/permissions/shell-semantics.ts` maps
  `cat`, `cp`, `curl -o`, redirections and redirect targets to virtual
  `read_file` / `write_file` / `web_fetch` operations before rules run.
- Ours: `packages/engine/src/agent/permissionPolicy/policies/sensitive-file-access-ask.ts`
  splits the command on whitespace and checks tokens. `cat ./secrets/x`,
  `cat $HOME/.ssh/id_rsa` (caught by basename), and `curl -o out https://…`
  (not caught) show the limit.
- Impact: closes the exact weakness the new sensitive-read gate was meant to
  close; makes path and domain rules authoritative.
- Effort: 3–5 days. We already ship `tree-sitter-bash` and a parser service.

**G2. Prior-read and changed-since-read enforcement.** `EDIT SAFETY`
- Reference: qwen `packages/core/src/tools/priorReadEnforcement.ts` +
  `services/fileReadCache.ts`; mutation requires the file to have been read and
  the fingerprint to still match, else `FILE_CHANGED_SINCE_READ`.
- Ours: no read cache; an external edit between Read and Edit is silently
  overwritten.
- Effort: 1–2 days; reuse `fileHistory` versions and the workspace write lock.

**G3. Bundle the 48 product skills.** `CONTENT`
- Reference: old `apps/omnicode-desktop/resources/skills/` (1.4 MB).
- Ours: `packages/server/src/start.ts:167` reads
  `OMNICODE_BUNDLED_SKILLS_DIR`, and **nothing sets it**. `.agents/skills` has
  only the 9 repo-dev skills.
- Impact: out-of-the-box capability; the consumer path already exists.
- Effort: 1 day (copy, set at CLI/server boot, one seed test).

**G4. Complete the plugin payloads.** `CONTENT`
- Ours: `plugins/marketplace.json` lists entries whose in-tree payload is
  missing (`plugins/official/omnicode-datasource` has only `bin/`;
  `omnicode-webbridge` has nothing).
- Reference: old tree shipped manifests, `SKILL.md`, watchlists.
- Effort: 2–4 hours; validate every entry resolves.

**G5. Headless structured contract.** `INTEGRATION`
- Reference: qwen `--json-schema` registers a synthetic `structured_output` tool
  whose parameters are the caller's schema; `--input-format stream-json`,
  `--include-partial-messages`, wall/tool budgets, documented exit codes.
- Ours: `--output-format text|stream-json` only.
- Impact: reliable CI/integration surface; hard to retrofit later.
- Effort: 3–4 days (our stream adapter already exists).

**G6. Small engineering parity.** `HYGIENE`
- `test:coverage` script (old tree had one; our config has the reporter block
  but no script).
- Post-publish `npm view <pkg> dist-tags.latest` assertion in
  `release.yml` (old tree; catches a publish that silently did not land).
- Effort: half a day.

### P1 — capability and leverage (weeks 3–8)

**G7. Persisted approval rule + canonicalization.** `APPROVALS`
- Reference: Codex `ReviewDecision::{ApprovedForSession,
  ApprovedExecpolicyAmendment}`, `command_canonicalization.rs` (`/bin/bash -lc
  "git status"` → `["git","status"]`), `exec_policy.rs` appends a **prefix**
  rule, not a blanket grant.
- Ours: session-approval history exists, but no persisted rule and no
  canonicalization; decision D12 said "no automatic write". Revisit with an
  explicit "always allow `git status`" action (user-initiated), not an
  automatic write.
- Effort: 1–2 weeks.

**G8. Inspector UI.** `DEBUG`
- Reference: old `apps/omnicode-inspect` (64 files, 9 tests): services, DI
  ledger/graph, events, transcript, search, model catalog, bash-parser.
- Ours: debug WS route and engine `IDebug*` services exist; no renderer.
- Effort: 3–5 days port; import-path and React 19 updates.

**G9. User manual + navigable docs site.** `DOCS`
- Reference: old `docs/en/**` 31 pages / `docs/zh/**` 31 pages (9.5k lines),
  VitePress with local search, mermaid, llms.txt.
- Ours: 26 md, 669 lines; `docs/AGENTS.md` makes user docs a non-goal.
- Impact: adoption. This is the single largest content gap.
- Effort: 2–4 days for the high-value pages (ACP/IDE, remote control, providers,
  slash commands, hooks, themes, skills, permissions).

**G10. Typed permission rules.** `POLICY`
- Reference: qwen `ToolName(specifier)` with `command | path | domain | literal`
  kinds, `key:value` params, scopes `system|user|workspace|session`.
- Ours: `PermissionRule.pattern` strings. Domain/path rules are weaker.
- Effort: 1–2 weeks; pairs with G1.

**G11. Terminal-capture visual regression.** `TUI`
- Reference: qwen `integration-tests/terminal-capture/` (node-pty → xterm.js in
  headless Chromium → screenshot) and `scripts/tui-parity/`.
- Ours: PTY boot e2e + frame budget; no proof a dialog still renders.
- Effort: ~1 week for 6–10 scenarios.

**G12. Hook emission audit.** `HOOKS`
- Ours already declares **20** hook event types including `PermissionRequest`,
  `PreCompact`/`PostCompact`, `SessionStart/End`, `SubagentStart/Stop`
  (`packages/engine/src/features/externalHooks/internal/types.ts`), which is
  broader than the reports implied. The gap is not the list; it is proving each
  event is emitted and can block/rewrite where the contract says.
- Effort: 2–3 days audit + tests; then add missing emissions.

### P2 — differentiation (weeks 9–16)

**G13. Guardian-style auto-mode reviewer.** `SAFETY`
- Reference: Codex `core/src/guardian/` (risk levels, budgets, evidence,
  allow/deny/timeout, protected-path refusal).
- Ours: reviewer lane exists (`agent/interaction/reviewer/`) but does not
  adjudicate auto-mode approvals.
- Impact: makes `auto` defensible and is a stronger story than "classifier".
- Effort: 4–6 weeks for the full loop; 1–2 weeks for a risk-gated slice.

**G14. Scriptable subagent workflows.** `ORCHESTRATION`
- Reference: qwen model-authored JS with `agent()/parallel()/pipeline()`,
  deterministic checks, journal, budgets.
- Ours: DAG runtime with no model-visible tool (decision was "no").
- Effort: 1–2 weeks for a bounded tool over the existing runtime + allowlist.

**G15. Shell snapshot + code mode.** `TOOLS`
- Codex `shell_snapshot` replays the user's aliases/functions; `code-mode` runs
  model-authored JS that calls tools.
- Ours: neither.
- Effort: 3–5 days (snapshot); 2–3 weeks (code mode).

**G16. Credential broker / egress proxy.** `SECURITY`
- Codex `network-proxy/src/credential_broker.rs` gives child processes dummy
  keys and substitutes the real secret only for authorized destinations.
- Ours: regex redaction only.
- Impact: the strongest available security differentiator; hard to copy.
- Effort: 3–4 weeks.

**G17. Desktop shell and Telegram bot UX.** `PRODUCT`
- Old tree had an Electron shell (auto-update, single-instance daemon adoption,
  bundled skills) and a 2.6k-line Telegram bot.
- Decisions D2/D7 currently say "no"/preview. Revisit only with a product owner.
- Effort: desktop 2–4 weeks; Telegram ~1 week.

---

## 4. What not to copy

- **Rust rewrite / Bazel.** Codex's per-OS sandbox depth is real, but a rewrite
  is not a strategy; our differentiators are trust, gates, and TS velocity.
- **Blanket lint disables, broken `build:dts`, Nix workspace lists.** The old
  tree is worse here; the successor already fixed these.
- **Manual release flow.** Our changesets + gate is better; only take the
  post-publish assertion.
- **48 skills as a mechanism.** Copy the content, not the desktop-only loader.
- **A second permission model.** Extend the existing chain; do not add a
  parallel policy language without migrating the current rules (G10 is a
  migration, not a second system).

---

## 5. Recommended program

### Phase 1 — two weeks, highest ROI
1. G1 shell-semantics bridge.
2. G2 prior-read enforcement.
3. G3 bundled skills.
4. G4 plugin payloads.
5. G5 `--json-schema` + stream-json input.
6. G6 coverage script + post-publish check.

Expected outcome: the security hole closes, silent clobbering stops, the agent
ships with real skills, the marketplace resolves, and CI can drive the CLI
structurally.

### Phase 2 — weeks 3–8
7. G7 persisted approval rule + canonicalization (user-initiated).
8. G8 inspector UI.
9. G9 user manual + docs site navigation.
10. G10 typed permission rules (incremental: `command` and `path` first).
11. G11 terminal-capture harness.
12. G12 hook emission audit.

Expected outcome: approvals stop repeating, debugging has a UI, adoption has
docs, and permission rules can express domain/path intent.

### Phase 3 — weeks 9–16, differentiators
13. G13 guardian reviewer (risk-gated slice first).
14. G14 scriptable workflows (bounded tool + allowlist).
15. G15 shell snapshot; code mode if it proves out.
16. G16 credential broker.
17. G17 product surfaces only on an explicit decision.

Expected outcome: `auto` mode becomes defensible, orchestration becomes
programmable, and secrets stop reaching child processes — areas where we can be
meaningfully better than Codex and qwen, not just equal.

---

## 6. Todo

- [ ] P1.1 shell-semantics bridge + tests for `>`, `cat`, `cp`, `curl -o`, `tee`.
- [ ] P1.2 prior-read fingerprint cache + `FILE_CHANGED_SINCE_READ`.
- [ ] P1.3 bundle skills; set `OMNICODE_BUNDLED_SKILLS_DIR`; seed test.
- [ ] P1.4 complete plugin payloads; validate every marketplace entry.
- [ ] P1.5 `--json-schema`, `--input-format stream-json`, budget flags, exit codes.
- [ ] P1.6 `test:coverage` + post-publish `npm view` assertion.
- [ ] P2.1 user-initiated "always allow this prefix" + canonicalization.
- [ ] P2.2 inspector UI port + 9 tests.
- [ ] P2.3 docs manual (en/zh high-value pages) + nav/search.
- [ ] P2.4 typed rules (`command`, `path`, then `domain`).
- [ ] P2.5 terminal-capture scenarios.
- [ ] P2.6 hook emission audit.
- [ ] P3.1 guardian reviewer slice.
- [ ] P3.2 workflow tool.
- [ ] P3.3 shell snapshot.
- [ ] P3.4 credential broker.
- [ ] P3.5 product surfaces decision.

## 7. Verification

Each item lands with the repo's normal gate: a test that fails on the base,
`pnpm --filter <pkg> typecheck`, targeted suites, then `pnpm check:guards` and
`preflight` before commit. The study's claims are pointers, not proof: every
adopted mechanism is re-implemented against this tree's contracts, not copied.
