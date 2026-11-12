import { describe, expect, it } from 'vitest';

import type { RetrievedMemory } from '#/contracts/retrieval';
import type { MemoryRecord } from '#/contracts/memoryTypes';
import { LexicalMemoryReranker } from '#/retrieval/reranker';

function memory(id: string, content: string, score: number): RetrievedMemory {
  return {
    record: {
      id,
      content,
      subject: id,
      tier: 'distilled',
      category: 'fact',
      sourceType: 'repository_file',
      origin: 'application',
      scope: { tier: 'repository', projectId: 'p' },
      lifecycle: 'active',
      trust: 'unverified',
      sensitivity: 'internal',
      retention: 'persistent',
      importance: 50,
      confidence: 0.5,
      accessCount: 0,
      createdAt: 1,
      updatedAt: 1,
      revision: 1,
      legalHold: false,
      evidence: [],
      relations: [],
    } as unknown as MemoryRecord,
    explanation: {
      memoryId: id,
      tier: 'distilled',
      category: 'fact',
      trust: 'unverified',
      sourceType: 'repository_file',
      scopeTier: 'repository',
      lifecycle: 'active',
      score,
      components: {
        lexical: score,
        trust: 0,
        scope: 0,
        reinforcement: 0,
        total: score,
      },
      gates: [],
      evidence: [],
      suspicious: false,
      suspiciousReasons: [],
      redacted: false,
      conflictsWith: [],
    },
  };
}

describe('LexicalMemoryReranker', () => {
  it('promotes a memory with stronger query overlap', () => {
    const reranker = new LexicalMemoryReranker();
    const original = memory('low-overlap', 'unrelated deployment note', 1);
    const relevant = memory('relevant', 'the cli bundles with tsup', 0.8);
    expect(reranker.rerank({ query: 'how does the cli bundle with tsup', memories: [original, relevant] })[0]?.record.id).toBe('relevant');
  });

  it('can preserve the original order with zero relevance weight', () => {
    const reranker = new LexicalMemoryReranker({ relevanceWeight: 0 });
    const original = memory('first', 'unrelated', 1);
    const relevant = memory('second', 'cli tsup bundle', 0.8);
    expect(reranker.rerank({ query: 'cli tsup bundle', memories: [original, relevant] })[0]?.record.id).toBe('first');
  });

  it('can use pure relevance with full weight', () => {
    const reranker = new LexicalMemoryReranker({ relevanceWeight: 1 });
    const original = memory('first', 'unrelated', 1);
    const relevant = memory('second', 'cli tsup bundle', 0);
    expect(reranker.rerank({ query: 'cli tsup bundle', memories: [original, relevant] })[0]?.record.id).toBe('second');
  });

  it('clamps the relevance weight', () => {
    const negative = new LexicalMemoryReranker({ relevanceWeight: -1 });
    const high = new LexicalMemoryReranker({ relevanceWeight: 2 });
    const original = memory('first', 'unrelated', 1);
    const relevant = memory('second', 'cli tsup bundle', 0.8);
    expect(negative.rerank({ query: 'cli tsup bundle', memories: [original, relevant] })[0]?.record.id).toBe('first');
    expect(high.rerank({ query: 'cli tsup bundle', memories: [original, relevant] })[0]?.record.id).toBe('second');
  });
});
