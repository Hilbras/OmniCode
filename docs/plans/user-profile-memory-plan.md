# User Profile Memory Plan

Status: active
Scope: automatic, trusted capture of explicit user profile facts and their
injection into every turn, so the assistant does not need to be told to search
memory. Touches `packages/memory` (flag, extraction layer, injection provider,
tests) and the generated config manifest. Does not weaken the trust policy: only
explicit user statements become trusted; model-authored memory stays
`unverified` and is never injected as fact.

Continues `deep-scan-remediation-plan.md` and `trust-and-contract-completion-plan.md`.

---

## 1. Goal

**Objective.** When the user says “my name is Hassan”, the next turn already
knows it and answers “yes, your name is Hassan” without a `memory_search` call —
while a model-authored or unconfirmed claim can never be stated as fact.

**Measurable completion.**

| # | Outcome | Measure |
|---|---|---|
| O1 | Explicit profile facts are captured as trusted | “my name is Hassan” → a `trusted` `user_statement` record |
| O2 | They are injected automatically | a new turn contains a `User profile` block with the name, no tool call |
| O3 | Conflicting facts are resolved | a newer trusted name supersedes the older one; only the current value is injected |
| O4 | Trust is not loosened | model-authored and unverified records never appear in the profile block |
| O5 | Nothing captures secrets | a name-shaped secret is redacted and a `secret` record is never injected |
| O6 | Gates stay green | `check:guards`, `lint`, memory tests, `preflight` |

**Decision taken.** An explicit user statement is trusted immediately; the
one-time confirmation is reserved for conflicting trusted values. This is the
behavior that produces “yes, Hassan” on the next turn.

**Non-goals.** Promoting model-authored memory; embedding search; changing the
canonical approval flow.

---

## 2. Design

### 2.1 New lane, not a loosened gate

- Flag `memory_profile` (`OMNICODE_EXPERIMENTAL_MEMORY_PROFILE`), **default on**,
  escape hatch by env/config/flag like the other memory flags.
- Capture only explicit self-statements: name, preferred address, location,
  timezone. Pattern-based, deterministic, no model call.
- Captures use `origin: 'user'`, `sourceType: 'user_statement'`,
  `category: 'fact'`, `tier: 'distilled'`, `scope: { tier: 'global' }`, with a
  stable `subject` (`profile.name`, `profile.location`, `profile.timezone`).
- Injection lists active, trusted global fact/preference records and renders a
  compact block. It does not depend on prompt relevance, because the profile is
  small and always useful; everything else still uses relevance-filtered
  canonical injection.

### 2.2 Conflict rule

`subject` is the conflict key. A newer trusted value is strictly higher trust
than an older unverified model entry and supersedes it; two trusted values with
the same subject are resolved by the existing capture rule (newer
`user_correction` wins). If two trusted values still conflict, the block renders
both with a `conflicting` flag instead of picking silently.

### 2.3 What never changes

- `capture()` still caps `origin: 'model'` at `unverified`.
- Canonical approval is untouched.
- `secret`/`confidential` records are excluded from the block.
- The injected text is context, not instructions.

---

## 3. Tasks

- [x] P1 Flag `memory_profile` + registration + config manifest.
- [x] P2 `layers/profile.ts`: name / address / location / timezone extraction
      with stable subjects, deduped.
- [x] P3 `profileProvider` in `memoryInjectionService.ts`: capture on a new turn,
      list and render the trusted profile block on every turn.
- [x] P4 Tests: capture, injection without relevance, supersede, unverified
      exclusion, secret exclusion, flag off.
- [x] P5 Prompt/docs: note in `packages/memory/AGENTS.md`; a profile block
      example in the injection test.
- [x] P6 Final: `pnpm --filter @hilbras/omnicode-memory test`, engine typecheck,
      `check:generated`, `check:guards`, `lint`, `preflight`.

## 4. Todo order

1. P1 → P2 → P3 → P4 (the vertical slice).
2. P5 docs.
3. P6 gates and commit.

## 5. Risks

| Risk | Mitigation |
|---|---|
| Over-capture from prose | only explicit “my name / call me / I live in / my timezone” patterns |
| False trust | capture origin is user; no model path can reach trusted |
| Repeated block every turn | capped at 6 short entries, deduped by subject |
| Privacy surprise | flag on by default but named, documented, and one setting to disable |

## 6. Definition of done

- [x] A fresh session with “my name is Hassan” answers a later “what is my name?”
      from the injected profile, with no `memory_search` call. Verified at the
      injection boundary (capture → next-turn block); the model’s exact wording
      is not deterministic and is not asserted.
- [x] The same session with the flag off does not capture or inject (provider is not registered).
- [x] A model-authored `memory_save` of the name never appears in the block; a secret record is excluded too.
- [x] All gates listed in P6 pass (`preflight` exit 0, 17/17; memory 287/287).

---

## 7. Execution log (2026-11-18)

| Item | Change | Verification |
|---|---|---|
| P1 | `memory_profile` flag, default on, env `OMNICODE_EXPERIMENTAL_MEMORY_PROFILE` | flag registered; `gen:config-manifest` clean |
| P2 | `src/layers/profile.ts` extracts name / preferred address / location / timezone with stable `profile.*` subjects | covered through the injection tests |
| P3 | `profileProvider` captures on a new turn and injects trusted `profile.*` entries every turn; later values use `user_correction` so they supersede | `test/injection.test.ts` 16/16 |
| P4 | Tests: flag registration, capture + next-turn injection, rename supersede, model-authored exclusion, secret exclusion | same suite |
| P5 | `packages/memory/AGENTS.md` documents the lane, subjects, cap, and escape hatch | `check:agents-docs` in guards |
| P6 | Gates | `pnpm --filter @hilbras/omnicode-memory test` **287/287**, `check:guards` exit 0, `lint` exit 0, `check:audit` exit 0, `preflight` recorded below |

Behavior now: “my name is Hassan” is stored as a trusted global fact; the next
turn injects `Known about the user … my name is Hassan`; “call me Sam”
supersedes it; an unverified `memory_save` or a `secret` record never appears.

Final gate:

| Command | Result |
|---|---|
| `pnpm preflight` | **exit 0** — 17/17 steps; typecheck 39/39 |
| `pnpm --filter @hilbras/omnicode-memory test` | **287 passed** |
| `pnpm check:guards` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm check:audit` | exit 0 |
