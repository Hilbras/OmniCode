import type {
  ISessionSearchService,
  SessionSearchHit,
  SessionSearchPage,
  SessionSearchQuery,
  SessionSearchRole,
} from './sessionSearch';

export interface SessionSearchDocument {
  readonly sessionId: string;
  readonly sessionTitle: string;
  readonly agentId: string;
  readonly role: SessionSearchRole;
  readonly text: string;
  readonly time: number;
  readonly turn?: number;
}

export interface SessionSearchSource {
  list(): Promise<readonly SessionSearchDocument[]>;
}

export class InMemorySessionSearchSource implements SessionSearchSource {
  constructor(private documents: readonly SessionSearchDocument[] = []) {}

  setDocuments(documents: readonly SessionSearchDocument[]): void {
    this.documents = documents;
  }

  async list(): Promise<readonly SessionSearchDocument[]> {
    return this.documents;
  }
}

export class LocalSessionSearchService implements ISessionSearchService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly source: SessionSearchSource,
    private readonly options: { readonly maxDocuments?: number } = {},
  ) {}

  async search(query: SessionSearchQuery): Promise<SessionSearchPage> {
    const all = await this.source.list();
    const maxDocuments = Math.max(this.options.maxDocuments ?? 10_000, 1);
    const incomplete = all.length > maxDocuments ? 'candidate_cap' as const : undefined;
    const documents = all.slice(0, maxDocuments);
    const filtered = documents
      .filter((document) => query.sessionId === undefined || document.sessionId === query.sessionId)
      .filter((document) => query.role === undefined || document.role === query.role)
      .map((document) => ({ document, score: scoreDocument(document, query) }))
      .filter((entry) => inputMatches(entry.document, query));
    filtered.sort((left, right) => compareEntries(left, right, query.sort ?? 'score'));
    const pageSize = clampPageSize(query.pageSize);
    const offset = decodeOffset(query.pageToken);
    const items = filtered.slice(offset, offset + pageSize).map((entry) => hit(entry.document, entry.score, query.query));
    return {
      items,
      hasMore: offset + pageSize < filtered.length,
      ...(offset + pageSize < filtered.length ? { pageToken: encodeOffset(offset + pageSize) } : {}),
      ...(incomplete === undefined ? {} : { incomplete }),
      indexState: {
        state: documents.length === 0 ? 'readonly' : 'ready',
        indexedSessions: new Set(documents.map((document) => document.sessionId)).size,
        totalSessions: new Set(documents.map((document) => document.sessionId)).size,
        documents: documents.length,
      },
    };
  }
}

function scoreDocument(document: SessionSearchDocument, query: SessionSearchQuery): number {
  const haystack = `${document.sessionTitle}\n${document.text}`.toLowerCase();
  const needle = query.query.toLowerCase();
  if (needle.trim().length === 0) return 0;
  if (query.mode === 'literal') return haystack.includes(needle) ? 1 : 0;
  const terms = termsOf(needle);
  if (terms.length === 0) return 0;
  let score = 0;
  for (const term of terms) score += occurrences(haystack, term);
  if (document.sessionTitle.toLowerCase().includes(needle)) score += 3;
  return score;
}

function inputMatches(document: SessionSearchDocument, query: SessionSearchQuery): boolean {
  if (query.query.trim().length === 0) return true;
  if (query.mode === 'literal') return `${document.sessionTitle}\n${document.text}`.toLowerCase().includes(query.query.toLowerCase());
  const haystack = `${document.sessionTitle}\n${document.text}`.toLowerCase();
  return termsOf(query.query.toLowerCase()).every((term) => haystack.includes(term));
}

function compareEntries(
  left: { document: SessionSearchDocument; score: number },
  right: { document: SessionSearchDocument; score: number },
  sort: NonNullable<SessionSearchQuery['sort']>,
): number {
  if (sort === 'time_asc') return left.document.time - right.document.time;
  if (sort === 'time_desc') return right.document.time - left.document.time;
  if (right.score !== left.score) return right.score - left.score;
  return right.document.time - left.document.time;
}

function hit(document: SessionSearchDocument, score: number, query: string): SessionSearchHit {
  return {
    sessionId: document.sessionId,
    sessionTitle: document.sessionTitle,
    agentId: document.agentId,
    role: document.role,
    snippet: snippet(document.text, query),
    time: document.time,
    ...(document.turn === undefined ? {} : { turn: document.turn }),
    score,
  };
}

function snippet(text: string, query: string): string {
  const needle = query.trim().toLowerCase();
  const at = needle.length === 0 ? -1 : text.toLowerCase().indexOf(needle);
  const start = at < 0 ? 0 : Math.max(0, at - 60);
  const value = text.slice(start, start + 220).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${value}${start + 220 < text.length ? '…' : ''}`;
}

function termsOf(value: string): readonly string[] {
  return [...new Set(value.split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length >= 2))];
}

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) >= 0) {
    count += 1;
    index += needle.length;
  }
  return count;
}

function clampPageSize(value: number | undefined): number {
  return Math.min(Math.max(value ?? 20, 1), 100);
}

function encodeOffset(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

function decodeOffset(token: string | undefined): number {
  if (token === undefined) return 0;
  const parsed = Number(Buffer.from(token, 'base64url').toString('utf8'));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}
