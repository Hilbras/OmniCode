import { mkdir as nodeMkdir, open, readdir as nodeReaddir, realpath as nodeRealpath, stat as nodeStat, writeFile as nodeWriteFile } from 'node:fs/promises';
import { dirname } from 'pathe';

import { KaosValueError } from '../errors';
import { isSandboxPathContained, normalizeSandboxRoot, resolveSandboxPath } from './paths';
import { sandboxFailure, sandboxSuccess, type SandboxResult } from './types';

export const DEFAULT_FILE_WORKER_MAX_PAYLOAD_BYTES = 1024 * 1024;
export const DEFAULT_FILE_WORKER_MAX_READ_BYTES = 1024 * 1024;
export const DEFAULT_FILE_WORKER_MAX_STAGED_BYTES = 8 * 1024 * 1024;
export const DEFAULT_FILE_WORKER_MAX_LIST_ENTRIES = 1000;

export type FileWorkerEncoding = 'utf8' | 'base64';

export interface FileWorkerReadRequest {
  readonly type: 'read';
  readonly id: string;
  readonly path: string;
  readonly encoding?: FileWorkerEncoding;
  readonly offset?: number;
  readonly limit?: number;
}

export interface FileWorkerWriteRequest {
  readonly type: 'write';
  readonly id: string;
  readonly path: string;
  readonly content: string;
  readonly encoding?: FileWorkerEncoding;
}

export interface FileWorkerStatRequest {
  readonly type: 'stat';
  readonly id: string;
  readonly path: string;
}

export interface FileWorkerListRequest {
  readonly type: 'list';
  readonly id: string;
  readonly path: string;
  readonly limit?: number;
}

export interface FileWorkerCommitRequest {
  readonly type: 'commit';
  readonly id: string;
}

export interface FileWorkerAbortRequest {
  readonly type: 'abort';
  readonly id: string;
}

export type FileWorkerRequest =
  | FileWorkerReadRequest
  | FileWorkerWriteRequest
  | FileWorkerStatRequest
  | FileWorkerListRequest
  | FileWorkerCommitRequest
  | FileWorkerAbortRequest;

export interface FileWorkerReadValue {
  readonly type: 'read';
  readonly path: string;
  readonly encoding: FileWorkerEncoding;
  readonly data: string;
  readonly bytes: number;
  readonly truncated: boolean;
}

export interface FileWorkerWriteValue {
  readonly type: 'write';
  readonly path: string;
  readonly bytes: number;
  readonly staged: true;
}

export interface FileWorkerStatValue {
  readonly type: 'stat';
  readonly path: string;
  readonly kind: 'file' | 'directory' | 'other';
  readonly size: number;
  readonly mtimeMs: number;
}

export interface FileWorkerListValue {
  readonly type: 'list';
  readonly path: string;
  readonly entries: readonly FileWorkerEntry[];
  readonly truncated: boolean;
}

export interface FileWorkerCommitValue {
  readonly type: 'commit';
  readonly committed: number;
}

export interface FileWorkerAbortValue {
  readonly type: 'abort';
  readonly aborted: number;
}

export type FileWorkerValue =
  | FileWorkerReadValue
  | FileWorkerWriteValue
  | FileWorkerStatValue
  | FileWorkerListValue
  | FileWorkerCommitValue
  | FileWorkerAbortValue;

export type FileWorkerFailureCode =
  | 'invalid-request'
  | 'path-escape'
  | 'payload-too-large'
  | 'unsupported-operation'
  | 'io-error'
  | 'not-found'
  | 'commit-failed';

export interface FileWorkerSuccessResponse {
  readonly type: 'file-worker-response';
  readonly id: string;
  readonly ok: true;
  readonly value: FileWorkerValue;
}

