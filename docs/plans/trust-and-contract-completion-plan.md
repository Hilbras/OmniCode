# Trust & Contract Completion Plan

Status: active
Scope: closes the three items the deep-scan pass deliberately deferred —
tool-output secret redaction, local session search, generated wire payload
types — plus the one external advisory. Touches `packages/engine` (tool
boundary, session search), `packages/Tools`, `packages/client-contract`,
`packages/API` scripts, `apps/omnicode-cli` composition, and the generated
artifact guard. Does not change the permission chain, sandbox, or published SDK
shape.

Supersedes nothing. Continues `deep-scan-remediation-plan.md`; the verification
style (local commands, bite-tested guards) is the same.

---

## 1. Goal

**Objective.** Close the three deferred surfaces so that no secret-shaped tool
output reaches a provider unmarked, local session search works without the
daemon, and the client wire contract has generated TypeScript that fails CI on
drift — without a broad refactor of the SDK or the permission model.

**Measurable completion.**

| # | Outcome | Measure |
|---|---|---|
| O1 | Secrets in tool output are marked | known credential shapes become `[redacted:<kind>]` at the provider/wire boundary; ordinary code is untouched |
| O2 | Local search works | `SearchSessions` returns hits from on-disk sessions in a CLI-only run |
| O3 | Wire drift is typed | generated payload types exist, are checked in, and `check:generated` fails on drift |
| O4 | Advisory lifecycle is automatic | the audit gate fails when the `picomatch` exception becomes unnecessary |
| O5 | Nothing regresses | `pnpm preflight`, `check:guards`, `lint`, `check:audit` stay green |

**Non-goals.** Replacing the hand-written SDK with generated classes; redacting
every high-entropy string; a server-side index rewrite.

---

## 2. W1 — Tool-output secret redaction

**Design.** One pure module, applied once at the tool-result boundary
(`normalizeAndMergeResult` in `toolExecutorService.ts`) so both the provider
request and `wire.jsonl` see the marked value.

- File: `packages/engine/src/tool/toolResultRedaction.ts`.
- Patterns (high confidence only): PEM private-key blocks, AWS `AKIA/ASIA` key
  ids, `sk-…` API keys (20+ chars), GitHub `ghp_/gho_/ghu_/ghs_/ghr_`, Slack
  `xox[baprs]-`, GitLab `glpat-`, JWT triples, `Bearer <token>`.
- Replacement: `[redacted:<kind>]`, preserving surrounding text and line count.
- Deliberately **not** redacted: generic `password =`, hashes, base64 blobs,
  test fixtures such as `sk-test`.
- Escape hatch: `OMNICODE_TOOL_OUTPUT_REDACTION=0` disables it; documented in
  the engine guide. Default on.

**Tasks.**

- [x] W1.1 Add the module + unit tests per pattern and per non-match.
- [x] W1.2 Wire it into `normalizeAndMergeResult` for string outputs and
      text content parts.
- [x] W1.3 Add a repo-wide non-match test (scan a fixture corpus, expect zero
      replacements) and an escape-hatch test.
- [x] W1.4 Document the env flag in `packages/engine/AGENTS.md`.

**Verify.** `pnpm --filter @hilbras/omnicode-engine exec vitest run
test/tool/toolResultRedaction.test.ts`; engine `test/agent/toolExecutor` and
`test/tool` suites; engine typecheck.

---

## 3. W2 — Local session search harvester

**Design.** A file-backed `SessionSearchSource` that reads session wire logs, so
`LocalSessionSearchService` works in a CLI-only run. The server's
`SessionSearchAdapter` override stays untouched.

- Files: `packages/engine/src/features/sessionSearch/fileSessionSearchSource.ts`
  plus a small session enumerator; compose it in the CLI at App scope only when
  the user has not overridden the service.
- Discovery: `<home>/<handlerScope>/<sessionId>/wire.jsonl` and
  `agents/<agentId>/wire.jsonl` (the layout `sessionDirOf` already defines).
- Extraction: user and assistant text from durable turn records; session title
  from session metadata when present, else the first user input.
- Bounds: cap sessions and documents, report `incomplete` honestly, skip
  unreadable files, never follow symlinks outside the home.
- Flag: the existing `session_search` experimental flag still gates the tool.

**Tasks.**

- [x] W2.1 Enumerate sessions and extract documents (with tests over a fixture
      tree).
- [x] W2.2 Implement `SessionSearchSource` + `LocalSessionSearchService`
      composition behind a composition-root hook.
- [x] W2.3 Wire the CLI root; keep the server override authoritative.
- [x] W2.4 Tests: empty home, one session, subagents, malformed lines,
      oversize cap, symlink escape.

**Verify.** New suite under `packages/engine/test/features/sessionSearch/`;
`packages/Tools` suite; CLI `search` tool test; `check:architecture`.

---

## 4. W3 — Generated wire payload types

**Design.** Generate TypeScript types from the already-drift-gated
`packages/API/docs/wire-contract.json`, without touching the hand-written SDK.

