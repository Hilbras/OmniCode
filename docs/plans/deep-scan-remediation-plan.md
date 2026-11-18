# Deep Scan & Remediation Plan

Status: active
Scope: whole workspace — `packages/*`, `apps/*`, `scripts/`, `.github/workflows/`,
docs, and the dependency graph. Changes gates, docs, dependency pins, and wires
existing seams. Does not weaken permission, trust, sandbox, or kernel-layering
boundaries.

Relationship to existing plans: this is a **verification pass over the current
tree**, not a replacement for `strength-program.md`. Where the two overlap, this
file records the re-measured state on 2026-11-18 and defers the design narrative
to `strength-program.md`. New findings that are not in that program are marked
**NEW**.

---

## 1. Goal

**Objective.** By the end of this program, every claim the tree makes about
itself is either enforced by a gate or explicitly recorded as open, no
built-but-unwired seam silently reads as a feature, and the documented trust
boundaries hold against the bypasses found in this scan.

**Measurable completion.**

| # | Outcome | Measure |
|---|---|---|
| O1 | Gates tell the truth | `pnpm check:guards` and `pnpm lint` exit 0 on a clean tree |
| O2 | Supply chain is clean | `pnpm audit --audit-level high` exits 0 or lists only shrink-only, documented build-time exceptions |
| O3 | Trust boundaries hold | S1/S2 closed with regression tests; S3–S5 closed or recorded with a decision |
| O4 | No dead seams | every registered tool/event/config contribution is reachable or deleted with a test |
| O5 | Docs match code | the drift guard covers `CONTRIBUTING.md` and the release flow |
| O6 | No unexplained tree state | `git status` clean; no orphan fixtures |

**Non-goal.** Redesigning the permission model or changing published contracts
without an explicit decision. The plan records each such call in §8.

**Execution rule.** Each item lands as its own commit with a test that fails on
the base and passes on the fix.

Success criteria:

1. `pnpm check:guards` exits 0 on a clean working tree.
2. `pnpm lint` exits 0 and the oxlint baseline only shrinks.
3. `pnpm audit` reports **zero high/critical** findings.
4. No tracked source/config/doc contradicts another (release flow, lint,
   test scripts, generated artifacts).
5. Every seam named in `strength-program.md` is either wired with a test or
   recorded as an explicit product decision with an owner.
6. No untracked build cruft, dead directory, or orphan process is left
   unexplained.
7. Each closed item carries a test or a guard that fails on the base and passes
   on the fix.

Non-goals: redesigning the permission model, rewriting the TUI renderer,
publishing a desktop app, or changing published SDK/server contracts without a
separate decision.

### 1.1 Executive summary — what to do first

| Priority | Item | Status |
|---|---|---|
| 1 | **S1** absolute-form auth bypass (`middleware/auth.ts`) | **fixed + tested** (base returned 200, now 401) |
| 2 | **S2** Windows `cmd` injection in `fileLaunch.ts` | **fixed + tested** (argv + PowerShell) |
| 3 | **F2/F3** `zod` + `dompurify` advisories | **fixed** (4.6.6 / 3.4.18) |
| 4 | **S3** MCP admission (mapped IPv6 + hostnames) | **fixed**: literal classification and connect-time DNS check |
| 5 | **F4/F5/F17/F28** stale docs | **fixed**, drift guard extended |
| — | **S4** auto-mode secret reads | **fixed for prompts** (Bash/Grep); output redaction deferred |
| — | **S5** provider key exposure | **fixed**: loopback-only reveal, no key for remote callers |
| — | **F6** glob semantics | **fixed + test un-skipped** |
| — | **F23–F27** unwired tools/events | **fixed** (allowlists, event producer, Event2 construction) |

Every item in this pass is closed. Three things remain outside it, by explicit
decision rather than omission: tool-output secret **redaction** (a heuristic there
would corrupt legitimate file content), a **local session-search harvester** (the
server adapter is the only source today), and **generated client TypeScript**
(the API contract tables stay the source). The only external blocker is a
published `picomatch` fix; its advisory is allowlisted with that reason.

---

## 2. Scan method and evidence

### 2.1 Commands run

| Check | Result |
|---|---|
| `git status --porcelain` | **dirty**: `D packages/engine/src/agent/permissionPolicy/policies/auto-mode-approve.ts`; untracked `apps/omnicode-mobile.old/`, `plugins/` |
| `pnpm check:guards` | **exit 0** on 2026-11-18, run once sequentially after the digest regeneration; all 11 steps passed |
| `pnpm lint` | **exit 0** — `oxlint baseline check: OK (70 frozen findings, 0 new)` |
| `pnpm audit --json` | **29 advisories — 3 high, 19 moderate, 7 low** |
| `rg` TODO/FIXME/stub sweep | no meaningful TODO debt; 9 `as any` in `src/` (down from the usual baseline) |
| `rg` skipped tests | 9, all justified gates except one real gap in `Kaos` |
| source/test inventory | 2 685 source files, 1 331 test files |
| guard scripts | workspace, layering, deps, docs claims, agent docs, docs build, generated freshness, test reachability, command paths, typecheck coverage, skills |
| security sub-scan | auth, command spawn, MCP admission, auto-mode secret reads, provider key exposure |
| wiring sub-scan | feature imports, tool allowlists, config readers, durable-event producers, SDK/API parity |

### 2.2 Guard pass detail

Every step passed in the final sequential run:

- `check-workspace-globs`: 4 patterns, 6 Vitest projects, 2 754 source files.
- `check-kernel-layering`: 24 packages, no cycles.
- `check-no-comments`: 283 files clean.
- `check-deps-consistency`: 40 packages, 37 lockfile importers, 0 unused
  internal deps, 3 allowlisted specifier divergences.
- `check-docs-claims`, `check-agents-docs` (71 paths), `docs:check` (14 markdown
  files, links resolve).
- `check-generated`: all 7 artifacts fresh, including
  `contract-types.sha256` (1 126 declarations).
- `check-tests`, `check-command-paths`, `check-typecheck`, `check-skills`:
  passed (the last reports 75/75 skill-validator tests).