export interface FileWorkerFailureResponse {
  readonly type: 'file-worker-response';
  readonly id: string;
  readonly ok: false;
  readonly code: FileWorkerFailureCode;
  readonly message: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export type FileWorkerResponse = FileWorkerSuccessResponse | FileWorkerFailureResponse;

export interface FileWorkerEntry {
  readonly name: string;
  readonly kind: 'file' | 'directory' | 'other';
}

export interface FileWorkerStatInfo {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly size: number;
  readonly mtimeMs: number;
}

export interface FileWorkerReadOptions {
  readonly offset: number;
  readonly limit: number;
}

export interface FileWorkerReadData {
  readonly data: Buffer;
  readonly totalSize: number;
}

export interface FileWorkerFs {
  readFile(path: string, options: FileWorkerReadOptions): Promise<FileWorkerReadData>;
  writeFile(path: string, data: Buffer): Promise<void>;
  mkdir(path: string): Promise<void>;
  stat(path: string): Promise<FileWorkerStatInfo>;
  readdir(path: string): Promise<readonly FileWorkerEntry[]>;
  realpath?(path: string): Promise<string>;
}

export function createNodeFileWorkerFs(): FileWorkerFs {
  return {
    async readFile(path, options) {
      const handle = await open(path, 'r');
      try {
        const info = await handle.stat();
        const totalSize = info.size;
        const start = Math.min(Math.max(options.offset, 0), totalSize);
        const length = Math.min(Math.max(options.limit, 0), totalSize - start);
        if (length === 0) return { data: Buffer.alloc(0), totalSize };
        const buffer = Buffer.allocUnsafe(length);
        const readResult = await handle.read(buffer, 0, length, start);
        const bytesRead = readResult.bytesRead;
        return { data: buffer.subarray(0, bytesRead), totalSize };
      } finally {
        await handle.close();
      }
    },
    async writeFile(path, data) {
      await nodeWriteFile(path, data);
    },
    async mkdir(path) {
      await nodeMkdir(path, { recursive: true });
    },
    async stat(path) {
      const info = await nodeStat(path);
      return {
        isFile: info.isFile(),
        isDirectory: info.isDirectory(),
        size: info.size,
        mtimeMs: info.mtimeMs,
      };
    },
    async readdir(path) {
      const entries = await nodeReaddir(path, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        kind: entry.isFile() ? 'file' : entry.isDirectory() ? 'directory' : 'other',
      }));
    },
    async realpath(path) {
      return nodeRealpath(path);
    },
  };
}

export interface FileWorkerLimits {
  readonly maxPayloadBytes: number;
  readonly maxReadBytes: number;
  readonly maxListEntries: number;
}

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequestId(value: unknown): string {
  if (!isRecord(value)) return '';
  const id = value['id'];
  return typeof id === 'string' ? id : '';
}

function readString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
  allowEmpty: boolean,
): SandboxResult<string> {
  const value = record[key];
  if (
    typeof value !== 'string' ||
    value.length > maxLength ||
    (!allowEmpty && value.length === 0)
  ) {
    const qualifier = allowEmpty ? 'a string' : 'a non-empty string';
    return sandboxFailure(
      'invalid-request',
      `${key} must be ${qualifier} of at most ${String(maxLength)} characters`,
    );
  }
  return sandboxSuccess(value);
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
): SandboxResult<string> {
  return readString(record, key, maxLength, false);
}

function readOptionalEncoding(
  record: Record<string, unknown>,
  key: string,
): SandboxResult<FileWorkerEncoding | undefined> {
  const value = record[key];
  if (value === undefined) return sandboxSuccess(undefined);
  if (value === 'utf8' || value === 'base64') return sandboxSuccess(value);
  return sandboxFailure('invalid-request', `${key} must be "utf8" or "base64"`);
}

function readOptionalInteger(
  record: Record<string, unknown>,
  key: string,
  allowZero: boolean,
): SandboxResult<number | undefined> {
  const value = record[key];
  if (value === undefined) return sandboxSuccess(undefined);
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return sandboxFailure('invalid-request', `${key} must be a non-negative integer`);
  }
  if (!allowZero && value === 0) {
    return sandboxFailure('invalid-request', `${key} must be greater than zero`);
  }
  return sandboxSuccess(value);
}

function encodedByteLength(content: string, encoding: FileWorkerEncoding): number {
  if (encoding === 'utf8') return Buffer.byteLength(content, 'utf8');
  return Buffer.from(content, 'base64').byteLength;
}

