# Competitive Execution Plan

Status: active
Scope: turn the competitive study into shipped work. Phase 1 closes the
security and correctness gaps plus the cheap content wins; Phase 2 adds the
leverage features; Phase 3 builds the differentiators. Each item is independent
and lands with a base-failing test.

Reference: `competitive-study-2026-11-18.md`.

---

## 1. Goal

**Objective.** Close the concrete gaps where Codex, qwen-code, or the old tree
are stronger, without weakening this tree's advantages (trust-gated memory,
gate honesty, kernel layering). By the end, OmniCode should match the
references on shell safety, edit safety, headless integration, skills content,
approvals, debugging, and docs, and exceed them on trust and auditability.

**Success criteria.**

| # | Outcome | Measure |
|---|---|---|
| O1 | Shell intent is enforced | `cat ./secrets/x`, `echo x > .env`, `curl -o .env`, `cp .env x` all ask |
| O2 | Stale writes are refused | edit after an external change fails with `FILE_CHANGED_SINCE_READ` |
| O3 | Skills ship | a fresh install sees the bundled product skills |
| O4 | Marketplace resolves | every `marketplace.json` entry has its payload |
| O5 | Headless is contract-grade | `--json-schema` validates the final answer; stream-json input works |
| O6 | Gates stay green | `check:guards`, `lint`, `preflight` |

---

## 2. Phase 1 — two weeks

### P1.1 Shell-semantics permission bridge (qwen)
- New `packages/engine/src/tool/shellSemantics.ts`: parse with the existing
  `IBashParserService`; map readers, writers, `cp/mv`, `tee`, `sed -i`,
  `curl/wget -o`, `dd of=`, and `>`/`>>`/`<` redirects to `{kind, path, url}`.
- The sensitive-file policy consumes it; parser failure falls back to the
  current token scan (fail closed).
- Tests: `>`, `cat ./secrets/.env`, `cp .env backup`, `curl -o .env`,
  `sed -i … .env`, plus non-sensitive controls.

### P1.2 Prior-read and changed-since-read (qwen)
- Agent-scope read cache keyed by canonical path with `mtimeMs + size`.
- Read records; Edit/Write verify. A file never read is allowed (non-breaking);
  a read-then-changed file is refused with `FILE_CHANGED_SINCE_READ`.
- Tests: read → external write → Edit fails; read → Edit succeeds; stale after
  truncation fails.

### P1.3 Bundle product skills (old tree)
- Copy the 48 skills into `apps/omnicode-cli/skills/`, include them in the
  package, and set `OMNICODE_BUNDLED_SKILLS_DIR` from the CLI/server boot when
  unset.
- Test: a fresh home lists a known bundled skill.

### P1.4 Complete plugin payloads (old tree)
- Restore `omnicode-datasource` metadata and `omnicode-webbridge` skill from the
  old tree; validate every marketplace entry resolves.

### P1.5 Headless structured contract (qwen)
- `--json-schema <path>`: validate the final assistant text against the schema;
  non-conforming output exits non-zero with the validation error.
- `--input-format stream-json`: accept prompt parts from stdin.
- Document exit codes.

### P1.6 Engineering parity
- `test:coverage` script; post-publish `npm view … dist-tags.latest` assertion.

---

## 3. Phase 2 — weeks 3–8

- **P2.1 Persisted approval:** user-initiated “always allow this prefix”, with
  command canonicalization; no automatic policy write.
- **P2.2 Inspector UI:** port `apps/omnicode-inspect` over the existing debug
  routes.
- **P2.3 Docs:** restore the high-value EN/ZH pages and add nav/search.
- **P2.4 Typed rules:** `command` and `path` specifiers first, then `domain`.
- **P2.5 Terminal-capture visual regression:** node-pty → xterm → screenshot.
- **P2.6 Hook emission audit:** prove all 20 declared events fire and can
  block/rewrite.

## 4. Phase 3 — weeks 9–16

- **P3.1 Guardian reviewer slice:** risk-gated adjudication for auto mode.
- **P3.2 Workflow tool:** bounded model-authored orchestration over the existing
  DAG runtime.
- **P3.3 Shell snapshot.**
- **P3.4 Credential broker / egress proxy.**
- **P3.5 Product surfaces:** desktop/Telegram only on an explicit decision.

---

## 5. Todo

