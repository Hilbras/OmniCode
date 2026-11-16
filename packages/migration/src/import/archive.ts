import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open as openFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { t as tarList, x as tarExtract, type ReadEntry } from 'tar';
import { type Entry, open as openZip, type ZipFile } from 'yauzl';

export const MAX_ARCHIVE_ENTRIES = 10_000;
export const MAX_ENTRY_BYTES = 256 * 1024 * 1024;

export const ARCHIVE_KINDS = ['zip', 'tar', 'tar.gz'] as const;
export type ArchiveKind = (typeof ARCHIVE_KINDS)[number];

export type ArchiveErrorCode =
  | 'unsupported-archive'
  | 'invalid-archive'
  | 'empty-entry-name'
  | 'nul-byte'
  | 'absolute-path'
  | 'path-traversal'
  | 'symlink-entry'
  | 'hardlink-entry'
  | 'device-entry'
  | 'fifo-entry'
  | 'unsupported-entry-type'
  | 'entry-count-exceeded'
  | 'entry-too-large'
  | 'encrypted-entry'
  | 'symlink-escape';

export class ArchiveError extends Error {
  readonly code: ArchiveErrorCode;
  readonly entry: string | undefined;

  constructor(code: ArchiveErrorCode, message: string, entry?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ArchiveError';
    this.code = code;
    this.entry = entry;
  }
}

export interface ExtractArchiveInput {
  readonly kind?: ArchiveKind;
  readonly archivePath: string;
  readonly destDir: string;
}

export interface ExtractArchiveResult {
  readonly entries: number;
}

export function inferArchiveKind(archivePath: string): ArchiveKind | undefined {
  const lower = archivePath.toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar.gz';
  if (lower.endsWith('.tar')) return 'tar';
  if (lower.endsWith('.zip')) return 'zip';
  return undefined;
}

export async function extractArchive(input: ExtractArchiveInput): Promise<ExtractArchiveResult> {
  const kind = input.kind ?? inferArchiveKind(input.archivePath);
  if (kind === undefined) {
    throw new ArchiveError(
      'unsupported-archive',
      `cannot infer archive kind from ${path.basename(input.archivePath)}`,
    );
  }

  const destDirResolved = path.resolve(input.destDir);

  if (kind === 'zip') {
    const { entries } = await listZipEntries(input.archivePath, destDirResolved);
    const destDirReal = await prepareDestination(destDirResolved);
    await extractZipEntries(input.archivePath, destDirResolved, destDirReal, entries);
    return { entries: entries.length };
  }

  const { entries } = await listTarEntries(input.archivePath, kind, destDirResolved);
  await prepareDestination(destDirResolved);
  await extractTarEntries(input.archivePath, kind, destDirResolved, entries);
  return { entries: entries.size };
}

async function prepareDestination(destDirResolved: string): Promise<string> {
  await mkdir(destDirResolved, { recursive: true });
  const destDirReal = await realpath(destDirResolved);
  if (!(await stat(destDirReal)).isDirectory()) {
    throw new ArchiveError('invalid-archive', `destination is not a directory: ${destDirResolved}`);
  }
  return destDirReal;
}

function validateEntryName(rawName: string): string[] {
  if (typeof rawName !== 'string') {
    throw new ArchiveError('invalid-archive', 'archive entry name is not a string');
  }
  if (rawName.includes('\0')) {
    throw new ArchiveError('nul-byte', `archive entry name contains a NUL byte: ${rawName}`);
  }

  const slashed = rawName.replaceAll('\\', '/');
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)) {
    throw new ArchiveError('absolute-path', `archive entry has an absolute path: ${rawName}`);
  }

  const segments: string[] = [];
  for (const segment of slashed.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      throw new ArchiveError('path-traversal', `archive entry escapes the destination: ${rawName}`);
    }
    segments.push(segment);
  }

  if (segments.length === 0) {
    throw new ArchiveError('empty-entry-name', `archive entry has an empty name: ${JSON.stringify(rawName)}`);
  }

  return segments;
}

function assertLexicallyContained(destDirResolved: string, segments: readonly string[], entry: string): string {
  const dest = path.resolve(destDirResolved, ...segments);
  if (dest !== destDirResolved && !dest.startsWith(destDirResolved + path.sep)) {
    throw new ArchiveError('path-traversal', `archive entry escapes the destination: ${entry}`, entry);
  }
  return dest;
}

function checkEntryBudget(count: number, entry: string): void {
  if (count > MAX_ARCHIVE_ENTRIES) {
    throw new ArchiveError(
      'entry-count-exceeded',
      `archive has more than ${String(MAX_ARCHIVE_ENTRIES)} entries (at ${entry})`,
      entry,
    );
  }
}

async function ensureContainedDirectory(destDirReal: string, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const real = await realpath(dir);
  if (real !== destDirReal && !real.startsWith(destDirReal + path.sep)) {
    throw new ArchiveError('symlink-escape', `directory escapes the destination: ${dir}`);
  }
}

