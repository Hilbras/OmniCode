import type { PatchJournal } from './patchJournal';

export interface PatchFileAdapter {
  readFile(path: string): Promise<string | undefined>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  /** Optional: a copy primitive lets a move keep the source until verify passes. */
  moveFile?(from: string, to: string): Promise<void>;
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

export interface PatchHunk {
  readonly oldLines: readonly string[];
  readonly newLines: readonly string[];
}

export interface PatchApplyResult {
  readonly changedFiles: readonly string[];
  readonly added: number;
  readonly updated: number;
  readonly deleted: number;
  readonly moved: number;
}

export type PatchFailureCode =
  | 'parse'
  | 'duplicate-target'
  | 'target-exists'
  | 'target-missing'
  | 'hunk-mismatch'
  | 'verify-failed';

/**
 * A failed patch still reports what it committed before failing. With a
 * journal the tree is rolled back, so `committedFiles` is what was touched
 * (and then undone); without one it is what remains changed on disk.
 */
export class PatchApplyError extends Error {
  constructor(
    readonly code: PatchFailureCode,
    message: string,
    readonly committedFiles: readonly string[],
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = 'PatchApplyError';
  }
}

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

export function parsePatch(patch: string): readonly PatchOperation[] {
  const lines = patch.replace(/\r\n/g, '\n').split('\n');
  const operations: PatchOperation[] = [];
  let index = 0;
  if (lines[index]?.trim() !== '*** Begin Patch') throw new Error('patch must start with *** Begin Patch');
  index += 1;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim() === '*** End Patch') return assertUniqueTargets(operations);
    if (line.startsWith('*** Add File: ')) {
      const path = line.slice('*** Add File: '.length).trim();
      const content: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.startsWith('***')) {
        const next = lines[index]!;
        if (!next.startsWith('+')) throw new Error(`add-file line must start with +: ${next}`);
        content.push(next.slice(1));
        index += 1;
      }
      operations.push({ kind: 'add', path, content: content.join('\n') + (content.length > 0 ? '\n' : '') });
      continue;
    }
    if (line.startsWith('*** Move to: ')) {
      // A `*** Move to:` line follows the update it belongs to; the parser sees
      // it after the update body closed, so it is attached to the last update.
      const previous = operations[operations.length - 1];
      if (previous === undefined || previous.kind !== 'update') {
        throw new Error('*** Move to must follow an update');
      }
      if (previous.move !== undefined) throw new Error(`duplicate *** Move to for ${previous.path}`);
      const to = line.slice('*** Move to: '.length).trim();
      if (to.length === 0) throw new Error('*** Move to needs a destination');
      operations[operations.length - 1] = { ...previous, move: to };
      index += 1;
      continue;
    }
    if (line.startsWith('*** Delete File: ')) {
      operations.push({ kind: 'delete', path: line.slice('*** Delete File: '.length).trim() });
      index += 1;
      continue;
    }
    if (line.startsWith('*** Update File: ')) {
      const path = line.slice('*** Update File: '.length).trim();
      const hunks: PatchHunk[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.startsWith('***')) {
        if (lines[index]!.startsWith('@@')) {
          index += 1;
          const oldLines: string[] = [];
          const newLines: string[] = [];
          while (index < lines.length && !lines[index]!.startsWith('@@') && !lines[index]!.startsWith('***')) {
            const hunkLine = lines[index]!;
            if (hunkLine.startsWith(' ')) {
              oldLines.push(hunkLine.slice(1));
              newLines.push(hunkLine.slice(1));
            } else if (hunkLine.startsWith('-')) {
              oldLines.push(hunkLine.slice(1));
            } else if (hunkLine.startsWith('+')) {
              newLines.push(hunkLine.slice(1));
            } else if (hunkLine.length === 0) {
              oldLines.push('');
              newLines.push('');
            } else {
              throw new Error(`invalid hunk line: ${hunkLine}`);
            }
            index += 1;
          }
          hunks.push({ oldLines, newLines });
          continue;
        }
        index += 1;
      }
      operations.push({ kind: 'update', path, hunks });
      continue;
    }
    index += 1;
  }
  throw new Error('patch is missing *** End Patch');
}

