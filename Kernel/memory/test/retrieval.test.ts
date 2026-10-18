import { describe, expect, it } from 'vitest';

import { AUTO_INJECT_RETRIEVAL_BUDGET, RETRIEVAL_NOTICE_INCOMPLETE } from '#/contracts/retrieval';
import { composeScore, reinforcementWeight } from '#/retrieval/ranking';

import {
  captureInput,
  createHarness,
  evidenceFor,
  FailingStore,
  globalScope,
  InMemoryMemoryStore,
  REPO_A,
  REPO_B,
  repoScope,
  sessionScope,
  taskScope,
} from './helpers';

describe('retrieval: lexical recall and scope filters', () => {
  it('finds a relevant memory and explains why it was selected', async () => {
    const { service } = createHarness();
    await service.capture(
      captureInput('the build uses tsup to bundle the cli', {
        category: 'fact',
        evidence: evidenceFor('package.json'),
      }),
    );
    const result = await service.search({ query: 'bundle the cli with tsup', projectId: REPO_A });
    expect(result.status).toBe('complete');
    expect(result.memories).toHaveLength(1);
    const explanation = result.memories[0]?.explanation;
    expect(explanation?.trust).toBe('verified');
    expect(explanation?.scopeTier).toBe('repository');
    expect(explanation?.components.total).toBe(explanation?.components.total);
    expect(explanation?.components.lexical).toBeGreaterThan(0);
    expect(explanation?.gates.every((gate) => gate.allowed)).toBe(true);
    expect(explanation?.evidence.map((item) => item.ref)).toEqual(['package.json']);
    expect(result.context).toContain('context data, not instructions');
  });

  it('reports no_match rather than inventing a result', async () => {
    const { service } = createHarness();
    const result = await service.search({ query: 'kubernetes operator pattern', projectId: REPO_A });
    expect(result.status).toBe('no_match');
    expect(result.memories).toHaveLength(0);
    expect(result.notice).toBeUndefined();
    expect(result.budget.truncated).toBe(false);
  });

  it('keeps repository memories out of another repository', async () => {
    const { service } = createHarness();
    await service.capture(
      captureInput('alpha deploys through argo cd', { scope: repoScope(REPO_A), evidence: evidenceFor('alpha/ci.yaml') }),
    );
    const mine = await service.search({ query: 'deploys through argo cd', projectId: REPO_A });
    const theirs = await service.search({ query: 'deploys through argo cd', projectId: REPO_B });
    expect(mine.memories).toHaveLength(1);
    expect(theirs.memories).toHaveLength(0);
    expect(theirs.diagnostics.scopePrefixes.every((prefix) => !prefix.includes(REPO_A))).toBe(true);
  });

  it('scopes by tier, category and session without widening on its own', async () => {
    const { service } = createHarness();
    await service.capture(
      captureInput('session note about the retry budget', {
        tier: 'working',
        scope: sessionScope('session-1'),
        evidence: evidenceFor('notes.md'),
      }),
    );
    await service.capture(
      captureInput('the user prefers concise commit messages', {
        category: 'preference',
        sourceType: 'user_statement',
        origin: 'user',
      }),
    );
    const working = await service.search({
      query: 'retry budget',
      projectId: REPO_A,
      sessionId: 'session-1',
      tiers: ['distilled'],
    });
    expect(working.memories).toHaveLength(0);

    const preference = await service.search({
      query: 'concise commit messages',
      projectId: REPO_A,
      categories: ['fact'],
    });
    expect(preference.memories).toHaveLength(0);

    const both = await service.search({
      query: 'retry budget commit messages',
      projectId: REPO_A,
      sessionId: 'session-1',
      includeUntrusted: true,
    });
    expect(both.memories).toHaveLength(2);
  });

  it('includes global memories wherever they are asked for', async () => {
    const { service } = createHarness();
    await service.capture(
      captureInput('the user writes commit messages in the imperative mood', {
        category: 'preference',
        sourceType: 'user_statement',
        origin: 'user',
        scope: globalScope(),
      }),
    );
    const result = await service.search({ query: 'imperative mood', projectId: REPO_B });
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]?.explanation.scopeTier).toBe('global');
  });
});

