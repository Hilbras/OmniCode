export interface PatchHunk {
  readonly oldLines: readonly string[];
  readonly newLines: readonly string[];
}

export type PatchOperation =
  | { readonly kind: 'add'; readonly path: string; readonly content: string }
  | { readonly kind: 'delete'; readonly path: string }
  | {
      readonly kind: 'update';
      readonly path: string;
      readonly hunks: readonly PatchHunk[];
      /** Destination when the update also moves the file. */
      readonly move?: string;
    }
  | { readonly kind: 'move'; readonly from: string; readonly to: string };

/** Every path an operation reads or writes; used for resolution and approval rules. */
export function patchOperationPaths(operation: PatchOperation): readonly string[] {
  switch (operation.kind) {
    case 'move':
      return [operation.from, operation.to];
    case 'update':
      return operation.move === undefined ? [operation.path] : [operation.path, operation.move];
    default:
      return [operation.path];
  }
}

export class DuplicateTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateTargetError';
  }
}

/** One operation per final path: two operations on the same file is ambiguous. */
export function assertUniqueTargets(
  operations: readonly PatchOperation[],
): readonly PatchOperation[] {
  const seen = new Set<string>();
  for (const operation of operations) {
    for (const target of patchOperationPaths(operation)) {
      if (seen.has(target)) throw new DuplicateTargetError(`patch targets ${target} more than once`);
      seen.add(target);
    }
  }
  return operations;
}