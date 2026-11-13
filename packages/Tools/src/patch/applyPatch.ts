import type { PatchJournal } from './patchJournal';
import {
  DuplicateTargetError,
  patchOperationPaths,
  type PatchHunk,
  type PatchOperation,
} from './patchOperations';
import { PatchStreamParser } from './patchStream';
import { identityPatchPathMapper, type PatchPathMapper } from './patchPath';

export type { PatchHunk, PatchOperation } from './patchOperations';
export { patchOperationPaths };

export interface PatchFileAdapter {
  readFile(path: string): Promise<string | undefined>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  /** Optional: a copy primitive lets a move keep the source until verify passes. */
  moveFile?(from: string, to: string): Promise<void>;
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

export function parsePatch(patch: string): readonly PatchOperation[] {
  const parser = new PatchStreamParser();
  parser.push(patch);
  return parser.finish();
}

export interface PatchApplyOptions {
  readonly journal?: PatchJournal;
  /**
   * Path resolution seam. Without one, patch paths are used verbatim as
   * backend paths (the in-memory and local adapters rely on that). A remote
   * host supplies a mapper so the same patch text applies to its own tree.
   */
  readonly paths?: PatchPathMapper;
}

export async function applyPatch(
  patch: string,
  fs: PatchFileAdapter,
  options: PatchApplyOptions = {},
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

  const mapper = options.paths ?? identityPatchPathMapper;
  const backend = (path: string): string => mapper.toBackend(path);
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
        if (!originals.has(path)) originals.set(path, await fs.readFile(backend(path)));
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
          const target = backend(path);
          if (!backups.has(target)) backups.set(target, await fs.readFile(target));
          await options.journal?.record(target, backups.get(target));
        }
        if (op.kind === 'add') {
          await fs.writeFile(backend(op.path), op.content);
          added += 1;
          changed.push(op.path);
        } else if (op.kind === 'delete') {
          await fs.deleteFile(backend(op.path));
          deleted += 1;
          changed.push(op.path);
        } else if (op.kind === 'update') {
          const content = planned.get(op.path)!;
          if (op.move !== undefined) {
            await fs.writeFile(backend(op.move), content);
            await fs.deleteFile(backend(op.path));
            moved += 1;
            changed.push(op.path, op.move);
          } else {
            await fs.writeFile(backend(op.path), content);
            changed.push(op.path);
          }
          updated += 1;
        } else if (op.kind === 'move') {
          const content = planned.get(op.from) ?? originals.get(op.from)!;
          await fs.writeFile(backend(op.to), content);
          await fs.deleteFile(backend(op.from));
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
          const actual = await fs.readFile(backend(target));
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