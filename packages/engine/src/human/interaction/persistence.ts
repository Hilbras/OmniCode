import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { InteractionRecord } from './machine';

export interface InteractionPersistence {
  load(): Promise<readonly InteractionRecord[]>;
  save(records: readonly InteractionRecord[]): Promise<void>;
}

export class FileInteractionPersistence implements InteractionPersistence {
  constructor(private readonly path: string) {}

  async load(): Promise<readonly InteractionRecord[]> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) throw new Error(`interactions file must contain an array: ${this.path}`);
      return parsed.filter(isPendingRecord);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }

  async save(records: readonly InteractionRecord[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(records.filter((record) => !record.resolved), null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temp, this.path);
  }
}

function isPendingRecord(value: unknown): value is InteractionRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['id'] === 'string' &&
    typeof record['kind'] === 'string' &&
    typeof record['payload'] === 'object' &&
    record['payload'] !== null &&
    typeof record['tags'] === 'object' &&
    record['tags'] !== null &&
    typeof record['createdAt'] === 'number' &&
    record['resolved'] === false
  );
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';
}
