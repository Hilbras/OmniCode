import { describe, expect, it } from 'vitest';

import type { IMemoryService, MemoryReviewReport } from '#/contracts/memoryContract';
import { MemoryMaintenanceScheduler, REVIEW_BATCH } from '#/service/memoryMaintenance';

import { captureInput, createHarness, evidenceFor, FakeTimers, REPO_A } from './helpers';

function emptyReport(overrides: Partial<MemoryReviewReport> = {}): MemoryReviewReport {
  return {
    processed: 0,
    stored: 0,
    deduplicated: 0,
    skipped: 0,
    retrying: 0,
    failed: 0,
    jobs: [],
    ...overrides,
  };
}

describe('maintenance scheduler', () => {
  it('drains queued reviews on startup without needing an enqueue', async () => {
    const harness = createHarness();
    await harness.service.capture(
      captureInput('a queued fact about sharding', { review: 'queued', evidence: evidenceFor('a.md') }),
    );
    expect(await harness.service.pendingReviews(harness.clock.now(), 10)).toHaveLength(1);

    const timers = new FakeTimers();
    const scheduler = new MemoryMaintenanceScheduler({
      memory: harness.service,
      log: harness.log,
      enabled: () => true,
      now: harness.clock.now,
      timers,
      reviewDebounceMs: 0,
    });
    scheduler.start();
    await timers.fireAll(scheduler);

    expect(scheduler.lastReview?.processed).toBe(1);
    expect(scheduler.lastReview?.stored).toBe(1);
    expect(await harness.service.pendingReviews(harness.clock.now(), 10)).toHaveLength(0);
    scheduler.dispose();
  });

  it('drains a debounced after an enqueue', async () => {
    const harness = createHarness();
    const timers = new FakeTimers();
    const scheduler = new MemoryMaintenanceScheduler({
      memory: harness.service,
      log: harness.log,
      enabled: () => true,
      now: harness.clock.now,
      timers,
      reviewDebounceMs: 10,
    });
    scheduler.start();
    await timers.fireAll(scheduler);

    await harness.service.capture(
      captureInput('a queued fact about backpressure', { review: 'queued', evidence: evidenceFor('b.md') }),
    );
    scheduler.notifyQueued();
    expect(timers.size).toBeGreaterThan(0);
    await timers.fireAll(scheduler);

    expect(scheduler.lastReview?.stored).toBe(1);
    scheduler.dispose();
  });

  it('does nothing when memory is disabled', async () => {
    const harness = createHarness();
    const timers = new FakeTimers();
    const scheduler = new MemoryMaintenanceScheduler({
      memory: harness.service,
      log: harness.log,
      enabled: () => false,
      now: harness.clock.now,
      timers,
      reviewDebounceMs: 0,
    });
    scheduler.start();
    await timers.fireAll(scheduler);
    expect(scheduler.lastReview).toBeUndefined();
    expect(harness.log.entriesAt('info').filter((entry) => entry.message === 'memory review drained')).toHaveLength(0);
    scheduler.dispose();
  });

  it('keeps polling and stops once disposed', async () => {
    const harness = createHarness();
    const timers = new FakeTimers();
    const scheduler = new MemoryMaintenanceScheduler({
      memory: harness.service,
      log: harness.log,
      enabled: () => true,
      now: harness.clock.now,
      timers,
      reviewPollMs: 1,
      reviewDebounceMs: 100,
      retentionSweepMs: 100,
    });
    scheduler.start();
    expect(timers.size).toBe(4);
    await timers.fireAll(scheduler);
    expect(timers.size).toBe(3);
    await timers.fireAll(scheduler);
    expect(timers.size).toBe(3);

    scheduler.dispose();
    expect(timers.size).toBe(0);
    await timers.fireAll(scheduler);
    expect(harness.log.entriesAt('info').filter((entry) => entry.message === 'memory review drained')).toHaveLength(0);
  });

  it('records a drain failure instead of throwing', async () => {
    const harness = createHarness();
    const failing: IMemoryService = {
      ...harness.service,
      runReview: async () => {
        throw new Error('store went away mid-drain');
      },
      pendingReviews: async () => [],
    } as unknown as IMemoryService;
    const timers = new FakeTimers();
    const scheduler = new MemoryMaintenanceScheduler({
      memory: failing,
      log: harness.log,
      enabled: () => true,
      now: harness.clock.now,
      timers,
      reviewDebounceMs: 0,
    });
    scheduler.start();
    await timers.fireAll(scheduler);
    expect(scheduler.lastReview).toBeUndefined();
    expect(harness.log.entriesAt('warn').some((entry) => entry.message === 'memory review drain failed')).toBe(true);
    scheduler.dispose();
  });

  it('runs the retention sweep and logs what it expired', async () => {
    const harness = createHarness();
    await harness.service.capture(
      captureInput('a temporary note about the spike', {
        tier: 'working',
        scope: { tier: 'task', taskId: 'task-maint', projectId: REPO_A },
        expiresAt: harness.clock.now() + 1,
        evidence: evidenceFor('c.md'),
      }),
    );
    const timers = new FakeTimers();
    const scheduler = new MemoryMaintenanceScheduler({
      memory: harness.service,
      log: harness.log,
      enabled: () => true,
      now: harness.clock.now,
      timers,
      retentionSweepMs: 0,
      reviewDebounceMs: 100_000,
    });
    scheduler.start();
    await timers.fireAll(scheduler);
    harness.clock.set(harness.clock.now() + 10_000);
    await timers.fireAll(scheduler);

    expect(harness.log.entriesAt('info').some((entry) => entry.message === 'memory retention expired records')).toBe(
      true,
    );
    scheduler.dispose();
  });

  it('does not overlap drains', async () => {
    const harness = createHarness();
    let running = 0;
    let peak = 0;
    const slow: IMemoryService = {
      ...harness.service,
      runReview: async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setImmediate(resolve));
        running -= 1;
        return emptyReport({ processed: 1, stored: 1 });
      },
    } as unknown as IMemoryService;
    const timers = new FakeTimers();
    const scheduler = new MemoryMaintenanceScheduler({
      memory: slow,
      log: harness.log,
      enabled: () => true,
      now: harness.clock.now,
      timers,
      reviewDebounceMs: 0,
    });
    scheduler.start();

    await Promise.all([scheduler.drainNow(), scheduler.drainNow(), scheduler.drainNow()]);
    expect(peak).toBe(1);
    expect(scheduler.lastReview?.stored).toBe(1);
    scheduler.dispose();
  });

  it('purges working memory only after the grace window', async () => {
    const harness = createHarness();
    await harness.service.capture(
      captureInput('a temporary note about the rollout', {
        tier: 'working',
        scope: { tier: 'task', taskId: 'task-purge', projectId: REPO_A },
        expiresAt: harness.clock.now() + 1,
        evidence: evidenceFor('e.md'),
      }),
    );
    const timers = new FakeTimers();
    const scheduler = new MemoryMaintenanceScheduler({
      memory: harness.service,
      log: harness.log,
      enabled: () => true,
      now: harness.clock.now,
      timers,
      retentionSweepMs: 0,
      reviewDebounceMs: 100_000,
      workingGraceMs: 60_000,
    });
    scheduler.start();
    harness.clock.set(harness.clock.now() + 10_000);
    await timers.fireAll(scheduler);

    expect(harness.log.entriesAt('info').some((e) => e.message === 'memory retention expired records')).toBe(true);
    expect(harness.log.entriesAt('info').some((e) => e.message === 'memory retention purged working records')).toBe(
      false,
    );
    expect(
      await harness.service.list({ projectId: REPO_A, taskId: 'task-purge', tiers: ['working'] }),
    ).toHaveLength(1);

    harness.clock.set(harness.clock.now() + 120_000);
    await timers.fireAll(scheduler);

    expect(harness.log.entriesAt('info').some((e) => e.message === 'memory retention purged working records')).toBe(
      true,
    );
    expect(
      await harness.service.list({ projectId: REPO_A, taskId: 'task-purge', tiers: ['working'] }),
    ).toHaveLength(0);
    scheduler.dispose();
  });

  it('keeps sweeping after a failed expire pass', async () => {
    const harness = createHarness();
    let expiredCalls = 0;
    const flaky: IMemoryService = {
      ...harness.service,
      expireDue: async (now: number) => {
        expiredCalls += 1;
        if (expiredCalls === 1) throw new Error('transient sweep failure');
        return harness.service.expireDue(now);
      },
      purgeWorking: (olderThan: number) => harness.service.purgeWorking(olderThan),
      pendingReviews: (now: number, limit: number) => harness.service.pendingReviews(now, limit),
    } as unknown as IMemoryService;
    const timers = new FakeTimers();
    const scheduler = new MemoryMaintenanceScheduler({
      memory: flaky,
      log: harness.log,
      enabled: () => true,
      now: harness.clock.now,
      timers,
      retentionSweepMs: 0,
      reviewDebounceMs: 100_000,
    });
    scheduler.start();
    await timers.fireAll(scheduler);
    await timers.fireAll(scheduler);
    expect(expiredCalls).toBe(2);
    expect(harness.log.entriesAt('warn').some((e) => e.message === 'memory retention expire failed')).toBe(true);
    scheduler.dispose();
  });

  it('reports what it drained without logging memory content', async () => {
    const harness = createHarness();
    await harness.service.capture(
      captureInput('a distinctive queued sentence', { review: 'queued', evidence: evidenceFor('d.md') }),
    );
    const timers = new FakeTimers();
    const scheduler = new MemoryMaintenanceScheduler({
      memory: harness.service,
      log: harness.log,
      enabled: () => true,
      now: harness.clock.now,
      timers,
      reviewDebounceMs: 0,
    });
    scheduler.start();
    await timers.fireAll(scheduler);
    const drained = harness.log.entriesAt('info').find((entry) => entry.message === 'memory review drained');
    expect(drained?.context).toMatchObject({ reason: 'startup', processed: 1, stored: 1 });
    expect(JSON.stringify(drained?.context)).not.toContain('distinctive queued sentence');
    scheduler.dispose();
  });

  it('bounds one drain to a fixed batch', () => {
    expect(REVIEW_BATCH).toBeGreaterThan(0);
  });
});