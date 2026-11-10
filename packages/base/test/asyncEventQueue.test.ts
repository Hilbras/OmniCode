import { describe, expect, it } from 'vitest';

import { AsyncEventQueue } from '#/asyncEventQueue';

describe('AsyncEventQueue', () => {
  it('rejects a queued waiter when the queue fails', async () => {
    const queue = new AsyncEventQueue<number>();
    const pending = queue.next();

    queue.fail(new Error('boom'));

    await expect(pending).rejects.toThrow('boom');
  });

  it('drains buffered values before rejecting with the failure', async () => {
    const queue = new AsyncEventQueue<number>();
    queue.push(1);

    queue.fail(new Error('boom'));

    await expect(queue.next()).resolves.toEqual({ done: false, value: 1 });
    await expect(queue.next()).rejects.toThrow('boom');
  });

  it('resolves queued waiters as done when the queue ends', async () => {
    const queue = new AsyncEventQueue<number>();
    const pending = queue.next();

    queue.end();

    await expect(pending).resolves.toEqual({ done: true, value: undefined });
  });

  it('ignores pushes after failure', async () => {
    const queue = new AsyncEventQueue<number>();
    queue.fail(new Error('boom'));
    queue.push(1);

    await expect(queue.next()).rejects.toThrow('boom');
  });
});
