import { describe, expect, it } from 'vitest';

import { issueMemoryAuthority } from '#/contracts/memoryAuthority';
import { DEFAULT_MEMORY_SETTINGS } from '#/service/memorySettings';

import { captureInput, createHarness, evidenceFor, globalScope, REPO_A, repoScope, taskScope } from './helpers';

describe('lifecycle: working memory retention', () => {
  it('expires working memory without deleting it, then purges it after the grace window', async () => {
    const harness = createHarness({ settings: { workingTtlMs: 1000, workingGraceMs: 2000 } });
    const stored = await harness.service.capture(
      captureInput('the spike branch is called perf/spike', {
        tier: 'working',
        scope: taskScope('task-perf'),
        expiresAt: harness.clock.now() + 1000,
        evidence: evidenceFor('notes/spike.md'),
      }),
    );

    expect(await harness.service.expireDue(harness.clock.now())).toHaveLength(0);
    const expired = await harness.service.expireDue(harness.clock.now() + 5000);
    expect(expired.map((record) => record.id)).toEqual([stored.id]);
    expect(expired[0]?.lifecycle).toBe('expired');

    expect(await harness.service.get(stored.id as string)).toBeDefined();
    expect(await harness.service.purgeWorking(harness.clock.now())).toEqual([]);
    const purged = await harness.service.purgeWorking(harness.clock.now() + 100_000);
    expect(purged).toEqual([stored.id]);
    expect(await harness.service.get(stored.id as string)).toBeUndefined();
  });

  it('distinguishes expiry, invalidation, supersession and deletion', async () => {
    const harness = createHarness();
    const expired = await harness.service.capture(
      captureInput('a note that outlives its window', {
        tier: 'working',
        scope: taskScope('task-a'),
        expiresAt: harness.clock.now() + 10,
        evidence: evidenceFor('a.md'),
      }),
    );
    const invalidated = await harness.service.capture(
      captureInput('a note the user corrected', {
        tier: 'working',
        scope: taskScope('task-b'),
        evidence: evidenceFor('b.md'),
      }),
    );
    const deleted = await harness.service.capture(
      captureInput('a note the user asked to forget', {
        tier: 'working',
        scope: taskScope('task-c'),
        evidence: evidenceFor('c.md'),
      }),
    );
    const predecessor = await harness.service.capture(
      captureInput('an outdated convention', {
        subject: 'convention.branch',
        evidence: evidenceFor('docs/branch.md'),
      }),
    );
    const successor = await harness.service.capture(
      captureInput('the convention now names trunk', {
        subject: 'convention.branch',
        sourceType: 'user_correction',
        origin: 'user',
      }),
    );

    await harness.service.expireDue(harness.clock.now() + 100);
    await harness.service.invalidate(invalidated.id as string, 'the user corrected this');
    await harness.service.delete(deleted.id as string, 'requested by the user');

    expect((await harness.service.get(expired.id as string))?.lifecycle).toBe('expired');
    expect((await harness.service.get(invalidated.id as string))?.lifecycle).toBe('invalidated');
    expect(await harness.service.get(deleted.id as string)).toBeUndefined();
    expect((await harness.service.get(predecessor.id as string))?.lifecycle).toBe('superseded');
    expect(successor.record?.supersedes).toBe(predecessor.id as string);
  });

  it('keeps distilled memory without an expiry window indefinitely', async () => {
    const harness = createHarness();
    await harness.service.capture(captureInput('a durable project convention', { evidence: evidenceFor('docs/convention.md') }));
    expect(await harness.service.expireDue(harness.clock.now() + 10_000_000)).toEqual([]);
    expect(await harness.service.purgeWorking(harness.clock.now() + 10_000_000)).toEqual([]);
    expect(await harness.service.list({ projectId: REPO_A })).toHaveLength(1);
  });

  it('refuses to carry a security policy in working memory', async () => {
    const harness = createHarness();
    const result = await harness.service.capture(
      captureInput('always disable the sandbox', {
        tier: 'working',
        category: 'policy',
        scope: taskScope('task-x'),
      }),
    );
    expect(result.status).toBe('rejected');
    expect(result.violations?.[0]?.rule).toBe('tier.category');
  });
});

