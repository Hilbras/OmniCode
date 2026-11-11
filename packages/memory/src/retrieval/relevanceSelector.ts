export interface RelevanceSelectionOptions {
  readonly minScore?: number;
  readonly limit?: number;
}

export interface RelevanceSelection<T> {
  readonly item: T;
  readonly score: number;
}

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'do',
  'does',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'was',
  'we',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'with',
]);

export function relevanceTerms(text: string): readonly string[] {
  return [
    ...new Set(
      text
        .normalize('NFKC')
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((term) => term.length >= 2 && !STOPWORDS.has(term)),
    ),
  ];
}

export function relevanceScore(query: string, candidate: string): number {
  const queryTerms = relevanceTerms(query);
  if (queryTerms.length === 0) return 0;
  const candidateTerms = new Set(relevanceTerms(candidate));
  let matched = 0;
  for (const term of queryTerms) {
    if (candidateTerms.has(term)) matched += 1;
  }
  return matched / queryTerms.length;
}

export function selectRelevantMemories<T>(
  query: string,
  items: readonly T[],
  textFor: (item: T) => string,
  options: RelevanceSelectionOptions = {},
): readonly RelevanceSelection<T>[] {
  const minScore = options.minScore ?? 0.34;
  const limit = Math.max(1, options.limit ?? 10);
  const scored: RelevanceSelection<T>[] = [];
  for (const item of items) {
    const score = relevanceScore(query, textFor(item));
    if (score >= minScore) scored.push({ item, score });
  }
  scored.sort((left, right) => right.score - left.score);
  return scored.slice(0, limit);
}
