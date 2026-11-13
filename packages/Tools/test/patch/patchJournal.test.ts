import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { dirname, join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';

import { applyPatch, type PatchFileAdapter } from '#/patch/applyPatch';
import { PatchJournal, recoverPatchJournals } from '#/patch/patchJournal';
import { rootedPatchPathMapper } from '#/patch/patchPath';

const tempDirs: string[] = [];

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omnicode-patch-journal-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function nodeAdapter(): PatchFileAdapter {
  return {
    async readFile(path) {
      try {
        return await readFile(path, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async writeFile(path, content) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, 'utf8');
    },
    async deleteFile(path) {
      await rm(path, { force: true });
    },
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('patch journal', () => {
  it('persists intent before the patch writes and removes it on success', async () => {
    const root = await makeRoot();
    const target = join(root, 'a.txt');
    await writeFile(target, 'one\n', 'utf8');

    const journal = await PatchJournal.open(root, 'success-1');
    await journal.record(target, 'one\n');
    expect(await exists(join(root, '.omnicode', 'patch-journal', 'success-1', 'intent.json'))).toBe(true);

    const adapter = nodeAdapter();
    const result = await applyPatch(
      ['*** Begin Patch', `*** Update File: ${target}`, '@@', '-one', '+two', '*** End Patch'].join('\n'),
      adapter,
      { journal },
    );
    expect(result.updated).toBe(1);
    expect(await readFile(target, 'utf8')).toBe('two\n');
    await expect(recoverPatchJournals(root)).resolves.toEqual([]);
    expect(await exists(journal.dir)).toBe(false);
  });

  it('restores files left by a crashed patch run', async () => {
    const root = await makeRoot();
    const restored = join(root, 'restored.txt');
    const created = join(root, 'created.txt');
    await writeFile(restored, 'original\n', 'utf8');

    const journal = await PatchJournal.open(root, 'crash-1');
    await journal.record(restored, 'original\n');
    await journal.record(created, undefined);
    await writeFile(restored, 'half applied\n', 'utf8');
    await writeFile(created, 'partial\n', 'utf8');

    const recovered = await recoverPatchJournals(root);
    expect([...recovered].sort()).toEqual([created, restored].sort());
    expect(await readFile(restored, 'utf8')).toBe('original\n');
    expect(await exists(created)).toBe(false);
    expect(await exists(join(root, '.omnicode', 'patch-journal', 'crash-1'))).toBe(false);
  });

  it('rolls a failed patch back and clears its journal', async () => {
    const root = await makeRoot();
    const adapter = nodeAdapter();
    const journal = await PatchJournal.open(root, 'failure-1');
    const added = join(root, 'added.txt');

    await writeFile(join(root, 'existing.txt'), 'present\n', 'utf8');
    const patch = [
      '*** Begin Patch',
      `*** Add File: ${added}`,
      '+hello',
      `*** Update File: ${join(root, 'missing.txt')}`,
      '@@',
      '-nope',
      '+still nope',
      '*** End Patch',
    ].join('\n');

    await expect(applyPatch(patch, adapter, { journal })).rejects.toThrow(/missing\.txt/);
    expect(await exists(added)).toBe(false);
    expect(await exists(journal.dir)).toBe(false);
  });

  it('leaves no journal behind when the patch fails without one', async () => {
    const root = await makeRoot();
    const adapter = nodeAdapter();
    const patch = [
      '*** Begin Patch',
      `*** Update File: ${join(root, 'missing.txt')}`,
      '@@',
      '-nope',
      '+nope',
      '*** End Patch',
    ].join('\n');
    await expect(applyPatch(patch, adapter)).rejects.toThrow(/missing\.txt/);
    await expect(recoverPatchJournals(root)).resolves.toEqual([]);
  });

  it('journals backend-resolved paths under a non-identity mapper so restore lands on the real files', async () => {
    const root = await makeRoot();
    const kept = join(root, 'journal-seam-a.txt');
    const added = join(root, 'journal-seam-b.txt');
    await writeFile(kept, 'one\n', 'utf8');

    const adapter = nodeAdapter();
    const failingDelete: PatchFileAdapter = {
      ...adapter,
      async deleteFile(path) {
        if (path === kept) throw new Error('disk full');
        await adapter.deleteFile(path);
      },
    };
    const journal = await PatchJournal.open(root, 'mapper-1');
    const patch = [
      '*** Begin Patch',
      '*** Add File: journal-seam-b.txt',
      '+hello',
      '*** Delete File: journal-seam-a.txt',
      '*** End Patch',
    ].join('\n');

    await expect(
      applyPatch(patch, failingDelete, { journal, paths: rootedPatchPathMapper(root) }),
    ).rejects.toMatchObject({ code: 'verify-failed' });

    expect(await readFile(kept, 'utf8')).toBe('one\n');
    expect(await exists(added)).toBe(false);
    expect(await exists(journal.dir)).toBe(false);
    await expect(recoverPatchJournals(root)).resolves.toEqual([]);
    expect(await exists(join(process.cwd(), 'journal-seam-a.txt'))).toBe(false);
    expect(await exists(join(process.cwd(), 'journal-seam-b.txt'))).toBe(false);
  });
});
