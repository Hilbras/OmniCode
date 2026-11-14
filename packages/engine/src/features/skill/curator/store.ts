import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { Error2, isError2 } from '#/errors';

import { SkillCuratorErrors } from './errors';

export const DEFAULT_MAX_STATE_BYTES = 1024 * 1024;
export const DEFAULT_MAX_LISTED_KEYS = 256;

export interface CuratorStoreListing {
  readonly keys: readonly string[];
  readonly truncated: boolean;
}

export interface SkillCuratorStore {
  readJson(key: string): Promise<unknown | undefined>;
  writeJson(key: string, value: unknown): Promise<void>;
  deleteKey(key: string): Promise<void>;
  listKeys(prefix: string): Promise<CuratorStoreListing>;
  /**
   * Serializes operations per key inside the process, so a read-modify-write
   * cycle can never interleave with another cycle on the same key. Writes
   * land via temp-file rename, so concurrent readers never see a torn file;
   * across processes the store is last-writer-wins on whole documents.
   */
  runExclusive<T>(key: string, operation: () => Promise<T>): Promise<T>;
}

export interface NodeCuratorStoreOptions {
  readonly rootDir: string;
  readonly maxFileBytes?: number;
  readonly maxListedKeys?: number;
}

const KEY_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class NodeCuratorStore implements SkillCuratorStore {
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly maxFileBytes: number;
  private readonly maxListedKeys: number;

  constructor(private readonly options: NodeCuratorStoreOptions) {
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_STATE_BYTES;
    this.maxListedKeys = options.maxListedKeys ?? DEFAULT_MAX_LISTED_KEYS;
    if (!Number.isInteger(this.maxFileBytes) || this.maxFileBytes <= 0) {
      throw new Error2(
        SkillCuratorErrors.codes.SKILL_CURATOR_OPTIONS_INVALID,
        `maxFileBytes must be a positive integer, got ${String(this.maxFileBytes)}`,
        { details: { maxFileBytes: this.maxFileBytes } },
      );
    }
    if (!Number.isInteger(this.maxListedKeys) || this.maxListedKeys <= 0) {
      throw new Error2(
        SkillCuratorErrors.codes.SKILL_CURATOR_OPTIONS_INVALID,
        `maxListedKeys must be a positive integer, got ${String(this.maxListedKeys)}`,
        { details: { maxListedKeys: this.maxListedKeys } },
      );
    }
  }

  async readJson(key: string): Promise<unknown | undefined> {
    const file = this.resolve(key);
    let size: number;
    try {
      size = (await stat(file)).size;
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
    if (size > this.maxFileBytes) {
      throw new Error2(
        SkillCuratorErrors.codes.SKILL_CURATOR_STATE_TOO_LARGE,
        `Curator state ${key} is ${String(size)} bytes, above the ${String(this.maxFileBytes)} byte read cap`,
        { details: { key, sizeBytes: size, maxFileBytes: this.maxFileBytes } },
      );
    }
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
    // The stat is a pre-filter; the file can be replaced between stat and
    // read, so the cap is enforced again on what was actually read.
    const readBytes = Buffer.byteLength(text, 'utf8');
    if (readBytes > this.maxFileBytes) {
      throw new Error2(
        SkillCuratorErrors.codes.SKILL_CURATOR_STATE_TOO_LARGE,
        `Curator state ${key} is ${String(readBytes)} bytes, above the ${String(this.maxFileBytes)} byte read cap`,
        { details: { key, sizeBytes: readBytes, maxFileBytes: this.maxFileBytes } },
      );
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new Error2(
        SkillCuratorErrors.codes.SKILL_CURATOR_STATE_INVALID,
        `Curator state ${key} is not valid JSON`,
        { details: { key }, cause: error },
      );
    }
  }

  async writeJson(key: string, value: unknown): Promise<void> {
    const file = this.resolve(key);
    const payload = `${JSON.stringify(value)}\n`;
    const size = Buffer.byteLength(payload, 'utf8');
    if (size > this.maxFileBytes) {
      throw new Error2(
        SkillCuratorErrors.codes.SKILL_CURATOR_STATE_TOO_LARGE,
        `Refusing to write curator state ${key} at ${String(size)} bytes, above the ${String(this.maxFileBytes)} byte cap`,
        { details: { key, sizeBytes: size, maxFileBytes: this.maxFileBytes } },
      );
    }
    await mkdir(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, payload, { mode: 0o600 });
    await rename(temp, file);
  }

  async deleteKey(key: string): Promise<void> {
    const file = this.resolve(key);
    try {
      await unlink(file);
    } catch (error) {
      if (isMissingFile(error)) return;
      throw error;
    }
  }

  async listKeys(prefix: string): Promise<CuratorStoreListing> {
    const dir = this.resolve(prefix);
    let entries: readonly string[];
    try {
      entries = await readdir(dir);
    } catch (error) {
      if (isMissingFile(error)) return { keys: [], truncated: false };
      throw error;
    }
    const files = entries.filter((name) => name.endsWith('.json'));
    const keys = files
      .toSorted((a, b) => a.localeCompare(b))
      .slice(0, this.maxListedKeys)
      .map((name) => joinName(prefix, name));
    return { keys, truncated: files.length > this.maxListedKeys };
  }

  runExclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.then(
      () => undefined,
      () => undefined,
    ).then(operation);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }

  private resolve(key: string): string {
    validateKey(key);
    return join(this.options.rootDir, key);
  }
}

function validateKey(key: string): void {
  if (key.length === 0 || key.startsWith('/') || key.includes('\\')) {
    throw new Error2(
      SkillCuratorErrors.codes.SKILL_CURATOR_STATE_INVALID,
      `Invalid curator store key ${JSON.stringify(key)}`,
      { details: { key } },
    );
  }
  for (const segment of key.split('/')) {
    if (!KEY_SEGMENT_PATTERN.test(segment)) {
      throw new Error2(
        SkillCuratorErrors.codes.SKILL_CURATOR_STATE_INVALID,
        `Invalid curator store key segment ${JSON.stringify(segment)}`,
        { details: { key } },
      );
    }
  }
}

function joinName(prefix: string, name: string): string {
  return prefix.endsWith('/') ? `${prefix}${name}` : `${prefix}/${name}`;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
}

export function isCuratorStateInvalid(error: unknown): boolean {
  return (
    isError2(error) &&
    error.code === SkillCuratorErrors.codes.SKILL_CURATOR_STATE_INVALID
  );
}