async function assertNotSymlink(target: string, entry: string): Promise<void> {
  try {
    if ((await lstat(target)).isSymbolicLink()) {
      throw new ArchiveError('symlink-escape', `refusing to overwrite a symbolic link: ${entry}`, entry);
    }
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function zipEntryName(entry: Entry): string {
  const rawName: unknown = entry.fileName;
  if (typeof rawName === 'string') return rawName;
  if (Buffer.isBuffer(rawName)) return rawName.toString('utf8');
  return '';
}

function isZipDirectory(rawName: string, fileType: number): boolean {
  return fileType === 0o040000 || rawName.endsWith('/');
}

interface ZipDescriptor {
  readonly fileName: string;
  readonly segments: readonly string[];
  readonly directory: boolean;
}

function validateZipEntry(entry: Entry, destDirResolved: string, count: number): ZipDescriptor {
  const rawName = zipEntryName(entry);
  checkEntryBudget(count, rawName);
  const segments = validateEntryName(rawName);

  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const fileType = mode & 0o170000;
  switch (fileType) {
    case 0o120000:
      throw new ArchiveError('symlink-entry', `archive entry is a symbolic link: ${rawName}`, rawName);
    case 0o020000:
    case 0o060000:
      throw new ArchiveError('device-entry', `archive entry is a device node: ${rawName}`, rawName);
    case 0o010000:
      throw new ArchiveError('fifo-entry', `archive entry is a FIFO: ${rawName}`, rawName);
    case 0:
    case 0o040000:
    case 0o100000:
      break;
    default:
      throw new ArchiveError('unsupported-entry-type', `unsupported archive entry type: ${rawName}`, rawName);
  }

  const directory = isZipDirectory(rawName, fileType);
  if (entry.isEncrypted()) {
    throw new ArchiveError('encrypted-entry', `archive entry is encrypted: ${rawName}`, rawName);
  }
  if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
    throw new ArchiveError('invalid-archive', `archive entry has an invalid size: ${rawName}`, rawName);
  }
  if (!directory && entry.uncompressedSize > MAX_ENTRY_BYTES) {
    throw new ArchiveError(
      'entry-too-large',
      `archive entry exceeds ${String(MAX_ENTRY_BYTES)} bytes: ${rawName}`,
      rawName,
    );
  }

  assertLexicallyContained(destDirResolved, segments, rawName);
  return { fileName: rawName, segments, directory };
}

function openZipFile(archivePath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    openZip(archivePath, { lazyEntries: true, autoClose: true, decodeStrings: false }, (error, zipfile) => {
      if (error !== null || zipfile === undefined) {
        reject(new ArchiveError('invalid-archive', `could not open zip archive: ${error?.message ?? 'unknown error'}`, undefined, { cause: error ?? undefined }));
        return;
      }
      resolve(zipfile);
    });
  });
}

function closeQuietly(zipfile: ZipFile): void {
  try {
    zipfile.close();
  } catch {
    // Closing a half-read archive has no recovery path; the original error wins.
  }
}

async function listZipEntries(archivePath: string, destDirResolved: string): Promise<{ entries: ZipDescriptor[] }> {
  const zipfile = await openZipFile(archivePath);
  const entries: ZipDescriptor[] = [];

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        closeQuietly(zipfile);
        reject(error instanceof ArchiveError ? error : new ArchiveError('invalid-archive', `could not read zip archive: ${String(error)}`, undefined, { cause: error }));
      };

      zipfile.on('entry', (entry: Entry) => {
        if (settled) return;
        try {
          entries.push(validateZipEntry(entry, destDirResolved, entries.length + 1));
        } catch (error) {
          fail(error);
          return;
        }
        zipfile.readEntry();
      });
      zipfile.on('end', () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      zipfile.on('error', fail);
      zipfile.readEntry();
    });
  } catch (error) {
    throw error instanceof ArchiveError ? error : new ArchiveError('invalid-archive', 'invalid zip archive', undefined, { cause: error });
  }

  return { entries };
}

function openZipEntryStream(zipfile: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error !== null || stream === undefined) {
        reject(new ArchiveError('invalid-archive', `could not read zip entry: ${error?.message ?? 'unknown error'}`, zipEntryName(entry), { cause: error ?? undefined }));
        return;
      }
      resolve(stream);
    });
  });
}

function zipWriteFlags(): number {
  return (
    fsConstants.O_WRONLY |
    fsConstants.O_CREAT |
    fsConstants.O_TRUNC |
    (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0)
  );
}

