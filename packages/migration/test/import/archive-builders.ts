import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { ZipFile } from 'yazl';
import { gzipSync } from 'node:zlib';

export interface ArchiveInputEntry {
  readonly name: string;
  readonly data: Buffer | string;
  readonly mode?: number;
}

export async function buildZip(entries: readonly ArchiveInputEntry[]): Promise<Buffer> {
  const zip = new ZipFile();
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    zip.outputStream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    zip.outputStream.on('error', reject);
  });

  for (const entry of entries) {
    zip.addBuffer(Buffer.from(entry.data), entry.name, entry.mode === undefined ? undefined : { mode: entry.mode });
  }
  zip.end();
  return completed;
}

function replaceBytes(buffer: Buffer, from: string, to: string): Buffer {
  const fromBytes = Buffer.from(from, 'utf8');
  const toBytes = Buffer.from(to, 'utf8');
  if (fromBytes.length !== toBytes.length) {
    throw new Error(`patch length mismatch: ${from} (${String(fromBytes.length)}) vs ${to} (${String(toBytes.length)})`);
  }
  const copy = Buffer.from(buffer);
  let index = copy.indexOf(fromBytes);
  if (index === -1) throw new Error(`archive does not contain ${from}`);
  while (index !== -1) {
    toBytes.copy(copy, index);
    index = copy.indexOf(fromBytes, index + toBytes.length);
  }
  return copy;
}

export function patchZipEntryName(buffer: Buffer, from: string, to: string): Buffer {
  return replaceBytes(buffer, from, to);
}

export function patchZipCentralEntrySize(buffer: Buffer, entryName: string, size: number): Buffer {
  const copy = Buffer.from(buffer);
  const nameBytes = Buffer.from(entryName, 'utf8');
  const signature = 0x02014b50;
  for (let offset = 0; offset + 46 + nameBytes.length <= copy.length; offset++) {
    if (copy.readUInt32LE(offset) !== signature) continue;
    if (copy.subarray(offset + 46, offset + 46 + nameBytes.length).equals(nameBytes)) {
      copy.writeUInt32LE(size, offset + 24);
      return copy;
    }
  }
  throw new Error(`central directory entry not found: ${entryName}`);
}

function octal(value: number, length: number): string {
  return `${value.toString(8).padStart(length - 1, '0')}\0`;
}

interface TarHeaderInput {
  readonly name: string;
  readonly type?: string;
  readonly size?: number;
  readonly linkname?: string;
}

function tarHeader(input: TarHeaderInput): Buffer {
  const header = Buffer.alloc(512);
  header.write(input.name, 0, 100, 'utf8');
  header.write(octal(0o644, 8), 100, 8, 'ascii');
  header.write(octal(0, 8), 108, 8, 'ascii');
  header.write(octal(0, 8), 116, 8, 'ascii');
  header.write(octal(input.size ?? 0, 12), 124, 12, 'ascii');
  header.write(octal(0, 12), 136, 12, 'ascii');
  header.fill(0x20, 148, 156);
  header.write(input.type ?? '0', 156, 1, 'ascii');
  header.write(input.linkname ?? '', 157, 100, 'utf8');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  header.write('root', 265, 32, 'ascii');
  header.write('root', 297, 32, 'ascii');

  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
}

export function buildTar(
  entries: readonly (ArchiveInputEntry & { readonly type?: string; readonly linkname?: string; readonly declaredSize?: number })[],
): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.data);
    chunks.push(
      tarHeader({
        name: entry.name,
        type: entry.type,
        size: entry.declaredSize ?? data.length,
        linkname: entry.linkname,
      }),
    );
    if (data.length > 0) {
      chunks.push(data);
      const padding = (512 - (data.length % 512)) % 512;
      if (padding > 0) chunks.push(Buffer.alloc(padding));
    }
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

export function buildTarGz(
  entries: readonly (ArchiveInputEntry & { readonly type?: string; readonly linkname?: string })[],
): Buffer {
  return gzipSync(buildTar(entries));
}

export interface FixtureFile {
  readonly relativePath: string;
  readonly data: Buffer;
}

export async function collectFixtureFiles(root: string): Promise<FixtureFile[]> {
  const files: FixtureFile[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      files.push({
        relativePath: relative(root, fullPath).split(sep).join('/'),
        data: await readFile(fullPath),
      });
    }
  };
  await walk(root);
  return files.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
}
