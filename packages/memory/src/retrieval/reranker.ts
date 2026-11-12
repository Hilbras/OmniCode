import type { RetrievedMemory } from '#/contracts/retrieval';

import { relevanceScore } from './relevanceSelector';

export interface MemoryRerankInput {
  readonly query: string;
  readonly memories: readonly RetrievedMemory[];
}

export interface MemoryReranker {
  rerank(input: MemoryRerankInput): readonly RetrievedMemory[] | Promise<readonly RetrievedMemory[]>;
}

export interface LexicalMemoryRerankerOptions {
  readonly relevanceWeight?: number;
}

export class LexicalMemoryReranker implements MemoryReranker {
  private readonly relevanceWeight: number;

  constructor(options: LexicalMemoryRerankerOptions = {}) {
    const weight = options.relevanceWeight ?? 0.3;
    this.relevanceWeight = Math.min(Math.max(weight, 0), 1);
  }

  rerank(input: MemoryRerankInput): readonly RetrievedMemory[] {
    const scored = input.memories.map((memory) => ({
      memory,
      score:
        memory.explanation.score * (1 - this.relevanceWeight) +
        relevanceScore(input.query, `${memory.record.subject ?? ''} ${memory.record.content}`) *
          this.relevanceWeight,
    }));
    scored.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.memory.record.updatedAt !== left.memory.record.updatedAt) {
        return right.memory.record.updatedAt - left.memory.record.updatedAt;
      }
      return left.memory.record.id.localeCompare(right.memory.record.id);
    });
    return scored.map((entry) => entry.memory);
  }
}
