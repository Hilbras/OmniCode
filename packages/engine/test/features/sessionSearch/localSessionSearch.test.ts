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