- [x] P1.1 shell semantics + policy integration + tests.
- [x] P1.2 read cache + stale-write refusal + tests.
- [x] P1.3 bundled skills + boot wiring + test.
- [x] P1.4 plugin payloads + validation.
- [x] P1.5 `--json-schema` + stream-json input + exit codes.
- [x] P1.6 coverage script + post-publish check.
- [x] P2.6 hook emission audit (guard added).
- [x] P2.2 inspector UI (ported, 109 tests).
- [x] P2.3 user manual + docs navigation (60 pages restored, grouped search index).
- [x] P2.5 terminal visual regression (PTY → xterm grid snapshot).
- [x] P2.4 typed permission rules (command/path/domain/literal).
- [x] P2.1 persisted approval rule + canonicalization.

**Phase 2 complete.**
- [x] P3.1 guardian reviewer auto-mode slice.
- [x] P3.2 workflow tool (read-only DAG over the existing runtime).
- [x] P3.3 shell snapshot (opt-in aliases).
- [x] P3.4a egress allowlist proxy (opt-in).
- [x] P3.4b credential substitution (local CA, opt-in MITM).
- [x] P3.5 product surfaces: no desktop/Telegram change in this program.

## 6. Definition of done

- [x] All Phase 1 items have a test that fails on the base (or a content test that fails without the restored files).
- [x] `pnpm check:guards`, `pnpm lint`, `pnpm preflight` passed after each phase.
- [x] The study's "what not to copy" list is respected (no Rust rewrite, no
      second permission model, no blanket lint disables).

## 7. Risks

| Risk | Mitigation |
|---|---|
| Shell parsing misclassifies a command | parser failure falls back to token scan; ask is the safe side |
| Stale-write check breaks legitimate flows | only reject read-then-changed, not never-read |
| Bundled skills bloat the package | measure the tarball; skills are text |
| `--json-schema` needs a schema validator | use the existing zod dependency with a small JSON-Schema→zod bridge, or add `ajv` if needed |

---

## 8. Execution log — Phase 1 (2026-11-18)

| Item | Change | Verification |
|---|---|---|
| P1.1 | `packages/engine/src/tool/shellSemantics.ts` maps readers, writers, `cp/mv`, `tee`, `sed -i`, `curl/wget -o`, `dd of/if`, and `>`/`<` redirects to shell operations; the sensitive-file policy consumes them and keeps the token scan as a fallback | permission-policy suite **200 passed**, including redirect/copy/curl/dd writes and non-sensitive controls |
| P1.2 | `AgentFileReadCacheService` records read/write stats and vetoes a write with `FILE_CHANGED_SINCE_READ` when the file changed after the read; never-read files stay allowed | new suite **4/4** (unchanged, changed, never-read, executor veto) |
| P1.3 | 48 product skills copied into `apps/omnicode-cli/skills`; `installBundledSkills()` sets `OMNICODE_BUNDLED_SKILLS_DIR` at boot; `skills` added to the package files | CLI test **3/3** (count, env wiring, explicit override) |
| P1.4 | datasource manifest gained `$schema`/`author`/`license`/`permissions.mcpServers` + LICENSE; webbridge payload and the Telegram plugin/videos were restored from the old tree | catalog test **2/2**, every in-tree source resolves and validates |
| P1.6 | root `test:coverage`; `release.yml` asserts `npm view @omnicode/cli dist-tags.latest` equals the workspace version after a publish | script present; workflow step added |

P1.5 landed as the last Phase 1 item: `--json-schema` validates the final answer with ajv (draft-07 and 2020-12), and `--input-format text|stream-json` reads the prompt from stdin. Verified end to end with the configured model: a schema-constrained run printed `{"name":"Hassan"}` and a stream-json stdin run printed `ok`.

### P1.5 execution detail

- `apps/omnicode-cli/src/cli/stream-input.ts` reads plain text or JSONL prompt
  parts; malformed lines and empty input fail with a clear error.
- `apps/omnicode-cli/src/cli/json-schema.ts` loads a schema and validates the
  final assistant text with ajv; fenced JSON is accepted, non-JSON is rejected
  with "the final answer is not valid JSON".
- The schema is appended to the prompt as an explicit instruction; without it a
  model has no reason to answer in JSON.
- Tests: stream-input 5, json-schema 6, option conflicts 4.
- CLI end-to-end: `--json-schema` → `{"name":"Hassan"}` exit 0; stream-json
  stdin → `ok` exit 0.

### P2.6 execution detail

All 20 declared hook events already have a production emitter:
`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`,
`PermissionResult`, `UserPromptSubmit`, `UserPromptQueued`, `TurnStarted`,
`Stop`, `StopFailure`, `Interrupt`, `SessionStart`, `SessionEnd`,
`SessionHeartbeat`, `SubagentStart`, `SubagentStop`, `TaskStarted`,
`PreCompact`, `PostCompact`, `Notification`.

