# LLM Memory Writer Plan

Status: active
Scope: replace pattern-only memory capture with a post-turn memory writer that
detects what is worth remembering, proposes structured operations, and stores
only what is anchored to the user's own words. Touches `packages/memory` (port,
validation, service, flag, tests), the memory feature registration, and the
config manifest. Does not let a model mint trusted memory: a quote check gates
every trusted write.

Continues `user-profile-memory-plan.md`; the pattern lane stays as the
zero-cost fallback.

---

## 1. Goal

**Objective.** After a turn, the assistant decides for itself that a durable
fact about the user is worth keeping — without a fixed list of phrasings — and
the next turn already knows it, while a hallucinated or inferred “fact” can
never be stated as truth.

**Measurable completion.**

| # | Outcome | Measure |
|---|---|---|
| O1 | Detection is model-driven | a turn with an unlisted phrasing (“I run a bakery in Cairo”) yields a save proposal |
| O2 | Trust is anchored | a save is stored only when its `quote` is a verbatim substring of the user message |
| O3 | No hallucinated facts | a proposal without a matching quote is rejected and logged |
| O4 | Updates supersede | a later statement on the same subject replaces the earlier value |
| O5 | Cost is bounded | one auxiliary call per non-trivial completed turn, isolated from chat state |
| O6 | Nothing regresses | `check:guards`, `lint`, memory tests, `preflight` green |

**Decision taken.** Use the agent’s model with `isolated: true` and a small
output cap for the first version; a dedicated cheap model alias can be set later
without changing the port.

**Non-goals.** Letting the writer promote memory; storing assistant-inferred
facts as trusted; replacing retrieval or ranking.

---

## 2. How it works

```
TurnEnded(completed)
  → AgentMemoryWriterService (agent scope)
      1. skip trivial turns / flag off / injection disabled
      2. collect last user message, last assistant message, current profile
      3. requester.request({ systemPrompt, messages, tools: [], isolated: true })
      4. parse JSON ops (save | update | forget | none)
      5. validate: quote ∈ user message, subject shape, no secrets,
         no instruction-shaped content, length caps
      6. capture(origin: 'user', sourceType: 'user_statement' | 'user_correction',
                 category: fact | preference, subject, scope)
      7. emit MemorySaved
```

### Trust rule

The model proposes; the **user’s quote authorises**. A proposal without a
verbatim quote stays out. This is the same boundary the deterministic lane uses,
generalised from “the regex saw it” to “the writer found it and the user said it”.

### Subjects

- `profile.*` for facts about the user → global scope, injected every turn by
  the existing profile block.
- Any other subject (`project.stack`, `devserver.port`, …) → repository scope,
  reachable through `memory_search`, not injected as profile.

### Rejection reasons

`no_quote`, `quote_not_in_turn`, `secret`, `suspicious`, `invalid_subject`,
`too_long`, `unsupported_op`, `duplicate`.

---

## 3. Tasks

- [x] W1 Flag `memory_writer` (`OMNICODE_EXPERIMENTAL_MEMORY_WRITER`), default on.
- [x] W2 `src/writer/memoryWriter.ts`: op schema, JSON parser, deterministic
      validation, rejection reasons.
- [x] W3 `src/writer/memoryWriterService.ts`: `TurnEnded` subscription, turn
      collection, requester call, capture, `MemorySaved`.
- [x] W4 Register in `MemoryFeature` (agent scope); skip when the flag is off.
- [x] W5 Tests: detection, quote anchoring, rejection matrix, supersede,
      trivial-turn skip, flag off, requester failure.
- [x] W6 Docs: `packages/memory/AGENTS.md` (writer, trust rule, cost, escape
      hatch) and a changeset.
- [x] W7 Gates: memory tests, engine typecheck, `gen:config-manifest`,
      `check:guards`, `lint`, `preflight`.

## 4. Todo order

1. W1 → W2 → W5 (validation first; it is the safety core).
2. W3 → W4 (service and wiring).
3. W6 → W7.

## 5. Risks

| Risk | Mitigation |
|---|---|
| Model invents a fact | quote must be verbatim; no quote → rejected |
| Model stores a secret | redaction check rejects changed content |
| Prompt injection in the turn | writer sees text as data; instruction-shaped content rejected |
| Cost/latency per turn | trivial-turn skip, 512-token cap, isolated call, timeout |
| Writer failure | logged, turn unaffected; deterministic lane still runs |

## 6. Definition of done

- [x] “I run a bakery in Cairo” is saved as a trusted `profile.occupation`
      fact and injected on the next turn.
- [x] A fabricated proposal without a quote is rejected by name.
- [x] A later “I moved to Alexandria” supersedes the old location.
- [x] All gates in W7 pass and the work is committed.

---

## 7. Execution log (2026-11-18)