export async function applyPatch(
  patch: string,
  fs: PatchFileAdapter,
  options: { readonly journal?: PatchJournal } = {},
): Promise<PatchApplyResult> {
  let operations: readonly PatchOperation[];
  try {
    operations = parsePatch(patch);
  } catch (error) {
    throw new PatchApplyError(
      error instanceof DuplicateTargetError ? 'duplicate-target' : 'parse',
      error instanceof Error ? error.message : String(error),
      [],
      { cause: error },
    );
  }

  const actions = planActions(operations);
  const backups = new Map<string, string | undefined>();
  const changed: string[] = [];
  let added = 0;
  let updated = 0;
  let deleted = 0;
  let moved = 0;
  const rollback = async (): Promise<void> => {
    if (options.journal !== undefined) {
      await options.journal.rollback();
      return;
    }
    for (const [path, content] of [...backups].reverse()) {
      if (content === undefined) await fs.deleteFile(path).catch(() => undefined);
      else await fs.writeFile(path, content).catch(() => undefined);
    }
  };

  try {
    // Phase 1: verify every action against the pre-patch tree before writing
    // anything. A patch that cannot land in full leaves the tree untouched.
    const originals = new Map<string, string | undefined>();
    for (const action of actions) {
      for (const path of action.reads) {
        if (!originals.has(path)) originals.set(path, await fs.readFile(path));
      }
    }
    const planned = new Map<string, string>();
    for (const action of actions) {
      for (const op of action.operations) {
        if (op.kind === 'add') {
          if (originals.get(op.path) !== undefined) {
            throw new PatchApplyError('target-exists', `file already exists: ${op.path}`, changed);
          }
          planned.set(op.path, op.content);
        } else if (op.kind === 'delete') {
          if (originals.get(op.path) === undefined) {
            throw new PatchApplyError('target-missing', `file does not exist: ${op.path}`, changed);
          }
        } else if (op.kind === 'update') {
          const original = originals.get(op.path);
          if (original === undefined) {
            throw new PatchApplyError('target-missing', `file does not exist: ${op.path}`, changed);
          }
          let lines = splitLines(original);
          for (const hunk of op.hunks) {
            try {
              lines = applyHunk(lines, hunk, op.path);
            } catch (error) {
              throw new PatchApplyError(
                'hunk-mismatch',
                error instanceof Error ? error.message : String(error),
                changed,
                { cause: error },
              );
            }
          }
          planned.set(op.path, lines.join('\n'));
          if (op.move !== undefined) {
            if (originals.get(op.move) !== undefined) {
              throw new PatchApplyError('target-exists', `move destination exists: ${op.move}`, changed);
            }
          }
        } else if (op.kind === 'move') {
          if (originals.get(op.from) === undefined) {
            throw new PatchApplyError('target-missing', `file does not exist: ${op.from}`, changed);
          }
          if (originals.get(op.to) !== undefined) {
            throw new PatchApplyError('target-exists', `move destination exists: ${op.to}`, changed);
          }
        }
      }
    }

    // Phase 2: commit. Every write is journaled/backed up first.
    for (const action of actions) {
      for (const op of action.operations) {
        const touches = patchOperationPaths(op);
        for (const path of touches) {
          if (!backups.has(path)) backups.set(path, await fs.readFile(path));
          await options.journal?.record(path, backups.get(path));
        }
        if (op.kind === 'add') {
          await fs.writeFile(op.path, op.content);
          added += 1;
          changed.push(op.path);
        } else if (op.kind === 'delete') {
          await fs.deleteFile(op.path);
          deleted += 1;
          changed.push(op.path);
        } else if (op.kind === 'update') {
          const content = planned.get(op.path)!;
          if (op.move !== undefined) {
            await fs.writeFile(op.move, content);
            await fs.deleteFile(op.path);
            moved += 1;
            changed.push(op.path, op.move);
          } else {
            await fs.writeFile(op.path, content);
            changed.push(op.path);
          }
          updated += 1;
        } else if (op.kind === 'move') {
          const content = planned.get(op.from) ?? originals.get(op.from)!;
          await fs.writeFile(op.to, content);
          await fs.deleteFile(op.from);
          moved += 1;
          changed.push(op.from, op.to);
        }
      }
    }

    // Phase 3: verify the result is what was planned.
    for (const action of actions) {
      for (const op of action.operations) {
        if (op.kind === 'add' || op.kind === 'update') {
          const expected = planned.get(op.path)!;
          const target = op.kind === 'update' && op.move !== undefined ? op.move : op.path;
          const actual = await fs.readFile(target);
          if (actual !== expected) {
            throw new PatchApplyError('verify-failed', `verify failed after write: ${target}`, changed);
          }
        }
      }
    }

    if (options.journal !== undefined) await options.journal.finish();
    return { changedFiles: [...new Set(changed)], added, updated, deleted, moved };
  } catch (error) {
    await rollback();
    if (error instanceof PatchApplyError) throw error;
    throw new PatchApplyError('verify-failed', error instanceof Error ? error.message : String(error), changed, {
      cause: error,
    });
  }
}

interface PlannedAction {
  readonly operations: readonly PatchOperation[];
  /** Paths this action reads before writing. */
  readonly reads: readonly string[];
}

/**
 * Groups operations into actions. A move creates two operations (update then
 * move) that must execute together, so they are kept in one action.
 */
function planActions(operations: readonly PatchOperation[]): readonly PlannedAction[] {
  const actions: PlannedAction[] = [];
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index]!;
    // Every path the operation touches must be read before anything is written,
    // including a move destination: that is what makes target-exists detectable
    // in the verify phase instead of after the source was already rewritten.
    actions.push({ operations: [operation], reads: patchOperationPaths(operation) });
  }
  return actions;
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n');
}

class DuplicateTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateTargetError';
  }
}

/** One operation per final path: two operations on the same file is ambiguous. */
function assertUniqueTargets(operations: readonly PatchOperation[]): readonly PatchOperation[] {
  const seen = new Set<string>();
  for (const operation of operations) {
    for (const target of patchOperationPaths(operation)) {
      if (seen.has(target)) throw new DuplicateTargetError(`patch targets ${target} more than once`);
      seen.add(target);
    }
  }
  return operations;
}

function applyHunk(lines: readonly string[], hunk: PatchHunk, path: string): string[] {
  const at = findBlock(lines, hunk.oldLines);
  if (at < 0) throw new Error(`patch hunk did not match ${path}`);
  return [...lines.slice(0, at), ...hunk.newLines, ...lines.slice(at + hunk.oldLines.length)];
}

function findBlock(lines: readonly string[], block: readonly string[]): number {
  if (block.length === 0) return lines.length;
  for (let index = 0; index <= lines.length - block.length; index += 1) {
    if (block.every((line, offset) => lines[index + offset] === line)) return index;
  }
  return -1;
}