async function extractZipEntries(
  archivePath: string,
  destDirResolved: string,
  destDirReal: string,
  descriptors: readonly ZipDescriptor[],
): Promise<void> {
  const zipfile = await openZipFile(archivePath);
  const flags = zipWriteFlags();

  try {
    await new Promise<void>((resolve, reject) => {
      let index = 0;
      let settled = false;
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        closeQuietly(zipfile);
        reject(error instanceof ArchiveError ? error : new ArchiveError('invalid-archive', `could not extract zip archive: ${String(error)}`, undefined, { cause: error }));
      };

      zipfile.on('entry', (entry: Entry) => {
        if (settled) return;
        const descriptor = descriptors[index];
        index += 1;

        void (async () => {
          const rawName = zipEntryName(entry);
          validateZipEntry(entry, destDirResolved, 1);
          if (descriptor === undefined || descriptor.fileName !== rawName) {
            throw new ArchiveError('invalid-archive', 'zip archive changed between validation and extraction', rawName);
          }

          const dest = path.resolve(destDirResolved, ...descriptor.segments);
          if (descriptor.directory) {
            await ensureContainedDirectory(destDirReal, dest);
          } else {
            await ensureContainedDirectory(destDirReal, path.dirname(dest));
            await assertNotSymlink(dest, rawName);
            const stream = await openZipEntryStream(zipfile, entry);
            const handle = await openFile(dest, flags);
            await pipeline(stream, handle.createWriteStream());
          }

          if (!settled) zipfile.readEntry();
        })().catch(fail);
      });
      zipfile.on('end', () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      zipfile.on('error', fail);
      zipfile.readEntry();
    });
  } catch (error) {
    throw error instanceof ArchiveError ? error : new ArchiveError('invalid-archive', 'invalid zip archive', undefined, { cause: error });
  }
}

function isAllowedTarType(type: string): boolean {
  return (
    type === 'File' ||
    type === 'OldFile' ||
    type === 'ContiguousFile' ||
    type === 'Directory' ||
    type === 'GNUDumpDir'
  );
}

function validateTarEntry(entry: ReadEntry, destDirResolved: string, count: number): { readonly directory: boolean } {
  checkEntryBudget(count, entry.path);
  const segments = validateEntryName(entry.path);

  if (entry.type === 'SymbolicLink') {
    throw new ArchiveError('symlink-entry', `archive entry is a symbolic link: ${entry.path}`, entry.path);
  }
  if (entry.type === 'Link') {
    throw new ArchiveError('hardlink-entry', `archive entry is a hard link: ${entry.path}`, entry.path);
  }
  if (entry.type === 'CharacterDevice' || entry.type === 'BlockDevice') {
    throw new ArchiveError('device-entry', `archive entry is a device node: ${entry.path}`, entry.path);
  }
  if (entry.type === 'FIFO') {
    throw new ArchiveError('fifo-entry', `archive entry is a FIFO: ${entry.path}`, entry.path);
  }
  if (!isAllowedTarType(entry.type)) {
    throw new ArchiveError('unsupported-entry-type', `unsupported archive entry type ${entry.type}: ${entry.path}`, entry.path);
  }

  const directory = entry.type === 'Directory' || entry.type === 'GNUDumpDir';
  if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
    throw new ArchiveError('invalid-archive', `archive entry has an invalid size: ${entry.path}`, entry.path);
  }
  if (!directory && entry.size > MAX_ENTRY_BYTES) {
    throw new ArchiveError(
      'entry-too-large',
      `archive entry exceeds ${String(MAX_ENTRY_BYTES)} bytes: ${entry.path}`,
      entry.path,
    );
  }

  assertLexicallyContained(destDirResolved, segments, entry.path);
  return { directory };
}

async function listTarEntries(
  archivePath: string,
  kind: ArchiveKind,
  destDirResolved: string,
): Promise<{ entries: Set<string> }> {
  const entries = new Set<string>();
  let count = 0;
  let violation: ArchiveError | undefined;

  try {
    await tarList({
      file: archivePath,
      gzip: kind === 'tar.gz',
      strict: true,
      onReadEntry: (entry: ReadEntry) => {
        if (violation !== undefined) return;
        count += 1;
        try {
          validateTarEntry(entry, destDirResolved, count);
          entries.add(entry.path);
        } catch (error) {
          violation =
            error instanceof ArchiveError
              ? error
              : new ArchiveError('invalid-archive', `invalid tar entry: ${String(error)}`, entry.path, { cause: error });
        }
      },
    });
  } catch (error) {
    if (violation !== undefined) throw violation;
    throw error instanceof ArchiveError
      ? error
      : new ArchiveError('invalid-archive', 'invalid tar archive', undefined, { cause: error });
  }

  if (violation !== undefined) throw violation;
  return { entries };
}

async function extractTarEntries(
  archivePath: string,
  kind: ArchiveKind,
  destDirResolved: string,
  entries: ReadonlySet<string>,
): Promise<void> {
  try {
    await tarExtract({
      file: archivePath,
      cwd: destDirResolved,
      gzip: kind === 'tar.gz',
      preservePaths: false,
      chmod: false,
      noMtime: true,
      filter: (entryPath: string, entry: unknown) => {
        if (!entries.has(entryPath)) return false;
        const type = (entry as { readonly type?: string }).type;
        return type === undefined || isAllowedTarType(type);
      },
    });
  } catch (error) {
    throw error instanceof ArchiveError
      ? error
      : new ArchiveError('invalid-archive', 'could not extract tar archive', undefined, { cause: error });
  }
}