export function parseFileWorkerRequest(
  value: unknown,
  limits: FileWorkerLimits = {
    maxPayloadBytes: DEFAULT_FILE_WORKER_MAX_PAYLOAD_BYTES,
    maxReadBytes: DEFAULT_FILE_WORKER_MAX_READ_BYTES,
    maxListEntries: DEFAULT_FILE_WORKER_MAX_LIST_ENTRIES,
  },
): SandboxResult<FileWorkerRequest> {
  if (!isRecord(value)) {
    return sandboxFailure('invalid-request', 'file worker request must be an object');
  }
  const id = readRequiredString(value, 'id', 256);
  if (!id.ok) return id;
  const type = readRequiredString(value, 'type', 32);
  if (!type.ok) return type;

  switch (type.value) {
    case 'read': {
      const path = readRequiredString(value, 'path', 4096);
      if (!path.ok) return path;
      const encoding = readOptionalEncoding(value, 'encoding');
      if (!encoding.ok) return encoding;
      const offset = readOptionalInteger(value, 'offset', true);
      if (!offset.ok) return offset;
      const limit = readOptionalInteger(value, 'limit', true);
      if (!limit.ok) return limit;
      return sandboxSuccess({
        type: 'read',
        id: id.value,
        path: path.value,
        encoding: encoding.value,
        offset: offset.value,
        limit: limit.value,
      });
    }
    case 'write': {
      const path = readRequiredString(value, 'path', 4096);
      if (!path.ok) return path;
      const content = readString(value, 'content', limits.maxPayloadBytes * 4, true);
      if (!content.ok) {
        return sandboxFailure('payload-too-large', 'write content exceeds the file worker payload limit');
      }
      const encoding = readOptionalEncoding(value, 'encoding');
      if (!encoding.ok) return encoding;
      const resolvedEncoding = encoding.value ?? 'utf8';
      if (resolvedEncoding === 'base64' && !BASE64_PATTERN.test(content.value)) {
        return sandboxFailure('invalid-request', 'write content is not valid base64');
      }
      const bytes = encodedByteLength(content.value, resolvedEncoding);
      if (bytes > limits.maxPayloadBytes) {
        return sandboxFailure('payload-too-large', `write content exceeds ${String(limits.maxPayloadBytes)} bytes`);
      }
      return sandboxSuccess({
        type: 'write',
        id: id.value,
        path: path.value,
        content: content.value,
        encoding: resolvedEncoding,
      });
    }
    case 'stat': {
      const path = readRequiredString(value, 'path', 4096);
      if (!path.ok) return path;
      return sandboxSuccess({ type: 'stat', id: id.value, path: path.value });
    }
    case 'list': {
      const path = readRequiredString(value, 'path', 4096);
      if (!path.ok) return path;
      const limit = readOptionalInteger(value, 'limit', false);
      if (!limit.ok) return limit;
      return sandboxSuccess({ type: 'list', id: id.value, path: path.value, limit: limit.value });
    }
    case 'commit':
      return sandboxSuccess({ type: 'commit', id: id.value });
    case 'abort':
      return sandboxSuccess({ type: 'abort', id: id.value });
    default:
      return sandboxFailure('unsupported-operation', `unsupported file worker operation: ${type.value}`);
  }
}

function failureResponse(
  id: string,
  code: FileWorkerFailureCode,
  message: string,
  detail?: Readonly<Record<string, unknown>>,
): FileWorkerFailureResponse {
  return detail === undefined
    ? { type: 'file-worker-response', id, ok: false, code, message }
    : { type: 'file-worker-response', id, ok: false, code, message, detail };
}

function errorCode(error: unknown): FileWorkerFailureCode {
  if (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  ) {
    return 'not-found';
  }
  return 'io-error';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

interface StagedWrite {
  readonly path: string;
  readonly data: Buffer;
}

export interface FileWorkerOptions {
  readonly root: string;
  readonly fs?: FileWorkerFs;
  readonly maxPayloadBytes?: number;
  readonly maxReadBytes?: number;
  readonly maxStagedBytes?: number;
  readonly maxListEntries?: number;
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new KaosValueError(`${label} must be a positive integer`);
  }
  return value;
}

export class SandboxFileWorker {
  readonly root: string;
  private readonly fs: FileWorkerFs;
  private readonly maxPayloadBytes: number;
  private readonly maxReadBytes: number;
  private readonly maxStagedBytes: number;
  private readonly maxListEntries: number;
  private readonly staged = new Map<string, StagedWrite>();
  private rootRealPathPromise: Promise<string> | null = null;

