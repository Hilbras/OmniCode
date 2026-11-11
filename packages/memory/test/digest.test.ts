import { describe, expect, it } from 'vitest';

import {
  captureInput,
  createHarness,
  evidenceFor,
  REPO_A,
  REPO_B,
  repoScope,
} from './helpers';

describe('deterministic memory digest', () => {
  it('stores one record for identical input items', async () => {
    const { service } = createHarness();
    const result = await service.digest({
      items: [
        captureInput('the deploy target is staging'),
        captureInput('the deploy target is staging'),
      ],
    });
    expect(result.stored).toBe(1);
    expect(result.deduplicated).toBe(1);
    expect(await service.list({ projectId: REPO_A, scopes: ['repository'] })).toHaveLength(1);
  });

  it('deduplicates a near-identical sentence', async () => {
    const { service } = createHarness();
    const result = await service.digest({
      items: [
        captureInput('the deploy target is staging'),
        captureInput('the deploy target is staging!'),
      ],
    });
    expect(result.stored).toBe(1);
    expect(result.deduplicated).toBe(1);
  });

  it('merges a superset when merge is enabled and keeps the pre-image', async () => {
    const { service } = createHarness();
    const first = await service.capture(captureInput('the deploy target is staging'));
    const result = await service.digest({
      merge: true,
      items: [captureInput('the deploy target is staging now')],
    });

    expect(result.merged).toBe(1);
    const updated = await service.get(first.id as string);
    expect(updated?.content).toBe('the deploy target is staging now');
    const history = await service.history(first.id as string);
    expect(history).toHaveLength(1);
    expect(history[0]?.record.content).toBe('the deploy target is staging');
    expect(history[0]?.reason).toBe('update');
  });

  it('honors an adjudicator decision to store instead of merge', async () => {
    const { service } = createHarness();
    await service.capture(captureInput('the deploy target is staging'));
    const result = await service.digest({
      items: [captureInput('the deploy target is staging now')],
      adjudicate: async () => 'store',
    });
    expect(result.stored).toBe(1);
    expect(await service.list({ projectId: REPO_A, scopes: ['repository'] })).toHaveLength(2);
  });

  it('does not merge different quantities', async () => {
    const { service } = createHarness();
    const result = await service.digest({
      items: [captureInput('the dev server port is 5173'), captureInput('the dev server port is 5174')],
    });
    expect(result.stored).toBe(2);
    expect(result.deduplicated).toBe(0);
  });

  it('keeps identical content separate across scopes', async () => {
    const { service } = createHarness();
    const result = await service.digest({
      items: [
        captureInput('the deploy target is staging', { evidence: evidenceFor('docs/deploy.md') }),
        captureInput('the deploy target is staging', {
          evidence: evidenceFor('docs/deploy.md'),
          scope: repoScope(REPO_B),
        }),
      ],
    });
    expect(result.stored).toBe(2);
  });
});
