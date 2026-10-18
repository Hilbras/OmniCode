import { tokenize } from '@hilbras/omnicode-minidb';

const MIN_STEM_LENGTH = 3;

const SUFFIXES: readonly { readonly suffix: string; readonly minLength: number }[] = [
  { suffix: 'ings', minLength: 6 },
  { suffix: 'ing', minLength: 5 },
  { suffix: 'edly', minLength: 6 },
  { suffix: 'ed', minLength: 4 },
  { suffix: 'ers', minLength: 5 },
  { suffix: 'er', minLength: 4 },
  { suffix: 'ies', minLength: 4 },
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

export function stem(term: string): string {
  if (term.length < MIN_STEM_LENGTH || KEEP_AS_IS.has(term)) return term;
  if (/^\d+$/.test(term)) return term;
  for (const { suffix, minLength } of SUFFIXES) {
    if (term.length < minLength) continue;
    if (!term.endsWith(suffix)) continue;
    const base = term.slice(0, term.length - suffix.length);
    if (base.length < MIN_STEM_LENGTH) continue;
    return base;
  }
  return term;
}

export function isStemmable(term: string): boolean {
  return /[a-z]/.test(term) && !/^\d+$/.test(term);
}

export function indexTerms(text: string): string[] {
  const terms: string[] = [];
  for (const token of tokenize(text)) {
    terms.push(token);
    const stemmed = stem(token);
    if (stemmed !== token) terms.push(stemmed);
  }
  return [...new Set(terms)];
}

export function queryTerms(text: string): string[] {
  return indexTerms(text);
}

export function searchTextFor(content: string): string {
  return indexTerms(content).join(' ');
}