/**
 * Post-compaction restoration.
 *
 * After compaction the model keeps a summary and the recent tail, but it loses
 * two things that decide whether its next edit is safe: *which files it was
 * working in* and *what it had already learned about them*. This module
 * captures that state before compaction and renders it back as a fenced
 * section, bounded so restoration never recreates the problem compaction was
 * solving.
 *
 * Rules that keep it safe:
 *
 * - Only paths the agent actually read or wrote are eligible. Nothing is
 *   discovered from the workspace by this module; it has no filesystem access.
 * - Reading a file is retried at most once per path after a failure, and a
 *   path that fails twice is dropped from restoration for the session. A file
 *   that keeps failing (deleted, permissions, binary) must not cost a failed
 *   read after every compaction.
 * - Rendered content is re-fenced: a file body containing its own fence cannot
 *   break out of the section and impersonate instructions.
 * - Each restored file is capped in characters, and the whole section in
 *   characters, with a visible omission note when either cap bites.
 */

export interface RecentlyTouchedFile {
  readonly path: string;
  /** Character count of the content the agent last observed, when known. */
  readonly chars?: number;
  readonly lastOperation: 'read' | 'write';
}

export interface RestorableFile {
  readonly path: string;
  readonly content: string;
  /** True when `content` was cut at the per-file cap. */
  readonly truncated: boolean;
}

export interface RestorationConfig {
  /** Files restored per compaction. Default 5. */
  readonly maxFiles?: number;
  /** Characters kept from each file. Default 4000. */
  readonly maxCharsPerFile?: number;
  /** Characters kept for the whole section. Default 16000. */
  readonly maxTotalChars?: number;
  /** Failed reads tolerated per path before it is dropped. Default 2. */
  readonly maxFailuresPerPath?: number;
}

export interface RestoreInput {
  readonly files: readonly RecentlyTouchedFile[];
  readonly config?: RestorationConfig;
  /** Reads one file; throw to signal a failure. */
  readonly read: (path: string) => Promise<string>;
}

export interface RestoreResult {
  readonly files: readonly RestorableFile[];
  readonly omitted: number;
  readonly failures: ReadonlyMap<string, number>;
  readonly text: string | undefined;
}

export const POST_COMPACTION_FILES_HEADING = '## Files Touched Before Compaction';

const DEFAULTS = {
  maxFiles: 5,
  maxCharsPerFile: 4_000,
  maxTotalChars: 16_000,
  maxFailuresPerPath: 2,
} as const;

export function selectRestorableFiles(
  files: readonly RecentlyTouchedFile[],
  maxFiles: number,
): readonly RecentlyTouchedFile[] {
  const seen = new Set<string>();
  const ordered: RecentlyTouchedFile[] = [];
  // Writes win over reads for the same path: the model needs what it changed.
  const sorted = [...files].sort(
    (left, right) => Number(right.lastOperation === 'write') - Number(left.lastOperation === 'write'),
  );
  for (const file of sorted) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    ordered.push(file);
  }
  return ordered.slice(0, Math.max(0, maxFiles));
}

export function renderRestoredFiles(
  files: readonly RestorableFile[],
  omitted: number,
  maxTotalChars: number,
): string | undefined {
  if (files.length === 0 && omitted === 0) return undefined;
  const parts: string[] = [POST_COMPACTION_FILES_HEADING];
  let used = parts[0]!.length;
  let written = 0;
  for (const file of files) {
    if (written > 0 && used + file.content.length > maxTotalChars) break;
    const fence = fenceFor(file.content);
    const block = `### ${file.path}${file.truncated ? ' (truncated)' : ''}\n${fence}\n${file.content}\n${fence}`;
    parts.push(block);
    used += block.length;
    written += 1;
  }
  const notShown = omitted + (files.length - written);
  if (notShown > 0) parts.push(`(${String(notShown)} more file(s) not restored)`);
  return parts.join('\n\n');
}

/** Picks a fence longer than any run of backticks inside `content`. */
export function fenceFor(content: string): string {
  let longest = 0;
  for (const match of content.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return '`'.repeat(Math.max(3, longest + 1));
}

export async function restoreRecentlyTouchedFiles(input: RestoreInput): Promise<RestoreResult> {
  const config = {
    maxFiles: positiveOrDefault(input.config?.maxFiles, DEFAULTS.maxFiles),
    maxCharsPerFile: positiveOrDefault(input.config?.maxCharsPerFile, DEFAULTS.maxCharsPerFile),
    maxTotalChars: positiveOrDefault(input.config?.maxTotalChars, DEFAULTS.maxTotalChars),
    maxFailuresPerPath: positiveOrDefault(input.config?.maxFailuresPerPath, DEFAULTS.maxFailuresPerPath),
  };
  const failures = new Map<string, number>();
  const selected = selectRestorableFiles(input.files, config.maxFiles * 2);
  const restored: RestorableFile[] = [];
  let omitted = 0;

  for (const file of selected) {
    if (restored.length >= config.maxFiles) {
      omitted += 1;
      continue;
    }
    let attempts = 0;
    let content: string | undefined;
    while (attempts < config.maxFailuresPerPath) {
      attempts += 1;
      try {
        content = await input.read(file.path);
        break;
      } catch {
        failures.set(file.path, (failures.get(file.path) ?? 0) + 1);
      }
    }
    if (content === undefined) {
      omitted += 1;
      continue;
    }
    const truncated = content.length > config.maxCharsPerFile;
    restored.push({
      path: file.path,
      content: truncated ? content.slice(0, config.maxCharsPerFile) : content,
      truncated,
    });
  }

  return {
    files: restored,
    omitted,
    failures,
    text: renderRestoredFiles(restored, omitted, config.maxTotalChars),
  };
}

function positiveOrDefault(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value >= 1 ? value : fallback;
}