| Item | Change | Verification |
|---|---|---|
| W1 | `memory_writer` flag, default on, env `OMNICODE_EXPERIMENTAL_MEMORY_WRITER` | registered; `gen:config-manifest` clean |
| W2 | `src/writer/memoryWriter.ts`: zod op schema, fenced-JSON parser, deterministic validation, rejection reasons | 5 validation tests |
| W3 | `AgentMemoryWriterService`: `TurnEnded(completed)` → collect user/assistant/profile → isolated requester call (512 tokens, 15 s) → validate → capture → `MemorySaved` | 4 service tests with a fake requester |
| W4 | Registered as an agent-scope service in `MemoryFeature`; skips when the writer/memory flag is off or the turn is trivial | flag-off and trivial-turn tests |
| W5 | Detection without a pattern (quoted “I run a bakery in Cairo”), fabricated quote rejection, secret/instruction rejection, invalid subject, non-completed turn | `test/memoryWriter.test.ts` 9/9 |
| W6 | `packages/memory/AGENTS.md` documents the writer, trust rule, cost, and escape hatch; changeset added | `check:agents-docs` in guards |

The deterministic profile lane was also widened beyond the name: location,
timezone, occupation, employer, language, tools/preferences, and explicit
“remember that I …” notes, with stable `profile.*` subjects. Values stop at a clause boundary (`and`, `but`, `so`, `because`) so “I work as a backend engineer and I live in Cairo” yields two clean facts; a 20-case extraction suite covers the matrix.

Result: a turn the pattern list does not know (“I run a bakery in Cairo”) is
proposed by the model, accepted only because the quote is verbatim, stored as a
trusted `profile.occupation` fact, and injected on the next turn.

Final gate:

| Command | Result |
|---|---|
| `pnpm preflight` | **exit 0** on the second run — 17/17 steps; typecheck 39/39 |
| `pnpm --filter @hilbras/omnicode-memory test` | **296 passed** |
| `pnpm check:guards` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm check:audit` | exit 0 |

One flake, recorded rather than hidden: the first preflight run failed in
`packages/llm/test/stress.test.ts` (“step() dispatches 3 ToolCalls concurrently”)
because the observed completion order was `call-2, call-3` instead of
`call-3, call-2`. The file passes 3/3 in isolation and the full gate passes on
the next run; no memory, writer, or engine code is involved.

---

## 8. CI-gated corpus and turn-level opt-out

**Corpus.** `packages/memory/test/fixtures/writerCorpus.ts` holds **50 turns**
covering saves (name, address, location, timezone, language, occupation,
employer, preferences, tools, notes, project facts), skips (chit-chat, one-off
tasks, code questions, transient state), rejections (paraphrased/missing quote,
secret, instruction-shaped, invalid subject, empty/oversized content, duplicate,
unsupported op, junk response), updates (name, location, occupation, two
preferences), quoting edge cases (whitespace, punctuation, apostrophe,
non-Latin), mixed batches, and opt-outs. `test/writerCorpus.test.ts` runs it and
is wired into both the CI memory step and `preflight`'s `test:memory-lifecycle`.

**Opt-out.** `src/writer/memoryOptOut.ts` recognises `don't remember this`,
`off the record`, `forget this turn`, `keep this out of memory`,
`no memory of this`, and the equivalent `do not …` forms. It skips the writer
**and** the deterministic profile/preference/auto-capture providers, so a turn
marked off the record writes nothing. `forget my name` is deliberately not an
opt-out: it is a forget request the writer can act on.

Verification: memory suite **378 passed**, including the 50 corpus cases,
opt-out unit matrix, and the injection opt-out test.

Final gate after the corpus and opt-out: `pnpm preflight` **exit 0** (17/17,
typecheck 39/39), `check:guards` exit 0, `lint` exit 0, `check:audit` exit 0.

---

## 9. CLI end-to-end (2026-11-18)

Run against the configured model in an isolated home (`OMNICODE_V_HOME=.tmp/mem-clean`):

| Prompt | Observed |
|---|---|
| `my name is Hassan` | assistant greeted Hassan; `profile.name` "my name is Hassan" stored as `trusted` / `user_statement` |
| `what is my name?` (new process) | injected `Known about the user … my name is Hassan`; answered "Your name is Hassan." |

The first attempt used `OMNICODE_HOME`, which the CLI ignores: `ensureHome` sets
`OMNICODE_V_HOME` to `~/.omnicode-v`, so that run touched the real store. The
clean run used `OMNICODE_V_HOME` and started from an empty memory directory.

Two fixes came out of the run:

- **Exit flush:** the writer is tracked as auxiliary work; `-p` waits up to 15 s
  and the TUI up to 5 s before disposing the agent. Without it, the process could
  exit before the write.
- **Duplicate suppression:** the deterministic lane and the writer both captured
  the name, producing two `profile.name` records and a `conflicting` flag. The
  writer now skips a save whose subject already has a trusted record with the
  same fact (60% token overlap after stopwords). Re-running the clean flow leaves
  exactly one record and no conflict.

Unit coverage: `test/app/auxiliaryWork.test.ts` (wait + empty flush) and the
writer suite's duplicate test.
