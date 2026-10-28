import { tokenize } from '@hilbras/omnicode-minidb';

import { SYNONYM_GROUPS, synonymsOf } from './synonyms';

const MIN_STEM_LENGTH = 3;
const IES_MIN_LENGTH = 5;

const SUFFIXES: readonly { readonly suffix: string; readonly minLength: number }[] = [
  { suffix: 'ings', minLength: 6 },
  { suffix: 'ing', minLength: 5 },
  { suffix: 'edly', minLength: 6 },
  { suffix: 'ed', minLength: 4 },
  { suffix: 'ers', minLength: 5 },
  { suffix: 'er', minLength: 4 },
  { suffix: 'es', minLength: 4 },
  { suffix: 's', minLength: 4 },
  { suffix: 'ly', minLength: 5 },
];

const KEEP_AS_IS: ReadonlySet<string> = new Set([
  'is',
  'was',
  'as',
  'has',
  'its',
  'this',
  'less',
  'across',
  'always',
  'unless',
  'process',
  'access',
  'business',
]);

const SIBILANT_ENDINGS = ['s', 'x', 'z', 'ch', 'sh'];

/**
 * `es` is only a plural suffix after a sibilant (`processes`, `flushes`);
 * elsewhere the word ends in a silent `e` and only the `s` is plural
 * (`writes` → `write`, not `writ`). Getting this wrong splits a verb from its
 * own base form, which then fails the relevance gate on both sides.
 */
function stripsEs(base: string): boolean {
  return SIBILANT_ENDINGS.some((ending) => base.endsWith(ending));
}

export function stem(term: string): string {
  if (term.length < MIN_STEM_LENGTH || KEEP_AS_IS.has(term)) return term;
  if (/^\d+$/.test(term)) return term;
  if (term.length >= IES_MIN_LENGTH && term.endsWith('ies')) return `${term.slice(0, -3)}y`;
  for (const { suffix, minLength } of SUFFIXES) {
    if (term.length < minLength) continue;
    if (!term.endsWith(suffix)) continue;
    const base = term.slice(0, term.length - suffix.length);
    if (base.length < MIN_STEM_LENGTH) continue;
    if (suffix === 'es' && !stripsEs(base)) continue;
    return base;
  }
  return term;
}

export function isStemmable(term: string): boolean {
  return /[a-z]/.test(term) && !/^\d+$/.test(term);
}

/**
 * Maps every synonym group member, and its stem, to the member that names the
 * group. Coverage is counted per group, so without this `repo` and
 * `repository` would be two query words that one record word satisfies.
 */
const CANONICAL: ReadonlyMap<string, string> = (() => {
  const index = new Map<string, string>();
  for (const group of SYNONYM_GROUPS) {
    const canonical = group[0];
    if (canonical === undefined) continue;
    for (const term of group) {
      index.set(term, canonical);
      index.set(stem(term), canonical);
    }
  }
  return index;
})();

const ACRONYM_BOUNDARY = /([A-Z]+)([A-Z][a-z])/g;
const WORD_BOUNDARY = /([a-z0-9])([A-Z])/g;

/**
 * Splits `MemoryService`, `HTTPServer` and `parseJSON` into their parts before
 * tokenization. `tokenize` lowercases first, so camelCase boundaries are gone
 * by the time it runs; snake_case and kebab-case already split on their
 * separators.
 */
export function splitIdentifiers(text: string): string {
  return text.replaceAll(ACRONYM_BOUNDARY, '$1 $2').replaceAll(WORD_BOUNDARY, '$1 $2');
}

function formsOf(token: string): string[] {
  const stemmed = stem(token);
  const forms = new Set<string>([token, stemmed]);
  for (const synonym of [...synonymsOf(token), ...synonymsOf(stemmed)]) {
    forms.add(synonym);
    forms.add(stem(synonym));
  }
  return [...forms];
}

export function indexTerms(text: string): string[] {
  const terms: string[] = [];
  for (const token of tokenize(splitIdentifiers(text))) {
    for (const form of formsOf(token)) terms.push(form);
  }
  return [...new Set(terms)];
}

/** One word of a query, with every form that can satisfy it. */
export interface QueryGroup {
  /** The canonical stem the group is counted under, so variants count once. */
  readonly key: string;
  /** Every form that satisfies the group (token, stem, synonyms and stems). */
  readonly forms: readonly string[];
}

function groupKeyOf(token: string): string {
  const stemmed = stem(token);
  return CANONICAL.get(token) ?? CANONICAL.get(stemmed) ?? stemmed;
}

/**
 * Query terms grouped by word. The retriever scores with the flattened forms
 * but counts coverage per group, so `linter`/`linting` and
 * `repo`/`repository` count as one matched word rather than two.
 */
export function queryGroups(text: string): QueryGroup[] {
  const groups = new Map<string, Set<string>>();
  for (const token of tokenize(splitIdentifiers(text))) {
    const key = groupKeyOf(token);
    const forms = groups.get(key) ?? new Set<string>();
    for (const form of formsOf(token)) forms.add(form);
    groups.set(key, forms);
  }
  return [...groups].map(([key, forms]) => ({ key, forms: [...forms] }));
}

export function queryTerms(text: string): string[] {
  return indexTerms(text);
}

export function searchTextFor(content: string): string {
  return indexTerms(content).join(' ');
}

/** The forms a stored `searchText` can be matched against, for coverage checks. */
export function termsOfStoredText(text: string): ReadonlySet<string> {
  return new Set(text.split(' ').filter((term) => term.length > 0));
}