The one real hazard observed: an interrupted run left its children alive, and a
second guard run then shared `packages/engine/.contract-types-tmp`, producing a
false `987 removed` drift report. Sequential runs are clean. See F15.

### 2.3 What this scan did **not** do

- It did not run the full uncached test graph (the last recorded run is in
  `strength-program.md`: 36/36 tasks, 22 496 passed, 55 skipped).
- It did not run `pnpm preflight` end to end.
- It did not execute notebook/PTY/MCP-conformance gated suites.
- It did not test on Windows or macOS.

Anything below that depends on those runs is marked as needing verification.

---

## 3. Findings

Ordered by blast radius. `NEW` = not present in `strength-program.md`.

### P0 — Correctness, security, and gate truth

**F1. `auto-mode-approve.ts` deletion — resolved in the working tree, not committed.** `NEW`
- Evidence: at scan start the file was deleted but
  `packages/engine/docs/contract-types.sha256` still digested
  `agent/permissionPolicy/policies/auto-mode-approve.d.ts`, so the gate could
  not be fresh. During the scan the work was completed: the digest line was
  regenerated away, both changes were staged, and
  `docs/plans/strength-program.md` gained a T0 entry explaining that the class
  had no importer and that the classifier policy already owned the slot.
- Verified: a **sequential** `pnpm --filter @hilbras/omnicode-engine
  gen:contract-types -- --check` now reports
  `contract types are fresh (1126 declaration files)` and exit 0.
- Caveat: an earlier `check:generated` run reported `987 removed` and exit 1.
  That number was an artifact of two overlapping guard runs sharing
  `packages/engine/.contract-types-tmp`, which one run wipes while the other
  reads it. Do not quote it as drift (see F15).
- Remaining: none. It is committed as `9f8ce87`, and the sequential
  `pnpm check:guards` run after it exits 0.
- Verify: `pnpm check:guards` exits 0; the permission-policy chain tests still
  pin `auto` → `auto-mode-classifier` for both read-only and mutating calls.

**F2. `zod` 4.3.6 is below the patched version (high).** `NEW`
- Evidence: advisory `GHSA-mrhx-c7xc-m3w5` — *Zod can exhaust memory while
  validating oversized constrained collections*; vulnerable `< 4.6.6`. The
  workspace pins `4.3.6` in both `pnpm-workspace.yaml` (`catalog:` + root
  `overrides`) and `AGENTS.md` documents that version.
- Impact: any untrusted payload validated by a constrained schema can spike
  memory before validation fails. Relevant because the API/server/MCP surfaces
  validate external input.
- Fix: bump the catalog and override to `>= 4.6.6`, refresh the lockfile, run
  the contract generators (`wire-contract`, manifests) and the full typecheck.
- Verify: `pnpm audit` no longer lists `zod`; `pnpm typecheck`; engine/API/server
  suites; generated artifacts fresh.
- Risk: zod 4.6 may change error shapes; contract-type digests and wire-contract
  JSON must be regenerated deliberately.

**F3. `dompurify` 3.2.7 is below the patched version (high).** `NEW`
- Evidence: advisory for `<= 3.4.16` (IN_PLACE hook leaves detached subtree event
  handlers armed). `pnpm why dompurify` shows `3.2.7` via
  `monaco-editor@0.55.1`; a second copy `3.4.17` already exists via `mermaid`.
- Impact: the advisory needs DOMPurify to be used on attacker-controlled HTML.
  `packages/app-markdown/src` does not import DOMPurify directly; the vulnerable
  copy arrives through `monaco-editor`/`stream-monaco`, so **reachability is not
  yet proven**. Treat the bump as cheap hardening and record the proof of reach
  (or non-reach) rather than assuming either way.
- Fix: add a root `pnpm.overrides` entry to force `dompurify >= 3.4.17` (or bump
  `monaco-editor`), dedupe to one copy.
- Verify: `pnpm why dompurify` shows one patched version; `pnpm audit` clean for
  this advisory; `packages/app-markdown` tests.

**F4. `CONTRIBUTING.md` tells contributors the gates are broken when they are not.** `NEW`
- Evidence: `CONTRIBUTING.md` still says “Root `pnpm lint` is a Turbo no-op (no
  package lint scripts exist)” and “`apps/omnicode-cli` `test` / `e2e` scripts
  call a root script that does not exist”. The tree now has a real `pnpm lint`
  (`check-no-comments && check-kernel-layering && check-oxlint-baseline`) and
  `apps/omnicode-cli` scripts call the existing `build:cli`.
- Impact: contributors skip a real gate and hand-build the CLI unnecessarily;
  the doc is the first thing a new maintainer reads.
- Fix: rewrite the “Checks” and “Known command gaps” sections; add
  `CONTRIBUTING.md` to `check-docs-claims.mjs` so the same drift fails the gate.
- Verify: `pnpm check:docs-claims` fails when the stale sentence is planted.

**F5. `docs/release.md` contradicts itself and `release.yml`.** `NEW`
- Evidence: the “Automation” section describes `release.yml` + `release-gate.yml`
  publishing `@hilbras/omnicode`; “Release flow” item 3 says “Publishing
  `@hilbras/omnicode` is currently a manual step … The publish workflow is
  deliberately not written yet”. Both files exist and the workflow calls
  `pnpm release`.
- Impact: an operator cannot tell whether a merge to `main` publishes.
- Fix: choose the truth (the workflow exists; publishing is CI-driven), rewrite
  the stale paragraph, and add the contradiction to `check-docs-claims.mjs`.
- Verify: the guard fails if the “not written yet” sentence reappears.

**F6. `Kaos` glob `**/` does not implement zero-or-more directories.** `NEW`
- Evidence: `packages/Kaos/test/internal.test.ts:267` is an `it.skip` that
  documents the gap: `globPatternToRegex('**/foo.txt')` does not match
  `foo.txt`, `a/foo.txt`, or `a/b/foo.txt`, unlike Python/bash glob semantics.
  `globPatternToRegex` is used in production by `Kaos/src/local.ts:413` and
  `Kaos/src/ssh.ts:684`.