  constructor(options: FileWorkerOptions) {
    this.root = normalizeSandboxRoot(options.root);
    this.fs = options.fs ?? createNodeFileWorkerFs();
    this.maxPayloadBytes = requirePositiveInteger(
      options.maxPayloadBytes ?? DEFAULT_FILE_WORKER_MAX_PAYLOAD_BYTES,
      'maxPayloadBytes',
    );
    this.maxReadBytes = requirePositiveInteger(
      options.maxReadBytes ?? DEFAULT_FILE_WORKER_MAX_READ_BYTES,
      'maxReadBytes',
    );
    this.maxStagedBytes = requirePositiveInteger(
      options.maxStagedBytes ?? DEFAULT_FILE_WORKER_MAX_STAGED_BYTES,
      'maxStagedBytes',
    );
    this.maxListEntries = requirePositiveInteger(
      options.maxListEntries ?? DEFAULT_FILE_WORKER_MAX_LIST_ENTRIES,
      'maxListEntries',
    );
  }

  get pendingWrites(): number {
    return this.staged.size;
  }

  private limits(): FileWorkerLimits {
    return {
      maxPayloadBytes: this.maxPayloadBytes,
      maxReadBytes: this.maxReadBytes,
      maxListEntries: this.maxListEntries,
    };
  }

  private stagedBytes(): number {
    let total = 0;
    for (const write of this.staged.values()) total += write.data.length;
    return total;
  }

  private boundRealpath(): ((path: string) => Promise<string>) | undefined {
    const realpath = this.fs.realpath;
    if (realpath === undefined) return undefined;
    return (path) => realpath.call(this.fs, path);
  }

  private getRootRealPath(): Promise<string> {
    const realpath = this.boundRealpath();
    if (realpath === undefined) return Promise.resolve(this.root);
    if (this.rootRealPathPromise === null) {
      this.rootRealPathPromise = realpath(this.root).catch(() => this.root);
    }
    return this.rootRealPathPromise;
  }

  private async realPathOrNull(
    realpath: (path: string) => Promise<string>,
    path: string,
  ): Promise<string | null> {
    try {
      return await realpath(path);
    } catch (error) {
      if (isMissingError(error)) return null;
      throw error;
    }
  }

  private containedResult(root: string, real: string, path: string): SandboxResult<string> {
    if (!isSandboxPathContained(root, real)) {
      return sandboxFailure('path-escape', `path resolves outside the sandbox root: ${path}`);
    }
    return sandboxSuccess(path);
  }

  private async ensureExistingContained(path: string): Promise<SandboxResult<string>> {
    const realpath = this.boundRealpath();
    if (realpath === undefined) return sandboxSuccess(path);
    const root = await this.getRootRealPath();
    try {
      const real = await realpath(path);
      return this.containedResult(root, real, path);
    } catch (error) {
      if (isMissingError(error)) return sandboxSuccess(path);
      return sandboxFailure('io-error', errorMessage(error));
    }
  }

  private async ensureWriteContained(path: string): Promise<SandboxResult<string>> {
    const realpath = this.boundRealpath();
    if (realpath === undefined) return sandboxSuccess(path);
    const root = await this.getRootRealPath();
    try {
      const target = await this.realPathOrNull(realpath, path);
      if (target !== null) return this.containedResult(root, target, path);

      let current = dirname(path);
      while (isSandboxPathContained(this.root, current)) {
        const real = await this.realPathOrNull(realpath, current);
        if (real !== null) return this.containedResult(root, real, path);
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
      }
      return sandboxFailure('path-escape', `path resolves outside the sandbox root: ${path}`);
    } catch (error) {
      return sandboxFailure('io-error', errorMessage(error));
    }
  }

  private pathFailure(id: string, failure: { readonly code: string; readonly message: string }): FileWorkerFailureResponse {
    const code: FileWorkerFailureCode =
      failure.code === 'path-escape'
        ? 'path-escape'
        : failure.code === 'io-error'
          ? 'io-error'
          : 'invalid-request';
    return failureResponse(id, code, failure.message);
  }