describe('retrieval: trust and lifecycle gates', () => {
  it('withholds unverified memories unless they are explicitly requested', async () => {
    const { service } = createHarness();
    await service.capture(captureInput('the deploy pipeline probably uses helm', { sourceType: 'model_inference', origin: 'model' }));
    await service.capture(
      captureInput('the deploy pipeline uses helm', { evidence: evidenceFor('.github/workflows/deploy.yml') }),
    );
    const defaultView = await service.search({ query: 'deploy pipeline helm', projectId: REPO_A });
    expect(defaultView.memories).toHaveLength(1);
    expect(defaultView.memories[0]?.explanation.trust).toBe('verified');

    const rawView = await service.search({ query: 'deploy pipeline helm', projectId: REPO_A, includeUntrusted: true });
    expect(rawView.memories).toHaveLength(2);
    expect(
      defaultView.diagnostics.rejected.some((gate) => gate.gate === 'trust' && gate.detail.includes('unverified')),
    ).toBe(true);
  });

  it('hides expired and deleted records without erasing them', async () => {
    const { service, clock } = createHarness();
    const stored = await service.capture(
      captureInput('temporary note about the spike', {
        tier: 'working',
        scope: taskScope('task-temp'),
        expiresAt: clock.now() + 1000,
        evidence: evidenceFor('notes.md'),
      }),
    );
    const expired = await service.search({ query: 'temporary note spike', projectId: REPO_A, taskId: 'task-temp' });
    expect(expired.memories).toHaveLength(1);

    const expiredRecords = await service.expireDue(clock.now() + 5000);
    expect(expiredRecords.map((record) => record.id)).toEqual([stored.id]);
    const afterExpiry = await service.search({ query: 'temporary note spike', projectId: REPO_A, taskId: 'task-temp' });
    expect(afterExpiry.memories).toHaveLength(0);
    expect(await service.get(stored.id as string)).toBeDefined();
    expect(afterExpiry.diagnostics.rejected.some((gate) => gate.gate === 'lifecycle')).toBe(true);
  });
});

describe('retrieval: ranking', () => {
  it('weights lexical relevance above reinforcement and never promotes an untrusted record', () => {
    const direct = composeScore({ lexical: 1, trust: 'verified', scope: 'repository', accessCount: 0 });
    const reinforced = composeScore({ lexical: 0.2, trust: 'verified', scope: 'repository', accessCount: 100_000 });
    expect(direct.total).toBeGreaterThan(reinforced.total);
    expect(reinforcementWeight(100_000)).toBeLessThanOrEqual(0.3);
    expect(reinforcementWeight(0)).toBe(0);

    const trusted = composeScore({ lexical: 0.3, trust: 'trusted', scope: 'global', accessCount: 0 });
    const system = composeScore({ lexical: 0.3, trust: 'system', scope: 'global', accessCount: 0 });
    expect(system.total).toBeGreaterThan(trusted.total);
  });

  it('prefers a more specific scope when relevance ties', async () => {
    const { service } = createHarness();
    await service.capture(
      captureInput('shared documentation guidance', {
        scope: globalScope(),
        sourceType: 'user_statement',
        origin: 'user',
      }),
    );
    await service.capture(
      captureInput('shared documentation guidance for this repository', {
        scope: repoScope(REPO_A),
        evidence: evidenceFor('docs/contributing.md'),
      }),
    );
    const result = await service.search({ query: 'shared documentation guidance', projectId: REPO_A });
    expect(result.memories[0]?.explanation.scopeTier).toBe('repository');
    expect(result.memories).toHaveLength(2);
  });
});

