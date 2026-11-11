import { describe, expect, it } from 'vitest';

import { captureInput, createHarness, evidenceFor, REPO_A } from './helpers';

describe('retention and legal hold', () => {
  it('does not expire pinned or neverExpire records', async () => {
    const harness = createHarness();
    const pinned = await harness.service.capture(
      captureInput('the pinned release note', {
        evidence: evidenceFor('docs/release.md'),
        retention: 'pinned',
        expiresAt: harness.clock.now() + 10,
      }),
    );
    const never = await harness.service.capture(
      captureInput('the never expiring note', {
        evidence: evidenceFor('docs/never.md'),
        retention: 'neverExpire',
        expiresAt: harness.clock.now() + 10,
      }),
    );
    expect(
      (await harness.service.expireDue(harness.clock.now() + 100)).map((record) => record.id),
    ).not.toEqual(expect.arrayContaining([pinned.id, never.id]));
  });

  it('expires an ephemeral record and hides a held record from normal retrieval', async () => {
    const harness = createHarness();
    const held = await harness.service.capture(
      captureInput('the held incident note', {
        evidence: evidenceFor('docs/incident.md'),
        retention: 'ephemeral',
        expiresAt: harness.clock.now() + 100,
      }),
    );
    await harness.service.setLegalHold(held.id as string, true, 'incident review');

    const normal = await harness.service.search({ query: 'held incident note', projectId: REPO_A });
    expect(normal.memories).toHaveLength(0);

    const explicit = await harness.service.search({
      query: 'held incident note',
      projectId: REPO_A,
      includeHeld: true,
    });
    expect(explicit.memories.map((memory) => memory.record.id)).toEqual([held.id]);

    expect(await harness.service.delete(held.id as string, 'cleanup')).toMatchObject({
      status: 'rejected',
    });
    expect(await harness.service.setLegalHold(held.id as string, false, 'review complete')).toMatchObject({
      status: 'updated',
    });
  });
});