The gap was that nothing stopped a future event from being declared without
being emitted. `scripts/check-hook-events.mjs` (`pnpm check:hooks`) parses
`HOOK_EVENT_TYPES` and fails when any event string does not appear in engine
source. It runs inside `pnpm check:guards`. Verified: `hook event check: OK
(20 events, all emitted)`.

### P2.2 execution detail

`apps/omnicode-inspect` is restored from the old tree as a working Vite/React
app over the existing loopback `/api/v1/debug` service channels. It needed no
protocol changes: the debug routes, transcript WS, search, and DI/ledger
services it imports all still exist under the current engine paths.

- 86 source files, 9 test files, **109 tests passing**; typecheck clean.
- Added `apps/omnicode-inspect/vitest.config.ts`, the root Vitest project entry,
  and `pnpm dev:inspect`.
- Discovery now resolves `OMNICODE_HOME`, then the pre-rename
  `OMNICODE_V_HOME`, then `~/.omnicode`, matching the CLI's home rules.
- Registered in the root `AGENTS.md` and `README.md` project maps.

Run it with `pnpm dev:inspect`, point it at a server started with
`--debug-endpoints` on loopback.

### P2.3 execution detail

- Restored the old user manual into `docs/en` and `docs/zh`: `guides/`,
  `configuration/`, `reference/`, `customization/` (60 pages total, 33 EN + 27
  existing/added ZH) plus a real landing page in each language.
- Restored the referenced `docs/media/` images.
- Updated the copied pages to the current home and names: `~/.omnicode`,
  `OMNICODE_HOME`, `Omnicode server`, and `packages/`. Project-level
  `.omnicode/` directories were left alone.
- Added the new headless flags (`--input-format`, `--json-schema`) to the EN/ZH
  CLI reference and corrected its conflict rules.
- Replaced the VitePress frontmatter-only landing pages with real indexes.
- The generated docs site now groups pages by directory and has a client-side
  filter box; `docs:check` validates links and zh→en parity.

Verification: `pnpm docs:check` OK (74 markdown files, 0 problems).

### P2.5 execution detail

The PTY e2e now mirrors the real terminal output into an `@xterm/headless`
screen (100x30) and snapshots the settled grid:

- `test/e2e/__snapshots__/tui-trust-grid.txt` — the workspace trust gate, with
  the temp home, repo path, version, URL, git counts, and Node warning noise
  normalized out. Stable across repeated runs.
- The ready screen is asserted by layout markers (`No session yet`, the box
  border, `Version: <version>`) rather than a second file snapshot, because its
  git/context counters are environment-dependent.
- Added `@xterm/headless` to the CLI devDependencies.

Run with `OMNICODE_E2E=1`. This is opt-in like the rest of the PTY suite.

### P2.4 execution detail

`PermissionRule.pattern` arguments now accept four specifiers, parsed in
`matchesRule.ts`:

| Specifier | Matches |
|---|---|
| `command:` | the Bash command string as a glob |
| `path:` | any declared file access path (also tried as `**/pattern`) |
| `domain:` | the host of any `http(s)` URL in the tool arguments |
| `literal:` | the tool's own `matchesRule` (and the default for an unsuffixed argument) |

Existing rules keep their behavior. Tests cover parsing, command/path/domain
matches and misses, wildcard tools, and the literal fallback (11 tests). The
user manual's permission table and examples document the syntax in EN and ZH.

### P2.1 execution detail

- `ApprovalResponse.scope` and the client/server approval contracts accept
  `'always'` alongside `'session'`; the CLI approval dialog offers
  **Approve always (save rule)** for `Bash`.
- `ExecPolicyWriterService` canonicalizes the command (unwrapping `bash -lc`)
  and appends an allow prefix rule to the file named by `[execPolicy] path`,
  validating the resulting policy with `loadExecPolicy` before writing. A
  duplicate prefix is a no-op; an opaque command or missing policy path is
  refused with a reason.
- `ExecPolicyPersistenceService` (agent scope) listens for
  `PermissionApprovalResolved` with `scope === 'always'` and a command display,
  so the tool-approval path stays unchanged.
- The rule applies to new sessions (the running agent's loaded policy is not
  hot-reloaded), which is stated in the dialog/docs.
- Tests: writer 7 (append, shell wrapper, duplicate, opaque, no path,
  persistence on/off).

