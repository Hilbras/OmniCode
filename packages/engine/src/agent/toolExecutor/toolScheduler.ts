import { parseNumberEnv } from '@hilbras/omnicode-base/utils/env';

import { ToolAccesses } from '#/tool/toolContract';

export const TOOL_CONCURRENCY_ENV = 'OMNICODE_TOOL_CONCURRENCY';

/** Positive integer cap from env; anything else (missing, 0, negative, junk) means unlimited. */
export function parseToolConcurrencyCap(value: string | undefined): number | undefined {
  const parsed = parseNumberEnv(value);
  if (parsed === undefined || !Number.isInteger(parsed) || parsed < 1) return undefined;
  return parsed;
}

/** Read the batch concurrency cap from the environment; undefined means unlimited. */
export function resolveToolConcurrencyCap(env: NodeJS.ProcessEnv = process.env): number | undefined {
  return parseToolConcurrencyCap(env[TOOL_CONCURRENCY_ENV]);
}

export interface ToolSchedulerOptions {
  /** Maximum tasks running at once; unlimited when omitted or not a positive integer. */
  readonly maxConcurrency?: number;
}

export interface ToolCallTask<Result> {
  readonly accesses: ToolAccesses;
  readonly start: () => Promise<{ readonly result: Promise<Result> }>;
}

interface ScheduledToolCallTask<Result> extends ToolCallTask<Result> {
  readonly result: ControlledPromise<Result>;
}

type ControlledPromise<Result> = Promise<Result> & {
  readonly resolve: (value: Result | PromiseLike<Result>) => void;
  readonly reject: (reason?: unknown) => void;
};

export class ToolScheduler<Result> {
  private readonly activeTasks: Array<ScheduledToolCallTask<Result>> = [];
  private queuedTasks: Array<ScheduledToolCallTask<Result>> = [];
  private readonly maxConcurrency: number;

  constructor(options: ToolSchedulerOptions = {}) {
    const cap = options.maxConcurrency;
    this.maxConcurrency =
      cap !== undefined && Number.isInteger(cap) && cap >= 1 ? cap : Number.POSITIVE_INFINITY;
  }

  add(task: ToolCallTask<Result>): Promise<Result> {
    const result = createControlledPromise<Result>();
    void result.catch(() => undefined);

    const scheduledTask: ScheduledToolCallTask<Result> = { ...task, result };
    if (!this.hasCapacity() || this.isBlocked(task, this.queuedTasks)) {
      this.queuedTasks.push(scheduledTask);
    } else {
      this.start(scheduledTask);
    }

    return result;
  }

  private hasCapacity(): boolean {
    return this.activeTasks.length < this.maxConcurrency;
  }

  private isBlocked(
    task: ToolCallTask<Result>,
    queuedBefore: readonly ToolCallTask<Result>[],
  ): boolean {
    return (
      this.conflictsWithAny(task, this.activeTasks) || this.conflictsWithAny(task, queuedBefore)
    );
  }

  private conflictsWithAny(
    task: ToolCallTask<Result>,
    candidates: readonly ToolCallTask<Result>[],
  ): boolean {
    return candidates.some((candidate) =>
      ToolAccesses.conflict(task.accesses, candidate.accesses),
    );
  }

  private start(task: ScheduledToolCallTask<Result>): void {
    this.activeTasks.push(task);
    let started: Promise<{ readonly result: Promise<Result> }>;
    try {
      started = task.start();
    } catch (error) {
      task.result.reject(error);
      this.finish(task);
      return;
    }

    void started
      .then(({ result }) => result)
      .then(task.result.resolve, task.result.reject)
      .finally(() => {
        this.finish(task);
      });
  }

  private finish(task: ScheduledToolCallTask<Result>): void {
    const index = this.activeTasks.indexOf(task);
    if (index >= 0) this.activeTasks.splice(index, 1);
    this.startQueuedTasks();
  }

  private startQueuedTasks(): void {
    const stillQueued: Array<ScheduledToolCallTask<Result>> = [];
    for (const task of this.queuedTasks) {
      if (!this.hasCapacity() || this.isBlocked(task, stillQueued)) {
        stillQueued.push(task);
      } else {
        this.start(task);
      }
    }
    this.queuedTasks = stillQueued;
  }
}

function createControlledPromise<Result>(): ControlledPromise<Result> {
  let resolve!: (value: Result | PromiseLike<Result>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Result>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  }) as ControlledPromise<Result>;
  return Object.assign(promise, { resolve, reject });
}
