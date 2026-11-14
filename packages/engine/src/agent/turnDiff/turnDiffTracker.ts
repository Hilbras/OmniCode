import type { TurnDiffFile, TurnDiffRenderScope, TurnDiffSnapshot } from './turnDiff';
import { countLineDelta, countTextLines, isBinaryText } from './turnDiffOps';

export interface TurnDiffCapture {
  /** False when the file could not be read for a reason other than absence. */
  readonly captured: boolean;
  /** File text; undefined means the file was absent or too large to track. */
  readonly content?: string;
  readonly oversize?: boolean;
}

interface TrackedEntry {
  readonly absolute: string;
  before: TurnDiffCapture;
  after?: TurnDiffCapture;
}

interface TurnRecord {
  readonly files: Map<string, TrackedEntry>;
  open: boolean;
  closed?: TurnDiffSnapshot;
}

const MAX_RETAINED_TURNS = 32;
const MAX_FILES_PER_TURN = 500;

/**
 * Pure accumulator behind the agent turn-diff service. It knows nothing about
 * the filesystem; the service captures content and feeds it in, which keeps
 * the delta shaping deterministic and unit-testable.
 */
export class TurnDiffTracker {
  private readonly turns = new Map<number, TurnRecord>();
  private order: number[] = [];

  begin(turnId: number): void {
    if (this.turns.has(turnId)) {
      this.turns.get(turnId)!.open = true;
      return;
    }
    this.turns.set(turnId, { files: new Map(), open: true });
    this.order.push(turnId);
  }

  isTracked(turnId: number): boolean {
    return this.turns.has(turnId);
  }

  isOpen(turnId: number): boolean {
    return this.turns.get(turnId)?.open === true;
  }

  activeTurn(): number | undefined {
    for (let index = this.order.length - 1; index >= 0; index -= 1) {
      const turnId = this.order[index]!;
      if (this.turns.get(turnId)!.open) return turnId;
    }
    return undefined;
  }

  hasBefore(turnId: number, key: string): boolean {
    return this.turns.get(turnId)?.files.has(key) === true;
  }

  trackedPaths(turnId: number): readonly { readonly key: string; readonly absolute: string }[] {
    const record = this.turns.get(turnId);
    if (record === undefined) return [];
    return [...record.files].map(([key, entry]) => ({ key, absolute: entry.absolute }));
  }

  /** First capture wins: the pre-turn content must not be overwritten by a later tool. */
  noteBefore(turnId: number, key: string, absolute: string, capture: TurnDiffCapture): boolean {
    const record = this.ensure(turnId);
    const existing = record.files.get(key);
    if (existing !== undefined) return true;
    if (record.files.size >= MAX_FILES_PER_TURN) return false;
    record.files.set(key, { absolute, before: capture });
    return true;
  }

  noteAfter(turnId: number, key: string, absolute: string, capture: TurnDiffCapture): void {
    const record = this.ensure(turnId);
    const existing = record.files.get(key);
    if (existing === undefined) {
      record.files.set(key, { absolute, before: { captured: false }, after: capture });
      return;
    }
    existing.after = capture;
  }

  snapshot(turnId: number): TurnDiffSnapshot | undefined {
    const record = this.turns.get(turnId);
    if (record === undefined) return undefined;
    if (record.closed !== undefined) return record.closed;
    return buildSnapshot(turnId, 'open', record.files);
  }

  /**
   * Render inputs for the diff renderer, one entry per path whose content is
   * diffable: `latest` resolves the most recent turn, `session` merges every
   * retained turn per path (first pre-image wins, last post-image wins).
   * Unchanged, binary, oversize, and never-fully-observed paths are omitted —
   * the renderer only sees content it can honestly diff.
   */
  diffInputs(scope: TurnDiffRenderScope): readonly { readonly path: string; readonly before: string; readonly after: string }[] {
    const entries = scope === 'latest' ? this.turnEntries(this.latestTurnId()) : this.mergedEntries();
    if (entries === undefined) return [];
    const inputs: { path: string; before: string; after: string }[] = [];
    for (const key of [...entries.keys()].toSorted()) {
      const entry = entries.get(key)!;
      const input = renderableInput(entry.before, entry.after);
      if (input !== undefined) inputs.push({ path: key, before: input.before, after: input.after });
    }
    return inputs;
  }

  /** Delta files behind `diffInputs`, including the binary/oversize paths the renderer omits. */
  files(scope: TurnDiffRenderScope): readonly TurnDiffFile[] {
    if (scope === 'latest') {
      const turnId = this.latestTurnId();
      return turnId === undefined ? [] : (this.snapshot(turnId)?.files ?? []);
    }
    const entries = this.mergedEntries();
    if (entries === undefined) return [];
    return deltaFiles(entries).files;
  }

  private latestTurnId(): number | undefined {
    return this.activeTurn() ?? this.latestTurn();
  }

  private turnEntries(turnId: number | undefined): ReadonlyMap<string, TrackedEntry> | undefined {
    if (turnId === undefined) return undefined;
    return this.turns.get(turnId)?.files;
  }

