import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gt, lt, valid } from 'semver';

const MAX_NOTES_ITEMS = 30;

export interface ReleaseNoteSection {
  readonly version: string;
  readonly items: readonly string[];
}

export interface ReleaseNotesBetween {
  readonly sections: readonly ReleaseNoteSection[];
  readonly omittedItems: number;
}

/**
 * Locate the CHANGELOG.md shipped alongside the running build.
 *
 * Under the packaged layout (`dist/main.mjs` → package root) the file sits
 * next to `package.json`; under the dev layout (tsx over the source tree)
 * it sits in `apps/omnicode`. Walk up a bounded number of directory levels
 * from this module and return the first directory that also has a
 * `CHANGELOG.md`. Returns undefined when neither layout is present (SEA,
 * exotic installs) — callers fall back to the changelog URL.
 */
export function locateChangelogFile(startDir?: string): string | undefined {
  let dir = startDir ?? import.meta.dirname;
  for (let depth = 0; depth < 4; depth++) {
    const candidate = join(dir, 'CHANGELOG.md');
    try {
      const stat = statSync(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // fall through: this directory level does not have one
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

/**
 * Parse the Changesets changelog format into version sections.
 *
 * Keeps the user-facing bullet lines and strips the commit-link +
 * "Thanks @author!" noise so what renders in a TUI is the sentence, not
 * the bookkeeping. Sections come back in document order (newest first,
 * matching the file layout).
 */
export function parseChangelogSections(markdown: string): readonly ReleaseNoteSection[] {
  const lines = markdown.split('\n');
  const sections: ReleaseNoteSection[] = [];
  let current: { version: string; items: string[] } | undefined;

  const flush = (): void => {
    if (current !== undefined && current.items.length > 0) {
      sections.push({ version: current.version, items: current.items });
    }
    current = undefined;
  };

  for (const line of lines) {
    const header = line.match(/^##\s+(v?[\d][^\s]*)\s*$/);
    if (header !== null) {
      flush();
      current = { version: header[1]!.replace(/^v/, ''), items: [] };
      continue;
    }
    if (current === undefined) continue;
    const changeset = line.match(
      /^-\s+\[[^\]]+\]\([^)]*\)\s+Thanks\s+\[[^\]]+\]\([^)]*\)!?\s*-\s*(.+)$/,
    );
    if (changeset !== null) {
      current.items.push(changeset[1]!.trim());
      continue;
    }
    const plain = line.match(/^-\s+(.+)$/);
    if (plain !== null) {
      const text = plain[1]!.trim();
      if (!text.startsWith('http')) current.items.push(text);
    }
  }
  flush();
  return sections;
}

function isStrictlyBetween(candidate: string, from: string, to: string): boolean {
  if (valid(candidate) === null || valid(from) === null || valid(to) === null) return false;
  return gt(candidate, from) && lt(candidate, to);
}

/**
 * Select the release notes covering `fromVersion` (exclusive) to `toVersion`
 * (inclusive), newest first, capped at MAX_NOTES_ITEMS total with an
 * `omittedItems` count so the UI can say "…and N more".
 *
 * A `fromVersion` that matches no section (e.g. the user's version predates
 * the shipped changelog) includes every section — the notes are all the
 * running build knows about, which is exactly the honest answer.
 */
export function notesBetweenSections(
  sections: readonly ReleaseNoteSection[],
  fromVersion: string,
  toVersion: string,
): ReleaseNotesBetween {
  const inRange = sections.filter(
    (section) =>
      section.version !== fromVersion &&
      (section.version === toVersion || isStrictlyBetween(section.version, fromVersion, toVersion)),
  );
  const chosen: ReleaseNoteSection[] = [];
  let total = 0;
  let omitted = 0;
  for (const section of inRange) {
    if (total >= MAX_NOTES_ITEMS) {
      omitted += section.items.length;
      continue;
    }
    const room = MAX_NOTES_ITEMS - total;
    const kept = section.items.slice(0, room);
    omitted += section.items.length - kept.length;
    if (kept.length > 0) {
      chosen.push({ version: section.version, items: kept });
      total += kept.length;
    }
  }
  return { sections: chosen, omittedItems: omitted };
}

export function readChangelogFileIfPresent(startDir?: string): string | undefined {
  const filePath = locateChangelogFile(startDir);
  if (filePath === undefined) return undefined;
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}
