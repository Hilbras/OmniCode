import type { FileHistoryChangeStatus } from './fileHistory';

/**
 * Machine-consumable patch rendering for file history: a complete, uncapped
 * unified diff in the format `git apply` accepts. This is deliberately *not*
 * `diffRender.renderDiffs` — that renderer caps and elides for humans; a patch
 * that drops lines is not a patch.
 *
 * Invariants:
 * - every changed file emits `diff --git`, `---`/`+++` headers (`/dev/null`
 *   for added/deleted files), and `@@ -l,c +l,c @@` hunks with exact numbers;
 * - no content is clipped or elided; files that cannot be rendered as text
 *   (binary, oversize, lost content) are excluded and reported, never faked;
 * - `\ No newline at end of file` markers are emitted for a side whose text
 *   does not end with a newline.
 */

export interface FileHistoryPatchFile {
  readonly path: string;
  readonly status: FileHistoryChangeStatus;
  /** Pre-state text; undefined for an added file. */
  readonly before?: string | undefined;
  /** Post-state text; undefined for a deleted file. */
  readonly after?: string | undefined;
  /** Set when either side cannot be rendered as text; the file is excluded. */
  readonly binary?: boolean | undefined;
  /** Set when either side exceeded the backup size limit; the file is excluded. */
  readonly oversize?: boolean | undefined;
}

export interface FileHistoryPatchExclusion {
  readonly path: string;
  readonly reason: 'binary' | 'oversize' | 'content-unavailable';
}

export interface FileHistoryPatch {
  /** Complete unified diff; empty string when nothing changed. */
  readonly text: string;
  /** Changed files the patch covers. */
  readonly files: readonly FileHistoryPatchFile[];
  /** Changed files excluded from the patch, with the reason. */
  readonly excluded: readonly FileHistoryPatchExclusion[];
}

interface Side {
  readonly lines: readonly string[];
  /** True when the text does not end with a newline (and is non-empty). */
  readonly endsWithoutNewline: boolean;
}

interface EditOp {
  readonly kind: 'same' | 'add' | 'remove';
  readonly line: string;
  /**
   * For the final line of a side: that side's `endsWithoutNewline`. The
   * renderer turns it into the `\ No newline at end of file` marker.
   */
  readonly marksNoNewline: boolean;
}

const CONTEXT_LINES = 3;
const LCS_CELL_BUDGET = 4_000_000;

function side(text: string | undefined): Side {
  if (text === undefined || text === '') return { lines: [], endsWithoutNewline: false };
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const hadTrailingNewline = lines.at(-1) === '';
  if (hadTrailingNewline) lines.pop();
  return { lines, endsWithoutNewline: !hadTrailingNewline && lines.length > 0 };
}

function editScript(before: Side, after: Side): readonly EditOp[] {
  // Line-level LCS; above the cell budget the whole region becomes
  // remove+add, which is still a correct (if less compact) patch.
  const a = before.lines;
  const b = after.lines;
  if (a.length * b.length > LCS_CELL_BUDGET) {
    return [
      ...a.map((line, index) => ({
        kind: 'remove' as const,
        line,
        marksNoNewline: index === a.length - 1 && before.endsWithoutNewline,
      })),
      ...b.map((line, index) => ({
        kind: 'add' as const,
        line,
        marksNoNewline: index === b.length - 1 && after.endsWithoutNewline,
      })),
    ];
  }

  const rows = lcsRows(a, b);
  const ops: EditOp[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({
        kind: 'same',
        line: a[i - 1]!,
        marksNoNewline:
          (i === a.length && before.endsWithoutNewline) || (j === b.length && after.endsWithoutNewline),
      });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || rows[i]![j - 1]! >= rows[i - 1]![j]!)) {
      ops.push({
        kind: 'add',
        line: b[j - 1]!,
        marksNoNewline: j === b.length && after.endsWithoutNewline,
      });
      j -= 1;
    } else {
      ops.push({
        kind: 'remove',
        line: a[i - 1]!,
        marksNoNewline: i === a.length && before.endsWithoutNewline,
      });
      i -= 1;
    }
  }
  return ops.reverse();
}

function lcsRows(a: readonly string[], b: readonly string[]): Uint32Array[] {
  const rows: Uint32Array[] = [];
  let previous = new Uint32Array(b.length + 1);
  rows.push(Uint32Array.from(previous));
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Uint32Array(b.length + 1);
    for (let j = 1; j <= b.length; j += 1) {
      current[j] =
        a[i - 1] === b[j - 1] ? previous[j - 1]! + 1 : Math.max(previous[j]!, current[j - 1]!);
    }
    previous = current;
    rows.push(Uint32Array.from(current));
  }
  return rows;
}