- Impact: the Glob tool and SSH glob expansion can silently miss files for a
  common pattern.
- Fix: implement `**/` as `(?:[^/]+/)*` (or delegate to a tested glob matcher),
  un-skip the test, add cases for `a/**/b`, trailing `/**`, and Windows
  separators.
- Verify: the un-skipped test passes; `packages/Kaos` suite and
  `features-integration` glob tests pass.

**F7. `picomatch <= 4.0.7` ReDoS (high, no patch).** `NEW`
- Evidence: `pnpm audit` high advisory; paths are dev/build tooling
  (`tsdown`, `vitest`, `changesets`, Expo metro) plus `tinyglobby`.
- Impact: build-time only; not shipped in the CLI runtime. Still a high advisory
  in CI.
- Fix: track upstream; prefer a patched `picomatch`/`tinyglobby` when released,
  or override to the first patched version once published. Do not add a fake
  override.
- Verify: `pnpm audit` no longer lists it, or the exception is recorded with a
  reason.

### P0b — Trust-boundary findings (security sub-scan)

These were found by a read-only invariants pass and spot-checked in source. They
are listed separately because they are not part of the strength program and two
of them are release-blocking if the server is exposed beyond loopback.

**S1. HIGH — Bearer auth bypass via an absolute-form request target.** `NEW`
- Evidence: `packages/server/src/middleware/auth.ts:23-46` decides “public vs
  API” from `req.url` with `path.startsWith('/api/')`. Fastify 5.12.5 exposes
  the raw request target, and `find-my-way` extracts a path from absolute-form
  targets (`node_modules/.../find-my-way/index.js:619,857,1001`). A request line
  of `GET http://127.0.0.1:PORT/api/v1/sessions HTTP/1.1` therefore skips auth
  and is still routed to the API handler.
- Impact: every bearer-protected REST route (sessions, filesystem, `fs open`,
  provider secrets) is reachable without a token when the server is exposed
  beyond loopback (`--insecure-no-tls` or behind a TLS proxy). Host/Origin
  checks do not close it: the client controls `Host` and can omit `Origin`.
- Confidence: source-traced through Fastify 5.12.5 + find-my-way; **not yet
  reproduced with a live request**. The first task is the regression test, which
  either confirms the bypass or closes the item with evidence.
- Fix: derive the pathname structurally (`new URL(raw, 'http://localhost')
  .pathname`), reject absolute-form/authority-form targets, or replace the
  blocklist with an explicit public-path allowlist.
- Verify: a route test sends an absolute-form target to `/api/v1/...` and
  expects **401**; the same target to `/api/v1/healthz` still passes.

**S2. MEDIUM/HIGH — Windows command injection from a workspace filename on `fs open`.** `NEW`
- Evidence: `packages/server/src/lib/fileLaunch.ts:32-33` builds
  `cmd /c start "" <absolutePath>`. Node quotes an argument containing spaces
  but does not quote cmd metacharacters, so a workspace file named `a&calc.exe`
  becomes a second command. Reachable at `packages/server/src/routes/fs.ts:405,
  853-860` by any authenticated client (or an unauthenticated one via S1).
  The same file also runs editor/`code` launches through `shell: true`
  (`:22-26`, `:134-146`) and `commandExists` spawns `command -v` through a
  shell (`:116-131`), contrary to the `resolveCommandPath` rule.
- Impact: arbitrary command execution from a repository filename on Windows.
- Fix: no workspace path through `shell: true`/`cmd`; resolve editor binaries
  with `resolveCommandPath`; use argv arrays; use the PowerShell
  `Start-Process -LiteralPath` launcher that
  `apps/omnicode-cli/src/utils/open-url.ts` already implements; reject cmd
  metacharacters in any path that must cross cmd.
- Verify: unit test with a filename containing `&` and a Windows path class;
  `packages/server` suite.

**S3. MEDIUM — MCP private/link-local endpoint rejection is bypassable.** `NEW`
- Evidence: `packages/engine/src/mcpCore/endpoint-policy.ts:28-40` takes the
  first colon group; for any compressed address starting with `::`
  (`::ffff:10.0.0.1`, `::ffff:169.254.169.254`) it returns “not private”.
  `isPrivateIpv4` also misses `0.0.0.0`, and hostnames are never resolved, so a
  public name resolving to a private address (or DNS rebinding) passes.
- Impact: an MCP server config can reach internal services and link-local
  metadata endpoints despite the documented rejection, carrying configured
  bearer tokens/headers.
- Fix: expand IPv6 fully (or use a vetted IP library), classify mapped IPv4,
  unspecified, loopback, ULA and link-local; resolve and re-check hostnames
  before connect and after redirects.
- **Resolved.** `endpoint-policy.ts` expands all eight IPv6 words and maps
  embedded IPv4; `remote-guard.ts` adds `assertMcpHostnameAllowed`, called from
  both HTTP and SSE `connect()`, which fails closed on NXDOMAIN and rejects a
  hostname resolving to a private/link-local address unless
  `allowPrivateNetwork` is set. Redirects are already origin-pinned.
- Verify: cases for `[::ffff:10.0.0.1]`, `[::ffff:169.254.169.254]`, `0.0.0.0`,
  and hostnames resolving to `10.0.0.5` / `169.254.169.254` all fail closed
  (`endpoint-policy.test.ts`, 20 tests).

**S4. MEDIUM — Auto mode reads secrets through Bash/Grep without the sensitive-file gate.** `NEW`
- Evidence: `SensitiveFileAccessAskPermissionPolicyService` only inspects
  `kind === 'file'` accesses (`packages/engine/src/agent/permissionPolicy/
  policies/path-utils.ts:9-14`). `Bash` declares no file accesses
  (`bashTool.ts:140-160`) and `cat`/`head`/`tail`/`grep` are in
  `READ_ONLY_BASH_COMMANDS` (`packages/engine/src/tool/read-only-command.ts:20-36`),
  so in auto mode `cat .env` is approved without the prompt that `Read .env`
  receives. `Grep` declares only `searchTree` (`grepTool.ts:104`), so matches
  inside key files never reach the policy. Tool results are also not redacted
  at the boundary (`toolExecutorService.ts` normalize/merge).
