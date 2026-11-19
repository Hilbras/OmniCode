import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { renderFileHistoryPatch, type FileHistoryPatchFile } from '#/features/fileHistory/patchRender';

describe('renderFileHistoryPatch', () => {
  it('renders a modified file with git headers and exact hunk numbers', () => {
    const patch = renderFileHistoryPatch([
      { path: 'src/a.ts', status: 'modified', before: 'one\ntwo\nthree\nfour\nfive\n', after: 'one\ntwo\nTHREE\nfour\nfive\n' },
    ]);
    expect(patch.excluded).toEqual([]);
    expect(patch.text).toBe(
      [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1,5 +1,5 @@',
        ' one',
        ' two',
        '-three',
        '+THREE',
        ' four',
        ' five',
        '',
      ].join('\n'),
    );
  });

  it('renders an added file against /dev/null with new file mode', () => {
    const patch = renderFileHistoryPatch([
      { path: 'new.txt', status: 'added', after: 'hello\nworld\n' },
    ]);
    expect(patch.text).toBe(
      [
        'diff --git a/new.txt b/new.txt',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/new.txt',
        '@@ -0,0 +1,2 @@',
        '+hello',
        '+world',
        '',
      ].join('\n'),
    );
  });

  it('renders a deleted file against /dev/null with deleted file mode', () => {
    const patch = renderFileHistoryPatch([
      { path: 'gone.txt', status: 'deleted', before: 'bye\n' },
    ]);
    expect(patch.text).toBe(
      [
        'diff --git a/gone.txt b/gone.txt',
        'deleted file mode 100644',
        '--- a/gone.txt',
        '+++ /dev/null',
        '@@ -1,1 +0,0 @@',
        '-bye',
        '',
      ].join('\n'),
    );
  });

  it('emits the no-newline marker when a side does not end with a newline', () => {
    const patch = renderFileHistoryPatch([
      { path: 'f.txt', status: 'modified', before: 'same\ntail', after: 'same\nnew tail' },
    ]);
    expect(patch.text).toContain('-tail');
    expect(patch.text).toContain('+new tail');
    expect(patch.text).toContain('\\ No newline at end of file');
  });

  it('splits distant changes into separate hunks with shifted numbers', () => {
    const before = Array.from({ length: 20 }, (_, index) => `line${String(index)}`).join('\n') + '\n';
    const after = before
      .replace('line2\n', 'CHANGED2\n')
      .replace('line17\n', 'CHANGED17\n');
    const patch = renderFileHistoryPatch([{ path: 'big.txt', status: 'modified', before, after }]);
    const hunks = patch.text.split('\n').filter((line) => line.startsWith('@@'));
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toBe('@@ -1,6 +1,6 @@');
    expect(hunks[1]).toMatch(/^@@ -1[45],6 \+1[45],6 @@$/);
  });

  it('skips a file whose content is unchanged and reports nothing', () => {
    const patch = renderFileHistoryPatch([
      { path: 'same.txt', status: 'modified', before: 'a\n', after: 'a\n' },
    ]);
    expect(patch.text).toBe('');
    expect(patch.files).toEqual([]);
  });

  it('excludes a file missing content its status requires', () => {
    const patch = renderFileHistoryPatch([
      { path: 'broken.txt', status: 'modified', before: 'a\n' },
    ]);
    expect(patch.text).toBe('');
    expect(patch.excluded).toEqual([{ path: 'broken.txt', reason: 'content-unavailable' }]);
  });

  it('keeps multiple files in order and reports coverage', () => {
    const patch = renderFileHistoryPatch([
      { path: 'a.txt', status: 'modified', before: 'x\n', after: 'y\n' },
      { path: 'b.txt', status: 'added', after: 'n\n' },
    ]);
    expect(patch.files.map((file) => file.path)).toEqual(['a.txt', 'b.txt']);
    expect(patch.text).toContain('diff --git a/a.txt b/a.txt');
    expect(patch.text).toContain('diff --git a/b.txt b/b.txt');
  });
});

describe('renderFileHistoryPatch git apply round-trip', () => {
  let dir: string;
  const gitAvailable = (() => {
    try {
      execFileSync('git', ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'omnicode-patch-render-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('a rendered patch applies cleanly with git apply', async () => {
    if (!gitAvailable) return;
    execFileSync('git', ['-C', dir, 'init', '-q']);

    const files: FileHistoryPatchFile[] = [
      {
        path: 'modified.txt',
        status: 'modified',
        before: 'keep\nold middle\nkeep\n',
        after: 'keep\nnew middle\nkeep\n',
      },
      { path: 'added.txt', status: 'added', after: 'fresh\ncontent\n' },
      { path: 'deleted.txt', status: 'deleted', before: 'stale\ncontent\n' },
    ];
    await writeFile(join(dir, 'modified.txt'), files[0]!.before!);
    await writeFile(join(dir, 'deleted.txt'), files[2]!.before!);

    const patch = renderFileHistoryPatch(files);
    expect(patch.excluded).toEqual([]);
    execFileSync('git', ['-C', dir, 'apply'], { input: patch.text });

    expect(await readFile(join(dir, 'modified.txt'), 'utf8')).toBe('keep\nnew middle\nkeep\n');
    expect(await readFile(join(dir, 'added.txt'), 'utf8')).toBe('fresh\ncontent\n');
    await expect(access(join(dir, 'deleted.txt'))).rejects.toThrow();
  });

  it('a no-newline patch round-trips the missing final newline', async () => {
    if (!gitAvailable) return;
    const sub = join(dir, 'no-newline');
    execFileSync('git', ['-C', dir, 'init', '-q', sub]);
    await writeFile(join(sub, 'f.txt'), 'same\ntail');

    const patch = renderFileHistoryPatch([
      { path: 'f.txt', status: 'modified', before: 'same\ntail', after: 'same\nnew tail' },
    ]);
    execFileSync('git', ['-C', sub, 'apply'], { input: patch.text });
    expect(await readFile(join(sub, 'f.txt'), 'utf8')).toBe('same\nnew tail');
  });
});
