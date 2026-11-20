import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  extractArchive,
  inferArchiveKind,
  MAX_ARCHIVE_ENTRIES,
  MAX_ENTRY_BYTES,
} from '../../src/import/archive.js';
import {
  buildTar,
  buildTarGz,
  buildZip,
  patchZipCentralEntrySize,
  patchZipEntryName,
} from './archive-builders.js';

let root: string;
let archivesDir: string;
let outParent: string;
let destDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'migration-archive-'));
  archivesDir = join(root, 'archives');
  outParent = join(root, 'out');
  destDir = join(outParent, 'dest');
  await mkdir(archivesDir, { recursive: true });
  await mkdir(outParent, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeArchive(fileName: string, data: Buffer): Promise<string> {
  const filePath = join(archivesDir, fileName);
  await writeFile(filePath, data);
  return filePath;
}

async function expectRejected(fileName: string, data: Buffer, code: string, kind?: 'zip' | 'tar' | 'tar.gz') {
  const archivePath = await writeArchive(fileName, data);
  const promise = extractArchive({ archivePath, destDir, kind });
  await expect(promise).rejects.toMatchObject({ code });
  expect(await readdir(outParent)).toEqual([]);
}

describe('archive constants', () => {
  it('exposes the documented caps', () => {
    expect(MAX_ARCHIVE_ENTRIES).toBe(10_000);
    expect(MAX_ENTRY_BYTES).toBe(256 * 1024 * 1024);
  });

  it('infers kinds from extensions', () => {
    expect(inferArchiveKind('a.zip')).toBe('zip');
    expect(inferArchiveKind('a.tar')).toBe('tar');
    expect(inferArchiveKind('a.tar.gz')).toBe('tar.gz');
    expect(inferArchiveKind('a.tgz')).toBe('tar.gz');
    expect(inferArchiveKind('a.bin')).toBeUndefined();
  });
});

describe('happy paths', () => {
  it('extracts a zip and reports its entry count', async () => {
    const archive = await buildZip([
      { name: 'a.txt', data: 'alpha' },
      { name: 'dir/b.txt', data: 'beta' },
    ]);
    const archivePath = await writeArchive('ok.zip', archive);

    await expect(extractArchive({ archivePath, destDir })).resolves.toEqual({ entries: 2 });
    expect(await readdir(destDir)).toEqual(['a.txt', 'dir']);
  });

  it('extracts a tar and reports its entry count', async () => {
    const archive = buildTar([
      { name: 'dir/', data: '', type: '5' },
      { name: 'dir/b.txt', data: 'beta' },
      { name: 'a.txt', data: 'alpha' },
    ]);
    const archivePath = await writeArchive('ok.tar', archive);

    await expect(extractArchive({ archivePath, destDir })).resolves.toEqual({ entries: 3 });
    expect(await readdir(destDir)).toEqual(['a.txt', 'dir']);
  });

  it('extracts a tar.gz and reports its entry count', async () => {
    const archive = buildTarGz([
      { name: 'dir/', data: '', type: '5' },
      { name: 'dir/b.txt', data: 'beta' },
      { name: 'a.txt', data: 'alpha' },
    ]);
    const archivePath = await writeArchive('ok.tar.gz', archive);

    await expect(extractArchive({ archivePath, destDir })).resolves.toEqual({ entries: 3 });
  });

  it('accepts an explicit kind for a path without a known extension', async () => {
    const archive = await buildZip([{ name: 'a.txt', data: 'alpha' }]);
    const archivePath = await writeArchive('ok.bin', archive);

    await expect(extractArchive({ archivePath, destDir, kind: 'zip' })).resolves.toEqual({
      entries: 1,
    });
  });
});

describe('archive rejection', () => {
  it('rejects an unknown archive kind', async () => {
    const archivePath = await writeArchive('unknown.bin', Buffer.from('nope'));
    await expect(extractArchive({ archivePath, destDir })).rejects.toMatchObject({
      code: 'unsupported-archive',
    });
    expect(await readdir(outParent)).toEqual([]);
  });

  it('rejects a corrupt zip', async () => {
    await expectRejected('corrupt.zip', Buffer.from('not a zip'), 'invalid-archive');
  });

  it('rejects a corrupt tar', async () => {
    const archive = buildTar([{ name: 'a.txt', data: 'x' }]);
    archive.fill(0x30, 148, 156);
    await expectRejected('corrupt.tar', archive, 'invalid-archive');
  });
});

describe('zip entry-name security', () => {
  it('rejects .. traversal', async () => {
    const archive = patchZipEntryName(
      await buildZip([{ name: 'aa/evil.txt', data: 'x' }]),
      'aa/evil.txt',
      '../evil.txt',
    );
    await expectRejected('traversal.zip', archive, 'path-traversal');
  });

  it('rejects an absolute path', async () => {
    const archive = patchZipEntryName(
      await buildZip([{ name: 'aaaa/evil.txt', data: 'x' }]),
      'aaaa/evil.txt',
      '/tmp/evil.txt',
    );
    await expectRejected('absolute.zip', archive, 'absolute-path');
  });

  it('rejects backslash traversal', async () => {
    const archive = patchZipEntryName(
      await buildZip([{ name: 'aa/evil.txt', data: 'x' }]),
      'aa/evil.txt',
      '..\\evil.txt',
    );
    await expectRejected('backslash.zip', archive, 'path-traversal');
  });

  it('rejects a NUL byte in the name', async () => {
    const archive = patchZipEntryName(
      await buildZip([{ name: 'aa/evil.txt', data: 'x' }]),
      'aa/evil.txt',
      'a\0bc/evil.t',
    );
    await expectRejected('nul.zip', archive, 'nul-byte');
  });

  it('rejects a symbolic link entry', async () => {
    const archive = await buildZip([{ name: 'link.txt', data: '', mode: 0o120777 }]);
    await expectRejected('symlink.zip', archive, 'symlink-entry');
  });

  it('rejects a device entry', async () => {
    const archive = await buildZip([{ name: 'dev', data: '', mode: 0o020644 }]);
    await expectRejected('device.zip', archive, 'device-entry');
  });

  it('rejects a FIFO entry', async () => {
    const archive = await buildZip([{ name: 'pipe', data: '', mode: 0o010644 }]);
    await expectRejected('fifo.zip', archive, 'fifo-entry');
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a write through a pre-existing symlinked directory',
    async () => {
      const outside = join(root, 'outside');
      await mkdir(outside, { recursive: true });
      await mkdir(destDir, { recursive: true });
      await symlink(outside, join(destDir, 'link'), 'dir');
      const archivePath = await writeArchive(
        'symlink-dir.zip',
        await buildZip([{ name: 'link/pwned.txt', data: 'x' }]),
      );

      await expect(extractArchive({ archivePath, destDir })).rejects.toMatchObject({
        code: 'symlink-escape',
      });
      expect(await readdir(outside)).toEqual([]);
    },
  );

  it('rejects more than the entry cap', async () => {
    const entries = Array.from({ length: MAX_ARCHIVE_ENTRIES + 1 }, (_, index) => ({
      name: `f${String(index)}.txt`,
      data: '',
    }));
    const archive = await buildZip(entries);
    await expectRejected('many.zip', archive, 'entry-count-exceeded');
  }, 120_000);

  it('rejects an oversized entry from the central directory', async () => {
    const archive = patchZipCentralEntrySize(
      await buildZip([{ name: 'big.bin', data: 'x' }]),
      'big.bin',
      MAX_ENTRY_BYTES + 1,
    );
    await expectRejected('oversized.zip', archive, 'entry-too-large');
  });
});

describe('tar entry security', () => {
  it('rejects an absolute path', async () => {
    await expectRejected(
      'absolute.tar',
      buildTar([{ name: '/tmp/escape.txt', data: 'x' }]),
      'absolute-path',
    );
  });

  it('rejects .. traversal', async () => {
    await expectRejected(
      'traversal.tar',
      buildTar([{ name: '../escape.txt', data: 'x' }]),
      'path-traversal',
    );
  });

  it('rejects nested .. traversal', async () => {
    await expectRejected(
      'nested-traversal.tar',
      buildTar([{ name: 'a/../../escape.txt', data: 'x' }]),
      'path-traversal',
    );
  });

  it('rejects a name that normalizes to empty', async () => {
    await expectRejected('empty-name.tar', buildTar([{ name: '.', data: 'x' }]), 'empty-entry-name');
  });

  it('rejects backslash traversal', async () => {
    await expectRejected(
      'backslash.tar',
      buildTar([{ name: '..\\escape.txt', data: 'x' }]),
      'path-traversal',
    );
  });

  it('rejects a symbolic link entry', async () => {
    await expectRejected(
      'symlink.tar',
      buildTar([{ name: 'link', data: '', type: '2', linkname: '/etc/passwd' }]),
      'symlink-entry',
    );
  });

  it('rejects a hard link entry', async () => {
    await expectRejected(
      'hardlink.tar',
      buildTar([{ name: 'link', data: '', type: '1', linkname: 'target' }]),
      'hardlink-entry',
    );
  });

  it('rejects a character device entry', async () => {
    await expectRejected(
      'char-device.tar',
      buildTar([{ name: 'dev', data: '', type: '3' }]),
      'device-entry',
    );
  });

  it('rejects a block device entry', async () => {
    await expectRejected(
      'block-device.tar',
      buildTar([{ name: 'dev', data: '', type: '4' }]),
      'device-entry',
    );
  });

  it('rejects a FIFO entry', async () => {
    await expectRejected(
      'fifo.tar',
      buildTar([{ name: 'pipe', data: '', type: '6' }]),
      'fifo-entry',
    );
  });

  it('rejects more than the entry cap', async () => {
    const entries = Array.from({ length: MAX_ARCHIVE_ENTRIES + 1 }, (_, index) => ({
      name: `f${String(index)}.txt`,
      data: '',
    }));
    await expectRejected('many.tar', buildTar(entries), 'entry-count-exceeded');
  }, 120_000);

  it('rejects an entry larger than the cap', async () => {
    await expectRejected(
      'oversized.tar',
      buildTar([{ name: 'big.bin', data: '', declaredSize: MAX_ENTRY_BYTES + 1 }]),
      'entry-too-large',
    );
  });

  it('rejects traversal inside a tar.gz', async () => {
    await expectRejected(
      'traversal.tar.gz',
      buildTarGz([{ name: '../escape.txt', data: 'x' }]),
      'path-traversal',
    );
  });
});