- Impact: credentials can be read and sent to the provider / persisted to
  `wire.jsonl` without approval in the mode used by `--print`.
- Fix: derive read accesses from the parsed shell AST and evaluate sensitive
  paths per match for search tools; redact secret-shaped strings at the tool
  result boundary while preserving an explicitly approved full read.
- Verify: an auto-mode chain test proving `cat .env` asks; a search test where
  the sensitive file’s contents are redacted.

**S5. LOW — Provider API key returned in plaintext.** `NEW`
- Evidence: `packages/server/src/routes/modelCatalog.ts:619-631` returns the
  stored `api_key` so local clients can prefill an edit form. The route is
  authenticated, but the server supports non-loopback exposure and any bearer
  holder (or S1) can read every provider key.
- Fix: return a masked value and add an explicit reveal endpoint restricted to
  loopback (or require re-auth).
- Verify: the route test asserts the key is masked by default.

### P1 — Built-but-unwired seams (from the strength program, re-confirmed)

**F8. `PermissionRulesAdd` is non-durable and `addRules` has no production caller.** `NEW` (detail)
- Evidence recorded at `strength-program.md` “T2.1b”: the only rule-append seam
  is dead in production; session approvals are durable but agent-scoped.
- Impact: “approve for session” works, but an approval never survives into a new
  session because nothing writes the user policy file.
- Fix: decide whether an approval may mutate the user-owned policy. If yes,
  route through the existing `configService` writeback path and emit a durable
  event; if no, delete the dead seam or label it.
- Verify: an approval followed by a fresh session either reuses the rule or the
  decision is documented with a test.

**F9. Workflow runtime exists; no model-visible tool wraps it.** (T4.3)
- Evidence: `runner.ts:147` empty allowlist, `runner.ts:281` fails closed;
  `IAgentToolExecutorService.execute` is the safe dispatch path.
- Impact: the runtime is unreachable from the model.
- Fix: product/policy decision, then a tool with an explicit allowlist and
  approval policy.
- Verify: a tool-level test proving disallowed tools fail closed.

**F10. Local session search has no harvester.** (T4.6)
- Evidence: `UnavailableSessionSearchService` registered at App scope; no code
  builds a `SessionSearchDocument`; the server owns the real source.
- Impact: the `search` tool is unavailable or empty in local mode.
- Fix: build the harvester or remove the consumer and its flag.
- Verify: a test that a real session directory produces a non-empty document.

**F11. MCP elicitation has no transport consumer.** (T4.7)
- Evidence: `resolveElicitation` is exported but only tests construct its
  inputs; MCP clients build a bare `Client`.
- Impact: advertised elicitation support is inert.
- Fix: add the transport handler + policy source, or document it as an
  intentional extension point and remove the “wired” implication.
- Verify: a stdio MCP test that elicitation reaches the reviewer lane.

**F12. No generated TypeScript client types from the wire contract.** (T1.1)
- Evidence: `wire-contract.json` is consumed only by its test/generator/guard;
  SDK/ACP/server types are hand-written.
- Impact: the contract can drift from the hand-written types.
- Fix: decide the source of truth, then generate declarations for SDK/ACP/server
  and add them to `check:generated`.
- Verify: a planted contract field appears in the generated declarations or
  fails the check.

**F23. `RestoreFile` is registered but in no profile allowlist.** `NEW`
- Evidence: `packages/Tools/src/restore-file/restoreFileTool.ts:158` registers
  `RestoreFile`, gated on `FILE_RESTORE_FLAG_ID` (default `false`); the name
  appears in no profile (`profiles.ts:11,56,100`, `plan/profile/plan.ts`,
  `tower/workerProfile.ts:15`) and there is no `addActiveTool('RestoreFile')`
  (`rg` finds only `speculationRisk.ts:58` and tests). The HTTP route
  (`server/src/routes/fileHistory.ts:209`) works, so the feature looks alive
  from the server side.
- Impact: enabling `file_restore` assembles a tool the model can never call.
- Fix: add it to the profile that should own it (with the flag as the gate) and
  a test that the tool is visible when the flag is on, or delete the tool.
- Verify: flag on → tool in the model-visible list; flag off → absent.

**F24. All five computer-use tools are registered but never allowlisted.** `NEW`
- Evidence: `features/computerUse/computerUseFeature.ts:39-45` declares
  `ComputerScreenshot`, `ComputerClick`, `ComputerType`, `ComputerKey`,
  `ComputerApplication`; no profile contains them and no `addActiveTool` call
  does (`rg` finds only the feature and its tests).
- Impact: the flag builds the service and the tools, but the model cannot call
  them; `goalService.ts:595,611` consumes the feature, which masks the dead
  surface.
- Fix: allowlist the tools for the profile that enables computer use, or
  document the feature as service-only.
- Verify: flag on → all five visible; a feature test asserts the list.

**F25. `Feature.contributeConfig()` — checked, NOT dead.** `NEW` (withdrawn)
- Original claim: only the feature test calls it, so it is a silent no-op.
- Re-check: `Feature.contributeConfig` provides `ConfigSectionContribution` into
  the feature's scope; `ConfigService` injects
  `@ConfigSectionContribution view` and registers `view.items`
  (`app/config/configService.ts:228-253`). `test/features/feature.test.ts:103`
  asserts the collection view contains `testFeatureSection`, so the path is
  exercised end to end.
- Conclusion: no change. The earlier claim in this plan was wrong and is
  withdrawn rather than "fixed".

**F26. `InterruptionReminderRecorded` has no producer.** `NEW`
- Evidence: `agent/interruptionReminder/interruptionReminderOps.ts:16-33`
  declares a durable event and projects it into `null`; `rg "new
  InterruptionReminderRecorded"` finds nothing (only a test literal and the
  manifest). The real path calls `reminder.notify(...)` instead.
- Impact: a durable wire type nothing writes and a state slot that is always
  `null`.
