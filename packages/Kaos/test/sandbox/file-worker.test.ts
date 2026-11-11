import { dirname } from 'pathe';
import { describe, expect, it } from 'vitest';

import {
  SandboxFileWorker,
  type FileWorkerEntry,
  type FileWorkerFs,
  type FileWorkerReadData,
  type FileWorkerReadOptions,
  type FileWorkerResponse,
  type FileWorkerStatInfo,
  type FileWorkerValue,
} from '#/sandbox/file-worker';

function errno(code: string): Error {
  return Object.assign(new Error(code), { code });
}

class FakeFs implements FileWorkerFs {
  readonly files = new Map<string, Buffer>();
  readonly dirs = new Set<string>(['/workspace']);
  readonly failWrites = new Set<string>();
  readonly symlinks = new Map<string, string>();

  async readFile(path: string, options: FileWorkerReadOptions): Promise<FileWorkerReadData> {
    const data = this.files.get(path);
    if (data === undefined) throw errno('ENOENT');
    const totalSize = data.length;
    const start = Math.min(options.offset, totalSize);
    const length = Math.min(options.limit, totalSize - start);
    return { data: Buffer.from(data.subarray(start, start + length)), totalSize };
  }

  async writeFile(path: string, data: Buffer): Promise<void> {
    if (this.failWrites.has(path)) throw new Error('disk full');
    this.files.set(path, Buffer.from(data));
  }

