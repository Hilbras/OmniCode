/**
 * Speculative write overlay.
 *
 * A speculative branch must never touch the real workspace while it runs:
 * writes are recorded here as pending operations, "accept" is the only path
 * that copies them onto the real filesystem, and "discard" drops them. The
 * overlay is pure data — applying it goes through a caller-provided write
 * target, so it never decides where or whether writes are allowed.
 */

export type OverlayOperation =
  | { readonly kind: 'write'; readonly path: string; readonly content: string; readonly recordedAt: number }
  | { readonly kind: 'remove'; readonly path: string; readonly recordedAt: number };

export interface OverlayWriteTarget {
  writeFile(path: string, content: string): Promise<void>;
  removeFile?(path: string): Promise<void>;
}

export interface OverlayApplyResult {
  readonly applied: readonly string[];
  readonly failed?: { readonly path: string; readonly error: string };
}

export class SpeculationOverlayFullError extends Error {
  constructor(readonly maxEntries: number) {
    super(`Speculative overlay is full (max ${String(maxEntries)} pending paths).`);
    this.name = 'SpeculationOverlayFullError';
  }
}

const DEFAULT_MAX_ENTRIES = 128;
const MAX_PATH_LENGTH = 4096;

export class SpeculationOverlay {
  private readonly ops = new Map<string, OverlayOperation>();

  constructor(readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {}

  /** Records a whole-file write. A later write for the same path replaces it. */
  write(path: string, content: string, now: number = Date.now()): void {
    const key = requireOverlayPath(path);
    this.assertCapacity(key);
    this.ops.set(key, { kind: 'write', path: key, content, recordedAt: now });
  }

  /** Records a removal that shadows any earlier write for the same path. */
  remove(path: string, now: number = Date.now()): void {
    const key = requireOverlayPath(path);
    this.assertCapacity(key);
    this.ops.set(key, { kind: 'remove', path: key, recordedAt: now });
  }

  /** A fork of the branch inherits the parent's pending operations as its baseline. */
  fork(): SpeculationOverlay {
    const child = new SpeculationOverlay(this.maxEntries);
    for (const [key, op] of this.ops) child.ops.set(key, op);
    return child;
  }

  entries(): readonly OverlayOperation[] {
    return [...this.ops.values()].toSorted((left, right) => comparePaths(left.path, right.path));
  }

  pendingPaths(): readonly string[] {
    return [...this.ops.keys()].toSorted(comparePaths);
  }

  size(): number {
    return this.ops.size;
  }

  isEmpty(): boolean {
    return this.ops.size === 0;
  }

  clear(): void {
    this.ops.clear();
  }

  private assertCapacity(key: string): void {
    if (this.ops.has(key)) return;
    if (this.ops.size >= this.maxEntries) throw new SpeculationOverlayFullError(this.maxEntries);
  }
}

/**
 * Applies the overlay's final operation per path, in sorted path order.
 * Stops at the first failure and reports what was applied before it, so an
 * accept never reports success for writes that did not land. A removal
 * against a target that cannot remove files is a reported failure, never a
 * silently dropped operation.
 */
export async function applyOverlay(
  overlay: SpeculationOverlay,
  target: OverlayWriteTarget,
): Promise<OverlayApplyResult> {
  const applied: string[] = [];
  const failure = (path: string, error: unknown): OverlayApplyResult => ({
    applied,
    failed: { path, error: error instanceof Error ? error.message : String(error) },
  });
  for (const op of overlay.entries()) {
    if (op.kind === 'write') {
      try {
        await target.writeFile(op.path, op.content);
      } catch (error) {
        return failure(op.path, error);
      }
      applied.push(op.path);
      continue;
    }
    if (target.removeFile === undefined) {
      return { applied, failed: { path: op.path, error: 'overlay target cannot remove files' } };
    }
    try {
      await target.removeFile(op.path);
    } catch (error) {
      return failure(op.path, error);
    }
    applied.push(op.path);
  }
  return { applied };
}

function requireOverlayPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0) throw new Error('Overlay path cannot be empty.');
  if (trimmed.length > MAX_PATH_LENGTH) {
    throw new Error(`Overlay path exceeds ${String(MAX_PATH_LENGTH)} characters.`);
  }
  return trimmed;
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