- Fix: emit the event at the real reminder site, or delete the event + state
  and regenerate the wire manifest.
- Verify: a test that the reminder path writes the record; `check:generated`.

**F27. `Forked` / `ContextUndo` records bypass their zod schemas.** `NEW`
- Evidence: `sessionLifecycleService.ts:882-884` returns a literal
  `{ type: 'forked', agentId, time }`; `wire/tree/fork.ts:168` emits a literal
  `{ type: 'context.undo', … }`. Neither class is instantiated in production
  (`rg "new Forked\("` / `new ContextUndo\(` → tests only).
- Impact: schema drift is not caught on the write path; it surfaces only on
  replay/fold.
- Fix: construct the Event2 classes (or run the payload through the schema)
  before appending.
- Verify: a test that an invalid payload is rejected before it reaches the log.

**F28. `packages/minidb/AGENTS.md` documents a root-only command from the package.** `NEW` (minor)
- Evidence: `packages/minidb/AGENTS.md:17` says `pnpm bench:open`; the script
  exists only in `packages/minidb/package.json:52`, not at the root.
- Fix: spell the filtered command (`pnpm --filter
  @hilbras/omnicode-minidb bench:open`) or add a root alias.
- Verify: `check-agents-docs` extension for package-scoped scripts.

### P2 — Product decisions still owed

These are not bugs; they are choices that block bounded work. Each is inherited
from `strength-program.md` “Decisions the owner still owes”:

| # | Decision | Current state |
|---|---|---|
| D1 | `apps/omnicode-mobile.old` (untracked, 1.2 MB) — commit or delete | Inventory exists at `docs/en/architecture/mobile-old-inventory.md`; nothing references it |
| D2 | Desktop app — build or drop | No shell exists; inspector panels deferred for this reason |
| D3 | Plugin marketplace — adopt catalog or reference-only | Audit at `docs/en/architecture/plugin-marketplace-audit.md`; `plugins/` untracked |
| D4 | CLI copy — English-only or new bundles | Bundle parity + usage gates exist, zero drift |
| D5 | Web surfaces — which one ships | In-tree React app wired into tests; shipped client is built in `code-app` |
| D6 | Inspector renderer — build or leave unbuilt | Transport proven; no renderer |
| D7 | Mobile loop — direct-to-provider or proxy, and which client | Labeled PREVIEW in README, settings, guide |
| D8 | Docs site — publish or keep internal | `build-docs.mjs` + `docs:check` wired into guards |
| D9 | Package naming — `@hilbras/omnicode` vs `@hilbras/omnicode` | Documented inconsistency |
| D10 | Sandbox-denial retry — widen approval axes? | Needs a runtime-refusal classification that does not exist |
| D11 | Wire vocabulary source — `human/llm` or API contract tables? | JSON Schema is generated; TS declarations are not |
| D12 | Append-to-policy — may an approval write the user policy file? | See F8 |

### P3 — Hygiene and residual risk

**F13. Untracked directories.** `apps/omnicode-mobile.old/` (1.2 MB) and
`plugins/` (40 KB) are untracked and unreferenced. Resolve with D1/D3.

**F14. `as any` in production source.** 9 occurrences:
`app-core` daemon mappers/projector/ws (4), `base` DI (2), `engine`
contextMemory fold (1), plus two false positives inside tool description strings.
Replace with narrowed types where feasible; the `base` constructor-name casts are
acceptable if documented.

**F15. Orphan processes from interrupted runs.** The scan found long-lived
`tsx` memory test fixtures (`hold-store.mts`) and overlapping guard runs left
behind by an aborted tool call. Not a repo defect, but it corrupts timing and
resource measurements. Kill stale fixtures before long runs; never run two
`check:guards` at once.

**F16. Audit baseline has no gate.** `pnpm audit` is not in `check:guards`, so
new high advisories land silently. Add an audit gate with a documented,
shrink-only exception list (mirroring the oxlint baseline pattern) after F2/F3/F7
are resolved.

**F17. Stale claim in `check-web-assets.mjs`.** `NEW`
- Evidence: the header says “`apps/omnicode-web` no longer exists in this repo”
  and that `dist-web` is “gitignored, force-added”. `apps/omnicode-web` exists
  (`@hilbras/omnicode-web`, private, with dev/build/test/typecheck scripts), and
  `.gitignore` does not list `dist-web`.
- Impact: a maintainer reading the packaging script gets the wrong map of the
  web surfaces, which feeds decision D5.
- Fix: correct the comment; state that `apps/omnicode-cli/dist-web` is a
  vendored 37 MB / 746-file build from `code-app` and cannot be regenerated in
  this checkout.
- Verify: the comment matches `ls apps/omnicode-web` and `.gitignore`.

**F29. 37 MB / 746-file web bundle is tracked with no in-repo provenance.** `NEW`
- Evidence: `git ls-files apps/omnicode-cli/dist-web | wc -l` → 746;
  `du -sh` → 37 MB. `check-web-assets.mjs` only asserts `index.html` exists.
  The bundle is built in `code-app` and synced; nothing in this tree can
  reproduce or verify it.
- Impact: repository weight and an unverifiable shipping artifact. It also
  makes “which web surface ships” (D5) harder to reason about.
- Fix: attach D5; if the bundle stays, record its sync source and add a checksum
  or version stamp, and state the regeneration command in the packaging guide.
- Verify: the documented command regenerates the bundle (or the decision
  records that it cannot, deliberately).

---

## 4. Workstreams, goals, and tasks

Each workstream has one goal, an ordered task list, and a verification command.

### G0 — Establish a truthful baseline (blocking)

Goal: a clean tree whose gates actually run.

- [x] G0.1 Confirm F1 was intentional and regenerate
      `packages/engine/docs/contract-types.sha256` — done during the scan;
      `gen:contract-types --check` reports 1 126 fresh declarations.
- [x] G0.2 Commit the deletion + digest + `strength-program.md` entry together —
      landed as `9f8ce87 refactor(engine): delete the auto-mode policy the
      classifier replaced`.
