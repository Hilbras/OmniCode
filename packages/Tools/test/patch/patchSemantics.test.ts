import { describe, expect, it } from 'vitest';

import {
  PatchApplyError,
  applyPatch,
  parsePatch,
  patchOperationPaths,
  type PatchFileAdapter,
} from '#/patch/applyPatch';
import { rootedPatchPathMapper } from '#/patch/patchPath';

class MemoryFs implements PatchFileAdapter {
  readonly files = new Map<string, string>();
  readonly writes: string[] = [];
  failOnWrite: string | undefined;
  async readFile(path: string): Promise<string | undefined> {
    return this.files.get(path);
  }
  async writeFile(path: string, content: string): Promise<void> {
    if (path === this.failOnWrite) throw new Error(`disk full: ${path}`);
    this.writes.push(path);
    this.files.set(path, content);
  }
  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }
}

function begin(...lines: string[]): string {
  return ['*** Begin Patch', ...lines, '*** End Patch'].join('\n');
}

describe('applyPatch verify-before-apply', () => {
  it('writes nothing when a later hunk cannot match', async () => {
    const fs = new MemoryFs();
    fs.files.set('a.txt', 'one\n');
    await expect(
      applyPatch(
        begin('*** Update File: a.txt', '@@', '-nothing-like-this', '+never', '*** Add File: b.txt', '+b'),
        fs,
      ),
    ).rejects.toBeInstanceOf(PatchApplyError);
    // The add never ran because the plan phase verified every action first.
    expect(fs.writes).toEqual([]);
    expect(fs.files.has('b.txt')).toBe(false);
    expect(fs.files.get('a.txt')).toBe('one\n');
  });

  it('reports a duplicate target as a parse-time failure', async () => {
    const fs = new MemoryFs();
    fs.files.set('a.txt', 'one\n');
    await expect(
      applyPatch(begin('*** Update File: a.txt', '@@', '-one', '+x', '*** Delete File: a.txt'), fs),
    ).rejects.toMatchObject({ code: 'duplicate-target', committedFiles: [] });
  });

  it('rejects a move onto an existing file without touching either', async () => {
    const fs = new MemoryFs();
    fs.files.set('a.txt', 'a\n');
    fs.files.set('b.txt', 'b\n');
    await expect(
      applyPatch(begin('*** Update File: a.txt', '*** Move to: b.txt'), fs),
    ).rejects.toMatchObject({ code: 'target-exists', committedFiles: [] });
    expect(fs.files.get('b.txt')).toBe('b\n');
  });

  it('moves a file and keeps its content', async () => {
    const fs = new MemoryFs();
    fs.files.set('a.txt', 'a\n');
    const result = await applyPatch(begin('*** Update File: a.txt', '*** Move to: d/b.txt'), fs);
    expect(result).toMatchObject({ moved: 1, changedFiles: ['a.txt', 'd/b.txt'] });
    expect(fs.files.has('a.txt')).toBe(false);
    expect(fs.files.get('d/b.txt')).toBe('a\n');
  });

  it('applies an update and a move together', async () => {
    const fs = new MemoryFs();
    fs.files.set('a.txt', 'one\ntwo\n');
    const result = await applyPatch(
      begin('*** Update File: a.txt', '@@', '-two', '+deux', '*** Move to: b.txt'),
      fs,
    );
    expect(result.updated).toBe(1);
    expect(fs.files.get('b.txt')).toBe('one\ndeux\n');
    expect(fs.files.has('a.txt')).toBe(false);
  });

  it('reports the committed delta when a write fails mid-patch', async () => {
    const fs = new MemoryFs();
    fs.files.set('a.txt', 'one\n');
    fs.failOnWrite = 'c.txt';
    let failure: PatchApplyError | undefined;
    try {
      await applyPatch(
        begin(
          '*** Add File: b.txt',
          '+b',
          '*** Add File: c.txt',
          '+c',
        ),
        fs,
      );
    } catch (error) {
      failure = error as PatchApplyError;
    }
    expect(failure).toBeInstanceOf(PatchApplyError);
    expect(failure?.code).toBe('verify-failed');
    expect(failure?.committedFiles).toContain('b.txt');
    // Without a journal the earlier write is rolled back from the backup.
    expect(fs.files.has('b.txt')).toBe(false);
  });

  it('can verify a dry run against a virtual tree', async () => {
    const fs = new MemoryFs();
    fs.files.set('a.txt', 'one\n');
    const virtual = new MemoryFs();
    for (const [path, content] of fs.files) virtual.files.set(path, content);
    const before = new Map(virtual.files);
    const result = await applyPatch(begin('*** Update File: a.txt', '@@', '-one', '+1'), virtual);
    expect(result.updated).toBe(1);
    expect(fs.files.get('a.txt')).toBe('one\n');
    expect(before.get('a.txt')).toBe('one\n');
  });
});

describe('patchOperationPaths', () => {
  it('covers both sides of a move and an update-with-move', () => {
    const operations = parsePatch(
      begin(
        '*** Update File: a.txt',
        '@@',
        '-x',
        '+y',
        '*** Move to: b.txt',
      ),
    );
    expect(operations.flatMap(patchOperationPaths)).toEqual(['a.txt', 'b.txt']);
  });
});

describe('patch path seam', () => {
  it('applies patch paths through a remote root while reporting patch paths', async () => {
    const fs = new MemoryFs();
    fs.files.set('/remote/ws/a.txt', 'one\n');
    const result = await applyPatch(begin('*** Update File: a.txt', '@@', '-one', '+1'), fs, {
      paths: rootedPatchPathMapper('/remote/ws'),
    });
    expect(result.changedFiles).toEqual(['a.txt']);
    expect(fs.files.get('/remote/ws/a.txt')).toBe('1\n');
    expect(fs.files.has('a.txt')).toBe(false);
  });

  it('resolves move destinations through the same mapper', async () => {
    const fs = new MemoryFs();
    fs.files.set('/remote/ws/a.txt', 'a\n');
    const result = await applyPatch(begin('*** Update File: a.txt', '*** Move to: d/b.txt'), fs, {
      paths: rootedPatchPathMapper('/remote/ws'),
    });
    expect(result.changedFiles).toEqual(['a.txt', 'd/b.txt']);
    expect(fs.files.get('/remote/ws/d/b.txt')).toBe('a\n');
    expect(fs.files.has('/remote/ws/a.txt')).toBe(false);
  });

  it('refuses absolute paths and traversal out of the root', () => {
    const mapper = rootedPatchPathMapper('/remote/ws');
    expect(() => mapper.toBackend('/etc/passwd')).toThrow('relative to the patch root');
    expect(() => mapper.toBackend('../outside.txt')).toThrow('escapes the patch root');
    expect(mapper.toBackend('nested/file.txt')).toBe('/remote/ws/nested/file.txt');
  });
});