  async mkdir(path: string): Promise<void> {
    let current = path;
    for (;;) {
      this.dirs.add(current);
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  async stat(path: string): Promise<FileWorkerStatInfo> {
    const file = this.files.get(path);
    if (file !== undefined) {
      return { isFile: true, isDirectory: false, size: file.length, mtimeMs: 1 };
    }
    if (this.dirs.has(path)) {
      return { isFile: false, isDirectory: true, size: 0, mtimeMs: 1 };
    }
    throw errno('ENOENT');
  }

  async readdir(path: string): Promise<readonly FileWorkerEntry[]> {
    if (!this.dirs.has(path)) throw errno('ENOENT');
    const entries = new Map<string, FileWorkerEntry['kind']>();
    const prefix = path === '/' ? '/' : `${path}/`;
    for (const file of this.files.keys()) {
      if (dirname(file) === path) entries.set(file.slice(prefix.length), 'file');
    }
    for (const directory of this.dirs) {
      if (directory !== path && dirname(directory) === path) {
        entries.set(directory.slice(prefix.length), 'directory');
      }
    }
    return [...entries].map(([name, kind]) => ({ name, kind }));
  }

  async realpath(path: string): Promise<string> {
    for (const [link, target] of this.symlinks) {
      if (path === link || path.startsWith(`${link}/`)) {
        return `${target}${path.slice(link.length)}`;
      }
    }
    if (this.files.has(path) || this.dirs.has(path)) return path;
    throw errno('ENOENT');
  }
}

function requireValue(response: FileWorkerResponse): FileWorkerValue {
  if (!response.ok) throw new Error(`${response.code}: ${response.message}`);
  return response.value;
}

function createWorker(fs: FakeFs, overrides: Partial<ConstructorParameters<typeof SandboxFileWorker>[0]> = {}) {
  return new SandboxFileWorker({
    root: '/workspace',
    fs,
    maxPayloadBytes: 64,
    maxReadBytes: 16,
    maxListEntries: 10,
    ...overrides,
  });
}

describe('SandboxFileWorker', () => {
  it('reads bounded data and reports truncation', async () => {
    const fs = new FakeFs();
    fs.files.set('/workspace/hello.txt', Buffer.from('hello world'));
    const worker = createWorker(fs);

    const response = await worker.handle({ type: 'read', id: 'r1', path: 'hello.txt' });
    const value = requireValue(response);
    expect(value.type).toBe('read');
    if (value.type === 'read') {
      expect(value.path).toBe('/workspace/hello.txt');
      expect(value.encoding).toBe('base64');
      expect(value.data).toBe(Buffer.from('hello world').toString('base64'));
      expect(value.bytes).toBe(11);
      expect(value.truncated).toBe(false);
    }

    const truncated = await worker.handle({
      type: 'read',
      id: 'r2',
      path: 'hello.txt',
      limit: 100,
    });
    const truncatedValue = requireValue(truncated);
    if (truncatedValue.type === 'read') {
      expect(truncatedValue.bytes).toBe(11);
      expect(truncatedValue.truncated).toBe(false);
    }
  });

  it('honours read offset, limit, and utf8 encoding', async () => {
    const fs = new FakeFs();
    fs.files.set('/workspace/hello.txt', Buffer.from('hello world'));
    const worker = createWorker(fs, { maxReadBytes: 5 });

    const response = await worker.handle({
      type: 'read',
      id: 'r1',
      path: 'hello.txt',
      offset: 6,
      limit: 5,
      encoding: 'utf8',
    });
    const value = requireValue(response);
    if (value.type === 'read') {
      expect(value.data).toBe('world');
      expect(value.encoding).toBe('utf8');
      expect(value.truncated).toBe(false);
    }

    const clamped = await worker.handle({ type: 'read', id: 'r2', path: 'hello.txt', limit: 100 });
    const clampedValue = requireValue(clamped);
    if (clampedValue.type === 'read') {
      expect(clampedValue.bytes).toBe(5);
      expect(clampedValue.truncated).toBe(true);
    }
  });

  it('stages writes and commits them with parent directories', async () => {
    const fs = new FakeFs();
    const worker = createWorker(fs);

    const write = await worker.handle({
      type: 'write',
      id: 'w1',
      path: 'sub/new.txt',
      content: 'abc',
    });
    const writeValue = requireValue(write);
    expect(writeValue).toEqual({
      type: 'write',
      path: '/workspace/sub/new.txt',
      bytes: 3,
      staged: true,
    });
    expect(fs.files.has('/workspace/sub/new.txt')).toBe(false);
    expect(worker.pendingWrites).toBe(1);

    const commit = await worker.handle({ type: 'commit', id: 'c1' });
    expect(requireValue(commit)).toEqual({ type: 'commit', committed: 1 });
    expect(fs.dirs.has('/workspace/sub')).toBe(true);
    expect(fs.files.get('/workspace/sub/new.txt')?.toString()).toBe('abc');
    expect(worker.pendingWrites).toBe(0);
  });

  it('aborts staged writes without touching the filesystem', async () => {
    const fs = new FakeFs();
    const worker = createWorker(fs);

    await worker.handle({ type: 'write', id: 'w1', path: 'abandoned.txt', content: 'x' });
    const abort = await worker.handle({ type: 'abort', id: 'a1' });
    expect(requireValue(abort)).toEqual({ type: 'abort', aborted: 1 });
    expect(worker.pendingWrites).toBe(0);
    expect(fs.files.has('/workspace/abandoned.txt')).toBe(false);

    const commit = await worker.handle({ type: 'commit', id: 'c1' });
    expect(requireValue(commit)).toEqual({ type: 'commit', committed: 0 });
  });

  it('supports base64 and empty write payloads', async () => {
    const fs = new FakeFs();
    const worker = createWorker(fs);

    await worker.handle({
      type: 'write',
      id: 'w1',
      path: 'binary.dat',
      content: Buffer.from([0, 1, 2, 255]).toString('base64'),
      encoding: 'base64',
    });
    await worker.handle({ type: 'write', id: 'w2', path: 'empty.txt', content: '' });
    const commit = await worker.handle({ type: 'commit', id: 'c1' });
    expect(requireValue(commit)).toEqual({ type: 'commit', committed: 2 });
    expect([...(fs.files.get('/workspace/binary.dat') ?? [])]).toEqual([0, 1, 2, 255]);
    expect(fs.files.get('/workspace/empty.txt')?.length).toBe(0);
  });

  it('stats files and directories and lists sorted entries with truncation', async () => {
    const fs = new FakeFs();
    fs.files.set('/workspace/b.txt', Buffer.from('b'));
    fs.files.set('/workspace/a.txt', Buffer.from('a'));
    fs.files.set('/workspace/c.txt', Buffer.from('c'));
    fs.dirs.add('/workspace/sub');
    const worker = createWorker(fs, { maxListEntries: 2 });

    const stat = await worker.handle({ type: 'stat', id: 's1', path: 'a.txt' });
    const statValue = requireValue(stat);
    if (statValue.type === 'stat') {
      expect(statValue.kind).toBe('file');
      expect(statValue.size).toBe(1);
    }

    const directory = await worker.handle({ type: 'stat', id: 's2', path: '.' });
    const directoryValue = requireValue(directory);
    if (directoryValue.type === 'stat') expect(directoryValue.kind).toBe('directory');

    const list = await worker.handle({ type: 'list', id: 'l1', path: '.' });
    const listValue = requireValue(list);
    if (listValue.type === 'list') {
      expect(listValue.entries.map((entry) => entry.name)).toEqual(['a.txt', 'b.txt']);
      expect(listValue.truncated).toBe(true);
    }

    const limited = await worker.handle({ type: 'list', id: 'l2', path: '.', limit: 1 });
    const limitedValue = requireValue(limited);
    if (limitedValue.type === 'list') {
      expect(limitedValue.entries).toHaveLength(1);
      expect(limitedValue.truncated).toBe(true);
    }
  });

  it('rejects path escapes for every path operation', async () => {
    const fs = new FakeFs();
    const worker = createWorker(fs);
    const requests = [
      { type: 'read', id: 'r', path: '../secret' },
      { type: 'write', id: 'w', path: '/etc/passwd', content: 'x' },
      { type: 'stat', id: 's', path: '../../root' },
      { type: 'list', id: 'l', path: '/tmp' },
    ] as const;

    for (const request of requests) {
      const response = await worker.handle(request);
      expect(response.ok).toBe(false);
      if (!response.ok) expect(response.code).toBe('path-escape');
    }
  });

  it('rejects symlink escapes that pass lexical containment', async () => {
    const fs = new FakeFs();
    fs.dirs.add('/outside');
    fs.files.set('/outside/secret', Buffer.from('secret'));
    fs.symlinks.set('/workspace/link', '/outside');
    const worker = createWorker(fs);

    const read = await worker.handle({ type: 'read', id: 'r', path: 'link/secret' });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.code).toBe('path-escape');

    const write = await worker.handle({
      type: 'write',
      id: 'w',
      path: 'link/new.txt',
      content: 'x',
    });
    expect(write.ok).toBe(false);
    if (!write.ok) expect(write.code).toBe('path-escape');

    const stat = await worker.handle({ type: 'stat', id: 's', path: 'link/secret' });
    expect(stat.ok).toBe(false);
    if (!stat.ok) expect(stat.code).toBe('path-escape');

    const list = await worker.handle({ type: 'list', id: 'l', path: 'link' });
    expect(list.ok).toBe(false);
    if (!list.ok) expect(list.code).toBe('path-escape');
  });

  it('bounds write payloads and staged bytes', async () => {
    const fs = new FakeFs();
    const worker = createWorker(fs, { maxPayloadBytes: 4, maxStagedBytes: 5 });

    const tooLarge = await worker.handle({
      type: 'write',
      id: 'w1',
      path: 'large.txt',
      content: 'hello',
    });
    expect(tooLarge.ok).toBe(false);
    if (!tooLarge.ok) expect(tooLarge.code).toBe('payload-too-large');

    const invalidBase64 = await worker.handle({
      type: 'write',
      id: 'w2',
      path: 'bad.bin',
      content: '***',
      encoding: 'base64',
    });
    expect(invalidBase64.ok).toBe(false);
    if (!invalidBase64.ok) expect(invalidBase64.code).toBe('invalid-request');

    await worker.handle({ type: 'write', id: 'w3', path: 'a.txt', content: 'abcd' });
    const staged = await worker.handle({ type: 'write', id: 'w4', path: 'b.txt', content: 'efgh' });
    expect(staged.ok).toBe(false);
    if (!staged.ok) expect(staged.code).toBe('payload-too-large');
  });

  it('reports commit failure while retaining unwritten entries', async () => {
    const fs = new FakeFs();
    fs.failWrites.add('/workspace/bad.txt');
    const worker = createWorker(fs);

    await worker.handle({ type: 'write', id: 'w1', path: 'good.txt', content: 'ok' });
    await worker.handle({ type: 'write', id: 'w2', path: 'bad.txt', content: 'nope' });
    const commit = await worker.handle({ type: 'commit', id: 'c1' });
    expect(commit.ok).toBe(false);
    if (!commit.ok) {
      expect(commit.code).toBe('commit-failed');
      expect(commit.detail?.['committed']).toBe(1);
    }
    expect(worker.pendingWrites).toBe(1);
    expect(fs.files.has('/workspace/bad.txt')).toBe(false);

    fs.failWrites.delete('/workspace/bad.txt');
    const retry = await worker.handle({ type: 'commit', id: 'c2' });
    expect(requireValue(retry)).toEqual({ type: 'commit', committed: 1 });
    expect(fs.files.get('/workspace/bad.txt')?.toString()).toBe('nope');
  });

  it('returns structured failures for invalid requests and missing files', async () => {
    const fs = new FakeFs();
    const worker = createWorker(fs);

    const notObject = await worker.handle(null);
    expect(notObject.ok).toBe(false);
    if (!notObject.ok) expect(notObject.code).toBe('invalid-request');

    const missingId = await worker.handle({ type: 'read', path: 'a.txt' });
    expect(missingId.ok).toBe(false);

    const unsupported = await worker.handle({ type: 'chmod', id: 'x', path: 'a.txt' });
    expect(unsupported.ok).toBe(false);
    if (!unsupported.ok) expect(unsupported.code).toBe('unsupported-operation');

    const negativeOffset = await worker.handle({ type: 'read', id: 'r', path: 'a.txt', offset: -1 });
    expect(negativeOffset.ok).toBe(false);

    const badEncoding = await worker.handle({
      type: 'read',
      id: 'r',
      path: 'a.txt',
      encoding: 'latin1',
    });
    expect(badEncoding.ok).toBe(false);

    const missing = await worker.handle({ type: 'read', id: 'r', path: 'missing.txt' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe('not-found');
  });

  it('rejects invalid worker roots', () => {
    const fs = new FakeFs();
    expect(() => new SandboxFileWorker({ root: '/', fs })).toThrow();
    expect(() => new SandboxFileWorker({ root: 'relative', fs })).toThrow();
  });
});
