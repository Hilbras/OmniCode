import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * On-disk intent journal for multi-file patch application.
 *
 * Every file the patch is about to touch is recorded — together with its
 * pre-write content — before the first mutation, so a process that dies
 * mid-patch leaves enough on disk for the next start to restore the original
 * files instead of a half-applied tree. A completed patch removes its journal.
 */

export interface PatchJournalEntry {
  readonly path: string;
  /** Absolute backup file holding the pre-write content; undefined when the file did not exist. */
  readonly backup: string | undefined;
}

interface PatchJournalIntent {
  readonly root: string;
  readonly id: string;
  readonly entries: readonly PatchJournalEntry[];
}

const JOURNAL_DIR_NAME = 'patch-journal';

function journalBase(root: string): string {
  return join(root, '.omnicode', JOURNAL_DIR_NAME);
}

export class PatchJournal {
  readonly dir: string;
  private readonly entries: PatchJournalEntry[] = [];
  private sequence = 0;

  private constructor(
    readonly root: string,
    readonly id: string,
  ) {
    this.dir = join(journalBase(root), id);
  }

  static async open(root: string, id: string = randomUUID()): Promise<PatchJournal> {
    const journal = new PatchJournal(root, id);
    await mkdir(journal.dir, { recursive: true, mode: 0o700 });
    return journal;
  }

  /** Record the pre-write content of `path` once, then persist the intent. */
  async record(path: string, before: string | undefined): Promise<void> {
    if (this.entries.some((entry) => entry.path === path)) return;
    this.sequence += 1;
    let backup: string | undefined;
    if (before !== undefined) {
      backup = join(this.dir, `backup-${String(this.sequence)}.txt`);
      await writeFile(backup, before, { mode: 0o600 });
    }
    this.entries.push({ path, backup });
    await this.persist();
  }

  /** Drop the journal: the patch finished, nothing left to recover. */
  async finish(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }

  /** Restore every recorded file, newest record first, then drop the journal. */
  async rollback(): Promise<void> {
    await restoreEntries(this.entries);
    await this.finish();
  }

  private async persist(): Promise<void> {
    const intent: PatchJournalIntent = { root: this.root, id: this.id, entries: this.entries };
    const tmp = join(this.dir, 'intent.json.tmp');
    await writeFile(tmp, JSON.stringify(intent));
    await rename(tmp, join(this.dir, 'intent.json'));
  }
}

async function restoreEntries(entries: readonly PatchJournalEntry[]): Promise<void> {
  for (const entry of [...entries].reverse()) {
    if (entry.backup === undefined) {
      await unlink(entry.path).catch(() => undefined);
      continue;
    }
    try {
      await writeFile(entry.path, await readFile(entry.backup, 'utf8'));
    } catch {
      /* the backup vanished with the journal; nothing to restore from */
    }
  }
}

/**
 * Roll back journals left behind by a crashed patch run under `root`.
 * Returns the paths that were restored or removed.
 */
export async function recoverPatchJournals(root: string): Promise<readonly string[]> {
  const base = journalBase(root);
  const ids = await readdir(base).catch(() => [] as string[]);
  const recovered: string[] = [];
  for (const id of ids) {
    const dir = join(base, id);
    let raw: string;
    try {
      raw = await readFile(join(dir, 'intent.json'), 'utf8');
    } catch {
      await rm(dir, { recursive: true, force: true });
      continue;
    }
    let entries: readonly PatchJournalEntry[] = [];
    try {
      entries = (JSON.parse(raw) as { entries?: readonly PatchJournalEntry[] }).entries ?? [];
    } catch {
      entries = [];
    }
    await restoreEntries(entries);
    for (const entry of entries) recovered.push(entry.path);
    await rm(dir, { recursive: true, force: true });
  }
  return recovered;
}
