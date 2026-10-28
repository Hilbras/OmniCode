import { queryGroups, queryTerms, type QueryGroup } from './stem';

export const MAX_QUERY_CHARS = 512;

const CONTROL_CHARS = /[\u0000-\u001F\u007F]+/g;

export interface NormalizedQuery {
  readonly text: string;
  readonly terms: readonly string[];
  readonly groups: readonly QueryGroup[];
  readonly truncated: boolean;
}

export function normalizeQuery(raw: string): NormalizedQuery {
  const collapsed = raw.normalize('NFKC').replaceAll(CONTROL_CHARS, ' ').replaceAll(/\s+/g, ' ').trim();
  const truncated = collapsed.length > MAX_QUERY_CHARS;
  const text = truncated ? collapsed.slice(0, MAX_QUERY_CHARS) : collapsed;
  return { text, terms: queryTerms(text), groups: queryGroups(text), truncated };
}
