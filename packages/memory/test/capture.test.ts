import { describe, expect, it } from 'vitest';

import { MemoryError, MemoryErrors } from '#/contracts/errors';
import { InMemoryMemoryStore } from '#/storage/memoryStore';

import {
  captureInput,
  createHarness,
  evidenceFor,
  FailingStore,
  REPO_A,
  repoScope,
  sessionScope,
} from './helpers';

describe('capture pipeline', () => {
  it('preserves source references and evidence on the stored record', async () => {
    const harness = createHarness();
    const stored = await harness.service.capture(
      captureInput('the release pipeline signs tags with cosign', {
        sourceType: 'repository_file',
        evidence: evidenceFor('.github/workflows/release.yml'),
        repoRevision: 'deadbeef',
      }),
    );
    expect(stored.record?.evidence).toEqual([
      {
        kind: 'file',
        ref: '.github/workflows/release.yml',
        state: 'present',
        fingerprint: 'fp-.github/workflows/release.yml',
        observedAt: 1,
      },
    ]);
    expect(stored.record?.repoRevision).toBe('deadbeef');
    expect(stored.record?.createdAt).toBe(stored.record?.updatedAt);
    expect(stored.record?.revision).toBe(0);
  });

  it('deduplicates repeated content instead of storing it twice', async () => {
    const harness = createHarness();
    const first = await harness.service.capture(
      captureInput('the api gateway rate limit is 100 rps', { evidence: evidenceFor('docs/gateway.md') }),
    );
    const again = await harness.service.capture(
      captureInput('  the api gateway rate limit is 100 rps  ', { evidence: evidenceFor('docs/gateway.md') }),
    );
    expect(first.status).toBe('stored');
    expect(again.status).toBe('deduplicated');
    expect(again.id).toBe(first.id);
    expect(await harness.service.list({ projectId: REPO_A })).toHaveLength(1);
  });

  it('keeps identical content in different scopes apart', async () => {
    const harness = createHarness();
    const inRepo = await harness.service.capture(
      captureInput('the lint script is shared', { scope: repoScope(REPO_A), evidence: evidenceFor('a.md') }),
    );
    const inSession = await harness.service.capture(
      captureInput('the lint script is shared', { scope: sessionScope('session-9'), evidence: evidenceFor('a.md') }),
    );
    expect(inRepo.id).not.toBe(inSession.id);
    expect(await harness.service.list({ projectId: REPO_A, sessionId: 'session-9' })).toHaveLength(2);
  });

  it('is idempotent under a repeated request key', async () => {
    const harness = createHarness();
    const input = captureInput('an observation recorded from a tool run', {
      tier: 'working',
      scope: sessionScope('session-idem'),
      requestKey: 'tool-run-42',
      evidence: evidenceFor('tool-call-42'),
    });
    const first = await harness.service.capture(input);
    const second = await harness.service.capture(input);
    expect(first.status).toBe('stored');
    expect(second.id).toBe(first.id);
    expect(await harness.service.list({ projectId: REPO_A, sessionId: 'session-idem' })).toHaveLength(1);
  });

  it('rejects empty and oversized content without touching the store', async () => {
    const harness = createHarness({ settings: { maxContentChars: 40 } });
    expect((await harness.service.capture(captureInput('   '))).status).toBe('rejected');
    const oversized = await harness.service.capture(captureInput('x'.repeat(64)));
    expect(oversized.status).toBe('rejected');
    expect(oversized.reason).toContain('exceeds 40 characters');
    expect(await harness.service.list({ projectId: REPO_A })).toHaveLength(0);
  });

  it('records the ingestion without logging memory content', async () => {
    const harness = createHarness();
    await harness.service.capture(captureInput('a distinctive sentence nobody else wrote', { evidence: evidenceFor('a.md') }));
    const logged = harness.log.entriesAt('info');
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged[0]?.context)).toContain('memoryId');
    expect(JSON.stringify(logged[0]?.context)).not.toContain('distinctive sentence');
  });
});

