import { describe, expect, it } from 'vitest';

import { InMemorySessionSearchSource, LocalSessionSearchService } from '#/features/sessionSearch/localSessionSearch';

const docs = [
  { sessionId: 's1', sessionTitle: 'Fix parser', agentId: 'main', role: 'user' as const, text: 'please fix the parser bug', time: 3 },
  { sessionId: 's1', sessionTitle: 'Fix parser', agentId: 'main', role: 'assistant' as const, text: 'fixed parser in src/a.ts', time: 4 },
  { sessionId: 's2', sessionTitle: 'Deploy', agentId: 'main', role: 'user' as const, text: 'deploy the parser service', time: 5 },
];

describe('LocalSessionSearchService', () => {
  it('finds term matches and filters by role and session', async () => {
    const service = new LocalSessionSearchService(new InMemorySessionSearchSource(docs));
    const page = await service.search({ query: 'parser', role: 'assistant', sessionId: 's1' });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ sessionId: 's1', role: 'assistant', sessionTitle: 'Fix parser' });
    expect(page.indexState.state).toBe('ready');
  });

  it('supports literal mode and time sorting', async () => {
    const service = new LocalSessionSearchService(new InMemorySessionSearchSource(docs));
    const page = await service.search({ query: 'parser service', mode: 'literal', sort: 'time_asc' });
    expect(page.items.map((hit) => hit.sessionId)).toEqual(['s2']);
  });

  it('paginates and reports remaining pages', async () => {
    const service = new LocalSessionSearchService(new InMemorySessionSearchSource(docs));
    const first = await service.search({ query: 'parser', pageSize: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    const second = await service.search({ query: 'parser', pageSize: 1, pageToken: first.pageToken });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.time).not.toBe(first.items[0]?.time);
  });

  it('reports candidate-cap degradation instead of silently dropping documents', async () => {
    const service = new LocalSessionSearchService(new InMemorySessionSearchSource(docs), { maxDocuments: 1 });
    const page = await service.search({ query: 'parser' });
    expect(page.incomplete).toBe('candidate_cap');
  });
});

describe('LocalSessionSearchService pagination', () => {
  function pagedDocs(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      sessionId: `s${String(index)}`,
      sessionTitle: `Session ${String(index)}`,
      agentId: 'main',
      role: 'user' as const,
      text: `page walk document ${String(index)}`,
      time: index,
    }));
  }

  it('walks every page through the token and loses nothing', async () => {
    const service = new LocalSessionSearchService(new InMemorySessionSearchSource(pagedDocs(10)));
    const seen: string[] = [];
    let token: string | undefined;
    let pages = 0;
    for (;;) {
      const page = await service.search({
        query: 'page walk document',
        pageSize: 3,
        pageToken: token,
      });
      pages += 1;
      seen.push(...page.items.map((hit) => hit.sessionId));
      if (!page.hasMore) {
        expect(page.pageToken).toBeUndefined();
        break;
      }
      expect(page.pageToken).toBeDefined();
      token = page.pageToken;
    }
    expect(pages).toBe(4);
    expect(seen).toHaveLength(10);
    expect(new Set(seen).size).toBe(10);
  });

  it('a token past the end yields an empty page without a next token', async () => {
    const service = new LocalSessionSearchService(new InMemorySessionSearchSource(pagedDocs(3)));
    const beyond = await service.search({
      query: 'page walk',
      sort: 'time_asc',
      pageSize: 3,
      pageToken: Buffer.from(String(10)).toString('base64url'),
    });
    expect(beyond.items).toHaveLength(0);
    expect(beyond.hasMore).toBe(false);
    expect(beyond.pageToken).toBeUndefined();
  });

  it('an invalid or negative token falls back to the first page', async () => {
    const service = new LocalSessionSearchService(new InMemorySessionSearchSource(pagedDocs(3)));
    const junk = await service.search({
      query: 'page walk',
      sort: 'time_asc',
      pageSize: 2,
      pageToken: 'not-a-token',
    });
    expect(junk.items.map((hit) => hit.time)).toEqual([0, 1]);
    const negative = await service.search({
      query: 'page walk',
      sort: 'time_asc',
      pageSize: 2,
      pageToken: Buffer.from(String(-5)).toString('base64url'),
    });
    expect(negative.items.map((hit) => hit.time)).toEqual([0, 1]);
  });

  it('clamps page size to at least one and at most one hundred', async () => {
    const service = new LocalSessionSearchService(new InMemorySessionSearchSource(pagedDocs(150)));
    const tiny = await service.search({ query: 'page walk', pageSize: 0 });
    expect(tiny.items).toHaveLength(1);
    const huge = await service.search({ query: 'page walk', pageSize: 500 });
    expect(huge.items).toHaveLength(100);
    expect(huge.hasMore).toBe(true);
  });

  it('an empty query lists every document without filtering', async () => {
    const service = new LocalSessionSearchService(new InMemorySessionSearchSource(pagedDocs(5)));
    const page = await service.search({ query: '   ', pageSize: 10, sort: 'time_asc' });
    expect(page.items).toHaveLength(5);
    expect(page.items.map((hit) => hit.time)).toEqual([0, 1, 2, 3, 4]);
    expect(page.indexState.state).toBe('ready');
  });
});