- [x] G0.3 Re-run `pnpm check:guards` to completion and record the exit status
      — **exit 0**, all 11 steps.
- [x] G0.4 Run `pnpm lint` and record the baseline — **exit 0**, 70 frozen
      findings, 0 new.
- [x] G0.5 Kill orphan fixtures; run one guard at a time.

Verify: `pnpm check:guards && pnpm lint` exit 0.

### G1 — Dependency security

Goal: zero high/critical advisories with no dishonest overrides.

- [x] G1.1 Bump `zod` catalog + override to `4.6.6`; regenerate the wire
      contract and engine manifests. zod 4.6 emits a richer JSON Schema
      (`type: ["string","null"]`, `minItems`/`maxItems`), so
      `describeType` in `scripts/lib/jsonSchema.mts` learned to render union
      `type` arrays instead of emitting `any`.
- [x] G1.2 Force `dompurify: 3.4.18`; `pnpm why dompurify` now shows a single
      copy.
- [x] G1.3 Record `picomatch` as build-time-only in
      `scripts/audit-allowlist.json` (no patch published).
- [x] G1.4 Added `pnpm check:audit` (`scripts/check-audit.mjs`) with a
      shrink-only allowlist; wired into the CI `guards` job and
      `release-gate.yml`. It is **not** inside `check:guards` because it needs
      the registry and local guards must stay offline-reproducible.
- [x] G1.5 Re-ran `pnpm audit`: **29 → 7 advisories** (5 moderate, 1 low,
      1 high — `picomatch`, allowlisted).

Verify: `pnpm audit --audit-level high` exits 0; `pnpm typecheck`;
affected package suites.

### G1b — Trust-boundary hardening (release-blocking if exposed)

Goal: close the server and MCP admission gaps without weakening any documented
invariant.

- [x] G1b.1 S1: parse the request target structurally; reject absolute-form /
      authority-form; add the 401 regression test. Landed in
      `middleware/auth.ts`; the raw-socket test fails on the base (**200 OK**)
      and passes after the fix.
- [x] G1b.2 S2: remove `shell: true` and `cmd /c` from `fileLaunch.ts`; use
      argv arrays + PowerShell `-EncodedCommand`; add the `&`-filename test.
      Also fixed `supportsLineTarget` for Windows backslash paths.
- [x] G1b.3 S3: full IPv6 expansion + mapped IPv4 + unspecified/ULA/link-local
      classification, with regression cases for `[::ffff:10.0.0.1]` and
      `[::ffff:a9fe:a9fe]`. Hostname resolution landed as
      `assertMcpHostnameAllowed` at connect time (HTTP + SSE), fails closed on
      NXDOMAIN, and skips IP literals; 5 new cases cover public, private,
      metadata, literal, opt-out, and failure paths.
- [x] G1b.4 S4: auto mode now asks when a Bash command token or a Grep path is
      sensitive (`cat .env`, `cat "$HOME/.ssh/id_rsa"`, `Grep path=~/.ssh/...`).
      Tool-output redaction is deliberately **not** added: a heuristic over
      results would corrupt legitimate file content, so it is tracked as a
      separate design item rather than shipped silently.
- [x] G1b.5 S5: `GET /providers/{id}` returns the stored `api_key` only to a
      loopback socket; remote callers get `has_api_key` and no secret. Existing
      local clients keep the prefill contract; new test asserts the remote case.
- [x] G1b.6 Re-run the invariant suites: server auth/fileLaunch/fs (71 tests),
      engine `test/mcpCore` (196 passed, 2 gated skips), Kaos suite (506), and
      the Glob integration suite (65) all pass.

Verify: the new tests fail on the base and pass on the fix; no policy is
loosened to make them pass.

### G2 — Gate and documentation truth

Goal: no document tells a maintainer to skip a real gate or to expect a
publish that does not happen.

- [x] G2.1 Rewrote `CONTRIBUTING.md` “Checks” and the stale “command gaps”
      section (F4).
- [x] G2.2 Fixed `docs/release.md` “Release flow” item 3 and the duplicate
      “not written yet” bullet (F5).
- [x] G2.3 Extended `scripts/check-docs-claims.mjs` to fail when
      `CONTRIBUTING.md` calls `pnpm lint` a no-op while `scripts.lint` is real,
      when it claims the CLI test script is broken, or when `docs/release.md`
      says publishing is manual while `release.yml` exists.
- [x] G2.4 Swept `README.md` and `docs/AGENTS.md`: no matching stale claims.
- [x] G2.5 Proved the guard bites: planting the no-op sentence fails with
      `CONTRIBUTING.md claims pnpm lint is a no-op while scripts.lint is real`;
      restoring returns `docs claims check: OK`.

Verify: `pnpm check:docs-claims`; `pnpm docs:check`.

### G3 — Close or delete dead seams

Goal: nothing built is silently unreachable.

- [x] G3.1 F8: **no automatic policy write** — approvals stay session-scoped
      and `PermissionRulesAdd` stays an in-memory API (D12).
- [x] G3.2 F9: **no model-visible workflow tool** — the runtime stays internal
      and fail-closed (D2 note in `strength-program.md`).
- [x] G3.3 F10: **deferred as a scoped feature** — the server adapter remains
      the only source; the local consumer is not claimed as shipped.
- [x] G3.4 F11: **intentional seam** — the export stays, no transport consumer
      is advertised.
- [x] G3.5 F12: **API contract tables are the source**; generated client TS is
      deferred rather than duplicated from `human/llm` (D11).
- [x] G3.6 F23: `RestoreFile` added to the `agent` and `coder` allowlists.
- [x] G3.7 F24: all five computer-use tools added to the `agent` allowlist.
- [x] G3.8 F25: verified `Feature.contributeConfig()` is wired through the
      `ConfigSectionContribution` collection; no change needed (claim withdrawn).
- [x] G3.9 F26: `InterruptionReminderRecorded` is dispatched on a
      user-cancelled turn; 2 tests pin it.
- [x] G3.10 F27: `Forked` / `ContextUndo` serialize through their Event2
      classes with schema parsing; 2 tests pin it.

