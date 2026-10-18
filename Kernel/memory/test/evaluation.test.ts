import { describe, expect, it } from 'vitest';

import {
  EVAL_CORPUS,
  EVAL_QUERIES,
  type EvaluationCase,
  type LabelledMemory,
  type RankingMetrics,
  evaluate,
} from '#/retrieval/evaluation';

import { captureInput, createHarness, evidenceFor, globalScope, REPO_A, repoScope, seedCorpus } from './helpers';

const K = 5;

async function runEvaluation(): Promise<{ metrics: RankingMetrics; cases: EvaluationCase[] }> {
  const harness = createHarness();
  const ids = await seedCorpus(harness.service, EVAL_CORPUS);
  const cases: EvaluationCase[] = [];
  for (const { query, corpusId } of EVAL_QUERIES) {
    const result = await harness.service.search({
      query,
      projectId: REPO_A,
      budget: { maxResults: K, maxContextChars: 100_000 },
      includeUntrusted: true,
    });
    const target = ids.get(corpusId);
    cases.push({
      query,
      ranked: result.memories.map((memory) => ({
        memoryId: memory.record.id,
        relevant: memory.record.id === target,
      })),
    });
  }
  return { metrics: evaluate(cases, K), cases };
}

describe('retrieval evaluation', () => {
  it('scores the metric helpers against a known ranking', () => {
    const judged: EvaluationCase[] = [
      { query: 'q', ranked: [{ memoryId: 'a', relevant: true }, { memoryId: 'b', relevant: false }] },
    ];
    const metrics = evaluate(judged, 2);
    expect(metrics.recallAtK).toBe(1);
    expect(metrics.precisionAtK).toBe(0.5);
    expect(metrics.meanReciprocalRank).toBe(1);
    expect(metrics.noResult).toBe(0);
  });

  it('refuses to score a case with no relevant memory as a perfect 1.0', () => {
    expect(() => evaluate([{ query: 'empty', ranked: [] }], 2)).toThrow(/no relevant memory/);
    expect(() =>
      evaluate([{ query: 'none relevant', ranked: [{ memoryId: 'a', relevant: false }] }], 2),
    ).toThrow(/no relevant memory/);
    expect(() => evaluate([], 0)).toThrow(/cutoff/);
  });

  it('finds the intended memory for every labelled query', async () => {
    const { metrics, cases } = await runEvaluation();
    expect(
      metrics,
      `recall@${K}=${metrics.recallAtK.toFixed(3)} precision@${K}=${metrics.precisionAtK.toFixed(3)} mrr=${metrics.meanReciprocalRank.toFixed(3)}`,
    ).toMatchObject({ queries: EVAL_QUERIES.length, noResult: 0 });
    expect(metrics.recallAtK).toBeGreaterThanOrEqual(1);
    expect(metrics.precisionAtK).toBeGreaterThanOrEqual(0.6);
    expect(metrics.meanReciprocalRank).toBeGreaterThanOrEqual(0.9);
    for (const entry of cases) {
      expect(
        entry.ranked.some((judgement) => judgement.relevant),
        `no relevant memory for: ${entry.query}`,
      ).toBe(true);
    }
  });

  it('keeps the ranking deterministic across repeated runs', async () => {
    const first = await runEvaluation();
    const second = await runEvaluation();
    expect(second.metrics).toEqual(first.metrics);
    expect(second.cases.map((entry) => entry.ranked)).toEqual(first.cases.map((entry) => entry.ranked));
  });

  it('matches a morphological variant through light stemming', async () => {
    const harness = createHarness();
    const stored = await harness.service.capture(
      captureInput('linting runs oxlint with the type aware ruleset', { evidence: evidenceFor('docs/lint.md') }),
    );
    expect(stored.status).toBe('stored');

    const result = await harness.service.search({
      query: 'which linter do we use',
      projectId: REPO_A,
      includeUntrusted: true,
    });
    expect(result.status).toBe('complete');
    expect(result.memories[0]?.record.id).toBe(stored.id);
  });

  it('still reports no_match rather than guessing when nothing is close', async () => {
    const harness = createHarness();
    await harness.service.capture(
      captureInput('linting runs oxlint with the type aware ruleset', { evidence: evidenceFor('docs/lint.md') }),
    );
    const result = await harness.service.search({
      query: 'kubernetes operator reconciliation',
      projectId: REPO_A,
      includeUntrusted: true,
    });
    expect(result.status).toBe('no_match');
    expect(result.memories).toHaveLength(0);
    expect(result.notice).toBeUndefined();
  });

  it('does not let a heavily reinforced irrelevant memory outrank a relevant one', async () => {
    const harness = createHarness();
    const noise = await harness.service.capture(
      captureInput('telemetry telemetry telemetry flush interval', { evidence: evidenceFor('docs/n.md') }),
    );
    const answer = await harness.service.capture(
      captureInput('the build pipeline uses tsup to bundle the cli', { evidence: evidenceFor('docs/b.md') }),
    );
    for (let index = 0; index < 200; index += 1) {
      await harness.service.noteAccess([noise.id as string], harness.clock.now());
    }
    const result = await harness.service.search({
      query: 'how do we bundle the cli',
      projectId: REPO_A,
      includeUntrusted: true,
    });
    expect(result.memories[0]?.record.id).toBe(answer.id);
    expect((await harness.service.get(noise.id as string))?.accessCount).toBe(200);
  });

  it('labels every corpus entry with a subject so conflicts stay addressable', () => {
    for (const entry of EVAL_CORPUS) {
      expect(entry.subject.length, entry.corpusId).toBeGreaterThan(0);
      expect(EVAL_CORPUS.filter((other) => other.subject === entry.subject)).toHaveLength(1);
    }
    const seen = new Set(EVAL_QUERIES.map((entry) => entry.corpusId));
    expect(seen.size).toBe(EVAL_QUERIES.length);
    for (const entry of EVAL_QUERIES) {
      expect(EVAL_CORPUS.some((memory) => memory.corpusId === entry.corpusId)).toBe(true);
    }
  });

  it('uses a distinct scope for global corpus entries', async () => {
    const harness = createHarness();
    const ids = await seedCorpus(harness.service, EVAL_CORPUS);
    const global = EVAL_CORPUS.filter((entry: LabelledMemory) => entry.global);
    expect(global.length).toBeGreaterThan(0);
    for (const entry of global) {
      const record = await harness.service.get(ids.get(entry.corpusId) as string);
      expect(record?.scope).toEqual(globalScope());
    }
    const scoped = EVAL_CORPUS.find((entry: LabelledMemory) => !entry.global);
    expect(scoped).toBeDefined();
    expect((await harness.service.get(ids.get(scoped!.corpusId) as string))?.scope).toEqual(repoScope(REPO_A));
  });
});