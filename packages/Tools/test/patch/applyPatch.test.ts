import { describe, expect, it } from 'vitest';

import { applyPatch, parsePatch, type PatchFileAdapter } from '#/patch/applyPatch';

class MemoryFs implements PatchFileAdapter {
  readonly files = new Map<string, string>();
  async readFile(path: string): Promise<string | undefined> { return this.files.get(path); }
  async writeFile(path: string, content: string): Promise<void> { this.files.set(path, content); }
  async deleteFile(path: string): Promise<void> { this.files.delete(path); }
}

describe('applyPatch', () => {
  it('parses and applies add, update, and delete operations', async () => {
    const fs = new MemoryFs();
    fs.files.set('a.txt', 'one\ntwo\nthree\n');
    fs.files.set('old.txt', 'bye\n');
    const result = await applyPatch(
      `*** Begin Patch
*** Add File: new.txt
+hello
+world
*** Update File: a.txt
@@
 one
-two
+deux
 three
*** Delete File: old.txt
*** End Patch`,
      fs,
    );
    expect(result).toMatchObject({ added: 1, updated: 1, deleted: 1 });
    expect(fs.files.get('new.txt')).toBe('hello\nworld\n');
    expect(fs.files.get('a.txt')).toBe('one\ndeux\nthree\n');
    expect(fs.files.has('old.txt')).toBe(false);
  });

  it('rolls back all files when one hunk fails', async () => {
    const fs = new MemoryFs();
    fs.files.set('a.txt', 'one\n');
    fs.files.set('b.txt', 'other\n');
    await expect(
      applyPatch(
        `*** Begin Patch
*** Update File: a.txt
@@
-one
+ONE
*** Update File: b.txt
@@
-missing
+whatever
*** End Patch`,
        fs,
      ),
    ).rejects.toThrow('did not match');
    expect(fs.files.get('a.txt')).toBe('one\n');
    expect(fs.files.get('b.txt')).toBe('other\n');
  });

  it('rejects malformed patches before applying', () => {
    expect(() => parsePatch('not a patch')).toThrow('must start');
    expect(() => parsePatch('*** Begin Patch\n*** Add File: x\nbad\n*** End Patch')).toThrow('must start with +');
  });
});