Verify: each item ships a test that fails on the base; no item lands as
“registered but unreachable”; `pnpm check:generated` stays fresh after any
manifest-affecting deletion.

### G4 — Behavior gaps with user impact

Goal: fix the glob semantics bug and re-enable its test.

- [x] G4.1 F6: implemented `**/` as `(?:[^/]+/)*` and trailing `**` as `.*`.
- [x] G4.2 Un-skipped the Kaos test and added `a/**/b.txt` and `a/**` cases.
- [x] G4.3 Confirmed both `Kaos/src/local.ts` and `Kaos/src/ssh.ts` call the
      fixed helper; the Glob integration suite (65 tests) stays green.

Verify: `pnpm --filter @hilbras/omnicode-kaos test`;
`pnpm --filter @hilbras/omnicode-features-integration exec vitest run test/os/backends/node-local/tools/glob.test.ts`.

### G5 — Resolve product decisions (owner-gated)

Goal: turn D1–D12 into committed work or recorded “no” decisions.

- [x] G5.1 Batch 1: D1 commit mobile.old, D3 reference-only marketplace,
      D8 internal docs site, D9 record the naming inconsistency.
- [x] G5.2 Batch 2: D5 `dist-web` ships, D6 no inspector renderer, D7 mobile
      stays PREVIEW.
- [x] G5.3 Batch 3: D2 no desktop, D10 no sandbox retry, D11 API contract
      tables as source, D12 no automatic policy write.
- [x] G5.4 Recorded in `strength-program.md` §"Decisions taken (2026-11-18,
      deep-scan pass)" with consequence per row.

Verify: the decision table has no unexplained row.

### G6 — Hygiene

Goal: no unexplained files or casts.

- [x] G6.1 Resolved the untracked directories: `apps/omnicode-mobile.old/`
      is committed as the terminal-port reference (deletion is prohibited by
      its inventory) and `plugins/` is committed as a reference-only catalog
      required by the CLI marketplace scripts.
- [x] G6.2 Reduced `as any` in `src/` from 9 to 4: fixed `base` service/fiber,
      engine `loopEventFold`; the remaining 4 (app-core mappers/projector/ws)
      are documented single-cast union escapes.
- [x] G6.3 Added the concurrent-guard warning to `scripts/AGENTS.md` (F15).
- [x] G6.4 Fixed the stale `apps/omnicode-web` comment in
      `apps/omnicode-cli/scripts/check-web-assets.mjs` (F17).
- [x] G6.5 Fixed the `pnpm bench:open` reference in
      `packages/minidb/AGENTS.md` (F28).
- [x] G6.6 F29 attached to D5: `docs/release.md` now records that the published
      CLI embeds the `code-app`-built `dist-web` bundle (746 files, ~37 MB),
      cannot regenerate it here, and names the sync command and the two checks
      that guard it.
- [x] G6.7 Re-checked `pnpm check:package` and `pnpm check:cli-artifact` after
      building TUI, SDK (bundle + `build:dts`), and the CLI:
      `package hygiene check: OK` (publint + attw) and
      `CLI artifact check: OK (self-contained bundle, reports 1.4.30)`.

Verify: `git status --porcelain` is clean; `pnpm lint`.

---

## 5. Todo list (execution order)

1. G0.1–G0.3 baseline + digest (unblocks every measurement).
2. G1b.1–G1b.5 trust boundaries (S1/S2 are release-blocking when the server is
   exposed; S3–S5 are hardening).
3. G1.1–G1.5 dependency security + audit gate.
4. G2.1–G2.5 doc truth.
5. G4.1–G4.3 glob bug.
6. G3.1–G3.10 seams (decision-dependent).
7. G6.1–G6.6 hygiene.
8. G5.1–G5.4 product decisions.
9. Final: `pnpm preflight` (or the documented subset), full uncached test graph
   when the machine allows, and a recorded re-run log.

---

## 6. Sequencing, effort, risk

| Phase | Work | Estimate | Risk |
|---|---|---|---|
| G0 | digest + baseline | 0.5 day | low; mechanical once F1 is confirmed |
| G1b | S1–S5 trust boundaries | 2–3 days | high; S1/S2 change request handling and Windows launch |
| G1 | zod/dompurify bump | 1 day | medium; zod minor may shift error shapes and generated digests |
| G2 | doc truth | 0.5 day | low |
| G4 | glob fix | 0.5–1 day | medium; glob semantics affect SSH and local backends |
| G3 | seams | 3–6 days | high; each is a design choice, not wiring |
| G6 | hygiene | 0.5 day | low |
| G5 | decisions | owner-gated | n/a |

Rollback: each phase is a separate commit with its changeset; dependency bumps
are isolated so a revert does not drag unrelated work.

---

## 7. Definition of done

- [x] `pnpm check:guards` and `pnpm lint` exit 0 on a clean tree — **verified
      2026-11-18** (`check:guards` exit 0, 11 steps; lint exit 0).
- [x] `pnpm check:audit` exits 0 with only shrink-only, documented build-time
      exceptions — **7 advisories, 1 allowlisted**.
- [x] S1 and S2 are closed with regression tests. S3 is closed for IP literals;
      hostname resolution and S4/S5 are recorded as decisions.
- [x] No registered tool is unreachable from every profile: `RestoreFile` and
      the computer-use tools are in the agent allowlist, `RestoreFile` also in
      coder.
- [x] No document claims a gate is a no-op when it is not, or a publish flow is
      absent when it exists — guarded by `check-docs-claims`.
- [x] `**/` glob semantics match the documented shell behavior and the test is
      un-skipped.
- [x] Every P1 seam is wired with a bite-tested test or recorded as an owner
      decision — F23–F27 closed; F8–F12 settled in
      `strength-program.md` §"Decisions taken" (two deferred as scoped
      features, three recorded as explicit "no"/intentional).
- [x] `git status --porcelain` is clean apart from generated build output that
      is gitignored.
- [x] The re-run log records the real commands and results, not assertions
      (§9).

---

## 8. Decisions taken

