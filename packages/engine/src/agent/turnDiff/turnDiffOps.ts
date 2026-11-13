import { isAbsolute, normalize, relative, resolve } from 'pathe';

export interface TurnDiffPath {
  /** Workspace-relative path used in snapshots. */
  readonly key: string;
  /** Path handed to the host filesystem. */
  readonly absolute: string;
}

/** Normalize a tool-reported path for tracking; absolute paths inside the workspace become relative. */
export function turnDiffPath(rawPath: string, workDir: string): TurnDiffPath {
  const normalized = normalize(rawPath);
  if (isAbsolute(normalized)) {
    const rel = relative(normalize(workDir), normalized);
    if (rel !== '' && rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)) {
      return { key: rel, absolute: normalized };
    }
    return { key: normalized, absolute: normalized };
  }
  return { key: normalized, absolute: resolve(normalize(workDir), normalized) };
}

export function isBinaryText(text: string): boolean {
  return text.includes('\u0000');
}

export function countTextLines(text: string): number {
  if (text === '') return 0;
  let count = 0;
  let cursor = 0;
  for (;;) {
    const at = text.indexOf('\n', cursor);
    if (at < 0) break;
    count += 1;
    cursor = at + 1;
  }
  if (cursor < text.length) count += 1;
  return count;
}

const LCS_CELL_BUDGET = 4_000_000;

/** Line additions/deletions; undefined above the LCS budget so the caller can mark it oversize. */
export function countLineDelta(
  before: string,
  after: string,
): { readonly additions: number; readonly deletions: number } | undefined {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);

  let start = 0;
  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  ) {
    start += 1;
  }
  let beforeEnd = beforeLines.length;
  let afterEnd = afterLines.length;
  while (
    beforeEnd > start &&
    afterEnd > start &&
    beforeLines[beforeEnd - 1] === afterLines[afterEnd - 1]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  const oldSlice = beforeLines.slice(start, beforeEnd);
  const newSlice = afterLines.slice(start, afterEnd);
  const cells = oldSlice.length * newSlice.length;
  if (cells > LCS_CELL_BUDGET) return undefined;
  const common = lcsLength(oldSlice, newSlice);
  return {
    additions: newSlice.length - common,
    deletions: oldSlice.length - common,
  };
}

function splitLines(content: string): string[] {
  if (content === '') return [];
  const lines = content.split('\n');
  if (lines.at(-1) === '') lines.pop();
  else lines[lines.length - 1] = `${lines.at(-1)!}\u0000`;
  return lines;
}

function lcsLength(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let previous = new Uint32Array(b.length + 1);
  let current = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      current[j] =
        a[i - 1] === b[j - 1]
          ? previous[j - 1]! + 1
          : Math.max(previous[j]!, current[j - 1]!);
    }
    const swap = previous;
    previous = current;
    current = swap;
    current.fill(0);
  }
  return previous[b.length]!;
}