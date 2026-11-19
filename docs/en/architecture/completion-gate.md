# The completion gate

> Ported from the pre-rename tree (`docs/architecture/completion-gate.md`);
> paths updated to this tree and every status claim re-verified on
> 2026-11-19. Original author: Hilbras.

The completion gate decides whether a completion claim may be accepted. It is
the answer to a question the autonomy plan asked and was deliberately not
answered until the verifier existed.

## The rule

> Reject an unproven completion, **but only when the goal is actually
> checkable.**

## Why not the strict version

The obvious implementation — reject anything `verifyGoal` cannot prove — is a
deadlock generator, and that is worth being explicit about because the failure
mode is worse than the one it prevents.

Consider "improve the onboarding copy". No script can decide whether the copy is
good. Under the strict rule the model would be refused forever and the run
would burn its entire budget re-attempting the same completion. Every attempt
costs a model call and a screenshot; the goal never advances and never stops on
its own terms.

So the gate separates two failures that look similar and are not:

| Verdict | What happened | Decision |
|---|---|---|
| `contradicted` | the run **recorded** something on the wrong side of a stated threshold | **refuse** |
| `unverified` | a check ran and did not hold | **refuse** |
| `insufficient_evidence` | some criteria could not be checked; nothing was disproved | **allow** |

`insufficient_evidence` passing through is not a loophole. It means the goal is
not machine-checkable, and the honest response to that is to allow the
completion and record *why* it could not be verified — not to block forever.

## Two other escapes

- An opt-out exists for operators whose goals legitimately complete without
  tool observations; the gate is **on by default** (see current-tree status
  below).
- `fromUser` **outranks every check.** A person saying "this is done" is not
  something to second-guess with a script.

## What a refusal says

Refusals carry feedback the model can act on, naming the criterion and the
reason:

```
Goal completion was refused: No runtime-observed evidence was recorded for
this goal. Run a verification command (for example the relevant test suite) so
the runtime observes an outcome, then call UpdateGoal again.
```

A refusal that only said "no" would burn the same budget as the deadlock.

## `buildGoalCriteria`

A goal with no declared checks becomes a single criterion marked
`undecidable`, carrying the goal's own description. That keeps the gate
uniform — every goal has at least one criterion — while making "not
checkable" an explicit, visible state rather than an implicit pass.

## Current-tree status (2026-11-19)

The gate shipped as
`packages/engine/src/features/goal/verificationGate.ts` and is wired into
`goalService.markComplete` (`assertModelCompletionVerified`,
`goalService.ts:448`): every **model** completion must carry runtime-observed
evidence — the newest observation must survive
`verifyGoalCompletion` (`verifier.ts`) with traceable provenance, and the
newest recorded command run must have exited 0. A refusal throws
`GOAL_NOT_VERIFIED` and the goal stays `active`; the turn is not force-ended,
so the goal budget remains the backstop for a model that cannot satisfy the
criteria.

Two deliberate departures from the design above, both visible in the shipped
gate:

- **`insufficient_evidence` is not a pass-through here.** The shipped gate
  rejects empty or unverified evidence outright, with actionable feedback, and
  relies on the budget backstop instead of the anti-deadlock allowance. The
  allowance was a policy choice for criteria-based goals; the shipped gate
  checks *observed evidence* rather than declared criteria, where an empty
  record is better refused than waved through. If criteria-based goals return,
  revisit the `insufficient_evidence` row against the deadlock cost with a
  test.
- **The opt-out is an env flag, not a config key**: `OMNICODE_GOAL_VERIFIER=0`
  (or `false`) disables the gate; any other value, including unset, keeps it
  on.

The `fromUser` escape survives as the actor check: only `model` completions are
gated; `user`, `runtime`, and `system` actors pass through.
