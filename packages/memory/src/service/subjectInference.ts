import type { MemoryCaptureInput } from '#/contracts/memoryContract';

/**
 * A statement shaped like "<key> is/uses/requires/defaults to <value>".
 * The key is one to three lowercase words, optionally led by "the".
 */
const STATEMENT = new RegExp(
  String.raw`^(?:the\s+)?([a-z][a-z0-9]*(?:[\s._-][a-z0-9]+){0,2})\s+(?:is|are|was|were|uses?|requires?|defaults?\s+to|runs?\s+on)\s+`,
  'i',
);

const NOT_A_KEY: ReadonlySet<string> = new Set([
  'a', 'all', 'an', 'any', 'each', 'every', 'he', 'here', 'i', 'it', 'one', 'she',
  'some', 'that', 'the', 'there', 'these', 'they', 'this', 'those', 'we', 'what',
  'when', 'which', 'who', 'you',
]);

const MAX_CONTENT_CHARS = 200;
const MIN_KEY_WORDS = 2;

/**
 * A conflict key derived from the sentence itself, used only when the caller
 * did not supply one. It is deliberately narrow: a short single-sentence
 * statement about a compound subject. Anything else — a long observation, a
 * list, a sentence starting with a pronoun — gets no subject, because a wrong
 * key reports a conflict between two memories that never contradicted each
 * other.
 *
 * A one-word key is rejected for that reason. "the cli is bundled with tsup"
 * and "the cli is written in typescript" both key to `cli`, and since a
 * subject match supersedes, the second would silently retire the first. Two
 * words ("devserver port") or a dotted name ("devserver.port") name a property,
 * which is what can actually be contradicted.
 */
export function inferSubject(content: string): string | undefined {
  if (content.length > MAX_CONTENT_CHARS || content.includes('\n')) return undefined;
  const match = STATEMENT.exec(content.trim());
  const key = match?.[1]?.toLowerCase();
  if (key === undefined) return undefined;
  const words = key.split(/[\s._-]+/).filter((word) => word.length > 0);
  if (words.length < MIN_KEY_WORDS) return undefined;
  if (words.some((word) => NOT_A_KEY.has(word))) return undefined;
  return words.join('.');
}

export function subjectFor(input: MemoryCaptureInput, content: string): string | undefined {
  if (input.subject !== undefined) return input.subject;
  if (input.category !== 'fact' && input.category !== 'preference') return undefined;
  return inferSubject(content);
}

const VALUE_STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'at', 'by', 'with',
  'is', 'are', 'was', 'were', 'be', 'being', 'been',
  'use', 'uses', 'used', 'using', 'require', 'requires', 'required',
  'default', 'defaults', 'run', 'runs', 'that', 'this', 'these', 'those', 'it', 'its',
]);

/**
 * The value part of a memory whose `subject` names the property it is about:
 * the content with the subject's own words, articles, and copulas removed,
 * returned as a multiset (sorted tokens, repetitions kept). Two memories that
 * share a subject state the SAME value when their token multisets are equal —
 * "The user's name is Hassan." and "User name is Hassan" both reduce to
 * `[hassan]`. Repetitions matter: a merged statement that merely happens to
 * reuse the same vocabulary ("… uses tsup | … bundles with tsup") does not
 * collapse onto one of its parts.
 */
export function subjectValueTokens(content: string, subject: string | undefined): readonly string[] {
  const drop = new Set(VALUE_STOPWORDS);
  if (subject !== undefined) {
    for (const token of subject.split(/[._\-\s]+/)) {
      if (token.length > 0) drop.add(token);
    }
  }
  const normalized = content
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['\u2019]s\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ');
  const tokens: string[] = [];
  for (const token of normalized.split(' ')) {
    if (token.length > 0 && !drop.has(token)) tokens.push(token);
  }
  return tokens.sort();
}

export function sameSubjectValue(
  left: string,
  leftSubject: string | undefined,
  right: string,
  rightSubject: string | undefined,
): boolean {
  const a = subjectValueTokens(left, leftSubject);
  if (a.length === 0) return false;
  const b = subjectValueTokens(right, rightSubject);
  return a.length === b.length && a.every((token, index) => token === b[index]);
}