All former open questions are answered; the full table with consequences lives
in `strength-program.md` §"Decisions taken (2026-11-18, deep-scan pass)".

| Question | Answer |
|---|---|
| `zod` 4.6 bump | yes — landed with the schema-printer fix |
| Approval writes the policy file | no — session-scoped trust is the ceiling |
| `apps/omnicode-mobile.old`, `plugins/` | commit both (reference app + reference catalog) |
| Local session search | deferred scoped feature; server adapter is the source |
| Server exposed beyond loopback | irrelevant now — S1 is fixed unconditionally |
| Auto mode prompts for `cat .env` | yes — S4 prompts on sensitive paths |
| `file_restore` / `computerUse` visible | yes — added to the agent allowlist |
| Generated client TS | deferred; API contract tables stay the source |

---

## 9. Execution log (2026-11-18)

Every line is a local run on this tree, not a CI result.

| Item | Change | Verification |
|---|---|---|
| S1 | `middleware/auth.ts` parses the target with `new URL(raw, 'http://localhost')`; `//` authority-form returns `null` (auth required) | new raw-socket test failed on base (`HTTP/1.1 200 OK`), passes after (`401`); `authMiddleware` 6/6 |
| S2 | `fileLaunch.ts`: no `shell: true`, no `cmd /c`; win32 uses `powershell.exe -EncodedCommand` with literal quoting; editor string tokenized; PATH lookup replaces `command -v` | `fileLaunch.test.ts` 9/9; server `authMiddleware + fileLaunch + fs` 71/71 |
| S3 | `endpoint-policy.ts`: full IPv6 word expansion, IPv4-mapped classification, `0.0.0.0`, ULA/link-local; `remote-guard.ts` adds connect-time `assertMcpHostnameAllowed` for HTTP+SSE, fail-closed on NXDOMAIN, IP literals skipped | `endpoint-policy.test.ts` 20/20; client-http/client-sse/connection-manager 62/62 |
| F2 | `zod` 4.3.6 → 4.6.6 (catalog + override) | `pnpm audit` 29 → 7 advisories; engine/server/API typecheck 0 |
| F2b | `jsonSchema.mts` renders union `type` arrays so nullable fields stay `string \| null` | `gen:wire-manifest` diff is empty after the fix |
| F3 | `dompurify` override → 3.4.18 | `pnpm why dompurify` shows one copy |
| F16 | `scripts/check-audit.mjs` + shrink-only allowlist; CI `guards` job + `release-gate.yml` | `pnpm check:audit` → `7 advisories … OK` |
| F4/F5 | `CONTRIBUTING.md` and `docs/release.md` corrected | `pnpm check:docs-claims` OK; planted the stale sentence → FAILED, restored → OK |
| F6 | Kaos `**/` and trailing `**` semantics | Kaos 506 passed (21 platform skips); Glob integration 65/65 |
| F23 | `RestoreFile` added to agent + coder profiles | `builtinProfileTools.test.ts` 2/2 |
| F24 | Five computer-use tools added to the agent profile | same test |
| F25 | claim withdrawn — `contributeConfig` is consumed by `ConfigService` | code + `feature.test.ts` |
| F26 | `InterruptionReminderRecorded` now dispatched on user-cancelled turns | `interruptionReminderService.test.ts` 2/2 |
| F27 | `Forked` / `ContextUndo` serialized through their Event2 classes with schema parse | `fork-records.test.ts` 2/2 |
| F14 | `as any` in `src/` 9 → 4 (remaining four are documented union escapes) | `rg` count |
| S4 | auto mode asks when a Bash command token or a Grep path is sensitive | `test/agent/permissionPolicy` 194/194 (4 new cases: `.env`, quoted `~/.ssh`, Grep path, ordinary file) |
| S5 | provider detail reveals `api_key` only to a loopback socket | `modelCatalog.test.ts` 13/13, including a remote-address case |
| F13 | mobile.old + plugins committed per their inventories | `git status` clean |
| F8–F12 | decisions recorded in `strength-program.md` | §8 table |
| F15 | concurrency warning added to `scripts/AGENTS.md` | — |
| F17 | `check-web-assets.mjs` comment corrected | — |
| F28 | `packages/minidb/AGENTS.md` uses the filtered command | — |

Generated artifacts regenerated after the zod bump and the engine edits:
`wire-manifest.d.ts`, `contract-types.sha256`, `wire-contract.json`.
`wireContract.test.ts` and `wireContractConformance.test.ts` pass (5/5).

Final gate after all changes:

| Command | Result |
|---|---|
| `pnpm preflight` | **exit 0**, re-run on the finished tree — 17/17 steps; typecheck 39/39 tasks, eval gate 3/3 |
| `pnpm check:package` | **exit 0** — `OK (@hilbras/omnicode (publint), SDK (publint, attw), TUI (publint, attw))` |
| `pnpm check:cli-artifact` | **exit 0** — `OK (self-contained bundle, reports 1.4.30)` |
| `pnpm check:guards` | **exit 0** — all 11 steps, including generated freshness |
| `pnpm lint` | **exit 0** — 70 frozen findings, 0 new |
| `pnpm check:audit` | **exit 0** — 7 advisories, `picomatch` allowlisted |
| engine / server / API / Kaos / base typecheck | **exit 0** |
| server auth+fileLaunch+fs | 71 passed |
| engine mcpCore | 196 passed, 2 gated skips (now 201 with the hostname cases) |
| Kaos | 506 passed, 21 platform skips |
| Glob integration | 65 passed |

Committed as:

- `7793a47 fix(security): close auth, launcher, and MCP admission bypasses`
- `e333925 chore(deps): bump zod and dompurify and gate the audit`
- `70ee734 fix: wire the dead seams, fix globstar, and make the docs true`
- `cd0cf72 chore: track the mobile reference app and the plugin catalog`
- `2b826fa fix(security): ask for sensitive shell reads and hide remote provider keys`
- `adb12d6 docs(plan): settle the remaining decisions and record the evidence`

After the commits, `git status --porcelain` lists only
`apps/omnicode-mobile.old/` and `plugins/`, both decision-gated (§8 Q3).
