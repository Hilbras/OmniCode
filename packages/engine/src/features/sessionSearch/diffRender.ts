/**
 * Bounded unified-diff rendering for `/diff`.
 *
 * A diff is the one output that can grow without limit while saying less and
 * less: a generated lockfile or a minified bundle turns a one-line change into
 * a 200k-line wall. Everything here is therefore capped on three axes — lines
 * per hunk, total lines, and characters per line — and every cap is reported
 * in the rendered text so the reader knows the view is partial rather than
 * complete.
 *
 * The algorithm is a line-level LCS with a bounded dynamic-programming table.
 * Above the table budget it degrades to "replace the whole region" instead of
 * silently timing out, and says so. That keeps a pathological input linear
 * where the exact algorithm would be quadratic.
 */

export interface DiffInput {
  readonly path: string;
  readonly before: string;
  readonly after: string;
}

export interface DiffRenderOptions {
  /** Context lines around each change. Default 3. */
  readonly contextLines?: number;
  /** Lines shown per hunk before eliding the middle. Default 200. */
  readonly maxLinesPerHunk?: number;
  /** Rendered output lines across the whole diff. Default 600. */
  readonly maxLines?: number;
  /** Characters kept per line; longer lines are cut with a marker. Default 400. */
  readonly maxLineChars?: number;
  /** LCS cell budget before falling back to whole-region replacement. Default 250_000. */
  readonly lcsCellBudget?: number;
}

export interface DiffSummary {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  readonly unchanged: boolean;
}

export interface RenderedDiff {
  readonly text: string;
  readonly summaries: readonly DiffSummary[];
  /** True when a cap dropped content from the rendering. */
  readonly truncated: boolean;
}

export const DEFAULT_DIFF_OPTIONS: Required<DiffRenderOptions> = {
  contextLines: 3,
  maxLinesPerHunk: 200,
  maxLines: 600,
  maxLineChars: 400,
  lcsCellBudget: 250_000,
};

type EditOp =
  | { readonly kind: 'same'; readonly line: string }
  | { readonly kind: 'add'; readonly line: string }
  | { readonly kind: 'remove'; readonly line: string };

function normalize(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n');
}

/** Line-level edit script; falls back to a single replace above the cell budget. */
export function diffLines(before: readonly string[], after: readonly string[], cellBudget: number): readonly EditOp[] {
  if (before.length * after.length > cellBudget) {
    return [
      ...before.map((line): EditOp => ({ kind: 'remove', line })),
      ...after.map((line): EditOp => ({ kind: 'add', line })),
    ];
  }
  const rows = before.length;
  const cols = after.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i]![j] =
        before[i] === after[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const ops: EditOp[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (before[i] === after[j]) {
      ops.push({ kind: 'same', line: before[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      ops.push({ kind: 'remove', line: before[i]! });
      i += 1;
    } else {
      ops.push({ kind: 'add', line: after[j]! });
      j += 1;
    }
  }
  while (i < rows) {
    ops.push({ kind: 'remove', line: before[i]! });
    i += 1;
  }
  while (j < cols) {
    ops.push({ kind: 'add', line: after[j]! });
    j += 1;
  }
  return ops;
}

function clip(line: string, maxChars: number): string {
  if (line.length <= maxChars) return line;
  return `${line.slice(0, maxChars)}… (+${String(line.length - maxChars)} chars)`;
}

/** Groups ops into hunks with `context` unchanged lines around each change. */
function toHunks(ops: readonly EditOp[], context: number): readonly EditOp[][] {
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, index) => {
    if (op.kind === 'same') return;
    for (let offset = Math.max(0, index - context); offset <= Math.min(ops.length - 1, index + context); offset += 1) {
      keep[offset] = true;
    }
  });
  const hunks: EditOp[][] = [];
  let current: EditOp[] | undefined;
  ops.forEach((op, index) => {
    if (keep[index] === true) {
      current ??= [];
      current.push(op);
      return;
    }
    if (current !== undefined) {
      hunks.push(current);
      current = undefined;
    }
  });
  if (current !== undefined) hunks.push(current);
  return hunks;
}

export function renderDiffs(files: readonly DiffInput[], options: DiffRenderOptions = {}): RenderedDiff {
  const opts = { ...DEFAULT_DIFF_OPTIONS, ...options };
  const summaries: DiffSummary[] = [];
  const out: string[] = [];
  let truncated = false;
  let emitted = 0;

  const remaining = (): number => opts.maxLines - emitted;

  for (const file of files) {
    const ops = diffLines(normalize(file.before), normalize(file.after), opts.lcsCellBudget);
    const added = ops.filter((op) => op.kind === 'add').length;
    const removed = ops.filter((op) => op.kind === 'remove').length;
    summaries.push({ path: file.path, added, removed, unchanged: added === 0 && removed === 0 });
    if (added === 0 && removed === 0) continue;
    if (remaining() <= 0) {
      truncated = true;
      continue;
    }

    out.push(`--- a/${file.path}`, `+++ b/${file.path}`);
    emitted += 2;
    for (const hunk of toHunks(ops, opts.contextLines)) {
      if (remaining() <= 0) {
        truncated = true;
        break;
      }
      out.push('@@');
      emitted += 1;
      const body = hunk.slice(0, opts.maxLinesPerHunk);
      const elided = hunk.length - body.length;
      for (const op of body) {
        if (remaining() <= 0) {
          truncated = true;
          break;
        }
        const prefix = op.kind === 'add' ? '+' : op.kind === 'remove' ? '-' : ' ';
        out.push(prefix + clip(op.line, opts.maxLineChars));
        emitted += 1;
      }
      if (elided > 0) {
        out.push(`… ${String(elided)} more line(s) in this hunk`);
        emitted += 1;
        truncated = true;
      }
    }
  }

  if (truncated) out.push(`(diff truncated at ${String(opts.maxLines)} lines)`);
  const stats = summaries.filter((summary) => !summary.unchanged);
  const header =
    stats.length === 0
      ? 'No changes.'
      : `Diff: ${String(stats.length)} file(s) changed, +${String(sum(stats, 'added'))} -${String(sum(stats, 'removed'))}`;
  return {
    text: stats.length === 0 ? header : [header, '', ...out].join('\n'),
    summaries,
    truncated,
  };
}

function sum(summaries: readonly DiffSummary[], key: 'added' | 'removed'): number {
  return summaries.reduce((total, summary) => total + summary[key], 0);
}
