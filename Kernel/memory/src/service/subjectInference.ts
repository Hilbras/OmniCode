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