  /** Per-path union of every retained turn: earliest `before`, latest `after`. */
  private mergedEntries(): ReadonlyMap<string, TrackedEntry> | undefined {
    if (this.order.length === 0) return undefined;
    const merged = new Map<string, TrackedEntry>();
    for (const turnId of this.order) {
      const record = this.turns.get(turnId);
      if (record === undefined) continue;
      for (const [key, entry] of record.files) {
        const existing = merged.get(key);
        if (existing === undefined) {
          merged.set(key, { absolute: entry.absolute, before: entry.before, after: entry.after });
          continue;
        }
        if (entry.after !== undefined) existing.after = entry.after;
      }
    }
    return merged;
  }

  close(turnId: number): TurnDiffSnapshot | undefined {
    const record = this.turns.get(turnId);
    if (record === undefined) return undefined;
    record.open = false;
    record.closed = buildSnapshot(turnId, 'closed', record.files);
    this.prune();
    return record.closed;
  }

  closedSnapshots(): readonly TurnDiffSnapshot[] {
    const snapshots: TurnDiffSnapshot[] = [];
    for (const turnId of this.order) {
      const closed = this.turns.get(turnId)?.closed;
      if (closed !== undefined) snapshots.push(closed);
    }
    return snapshots;
  }

  latestTurn(): number | undefined {
    return this.order.at(-1);
  }

  private ensure(turnId: number): TurnRecord {
    const existing = this.turns.get(turnId);
    if (existing !== undefined) return existing;
    this.begin(turnId);
    return this.turns.get(turnId)!;
  }

  private prune(): void {
    while (this.order.length > MAX_RETAINED_TURNS) {
      const oldest = this.order[0]!;
      if (this.turns.get(oldest)?.open === true) return;
      this.order.shift();
      this.turns.delete(oldest);
    }
  }
}

function buildSnapshot(
  turnId: number,
  state: 'open' | 'closed',
  entries: ReadonlyMap<string, TrackedEntry>,
): TurnDiffSnapshot {
  const { files, additions, deletions } = deltaFiles(entries);
  return { turnId, state, files, additions, deletions };
}

function deltaFiles(entries: ReadonlyMap<string, TrackedEntry>): {
  readonly files: readonly TurnDiffFile[];
  readonly additions: number;
  readonly deletions: number;
} {
  const files: TurnDiffFile[] = [];
  let additions = 0;
  let deletions = 0;
  for (const key of [...entries.keys()].toSorted()) {
    const entry = entries.get(key)!;
    const file = fileDelta(key, entry);
    if (file === undefined) continue;
    files.push(file);
    additions += file.additions;
    deletions += file.deletions;
  }
  return { files, additions, deletions };
}

/**
 * Content pair the renderer can honestly diff: both sides observed, neither
 * oversize, neither binary, and actually different. Missing sides become
 * empty strings so adds/deletes render as pure insertion/deletion. The gate
 * mirrors `fileDelta` exactly — including its LCS-budget check — so a path
 * `files()` flags `oversize` can never reach the renderer while the panel
 * note still claims it was not rendered.
 */
function renderableInput(
  before: TurnDiffCapture,
  after: TurnDiffCapture | undefined,
): { readonly before: string; readonly after: string } | undefined {
  if (!before.captured || after === undefined || !after.captured) return undefined;
  if (before.oversize === true || after.oversize === true) return undefined;
  if (before.content === undefined && after.content === undefined) return undefined;
  if (before.content === undefined) return { before: '', after: after.content! };
  if (after.content === undefined) return { before: before.content, after: '' };
  if (before.content === after.content) return undefined;
  if (isBinaryText(before.content) || isBinaryText(after.content)) return undefined;
  if (countLineDelta(before.content, after.content) === undefined) return undefined;
  return { before: before.content, after: after.content };
}

function fileDelta(key: string, entry: TrackedEntry): TurnDiffFile | undefined {
  const before = entry.before;
  const after = entry.after;
  if (!before.captured || after === undefined || !after.captured) return undefined;

  const beforeMissing = before.content === undefined && before.oversize !== true;
  const afterMissing = after.content === undefined && after.oversize !== true;
  if (beforeMissing && afterMissing) return undefined;

  const status = beforeMissing ? 'added' : afterMissing ? 'deleted' : 'modified';
  if (before.oversize === true || after.oversize === true) {
    return { path: key, status, additions: 0, deletions: 0, oversize: true };
  }
  if (before.content === after.content) return undefined;
  if (before.content === undefined) {
    return { path: key, status, additions: countTextLines(after.content!), deletions: 0 };
  }
  if (after.content === undefined) {
    return { path: key, status, additions: 0, deletions: countTextLines(before.content) };
  }
  if (isBinaryText(before.content) || isBinaryText(after.content)) {
    return { path: key, status, additions: 0, deletions: 0, binary: true };
  }
  const delta = countLineDelta(before.content, after.content);
  if (delta === undefined) {
    return { path: key, status, additions: 0, deletions: 0, oversize: true };
  }
  return { path: key, status, additions: delta.additions, deletions: delta.deletions };
}