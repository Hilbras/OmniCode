const directoryQueue = new Map<string, Promise<unknown>>();

/**
 * Reserve this directory's slot synchronously, then run `task` once the
 * previous holder frees it.
 *
 * Synchronous reservation is the point. minidb allows one writer per directory,
 * and a scope can be torn down while its store is still opening, so its close
 * has to wait for that open before it can release the lock. Reserving the close
 * only after that wait let the next scope's open jump ahead of it, find a live
 * lock, degrade to read-only, and return `failed` from every capture for the
 * rest of that scope's life. Reserving up front puts the close in line ahead of
 * anything that opens later.
 *
 * Only same-process callers queue here. A second process still degrades to
 * read-only, which is the documented behaviour.
 */
export function withDirectorySlot<T>(dir: string, task: () => Promise<T>): Promise<T> {
  const previous = directoryQueue.get(dir) ?? Promise.resolve();
  const next = previous.then(task, task);
  directoryQueue.set(
    dir,
    next.catch(() => undefined),
  );
  return next;
}
