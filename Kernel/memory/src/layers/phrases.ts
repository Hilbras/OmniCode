const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'at', 'by',
  'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before',
  'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off',
  'over', 'under', 'again', 'further', 'once', 'here', 'there', 'where', 'why',
  'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't',
  'can', 'will', 'just', 'don', 'should', 'now', 'i', 'me', 'my', 'you', 'your',
  'it', 'its', 'we', 'our', 'they', 'them', 'their', 'this', 'that', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do',
  'does', 'did', 'of', 'as', 'what', 'which', 'who',
]);

export interface PhraseCount {
  readonly ngram: string;
  readonly count: number;
  readonly lastSeenAt: number;
}

export function extractPhrases(prompt: string): readonly string[] {
  const words = prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
  const phrases: string[] = [];
  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      phrases.push(words.slice(i, i + n).join(' '));
    }
  }
  return phrases;
}

export function decayedCount(count: number, lastSeenAt: number, now: number, halfLifeMs: number): number {
  const age = Math.max(0, now - lastSeenAt);
  return count * Math.pow(0.5, age / Math.max(1, halfLifeMs));
}

export function rankPhrases(phrases: readonly PhraseCount[], now: number, halfLifeMs: number): readonly PhraseCount[] {
  return [...phrases].toSorted((a, b) => {
    const da = decayedCount(a.count, a.lastSeenAt, now, halfLifeMs);
    const db = decayedCount(b.count, b.lastSeenAt, now, halfLifeMs);
    if (db !== da) return db - da;
    return b.lastSeenAt - a.lastSeenAt;
  });
}