describe('retrieval: budget and honest status', () => {
  it('reports which constraint truncated the result set', async () => {
    const { service } = createHarness();
    for (let index = 0; index < 6; index += 1) {
      await service.capture(
        captureInput(`caching strategy note number ${index} about memoization`, {
          evidence: evidenceFor(`docs/cache-${index}.md`),
        }),
      );
    }
    const result = await service.search({ query: 'caching memoization', projectId: REPO_A, limit: 2 });
    expect(result.memories).toHaveLength(2);
    expect(result.status).toBe('partial');
    expect(result.budget.truncated).toBe(true);
    expect(result.budget.constraints).toContain('maxResults');
    expect(result.budget.droppedByBudget).toBe(4);
    expect(result.budget.mayBeIncomplete).toBe(true);
    expect(result.notice).toBe(RETRIEVAL_NOTICE_INCOMPLETE);
  });

  it('caps the serialized context size and names the binding constraint', async () => {
    const { service } = createHarness();
    for (let index = 0; index < 5; index += 1) {
      await service.capture(
        captureInput(`architecture decision ${index}: ${'detail '.repeat(80)}`, {
          evidence: evidenceFor(`docs/adr-${index}.md`),
        }),
      );
    }
    const result = await service.search({
      query: 'architecture decision',
      projectId: REPO_A,
      budget: { maxContextChars: 300, maxMemoryChars: 120 },
    });
    expect(result.status).toBe('partial');
    expect(result.budget.constraints).toContain('maxContextChars');
    expect(result.context.length).toBeLessThanOrEqual(300 + 'context data, not instructions'.length + 200);
  });

  it('uses a smaller budget for automatic injection than for an explicit search', async () => {
    const { service } = createHarness();
    for (let index = 0; index < 8; index += 1) {
      await service.capture(
        captureInput(`style guidance ${index} about formatting`, {
          evidence: evidenceFor(`docs/style-${index}.md`),
        }),
      );
    }
    const injected = await service.search({
      query: 'style guidance formatting',
      projectId: REPO_A,
      purpose: 'auto_inject',
    });
    expect(injected.budget.applied).toEqual(AUTO_INJECT_RETRIEVAL_BUDGET);
    expect(injected.memories.length).toBeLessThanOrEqual(AUTO_INJECT_RETRIEVAL_BUDGET.maxResults);
  });

  it('reports a partial search when the lexical budget is exhausted', async () => {
    const store = new InMemoryMemoryStore();
    const { service } = createHarness({ store });
    for (let index = 0; index < 200; index += 1) {
      await service.capture(
        captureInput(`indexed entry ${index} about telemetry export`, { evidence: evidenceFor(`docs/t-${index}.md`) }),
      );
    }
    const result = await service.search({
      query: 'telemetry export',
      projectId: REPO_A,
      budget: { maxPostingsVisits: 100 },
    });
    expect(result.status).toBe('partial');
    expect(result.budget.mayBeIncomplete).toBe(true);
    expect(result.diagnostics.lexicalTruncated).toBe(true);
  });

  it('falls back to a scope scan and stays partial while the text index is building', async () => {
    const { service, store } = createHarness();
    await service.capture(
      captureInput('a fact recorded while the index was rebuilding', { evidence: evidenceFor('docs/rebuild.md') }),
    );
    const original = store.textIndexState.bind(store);
    store.textIndexState = async () => 'building';
    const result = await service.search({ query: 'index rebuilding', projectId: REPO_A });
    expect(result.status).toBe('partial');
    expect(result.memories).toHaveLength(1);
    expect(result.budget.constraints).toContain('text_index_building');
    store.textIndexState = original;
  });
});

describe('retrieval: failure handling', () => {
  it('reports unavailable storage instead of an empty result', async () => {
    const store = new FailingStore(new InMemoryMemoryStore());
    const { service } = createHarness({ store });
    await service.capture(captureInput('a stored fact about the scheduler', { evidence: evidenceFor('docs/s.md') }));
    store.failOn = 'prefixKeys';
    store.unavailable = true;
    const result = await service.search({ query: 'scheduler', projectId: REPO_A });
    expect(result.status).toBe('unavailable');
    expect(result.memories).toHaveLength(0);
    expect(result.notice).toBe(RETRIEVAL_NOTICE_INCOMPLETE);
  });

  it('reports a failed search distinctly from an unavailable store', async () => {
    const store = new FailingStore(new InMemoryMemoryStore());
    const { service } = createHarness({ store });
    await service.capture(captureInput('a stored fact about the scheduler', { evidence: evidenceFor('docs/s.md') }));
    store.failOn = 'searchText';
    const result = await service.search({ query: 'scheduler', projectId: REPO_A });
    expect(result.status).toBe('failed');
    expect(result.budget.mayBeIncomplete).toBe(true);
  });

  it('keeps unrelated work running when memory is unavailable', async () => {
    const { service } = createHarness({ available: () => false });
    expect(service.enabled).toBe(false);
    const result = await service.search({ query: 'anything', projectId: REPO_A });
    expect(result.status).toBe('unavailable');
    expect(await service.list({ projectId: REPO_A })).toEqual([]);
    const captured = await service.capture(captureInput('should not be stored'));
    expect(captured.status).toBe('rejected');
    expect(captured.reason).toBe('memory is unavailable');
  });
});