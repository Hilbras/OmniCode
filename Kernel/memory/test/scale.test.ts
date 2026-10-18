import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EVAL_CORPUS, EVAL_QUERIES } from '#/retrieval/evaluation';

import type { LabelledMemory } from '#/retrieval/evaluation';

import type { MemoryStorePort } from '#/storage/memoryStore';
import { MiniDbMemoryStore } from '#/storage/miniDbMemoryStore';

import {
  captureInput,
  createHarness,
  evidenceFor,
  REPO_A,
  REPO_B,
  repoScope,
  seedCorpus,
} from './helpers';

const CORPUS_SIZE = 400;
const DISTRACTOR_COUNT = CORPUS_SIZE - EVAL_CORPUS.length;

const DISTRACTOR_SUBJECTS: readonly string[] = Array.from(
  { length: DISTRACTOR_COUNT },
  (_, index) => `generated.topic.${index}`,
);

const DISTRACTOR_CONTENT: readonly string[] = Array.from(
  { length: DISTRACTOR_COUNT },
  (_, index) =>
    `routine observation number ${index} about the generated topic: the module emits a trace span, ` +
    `records a counter, and returns the parsed payload to the caller without further allocation`,
);

async function seedLargeCorpus(store?: MemoryStorePort) {
  const harness = createHarness(store === undefined ? {} : { store });
  const entries = [
    ...EVAL_CORPUS,
    ...DISTRACTOR_CONTENT.map(
      (content, index): LabelledMemory => ({
        corpusId: DISTRACTOR_SUBJECTS[index] as string,
        subject: DISTRACTOR_SUBJECTS[index] as string,
        content,
        category: 'fact',
        sourceType: 'repository_file',
        origin: 'application',
        global: false,
      }),
    ),
  ];
  const ids = await seedCorpus(harness.service, entries);
  return { harness, ids, entries };
}

describe('retrieval at corpus scale', () => {
  it(`still recalls the right memory out of ${CORPUS_SIZE}`, async () => {
    const { harness, ids } = await seedLargeCorpus();
    expect(await harness.service.list({ projectId: REPO_A, limit: CORPUS_SIZE })).toHaveLength(CORPUS_SIZE);
    expect(await harness.service.list({ projectId: REPO_A })).toHaveLength(100);

    const misses: string[] = [];
    for (const { query, corpusId } of EVAL_QUERIES) {
      const id = ids.get(corpusId);
      const result = await harness.service.search({ query, projectId: REPO_A });
      if (!result.memories.some((memory) => memory.record.id === id)) misses.push(query);
    }
    expect(misses, `queries that failed to recall at ${CORPUS_SIZE} memories`).toEqual([]);
  });

  it('bounds the work it does and names the constraint that bounded it', async () => {
    const { harness } = await seedLargeCorpus();
    const started = Date.now();
    const result = await harness.service.search({
      query: 'generated topic trace span parsed payload',
      projectId: REPO_A,
      limit: 5,
    });
    const elapsed = Date.now() - started;

    expect(result.status).toBe('partial');
    expect(result.memories.length).toBeLessThanOrEqual(5);
    expect(result.budget.constraints.length).toBeGreaterThan(0);
    expect(result.budget.mayBeIncomplete).toBe(true);
    expect(result.notice).toBeDefined();
    expect(elapsed).toBeLessThan(10_000);
  });

  it('reports how many candidates it actually examined', async () => {
    const { harness } = await seedLargeCorpus();
    const result = await harness.service.search({
      query: 'generated topic trace span',
      projectId: REPO_A,
      limit: 3,
      budget: { maxCandidates: 50 },
    });
    expect(result.diagnostics.lexicalCandidates).toBeLessThanOrEqual(50);
    expect(result.diagnostics.scopeCandidates).toBeLessThanOrEqual(50);
    expect(result.budget.constraints).toContain('scope_candidates');
    expect(result.budget.mayBeIncomplete).toBe(true);
  });

  it('keeps a large second repository out of a large first one', async () => {
    const { harness } = await seedLargeCorpus();
    await harness.service.capture(
      captureInput('repository beta keeps its kangaroo facts in a private ledger', {
        scope: repoScope(REPO_B),
        evidence: evidenceFor('beta/ledger.md'),
      }),
    );
    const result = await harness.service.search({
      query: 'how are releases tagged',
      projectId: REPO_A,
      includeUntrusted: true,
    });
    expect(result.memories.map((memory) => memory.record.content)).not.toContain(
      'repository beta keeps its kangaroo facts in a private ledger',
    );
    expect(JSON.stringify(result.diagnostics)).not.toContain('kangaroo');
  });

  it('ranks the corpus answer above the generated noise', async () => {
    const { harness, ids } = await seedLargeCorpus();
    const target = ids.get('search-index');
    const result = await harness.service.search({
      query: 'how many shards does the search index use',
      projectId: REPO_A,
    });
    expect(result.memories[0]?.record.id).toBe(target);
  });
});
describe('retrieval at corpus scale on the real store', () => {
  it(`recalls every labelled query out of ${CORPUS_SIZE} persisted memories`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'omnicode-memory-scale-'));
    const store = await MiniDbMemoryStore.open({ dir });
    try {
      const { harness, ids } = await seedLargeCorpus(store);
      const misses: string[] = [];
      for (const { query, corpusId } of EVAL_QUERIES) {
        const id = ids.get(corpusId);
        const result = await harness.service.search({ query, projectId: REPO_A });
        if (!result.memories.some((memory) => memory.record.id === id)) misses.push(query);
      }
      expect(misses, `queries that failed to recall against minidb at ${CORPUS_SIZE} memories`).toEqual([]);
    } finally {
      await store.close();
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 60_000);

  it('survives a reopen and still recalls', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'omnicode-memory-reopen-'));
    let target: string | undefined;
    try {
      const first = await MiniDbMemoryStore.open({ dir });
      const seeded = await seedLargeCorpus(first);
      target = seeded.ids.get('search-index');
      await first.close();

      const second = await MiniDbMemoryStore.open({ dir });
      try {
        expect(await second.textIndexState()).toBe('ready');
        const harness = createHarness({ store: second });
        const result = await harness.service.search({
          query: 'how many shards does the search index use',
          projectId: REPO_A,
        });
        expect(result.status).toBe('complete');
        expect(result.memories[0]?.record.id).toBe(target);
      } finally {
        await second.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 60_000);
});
