import { describe, expect, it } from 'vitest';

import { captureInput, createHarness } from './helpers';

describe('memory version history', () => {
  it('keeps a pre-image for update and invalidate', async () => {
    const { service } = createHarness();
    const stored = await service.capture(captureInput('the deploy target is staging'));
    const id = stored.id as string;

    await service.update(id, { content: 'the deploy target is production' });
    await service.invalidate(id, 'corrected by the user');

    const history = await service.history(id);
    expect(history.map((entry) => entry.reason)).toEqual(['update', 'invalidate: corrected by the user']);
    expect(history[0]?.record.content).toBe('the deploy target is staging');
    expect(history[1]?.record.content).toBe('the deploy target is production');

    const audit = await service.auditLog(10);
    expect(audit.map((entry) => entry.operation)).toEqual(['invalidate', 'update']);
    expect(JSON.stringify(audit)).not.toContain('the deploy target is staging');
    expect(JSON.stringify(audit)).not.toContain('the deploy target is production');
  });

  it('keeps a pre-image after delete and caps history at 20', async () => {
    const { service } = createHarness();
    const stored = await service.capture(captureInput('version zero'));
    const id = stored.id as string;
    for (let revision = 1; revision <= 25; revision += 1) {
      await service.update(id, { content: `version ${String(revision)}` });
    }

    const history = await service.history(id);
    expect(history).toHaveLength(20);
    expect(history[0]?.revision).toBe(5);

    await service.delete(id, 'test cleanup');
    const afterDelete = await service.history(id);
    expect(afterDelete).toHaveLength(20);
    expect(afterDelete.at(-1)?.reason).toBe('delete: test cleanup');
  });
});
