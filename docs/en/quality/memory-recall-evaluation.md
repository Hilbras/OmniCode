# Memory recall evaluation baseline

Status: active  
Scope: how to run the memory recall evaluation, what it measures, and the baseline recorded for this tree.  
Source of truth: this English document. The Chinese mirror is `docs/zh/quality/memory-recall-evaluation.md`.

Related documents:

- [Architecture and workstream status](../architecture/omnicode-architecture.md)
- [End-to-end test plan](e2e-test-plan.md)

## Module

The evaluation module is `packages/memory/src/retrieval/evaluation.ts`. It exports:

- `recallAtK`, `precisionAtK`, `reciprocalRank`, and `average` metric helpers.
- `evaluate(cases, k)` returning `RankingMetrics`: `queries`, `recallAtK`, `precisionAtK`, `meanReciprocalRank`, and `noResult`.
- `EVAL_CORPUS`, a labelled set of 15 memories covering facts, a preference, numbers, and a negated question.
- `EVAL_QUERIES`, 15 queries mapped one-to-one to a corpus entry.

`evaluate` refuses to score a case with no relevant memory. That guard prevents an empty result set from being reported as perfect recall. It also rejects a non-positive cutoff.

The implementing service is `packages/memory/src/service/memoryService.ts`; the relevance selector is `packages/memory/src/retrieval/relevanceSelector.ts`.

## How to run

Ranking evaluation:

```bash
pnpm --filter @hilbras/omnicode-memory exec vitest run test/evaluation.test.ts
```

Scale evaluation, which repeats the labelled queries against a 400-memory corpus:

```bash
pnpm --filter @hilbras/omnicode-memory exec vitest run test/scale.test.ts
```

The evaluation test seeds the in-memory store, runs every labelled query at `k = 5` with `includeUntrusted: true`, and scores the returned ids. It also runs three end-to-end scenarios: a contradicted fact that retires its predecessor, a fact whose cited file changed that leaves search, and two projects storing the same fact without cross-answering.

## Baseline

Measured on 2026-11-11 against this tree, using the same in-memory harness and labelled corpus as `test/evaluation.test.ts`, at `k = 5`:

| Metric | Value |
|---|---|
| Queries | 15 |
| recall@5 | 1.000 |
| precision@5 | 1.000 |
| MRR | 1.000 |
| noResult | 0 |

This is a local harness measurement, not a CI result. The evaluation test asserts these floors on every run:

- recall@5 `>= 1.0`
- precision@5 `>= 0.9`
- MRR `>= 0.95`
- `queries == 15`
- `noResult == 0`
- identical ranking across repeated runs

The test also asserts that automatic injection stays inside `AUTO_INJECT_RETRIEVAL_BUDGET`: the largest injected context is at most the budget, the average injected context is at most 400 characters, and a query stays under 250 ms. Those ceilings are loose enough for a slow CI machine and tight enough to catch unbounded injection. `packages/memory/AGENTS.md` records an earlier measured injection-cost sample; this document does not restate machine-dependent timings as a baseline.

## Interpreting the numbers

The corpus is deliberately small and synthetic. A perfect score means the retrieval path finds the intended memory for each labelled query without filling the remaining slots with partial matches. It does not prove quality on real repositories, and it is not a substitute for the channel and tool end-to-end cases.

The floors are regression guards. When a change lowers a metric below its floor, fix the retrieval path or document a deliberate baseline change; do not lower the floor silently. When adding corpus entries, keep subjects unique and keep every query mapped to a corpus id, because the test asserts both properties.

## When to update this baseline

Update the measured table when the corpus, scoring cutoffs, relevance gate, or ranking weights change. Record the date, the command used, and whether the measurement came from the test harness or a different environment. Never copy a number from an unrelated run.
