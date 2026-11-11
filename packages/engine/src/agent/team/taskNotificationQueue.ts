import { Error2, ErrorCodes } from '#/errors';

export interface TaskNotification<T = unknown> {
  readonly taskId: string;
  readonly title?: string;
  readonly body?: string;
  readonly status?: string;
  readonly payload?: T;
  readonly createdAt?: number;
}

export interface QueuedTaskNotification<T = unknown> extends TaskNotification<T> {
  readonly sequence: number;
  readonly queuedAt: number;
  readonly updatedAt: number;
  readonly coalescedCount: number;
}

export type TaskNotificationEnqueueStatus = 'queued' | 'coalesced' | 'duplicate';

export interface TaskNotificationEnqueueResult<T = unknown> {
  readonly status: TaskNotificationEnqueueStatus;
  readonly notification?: QueuedTaskNotification<T>;
  readonly pendingCount: number;
}

export type TaskNotificationDequeueResult<T = unknown> =
  | {
      readonly kind: 'notification';
      readonly notification: QueuedTaskNotification<T>;
      readonly remaining: number;
    }
  | {
      readonly kind: 'empty';
      readonly remaining: 0;
    };

export interface TaskNotificationQueueOptions {
  readonly now?: () => number;
  readonly dedupeDelivered?: boolean;
  readonly maxDelivered?: number;
}

export class TaskNotificationQueue<T = unknown> {
  private readonly now: () => number;
  private readonly dedupeDelivered: boolean;
  private readonly maxDelivered: number;
  private readonly pending = new Map<string, QueuedTaskNotification<T>>();
  private readonly delivered: string[] = [];
  private readonly deliveredSet = new Set<string>();
  private sequence = 0;

  constructor(options: TaskNotificationQueueOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.dedupeDelivered = options.dedupeDelivered ?? true;
    const maxDelivered = options.maxDelivered ?? 1024;
    if (!Number.isInteger(maxDelivered) || maxDelivered < 0) {
      throw new Error2(
        ErrorCodes.VALIDATION_FAILED,
        `Notification maxDelivered must be a non-negative integer, got ${String(maxDelivered)}.`,
        { details: { maxDelivered } },
      );
    }
    this.maxDelivered = maxDelivered;
  }

  get size(): number {
    return this.pending.size;
  }

  get isEmpty(): boolean {
    return this.pending.size === 0;
  }

  enqueue(notification: TaskNotification<T>): TaskNotificationEnqueueResult<T> {
    const taskId = notification.taskId.trim();
    if (taskId.length === 0) {
      throw new Error2(ErrorCodes.VALIDATION_FAILED, 'Notification taskId must not be empty.');
    }
    const timestamp = this.now();
    const existing = this.pending.get(taskId);
    if (existing !== undefined) {
      const merged: QueuedTaskNotification<T> = {
        ...existing,
        taskId,
        title: notification.title ?? existing.title,
        body: notification.body ?? existing.body,
        status: notification.status ?? existing.status,
        payload: notification.payload === undefined ? existing.payload : notification.payload,
        updatedAt: timestamp,
        coalescedCount: existing.coalescedCount + 1,
      };
      this.pending.set(taskId, merged);
      return { status: 'coalesced', notification: merged, pendingCount: this.pending.size };
    }
    if (this.dedupeDelivered && this.deliveredSet.has(taskId)) {
      return { status: 'duplicate', pendingCount: this.pending.size };
    }
    this.sequence += 1;
    const queued: QueuedTaskNotification<T> = {
      ...notification,
      taskId,
      sequence: this.sequence,
      queuedAt: timestamp,
      updatedAt: timestamp,
      coalescedCount: 0,
      createdAt: notification.createdAt ?? timestamp,
    };
    this.pending.set(taskId, queued);
    return { status: 'queued', notification: queued, pendingCount: this.pending.size };
  }

  dequeue(): TaskNotificationDequeueResult<T> {
    const first = this.pending.entries().next();
    if (first.done === true) {
      return { kind: 'empty', remaining: 0 };
    }
    const [taskId, notification] = first.value;
    this.pending.delete(taskId);
    this.markDelivered(taskId);
    return {
      kind: 'notification',
      notification,
      remaining: this.pending.size,
    };
  }

  peek(): QueuedTaskNotification<T> | undefined {
    return this.pending.values().next().value;
  }

  listPending(): readonly QueuedTaskNotification<T>[] {
    return [...this.pending.values()];
  }

  remove(taskId: string): boolean {
    return this.pending.delete(taskId);
  }

  drain(): readonly QueuedTaskNotification<T>[] {
    const drained: QueuedTaskNotification<T>[] = [];
    for (;;) {
      const next = this.dequeue();
      if (next.kind === 'empty') return drained;
      drained.push(next.notification);
    }
  }

  clear(): void {
    this.pending.clear();
    this.delivered.length = 0;
    this.deliveredSet.clear();
  }

  isDelivered(taskId: string): boolean {
    return this.deliveredSet.has(taskId);
  }

  private markDelivered(taskId: string): void {
    if (!this.dedupeDelivered || this.maxDelivered === 0) return;
    if (this.deliveredSet.has(taskId)) return;
    this.deliveredSet.add(taskId);
    this.delivered.push(taskId);
    while (this.delivered.length > this.maxDelivered) {
      const oldest = this.delivered.shift();
      if (oldest !== undefined) this.deliveredSet.delete(oldest);
    }
  }
}

export { TaskNotificationQueue as NotificationQueue };