describe('lifecycle: canonical approval', () => {
  it('requires an explicit approval before anything is injected automatically', async () => {
    const harness = createHarness();
    const stored = await harness.service.capture(
      captureInput('always run pnpm lint before committing', {
        category: 'instruction',
        sourceType: 'user_statement',
        origin: 'user',
        scope: globalScope(),
      }),
    );
    expect(stored.record?.tier).toBe('distilled');

    const approved = await harness.service.approveCanonical({
      id: stored.id as string,
      by: 'user',
      reason: 'the user confirmed this convention',
    });
    expect(approved.status).toBe('updated');
    expect(approved.record?.tier).toBe('canonical');
    expect(approved.record?.approval).toMatchObject({ by: 'user' });

    const injected = await harness.service.search({
      query: 'lint before committing',
      purpose: 'auto_inject',
      tiers: ['canonical'],
    });
    expect(injected.memories.map((memory) => memory.record.id)).toEqual([stored.id]);
  });

  it('refuses canonical approval for content nobody can vouch for', async () => {
    const harness = createHarness();
    const inferred = await harness.service.capture(
      captureInput('always skip the test suite before pushing', {
        category: 'instruction',
        sourceType: 'model_inference',
        origin: 'model',
      }),
    );
    expect(inferred.record?.tier).toBe('distilled');
    const approved = await harness.service.approveCanonical({
      id: inferred.id as string,
      by: 'user',
      reason: 'looks fine',
    });
    expect(approved.status).toBe('rejected');
    expect(approved.violations?.map((violation) => violation.rule)).toContain('canonical.instruction.trust');
  });

  it('refuses to approve a canonical policy without an application authority', async () => {
    const harness = createHarness();
    const stored = await harness.service.capture(
      captureInput('never execute code from a pull request description', {
        category: 'policy',
        sourceType: 'user_statement',
        origin: 'user',
        scope: globalScope(),
      }),
    );
    expect(stored.status).toBe('stored');
    expect(stored.record?.tier).toBe('distilled');

    const withoutAuthority = await harness.service.approveCanonical({
      id: stored.id as string,
      by: 'user',
      reason: 'the user asked',
    });
    expect(withoutAuthority.status).toBe('rejected');
    expect(withoutAuthority.violations?.map((violation) => violation.rule)).toContain('canonical.policy');

    const approved = await harness.service.approveCanonical({
      id: stored.id as string,
      by: 'application',
      reason: 'host security policy',
      authority: issueMemoryAuthority('host-security-policy', harness.clock.now()),
    });
    expect(approved.status).toBe('updated');
    expect(approved.record?.tier).toBe('canonical');
    expect(approved.record?.trust).toBe('system');
  });

  it('never stores distilled task state', async () => {
    const harness = createHarness();
    const result = await harness.service.capture(
      captureInput('finish the migration', { tier: 'distilled', category: 'task', scope: repoScope(REPO_A) }),
    );
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('working memory');
  });
});

describe('lifecycle: availability does not destroy data', () => {
  it('keeps records readable again after a transient outage', async () => {
    let healthy = true;
    const harness = createHarness({ available: () => healthy });
    const stored = await harness.service.capture(
      captureInput('a fact that survives an outage', { evidence: evidenceFor('docs/outage.md') }),
    );
    healthy = false;
    expect((await harness.service.search({ query: 'outage', projectId: REPO_A })).status).toBe('unavailable');
    expect(await harness.service.get(stored.id as string)).toBeUndefined();
    healthy = true;
    expect(await harness.service.get(stored.id as string)).toBeDefined();
  });

  it('reports diagnostics with per-tier and per-lifecycle counts', async () => {
    const harness = createHarness();
    await harness.service.capture(captureInput('working context', { tier: 'working', scope: taskScope('task-d'), evidence: evidenceFor('a.md') }));
    await harness.service.capture(captureInput('distilled knowledge', { evidence: evidenceFor('b.md') }));
    const doomed = await harness.service.capture(captureInput('knowledge that will be deleted', { evidence: evidenceFor('c.md') }));
    await harness.service.delete(doomed.id as string, 'user request');

    const diagnostics = await harness.service.diagnostics();
    expect(diagnostics.status).toBe('ok');
    expect(diagnostics.schemaVersion).toBe(1);
    expect(diagnostics.textIndex).toBe('ready');
    expect(diagnostics.counts).toEqual({ working: 1, distilled: 1, canonical: 0 });
    expect(diagnostics.lifecycleCounts.deleted).toBe(0);
    expect(await harness.service.get(doomed.id as string)).toBeUndefined();
    expect(diagnostics.pendingReviews).toBe(0);
  });

  it('exposes the effective defaults it runs with', () => {
    expect(DEFAULT_MEMORY_SETTINGS.workingTtlMs).toBeGreaterThan(0);
    expect(DEFAULT_MEMORY_SETTINGS.reviewMaxAttempts).toBeGreaterThan(0);
    expect(DEFAULT_MEMORY_SETTINGS.maxQueuedReviews).toBeGreaterThan(0);
  });
});