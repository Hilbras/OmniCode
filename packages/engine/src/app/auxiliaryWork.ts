const pending = new Set<Promise<unknown>>();

export function trackAuxiliaryWork(work: Promise<unknown>): void {
  pending.add(work);
  void work.finally(() => {
    pending.delete(work);
  });
}

export async function flushAuxiliaryWork(timeoutMs = 15_000): Promise<void> {
  if (pending.size === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
    timer.unref?.();
  });
  await Promise.race([
    Promise.allSettled(Array.from(pending)).then(() => undefined),
    timeout,
  ]);
  if (timer !== undefined) clearTimeout(timer);
}
