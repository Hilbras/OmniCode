/**
 * Tracks which files the agent touched so compaction can restore them.
 *
 * This is deliberately event-driven and self-bounded: it keeps one entry per
 * path (not per call), so a long read-heavy session costs one record per file.
 * It records only paths that were successfully read or written — a call that
 * failed says nothing about what the file contains, and restoring a path the
 * agent could not read would fail again after every compaction.
 */

import type { RecentlyTouchedFile } from './fileRestoration';

/** Paths retained before the least recently touched is dropped. Default 64. */
export const DEFAULT_TRACKED_FILES = 64;

const PATH_ARG_KEYS = ['file_path', 'path', 'notebook_path', 'target_file'] as const;
const READ_TOOL_NAMES = new Set(['Read', 'ReadMediaFile']);
const WRITE_TOOL_NAMES = new Set(['Write', 'Edit', 'NotebookEdit']);

export class RecentlyTouchedFilesTracker {
  private readonly files = new Map<string, RecentlyTouchedFile>();
  private readonly limit: number;

  constructor(limit: number = DEFAULT_TRACKED_FILES) {
    this.limit = Number.isInteger(limit) && limit >= 1 ? limit : DEFAULT_TRACKED_FILES;
  }

  /** Records the outcome of one tool call. Returns true when a file was recorded. */
  record(toolName: string, args: unknown, isError: boolean): boolean {
    if (isError) return false;
    const operation = READ_TOOL_NAMES.has(toolName)
      ? 'read'
      : WRITE_TOOL_NAMES.has(toolName)
        ? 'write'
        : undefined;
    if (operation === undefined) return false;
    const path = pathFromArgs(args);
    if (path === undefined) return false;

    const previous = this.files.get(path);
    // A read after a write keeps the write: the model needs what it changed.
    if (previous?.lastOperation === 'write' && operation === 'read') return false;
    this.files.delete(path);
    this.files.set(path, { path, lastOperation: operation });
    while (this.files.size > this.limit) {
      const oldest = this.files.keys().next();
      if (oldest.done === true) break;
      this.files.delete(oldest.value);
    }
    return true;
  }

  /** Most recent first. */
  list(): readonly RecentlyTouchedFile[] {
    return [...this.files.values()].reverse();
  }

  clear(): void {
    this.files.clear();
  }
}

function pathFromArgs(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  for (const key of PATH_ARG_KEYS) {
    const value = (args as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}
