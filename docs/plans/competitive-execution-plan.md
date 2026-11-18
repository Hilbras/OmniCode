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
gate honesty, kernel layering). By the end, OmniCode-V should match the
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
- [ ] P1.5 `--json-schema` + stream-json input + exit codes.
- [x] P1.6 coverage script + post-publish check.
- [ ] P2.1–P2.6.
- [ ] P3.1–P3.5.

## 6. Definition of done

- [ ] All Phase 1 items have a test that fails on the base.
- [ ] `pnpm check:guards`, `pnpm lint`, `pnpm preflight` pass after each phase.
- [ ] The study's "what not to copy" list is respected (no Rust rewrite, no
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

**Still open in Phase 1:** P1.5 (`--json-schema` + `--input-format stream-json`).
It needs a JSON-Schema validator and a stdin prompt-part reader; it is the next
slice, not a silently dropped item.