  async handle(value: unknown): Promise<FileWorkerResponse> {
    const parsed = parseFileWorkerRequest(value, this.limits());
    if (!parsed.ok) {
      const code: FileWorkerFailureCode =
        parsed.code === 'payload-too-large'
          ? 'payload-too-large'
          : parsed.code === 'unsupported-operation'
            ? 'unsupported-operation'
            : 'invalid-request';
      return failureResponse(readRequestId(value), code, parsed.message);
    }
    const request = parsed.value;
    const requestId = request.id;

    try {
      switch (request.type) {
        case 'read': {
          const path = resolveSandboxPath(this.root, request.path);
          if (!path.ok) return this.pathFailure(request.id, path);
          const contained = await this.ensureExistingContained(path.value);
          if (!contained.ok) return this.pathFailure(request.id, contained);
          const offset = request.offset ?? 0;
          const limit = Math.min(request.limit ?? this.maxReadBytes, this.maxReadBytes);
          const read = await this.fs.readFile(path.value, { offset, limit });
          const encoding = request.encoding ?? 'base64';
          return {
            type: 'file-worker-response',
            id: request.id,
            ok: true,
            value: {
              type: 'read',
              path: path.value,
              encoding,
              data: read.data.toString(encoding === 'utf8' ? 'utf8' : 'base64'),
              bytes: read.data.length,
              truncated: offset + read.data.length < read.totalSize,
            },
          };
        }
        case 'write': {
          const path = resolveSandboxPath(this.root, request.path);
          if (!path.ok) return this.pathFailure(request.id, path);
          const contained = await this.ensureWriteContained(path.value);
          if (!contained.ok) return this.pathFailure(request.id, contained);
          const data = Buffer.from(request.content, request.encoding ?? 'utf8');
          const existing = this.staged.get(path.value);
          const nextBytes = this.stagedBytes() - (existing?.data.length ?? 0) + data.length;
          if (nextBytes > this.maxStagedBytes) {
            return failureResponse(
              request.id,
              'payload-too-large',
              `staged writes exceed ${String(this.maxStagedBytes)} bytes`,
              { stagedBytes: nextBytes, maxStagedBytes: this.maxStagedBytes },
            );
          }
          this.staged.set(path.value, { path: path.value, data });
          return {
            type: 'file-worker-response',
            id: request.id,
            ok: true,
            value: { type: 'write', path: path.value, bytes: data.length, staged: true },
          };
        }
        case 'stat': {
          const path = resolveSandboxPath(this.root, request.path);
          if (!path.ok) return this.pathFailure(request.id, path);
          const contained = await this.ensureExistingContained(path.value);
          if (!contained.ok) return this.pathFailure(request.id, contained);
          const info = await this.fs.stat(path.value);
          return {
            type: 'file-worker-response',
            id: request.id,
            ok: true,
            value: {
              type: 'stat',
              path: path.value,
              kind: info.isDirectory ? 'directory' : info.isFile ? 'file' : 'other',
              size: info.size,
              mtimeMs: info.mtimeMs,
            },
          };
        }
        case 'list': {
          const path = resolveSandboxPath(this.root, request.path);
          if (!path.ok) return this.pathFailure(request.id, path);
          const contained = await this.ensureExistingContained(path.value);
          if (!contained.ok) return this.pathFailure(request.id, contained);
          const entries = await this.fs.readdir(path.value);
          const limit = Math.min(request.limit ?? this.maxListEntries, this.maxListEntries);
          const sorted = [...entries].sort((left, right) =>
            left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
          );
          return {
            type: 'file-worker-response',
            id: request.id,
            ok: true,
            value: {
              type: 'list',
              path: path.value,
              entries: sorted.slice(0, limit),
              truncated: sorted.length > limit,
            },
          };
        }
        case 'commit': {
          const writes = [...this.staged.values()];
          let committed = 0;
          for (const write of writes) {
            const contained = await this.ensureWriteContained(write.path);
            if (!contained.ok) {
              const code: FileWorkerFailureCode =
                contained.code === 'path-escape' ? 'path-escape' : 'commit-failed';
              return failureResponse(request.id, code, contained.message, {
                committed,
                remaining: this.staged.size,
              });
            }
            try {
              await this.fs.mkdir(dirname(write.path));
              await this.fs.writeFile(write.path, write.data);
              this.staged.delete(write.path);
              committed += 1;
            } catch (error) {
              return failureResponse(
                request.id,
                'commit-failed',
                `commit failed after ${String(committed)} write(s): ${errorMessage(error)}`,
                { committed, remaining: this.staged.size },
              );
            }
          }
          return {
            type: 'file-worker-response',
            id: request.id,
            ok: true,
            value: { type: 'commit', committed },
          };
        }
        case 'abort': {
          const aborted = this.staged.size;
          this.staged.clear();
          return {
            type: 'file-worker-response',
            id: request.id,
            ok: true,
            value: { type: 'abort', aborted },
          };
        }
      }
      return failureResponse(requestId, 'unsupported-operation', 'unsupported file worker operation');
    } catch (error) {
      return failureResponse(request.id, errorCode(error), errorMessage(error));
    }
  }
}
