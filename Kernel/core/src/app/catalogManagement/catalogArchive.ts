import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';

import path from 'pathe';
import { type Entry, fromBuffer as yauzlFromBuffer } from 'yauzl';
import { ZipFile as ZipWriter } from 'yazl';

import { CoreErrors } from '#/_base/errors/codes';
import { Error2 } from '#/_base/errors/errors';

export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 2000;
export const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
export const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

interface ZipLike {
  on(event: 'entry', listener: (entry: Entry) => void): void;
  once(event: 'end' | 'error', listener: (arg: never) => void): void;
  readEntry(): void;
  close(): void;
  openReadStream(
    entry: Entry,
    callback: (error: Error | null, stream?: NodeJS.ReadableStream & { destroy(): void }) => void,
  ): void;
}

export interface ArchiveFile {
  readonly path: string;
  readonly data: Buffer;
}

export async function readArchiveEntries(archive: Buffer): Promise<readonly ArchiveFile[]> {
  if (archive.length === 0) throw invalidArchive('The archive is empty');
  if (archive.length > MAX_ARCHIVE_BYTES) {
    throw invalidArchive(`The archive exceeds ${MAX_ARCHIVE_BYTES} bytes`);
  }

  const files: ArchiveFile[] = [];
  let entries = 0;
  let expanded = 0;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    yauzlFromBuffer(
      archive,
      { lazyEntries: true, decodeStrings: true, validateEntrySizes: true },
      (openError, zip) => {
        if (openError !== null || zip === undefined) {
          fail(invalidArchive(`Could not open the archive: ${openError?.message ?? 'unknown error'}`));
          return;
        }
        const zipFile = zip as unknown as ZipLike;

        const onEntry = (entry: Entry): void => {
          entries += 1;
          if (entries > MAX_ARCHIVE_ENTRIES) {
            fail(invalidArchive(`The archive has more than ${MAX_ARCHIVE_ENTRIES} entries`));
            zipFile.close();
            return;
          }

          const normalized = normalizeArchivePath(entry.fileName);
          const mode = entry.externalFileAttributes >>> 16;
          const isSymlink = (mode & 0o170000) === 0o120000;

          if (normalized === undefined) {
            if (!entry.fileName.endsWith('/') && entry.fileName !== '') {
              fail(invalidArchive(`Unsafe archive entry: ${entry.fileName}`));
              zipFile.close();
            } else {
              zipFile.readEntry();
            }
            return;
          }
          if (isSymlink) {
            fail(invalidArchive(`Symbolic links are not allowed in archives: ${entry.fileName}`));
            zipFile.close();
            return;
          }
          if (entry.fileName.endsWith('/')) {
            zipFile.readEntry();
            return;
          }
          if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
            fail(invalidArchive(`Archive entry is too large: ${entry.fileName}`));
            zipFile.close();
            return;
          }

          zipFile.openReadStream(entry, (streamError, stream) => {
            if (streamError !== null || stream === undefined) {
              fail(
                invalidArchive(
                  `Could not read ${entry.fileName}: ${streamError?.message ?? 'unknown error'}`,
                ),
              );
              zipFile.close();
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            let entryFailed = false;
            stream.on('data', (chunk: Buffer) => {
              if (entryFailed) return;
              size += chunk.length;
              expanded += chunk.length;
              if (size > MAX_ENTRY_BYTES || expanded > MAX_EXPANDED_BYTES) {
                entryFailed = true;
                fail(invalidArchive(`Archive expands beyond ${MAX_EXPANDED_BYTES} bytes`));
                stream.destroy();
                zipFile.close();
                return;
              }
              chunks.push(chunk);
            });
            stream.once('error', (error: Error) => {
              if (!entryFailed) fail(invalidArchive(`Could not read ${entry.fileName}: ${error.message}`));
              zipFile.close();
            });
            stream.once('end', () => {
              if (entryFailed) return;
              files.push({ path: normalized, data: Buffer.concat(chunks) });
              zipFile.readEntry();
            });
          });
        };

        zipFile.on('entry', onEntry);
        zipFile.once('end', () => {
          if (settled) return;
          settled = true;
          resolve();
        });
        zipFile.once('error', (error: Error) => fail(invalidArchive(`Invalid archive: ${error.message}`)));
        zipFile.readEntry();
      },
    );
  });

  return files;
}

export function normalizeArchivePath(raw: string): string | undefined {
  if (raw.includes('\0') || raw.includes('\\')) return undefined;
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) return undefined;
  const normalized = path.normalize(raw).replace(/^\.\//, '');
  if (normalized === '.' || normalized === '') return undefined;
  if (normalized === '..' || normalized.startsWith('../') || path.isAbsolute(normalized)) {
    return undefined;
  }
  return normalized;
}

export async function writeArchive(files: readonly ArchiveFile[]): Promise<Buffer> {
  const zip = new ZipWriter();
  const chunks: Buffer[] = [];
  const collected = new Promise<void>((resolve, reject) => {
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.once('end', () => resolve());
    zip.outputStream.once('error', reject);
  });
  for (const file of files.toSorted((a, b) => a.path.localeCompare(b.path))) {
    zip.addBuffer(file.data, file.path, { mtime: new Date(0), mode: 0o100644 });
  }
  zip.end();
  await collected;
  return Buffer.concat(chunks);
}

export function invalidArchive(message: string): Error2 {
  return new Error2(CoreErrors.codes.VALIDATION_FAILED, message, { details: { kind: 'invalid_archive' } });
}

export function archiveData(entries: readonly ArchiveFile[], entryPath: string): Buffer | undefined {
  return entries.find((entry) => entry.path === entryPath)?.data;
}

export function readArchiveText(entries: readonly ArchiveFile[], entryPath: string): string | undefined {
  return archiveData(entries, entryPath)?.toString('utf8');
}

export function listArchiveFiles(
  entries: readonly ArchiveFile[],
  prefix: string,
): readonly ArchiveFile[] {
  return entries.filter((entry) => entry.path.startsWith(`${prefix}/`));
}

export function streamFromBuffer(buffer: Buffer): Readable {
  return Readable.from(buffer);
}