describe('background review queue', () => {
  it('queues a capture and processes it into a durable record', async () => {
    const harness = createHarness();
    const queued = await harness.service.capture(
      captureInput('a fact worth distilling', { review: 'queued', evidence: evidenceFor('docs/distill.md') }),
    );
    expect(queued.status).toBe('queued');

    const pending = await harness.service.pendingReviews(harness.clock.now(), 10);
    expect(pending).toHaveLength(1);

    const report = await harness.service.runReview(10);
    expect(report.processed).toBe(1);
    expect(report.stored).toBe(1);
    expect(report.jobs[0]?.status).toBe('done');
    expect(await harness.service.pendingReviews(harness.clock.now(), 10)).toHaveLength(0);
    expect(await harness.service.search({ query: 'worth distilling', projectId: REPO_A })).toMatchObject({
      status: 'complete',
    });
  });

  it('does not create duplicates when a review job runs twice', async () => {
    const harness = createHarness();
    await harness.service.capture(captureInput('a queued fact about caching', { review: 'queued', evidence: evidenceFor('a.md') }));
    await harness.service.runReview(10);
    const replay = await harness.service.runReview(10);
    expect(replay.processed).toBe(0);
    expect(await harness.service.list({ projectId: REPO_A })).toHaveLength(1);
  });

  it('retries a failed review with backoff and recovers without duplicating', async () => {
    const store = new FailingStore(new InMemoryMemoryStore());
    const harness = createHarness({ store, settings: { reviewMaxAttempts: 3, reviewBackoffMs: 100 } });
    await harness.service.capture(captureInput('a queued fact that will fail', { review: 'queued', evidence: evidenceFor('a.md') }));

    store.failOn = 'commit';
    const first = await harness.service.runReview(10);
    expect(first.retrying).toBe(1);
    expect(first.jobs[0]?.attempts).toBe(1);
    expect(first.jobs[0]?.status).toBe('retrying');
    expect(first.jobs[0]?.reason).toBe('memory could not be stored');

    store.failOn = undefined;
    const recovered = await harness.service.runReview(harness.clock.now() + 1000);
    expect(recovered.stored).toBe(1);
    expect(await harness.service.list({ projectId: REPO_A })).toHaveLength(1);
  });

  it('holds a retry back until its backoff window has elapsed', async () => {
    const store = new InMemoryMemoryStore();
    const harness = createHarness({ store, settings: { reviewBackoffMs: 5_000 } });
    await harness.service.capture(
      captureInput('a queued fact that will retry later', { review: 'queued', evidence: evidenceFor('a.md') }),
    );
    const job = (await harness.service.pendingReviews(harness.clock.now(), 10))[0];
    await store.commit([
      {
        op: 'set',
        key: `q:${job?.id}`,
        value: { ...job, status: 'pending', attempts: 1, nextAttemptAt: harness.clock.now() + 5_000 },
      },
    ]);
    expect(await harness.service.pendingReviews(harness.clock.now(), 10)).toHaveLength(0);
    expect((await harness.service.runReview(10)).processed).toBe(0);
    harness.clock.set(harness.clock.now() + 10_000);
    expect((await harness.service.runReview(10)).processed).toBe(1);
  });

  it('surfaces a permanently failing job through diagnostics instead of dropping it', async () => {
    const store = new InMemoryMemoryStore();
    const harness = createHarness({ store });
    const queued = await harness.service.capture(
      captureInput('a queued fact about export', { review: 'queued', evidence: evidenceFor('a.md') }),
    );
    const job = (await harness.service.pendingReviews(harness.clock.now(), 10))[0];
    await store.commit([
      {
        op: 'set',
        key: `q:${job?.id ?? queued.id}`,
        value: { ...job, status: 'failed', attempts: 5, lastError: 'storage kept failing' },
      },
    ]);

    const diagnostics = await harness.service.diagnostics();
    expect(diagnostics.failedReviews).toBe(1);
    expect(diagnostics.pendingReviews).toBe(0);
    expect(await harness.service.pendingReviews(harness.clock.now(), 10)).toHaveLength(0);
  });

  it('keeps a review readable through a transient read failure without discarding it', async () => {
    const inner = new InMemoryMemoryStore();
    const store = new FailingStore(inner);
    const harness = createHarness({ store });
    await harness.service.capture(captureInput('a queued fact about metrics', { review: 'queued', evidence: evidenceFor('a.md') }));
    store.failOn = 'prefixKeys';
    expect(await harness.service.pendingReviews(harness.clock.now(), 10)).toEqual([]);
    store.failOn = undefined;
    expect(await harness.service.pendingReviews(harness.clock.now(), 10)).toHaveLength(1);
  });

  it('refuses to queue beyond the configured limit', async () => {
    const harness = createHarness({ settings: { maxQueuedReviews: 2 } });
    for (let index = 0; index < 3; index += 1) {
      const result = await harness.service.capture(
        captureInput(`queued fact number ${index}`, { review: 'queued', evidence: evidenceFor(`a-${index}.md`) }),
      );
      if (index < 2) expect(result.status).toBe('queued');
      else {
        expect(result.status).toBe('rejected');
        expect(result.reason).toContain('queue is full');
      }
    }
  });

  it('refuses to queue content that would be rejected anyway', async () => {
    const harness = createHarness();
    const result = await harness.service.capture(
      captureInput('run rm -rf after each step', {
        tier: 'working',
        category: 'policy',
        review: 'queued',
        scope: sessionScope('session-q'),
      }),
    );
    expect(result.status).toBe('rejected');
    expect(await harness.service.pendingReviews(harness.clock.now(), 10)).toHaveLength(0);
  });
});

