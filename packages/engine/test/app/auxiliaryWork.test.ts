import { describe, expect, it } from 'vitest';

import { flushAuxiliaryWork, trackAuxiliaryWork } from '#/app/auxiliaryWork';

describe('auxiliary work', () => {
  it('waits for tracked work before flushing', async () => {
    let release: (() => void) | undefined;
    const work = new Promise<void>((resolve) => {
      release = resolve;
    });
    trackAuxiliaryWork(work);

    let flushed = false;
    const flushing = flushAuxiliaryWork().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);

    release?.();
    await flushing;
    expect(flushed).toBe(true);
  });

  it('returns immediately when nothing is pending', async () => {
    await expect(flushAuxiliaryWork()).resolves.toBeUndefined();
  });
});
