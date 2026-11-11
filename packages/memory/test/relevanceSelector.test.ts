import { describe, expect, it } from 'vitest';

import { relevanceScore, selectRelevantMemories } from '#/retrieval/relevanceSelector';

describe('relevance selector', () => {
  it('prefers records that match meaningful query terms', () => {
    const items = [
      { id: 'build', text: 'the cli is bundled with tsup' },
      { id: 'tests', text: 'unit tests run under vitest' },
    ];
    const selected = selectRelevantMemories('how does the cli bundle', items, (item) => item.text);
    expect(selected.map((entry) => entry.item.id)).toEqual(['build']);
  });

  it('ignores stopwords', () => {
    expect(relevanceScore('what is it', 'something else')).toBe(0);
  });

  it('honours minScore and limit', () => {
    const items = [
      { id: 'a', text: 'alpha beta' },
      { id: 'b', text: 'alpha' },
      { id: 'c', text: 'gamma' },
    ];
    expect(selectRelevantMemories('alpha beta', items, (item) => item.text, { minScore: 1, limit: 1 })).toHaveLength(1);
  });
});