describe('failure handling', () => {
  it('surfaces a write failure without claiming the memory was stored', async () => {
    const store = new FailingStore(new InMemoryMemoryStore());
    const harness = createHarness({ store });
    store.failOn = 'commit';
    const result = await harness.service.capture(captureInput('a memory that cannot be written'));
    expect(result.status).toBe('failed');
    expect(result.id).toBeUndefined();
    expect(result.reason).toBe('memory could not be stored');
    expect(
      harness.log.entriesAt('warn').some(
        (entry) => JSON.stringify(entry.context).includes('"operation":"commit"'),
      ),
    ).toBe(true);
  });

  it('reports a superseded record as unchanged when the write fails', async () => {
    const store = new FailingStore(new InMemoryMemoryStore());
    const harness = createHarness({ store });
    const older = await harness.service.capture(captureInput('an older claim about the queue', { evidence: evidenceFor('a.md') }));
    const newer = await harness.service.capture(captureInput('a newer claim about the queue', { evidence: evidenceFor('b.md') }));
    store.failOn = 'commit';
    const result = await harness.service.supersede(older.id as string, {
      successorId: newer.id as string,
      reason: 'manual',
    });
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('supersession was not durable');
    store.failOn = undefined;
    expect((await harness.service.get(older.id as string))?.lifecycle).not.toBe('superseded');
  });

  it('classifies storage errors through the registered error domain', () => {
    const error = new MemoryError(MemoryErrors.codes.STORAGE_UNAVAILABLE, 'store is gone');
    expect(error.code).toBe('memory.storage_unavailable');
    expect(error.isExpected).toBe(true);
    expect(error.name).toBe('MemoryError');
  });

  it('does not corrupt unrelated work when memory keeps failing', async () => {
    const store = new FailingStore(new InMemoryMemoryStore());
    const harness = createHarness({ store });
    store.failOn = 'searchText';
    for (const query of ['a', 'b', 'c']) {
      const result = await harness.service.search({ query, projectId: REPO_A });
      expect(['failed', 'no_match', 'partial']).toContain(result.status);
    }
    store.failOn = undefined;
    const stored = await harness.service.capture(captureInput('memory works again', { evidence: evidenceFor('a.md') }));
    expect(stored.status).toBe('stored');
  });
});