function renderFile(file: FileHistoryPatchFile): string {
  const before = side(file.before);
  const after = side(file.after);
  const ops = editScript(before, after);

  const out: string[] = [`diff --git a/${file.path} b/${file.path}`];
  if (file.status === 'added') {
    out.push('new file mode 100644', '--- /dev/null', `+++ b/${file.path}`);
  } else if (file.status === 'deleted') {
    out.push('deleted file mode 100644', `--- a/${file.path}`, '+++ /dev/null');
  } else {
    out.push(`--- a/${file.path}`, `+++ b/${file.path}`);
  }

  let beforeLine = 0;
  let afterLine = 0;
  let current: EditOp[] | undefined;
  let hunkBeforeStart = 0;
  let hunkAfterStart = 0;

  const flushHunk = (): void => {
    if (current === undefined) return;
    const beforeCount = current.filter((op) => op.kind !== 'add').length;
    const afterCount = current.filter((op) => op.kind !== 'remove').length;
    // git's convention: a side with zero lines in the hunk reports the
    // position before the hunk (0 at file start), not the next line.
    const beforeStart = beforeCount === 0 ? hunkBeforeStart - 1 : hunkBeforeStart;
    const afterStart = afterCount === 0 ? hunkAfterStart - 1 : hunkAfterStart;
    const beforeRange =
      beforeCount === 0 ? `${String(Math.max(0, beforeStart))},0` : `${String(beforeStart)},${String(beforeCount)}`;
    const afterRange =
      afterCount === 0 ? `${String(Math.max(0, afterStart))},0` : `${String(afterStart)},${String(afterCount)}`;
    out.push(`@@ -${beforeRange} +${afterRange} @@`);
    for (const op of current) {
      const prefix = op.kind === 'add' ? '+' : op.kind === 'remove' ? '-' : ' ';
      out.push(prefix + op.line);
      if (op.marksNoNewline) out.push('\\ No newline at end of file');
    }
    current = undefined;
  };

  const keep = Array.from({ length: ops.length }, () => false as boolean);
  ops.forEach((op, index) => {
    if (op.kind === 'same') return;
    for (
      let offset = Math.max(0, index - CONTEXT_LINES);
      offset <= Math.min(ops.length - 1, index + CONTEXT_LINES);
      offset += 1
    ) {
      keep[offset] = true;
    }
  });

  ops.forEach((op, index) => {
    if (keep[index] === true) {
      if (current === undefined) {
        hunkBeforeStart = beforeLine + 1;
        hunkAfterStart = afterLine + 1;
        current = [];
      }
      current.push(op);
    } else if (current !== undefined) {
      flushHunk();
    }
    if (op.kind !== 'add') beforeLine += 1;
    if (op.kind !== 'remove') afterLine += 1;
  });
  flushHunk();

  return out.join('\n');
}

/**
 * Render changed files as one complete unified diff. Files whose content is
 * missing on a side they need (an `added` file without `after`, a `deleted`
 * file without `before`, a `modified` file without either) are excluded with
 * `content-unavailable` rather than rendered partially. Files whose declared
 * status disagrees with the content (equal text) are skipped: the patch only
 * carries real deltas.
 */
export function renderFileHistoryPatch(files: readonly FileHistoryPatchFile[]): FileHistoryPatch {
  const covered: FileHistoryPatchFile[] = [];
  const excluded: FileHistoryPatchExclusion[] = [];
  const bodies: string[] = [];

  for (const file of files) {
    if (file.binary === true) {
      excluded.push({ path: file.path, reason: 'binary' });
      continue;
    }
    if (file.oversize === true) {
      excluded.push({ path: file.path, reason: 'oversize' });
      continue;
    }
    const missingNeeded =
      (file.status === 'added' && file.after === undefined) ||
      (file.status === 'deleted' && file.before === undefined) ||
      (file.status === 'modified' && (file.before === undefined || file.after === undefined));
    if (missingNeeded) {
      excluded.push({ path: file.path, reason: 'content-unavailable' });
      continue;
    }
    if ((file.before ?? '') === (file.after ?? '')) continue;
    covered.push(file);
    bodies.push(renderFile(file));
  }

  return { text: bodies.length > 0 ? `${bodies.join('\n')}\n` : '', files: covered, excluded };
}
