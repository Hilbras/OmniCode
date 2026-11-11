import { describe, expect, it } from 'vitest';

import { captureInput, createHarness, evidenceFor } from './helpers';

describe('feedback recalibration', () => {
  it('promotes one trust level after three useful signals and then cools down', async () => {
    const harness = createHarness();
    const stored = await harness.service.capture(captureInput('the parser uses a Pratt parser'));
    const id = stored.id as string;
    for (let index = 0; index < 3; index += 1) {
      await harness.service.recordFeedback({ memoryId: id, feedback: 'useful' });
    }

    expect(await harness.service.recalibrateTrust(id, harness.clock.now())).toMatchObject({
      status: 'promoted',
      from: 'unverified',
      to: 'trusted',
    });
    expect((await harness.service.get(id))?.trust).toBe('trusted');
    expect(await harness.service.recalibrateTrust(id, harness.clock.now())).toMatchObject({
      status: 'cooldown',
    });
  });

  it('demotes one level after two harmful signals', async () => {
    const harness = createHarness();
    const stored = await harness.service.capture(
      captureInput('the parser uses a Pratt parser', { evidence: evidenceFor('docs/parser.md') }),
    );
    const id = stored.id as string;
    await harness.service.recordFeedback({ memoryId: id, feedback: 'harmful' });
    await harness.service.recordFeedback({ memoryId: id, feedback: 'harmful' });

    expect(await harness.service.recalibrateTrust(id, harness.clock.now())).toMatchObject({
      status: 'demoted',
      from: 'verified',
      to: 'trusted',
    });
  });

  it('never promotes from access count alone', async () => {
    const harness = createHarness();
    const stored = await harness.service.capture(captureInput('the parser uses a Pratt parser'));
    expect(
      await harness.service.recalibrateTrust(stored.id as string, harness.clock.now()),
    ).toMatchObject({ status: 'skipped' });
  });
});