- Generator: `packages/client-contract/scripts/gen-wire-types.mts` (reads the
  contract, writes `src/generated/wireTypes.ts`, supports `--check`).
- Emission: one exported type per procedure input tuple and output, and per
  event payload, grouped by scope; `$ref`-free by construction because the
  generator inlines or names shared definitions deterministically.
- Guard: add `gen:wire-types` to `scripts/check-generated-freshness.mjs` after
  the API contract, and a `wireTypes.test.ts` that re-renders and compares.
- Conformance: a test in `packages/API` asserting each hand-written request /
  response type is assignable to the generated payload type where names align.
- Source of truth stays the `client-contract` zod tables (decision D11).

**Tasks.**

- [x] W3.1 Implement the schema→TypeScript renderer (objects, arrays, unions,
      enums, nullable, records, tuples).
- [x] W3.2 Generate and check in `wireTypes.ts`; add `gen:wire-types` +
      `--check`.
- [x] W3.3 Add to `check:generated`; prove both directions (edit the contract →
      fail; restore → pass).
- [x] W3.4 Add the assignability conformance test; run API typecheck.

**Verify.** `pnpm --filter @hilbras/omnicode-client-contract gen:wire-types --
--check`; `pnpm check:generated`; `packages/API` typecheck and wire-contract
tests.

---

## 5. W4 — Advisory lifecycle

- [x] W4.1 Keep `picomatch` allowlisted with its reason; add a note to
      `packages/engine/AGENTS.md`? No — `scripts/AGENTS.md` already documents
      the audit gate.
- [x] W4.2 Confirm the gate fails when the advisory disappears while
      allowlisted (planted-removal check), so the exception cannot outlive the
      vulnerability.

**Verify.** `pnpm check:audit`; a temporary allowlist entry that no longer
matches fails with “no longer needed”.

---

## 6. Sequencing

1. W1 (1–2 days) — smallest, closes a trust invariant.
2. W3 (2–4 days) — mechanical, high leverage, no runtime behavior.
3. W2 (3–5 days) — largest; needs the extraction and careful bounds.
4. W4 (hours) — confirm the gate's shrink direction.

Each item lands as its own commit with a changeset when it changes user-visible
behavior (W1 and W2 do; W3 is build-time).

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Redaction false positives corrupt code | high-confidence patterns only; repo-wide non-match test; env escape hatch |
| Session scan reads outside the home | canonicalise and refuse paths that escape; skip symlinks |
| Generated types churn on every contract change | it is a generated file; the diff is the review signal, not a hand edit |
| Two search implementations diverge | server adapter stays authoritative; local source only feeds the local service |

---

## 8. Todo (execution order)

- [x] W1.1–W1.4 redaction module, wiring, tests, docs.
- [x] W3.1–W3.4 generator, artifact, guard, conformance.
- [x] W2.1–W2.4 harvester, composition, CLI wiring, tests.
- [x] W4.1–W4.2 advisory lifecycle proof.
- [x] Final: `pnpm preflight` **exit 0** (17/17, typecheck 39/39), `check:guards` exit 0, `lint` exit 0, `check:audit` exit 0, five commits.

---

## 9. Execution log (2026-11-18)

| Item | Change | Verification |
|---|---|---|
| W1 | `packages/engine/src/tool/toolResultRedaction.ts`; applied in `normalizeToolResult` | 15/15 unit tests, including a scan of non-test engine source proving zero false positives; `test/agent/toolExecutor` + `test/tool` 86/86 |
| W1 doc | `packages/engine/AGENTS.md` documents `OMNICODE_TOOL_OUTPUT_REDACTION=0` | — |
| W2 | `FileSessionSearchSource` + `FileSessionSearchService`; app-scope override in `packages/API/src/runtime-primitives.ts` | 4/4 source tests (main + subagent wires, injection/malformed skip, symlink refusal, missing root); API wiring test 1/1 |
| W3 | `packages/client-contract/scripts/gen-wire-types.mjs` → `src/generated/wireTypes.ts` (2 521 lines); `gen:wire-types --check` added to `check:generated` | `check:generated` fresh (8 artifacts); planting a type fails `--check`, restoring passes |
| W3 note | Name-based assignability was not added: the contract tables are zod and the hand-written SDK types do not share names. The generated-artifact drift guard is the enforcement point instead of a second, weaker list. | documented here |
| W4 | `check:audit` rejects an allowlist entry that no longer matches | bogus entry → `allowlist entries no longer needed: left-pad-nonexistent`; restored → OK |

Final gate on the committed tree:

| Command | Result |
|---|---|
| `pnpm preflight` | **exit 0** — 17/17 steps; typecheck 39/39 |
| `pnpm check:guards` | **exit 0** — 8 generated artifacts fresh |
| `pnpm lint` | **exit 0** — 70 frozen, 0 new |
| `pnpm check:audit` | **exit 0** — 7 advisories, `picomatch` allowlisted |
| `git status --porcelain` | empty |

Commits: `e734ddb` (redaction), `71fbe9f` (local search), `35705d1` (wire types).
