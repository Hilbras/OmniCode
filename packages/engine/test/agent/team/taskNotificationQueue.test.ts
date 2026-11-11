import { describe, expect, it } from 'vitest';

import { TaskNotificationQueue } from '#/agent/team/taskNotificationQueue';

describe('TaskNotificationQueue', () => {
  it('reports explicit empty state', () => {
    const queue = new TaskNotificationQueue();
    expect(queue.isEmpty).toBe(true);
    expect(queue.size).toBe(0);
    expect(queue.dequeue()).toEqual({ kind: 'empty', remaining: 0 });
    expect(queue.drain()).toEqual([]);
  });

  it('delivers in order and dedupes by task id', () => {
    const queue = new TaskNotificationQueue({ now: () => 10 });
    const first = queue.enqueue({ taskId: 'task-a', title: 'A' });
    const second = queue.enqueue({ taskId: 'task-b', title: 'B' });

    expect(first.status).toBe('queued');
    expect(second.status).toBe('queued');
    expect(queue.size).toBe(2);
    expect(queue.listPending().map((item) => item.taskId)).toEqual(['task-a', 'task-b']);

    const delivered = queue.dequeue();
    expect(delivered.kind).toBe('notification');
    if (delivered.kind === 'notification') {
      expect(delivered.notification.taskId).toBe('task-a');
      expect(delivered.remaining).toBe(1);
    }

    expect(queue.enqueue({ taskId: 'task-a', title: 'again' })).toMatchObject({
      status: 'duplicate',
      pendingCount: 1,
    });
    expect(queue.isDelivered('task-a')).toBe(true);
  });

  it('coalesces repeated notifications while preserving the original position', () => {
    let now = 100;
    const queue = new TaskNotificationQueue({ now: () => now });
    queue.enqueue({ taskId: 'task-a', title: 'A', body: 'first' });
    queue.enqueue({ taskId: 'task-b', title: 'B' });
    now = 200;
    const coalesced = queue.enqueue({
      taskId: 'task-a',
      title: 'A2',
      status: 'running',
    });

    expect(coalesced).toMatchObject({
      status: 'coalesced',
      pendingCount: 2,
      notification: {
        taskId: 'task-a',
        sequence: 1,
        title: 'A2',
        body: 'first',
        status: 'running',
        coalescedCount: 1,
        queuedAt: 100,
        updatedAt: 200,
      },
    });
    expect(queue.listPending().map((item) => item.taskId)).toEqual(['task-a', 'task-b']);

    const delivered = queue.drain();
    expect(delivered.map((item) => [item.taskId, item.title, item.coalescedCount])).toEqual([
      ['task-a', 'A2', 1],
      ['task-b', 'B', 0],
    ]);
    expect(queue.dequeue()).toEqual({ kind: 'empty', remaining: 0 });
  });

  it('can allow redelivery when dedupe is disabled', () => {
    const queue = new TaskNotificationQueue({ dedupeDelivered: false });
    queue.enqueue({ taskId: 'task-a' });
    queue.dequeue();
    expect(queue.enqueue({ taskId: 'task-a' })).toMatchObject({ status: 'queued' });
  });

  it('bounds delivered history and allows removed tasks to be re-enqueued', () => {
    const queue = new TaskNotificationQueue({ maxDelivered: 1 });
    queue.enqueue({ taskId: 'task-a' });
    queue.dequeue();
    queue.enqueue({ taskId: 'task-b' });
    queue.dequeue();

    expect(queue.isDelivered('task-a')).toBe(false);
    expect(queue.isDelivered('task-b')).toBe(true);
    expect(queue.enqueue({ taskId: 'task-a' })).toMatchObject({ status: 'queued' });

    expect(queue.remove('task-a')).toBe(true);
    expect(queue.remove('task-a')).toBe(false);
    expect(queue.enqueue({ taskId: 'task-a' })).toMatchObject({ status: 'queued' });
  });
});
