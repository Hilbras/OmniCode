import { describe, expect, it } from 'vitest';

import { applyPatch, parsePatch, type PatchFileAdapter } from '#/patch/applyPatch';
import { PatchStreamParser } from '#/patch/patchStream';

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

describe('PatchStreamParser', () => {
  const PATCH = `*** Begin Patch
*** Add File: new.txt
+hello
+world
*** Update File: a.txt
@@
 one
-two
+deux
 three
*** Move to: moved.txt
*** Delete File: old.txt
*** End Patch
`;

  it('yields the same operations as the whole-string parser at any chunking', () => {
    const expected = parsePatch(PATCH);
    for (const size of [1, 2, 3, 7]) {
      const parser = new PatchStreamParser();
      for (let index = 0; index < PATCH.length; index += size) {
        parser.push(PATCH.slice(index, index + size));
      }
      expect(parser.finish()).toEqual(expected);
      expect(parser.done).toBe(true);
    }
  });

  it('exposes completed operations before the patch ends', () => {
    const parser = new PatchStreamParser();
    parser.push('*** Begin Patch\n*** Add File: a.txt\n+x\n');
    expect(parser.operations()).toEqual([]);
    parser.push('*** Update File: a.txt\n');
    expect(parser.operations()).toEqual([{ kind: 'add', path: 'a.txt', content: 'x\n' }]);
  });

  it('keeps a CRLF split across chunks as one line break', () => {
    const parser = new PatchStreamParser();
    parser.push('*** Begin Patch\r');
    parser.push('\n*** Add File: a.txt\r');
    parser.push('\n+x\r\n*** End Patch');
    expect(parser.finish()).toEqual([{ kind: 'add', path: 'a.txt', content: 'x\n' }]);
  });

  it('throws on a malformed complete line and on a missing terminator', () => {
    const malformed = new PatchStreamParser();
    malformed.push('*** Begin Patch\n*** Add File: a.txt\n');
    expect(() => malformed.push('bad\n')).toThrow('must start with +');

    const unterminated = new PatchStreamParser();
    unterminated.push('*** Begin Patch\n*** Delete File: a.txt\n');
    expect(() => unterminated.finish()).toThrow('missing *** End Patch');
  });

  it('rejects duplicate targets once the patch closes', () => {
    const parser = new PatchStreamParser();
    parser.push('*** Begin Patch\n*** Add File: a.txt\n+x\n');
    expect(() => parser.push('*** Delete File: a.txt\n*** End Patch\n')).toThrow('more than once');
  });

  it('treats a trailing bare CR exactly like the whole-string grammar', () => {
    // Base keeps the CR in the final line, but that line cannot be content:
    // with no following *** End Patch both parsers reject the patch.
    expect(() => parsePatch('*** Begin Patch\n*** Add File: a.txt\n+x\r')).toThrow(
      'patch is missing *** End Patch',
    );

    const parser = new PatchStreamParser();
    parser.push('*** Begin Patch\n*** Add File: a.txt\n+x');
    parser.push('\r');
    expect(() => parser.finish()).toThrow('patch is missing *** End Patch');
  });

  it('matches the whole-string parse when *** End Patch is followed by a bare CR', () => {
    const whole = parsePatch('*** Begin Patch\n*** Add File: a.txt\n+x\n*** End Patch\r');
    expect(whole).toEqual([{ kind: 'add', path: 'a.txt', content: 'x\n' }]);

    const parser = new PatchStreamParser();
    parser.push('*** Begin Patch\n*** Add File: a.txt\n+x\n*** End Patch');
    parser.push('\r');
    expect(parser.finish()).toEqual(whole);
  });

  it('keeps a bare CR that sits inside a content line', () => {
    expect(parsePatch('*** Begin Patch\n*** Add File: a.txt\n+x\rX\n*** End Patch')).toEqual([
      { kind: 'add', path: 'a.txt', content: 'x\rX\n' },
    ]);
  });
});