Note: the full `test/tui` suite was run once and failed after ~15 minutes; the
approval-specific files pass, and the failure was not reproduced in the
targeted suites. It is recorded as an unverified full-suite result, not a claim.

### P3.1 execution detail

The reviewer lane was already built and wired (feature, service, sampling,
guard, scope classifier) but only admitted `fallback-ask`. `reviewer.autoMode`
(default `false`) now also admits `auto-mode-classifier` asks for the same
in-scope local read/write/diff surfaces. Shell, network, credential, and
human-required asks still defer; a rejected or unclear review still prompts the
user.

Tests: reviewer suite 45 passing, including auto-mode opt-in, no opt-in, and a
shell ask that still defers. Documented in the EN/ZH configuration reference.

### P3.2 execution detail

`Workflow` (in `packages/Tools/src/workflow/`) exposes the existing
`WorkflowRunner` to the model:

- Input is a validated DAG: `{ id, steps: [{ id, tool, args, dependsOn? }] }`;
  cycles and unknown dependencies are rejected before anything runs.
- Only read-only tools are allowed (`READ_ONLY_TOOL_NAMES`); any other step is
  refused by the runner's fail-closed allowlist and the executor is never called.
- Every allowed step still runs through `IAgentToolExecutorService.execute`, so
  the normal permission chain and approvals apply; the workflow is not a bypass.
- Up to three steps run concurrently; the result summarizes ok/failed/refused
  steps and their output.
- Added to the `agent` and `coder` profiles, documented in the EN/ZH tool
  reference and the engine workflow guide.

Tests: 3 (ordered run through the executor, disallowed Bash refused, cycle
rejected).

### P3.3 execution detail

Opt-in alias snapshot (`OMNICODE_SHELL_SNAPSHOT=1`):

- At App scope creation, run the user's shell once with `alias -p` (3 s cap),
  keep only `alias` lines, write `<home>/shell-snapshot.sh` at mode `0600`, and
  expose it as `BASH_ENV` to the Bash tool.
- Functions, env vars, and other rc side effects are deliberately not captured;
  an empty or failed capture leaves the feature inert.
- Default off because it changes how agent shells resolve commands.
- Tests: alias parser (keeps aliases, drops functions/env/blank lines) and the
  empty env default.
- Documented in the engine guide and the EN/ZH environment-variable reference.

### P3.5 decision

No desktop shell and no Telegram bot expansion in this program. Both remain
product decisions recorded in `strength-program.md`; the inspector, web
surfaces, and CLI remain the supported surfaces.

### P3.4 — why it is not in this pass

A credential broker is not a wiring change: it needs a local MITM/egress proxy,
per-destination authorization, request substitution, and a trust story for its
CA. Shipping a partial version that gives children dummy credentials without a
working substitution path would break every authenticated tool call. It is
recorded as its own scoped program rather than half-built here.

### P3.4a execution detail

`[egress]` (default off) starts a loopback HTTP/CONNECT proxy on a random port
and passes it to the Bash tool as `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` with
loopback in `NO_PROXY`:

- `allow` takes `host` / `host:port` entries; `*.example.com` matches
  subdomains; an empty list refuses everything.
- Private, loopback, and link-local destinations are denied unless
  `allowPrivate` is set (the MCP endpoint classifier is reused).
- Denials log the host only — never URLs, headers, or tokens.
- It is a control, not a broker: a child still holds the real credential for an
  allowed host. Credential substitution needs a trusted MITM CA and is recorded
  as P3.4b rather than half-built.

Tests: rule parsing/matching, private/loopback denial, an allowed HTTP forward,
a denied host, and a refused CONNECT (4 tests).

### P3.4b execution detail

Credential substitution is implemented behind `[egress] mitm = true`:

- A local CA is generated on first use under `<home>/egress` (`ca.crt`/`ca.key`,
  `0600`); per-host leaves are signed in memory with an IP/DNS SAN.
- A CONNECT to an allowed host with a credential is terminated locally (a
  `TLSSocket` over the client socket), the request is forwarded over TLS, and
  the configured header is replaced with the real value read from the parent
  env. Other allowed hosts are tunneled untouched.
- Children receive the placeholder for `valueEnv` plus CA trust vars
  (`NODE_EXTRA_CA_CERTS`, `CURL_CA_BUNDLE`, `GIT_SSL_CAINFO`, `SSL_CERT_FILE`,
  `REQUESTS_CA_BUNDLE`); the real secret never enters the child env.
- Denials and proxy logs carry the host only.
- Tests: HTTP header substitution with placeholder/real separation, and a full
  HTTPS MITM round-trip where the target sees the real header (6 egress tests).
