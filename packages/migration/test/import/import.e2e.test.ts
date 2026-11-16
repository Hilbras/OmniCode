import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { extractArchive } from '../../src/import/archive.js';
import { IMPORT_SOURCE_ADAPTERS } from '../../src/import/sources/index.js';
import type { ImportedSource } from '../../src/import/schema.js';
import {
  buildTar,
  buildTarGz,
  buildZip,
  collectFixtureFiles,
  type FixtureFile,
} from './archive-builders.js';

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function fixtureRoot(source: ImportedSource): string {
  return fileURLToPath(new URL(`./fixtures/${source}/`, import.meta.url));
}

async function archiveBytes(
  kind: 'zip' | 'tar' | 'tar.gz',
  files: readonly FixtureFile[],
): Promise<Buffer> {
  const entries = files.map((file) => ({ name: file.relativePath, data: file.data }));
  if (kind === 'zip') return buildZip(entries);
  if (kind === 'tar') return buildTar(entries);
  return buildTarGz(entries);
}

async function assertRoundTrip(source: ImportedSource, kind: 'zip' | 'tar' | 'tar.gz'): Promise<void> {
  const adapter = IMPORT_SOURCE_ADAPTERS[source];
  const fixture = fixtureRoot(source);
  const direct = await adapter.read(fixture);
  const files = await collectFixtureFiles(fixture);

  const dir = await makeTempDir(`migration-import-${source}-`);
  const extension = kind === 'tar.gz' ? 'tar.gz' : kind;
  const archivePath = join(dir, `fixture.${extension}`);
  await writeFile(archivePath, await archiveBytes(kind, files));

  const destDir = join(dir, 'extracted');
  await expect(extractArchive({ archivePath, destDir })).resolves.toEqual({ entries: files.length });
  expect(await readdir(destDir)).not.toEqual([]);

  const imported = await adapter.read(destDir);
  expect(imported).toEqual({ ...direct, root: destDir });
}

describe('import e2e', () => {
  for (const source of Object.keys(IMPORT_SOURCE_ADAPTERS) as ImportedSource[]) {
    for (const kind of ['zip', 'tar', 'tar.gz'] as const) {
      it(`round-trips ${source} through a ${kind} archive`, async () => {
        await assertRoundTrip(source, kind);
      }, 30_000);
    }
  }
});
