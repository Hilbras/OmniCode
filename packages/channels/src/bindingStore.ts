import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { ChannelKind, ChannelSessionBinding } from './contracts';

export interface ChannelBindingPersistence {
  load(): Promise<readonly ChannelSessionBinding[]>;
  save(bindings: readonly ChannelSessionBinding[]): Promise<void>;
}

export class FileChannelBindingPersistence implements ChannelBindingPersistence {
  constructor(private readonly path: string) {}

  async load(): Promise<readonly ChannelSessionBinding[]> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) throw new Error(`channel bindings file must contain an array: ${this.path}`);
      return parsed.filter(isBinding);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }

  async save(bindings: readonly ChannelSessionBinding[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(bindings, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, this.path);
  }
}

function isBinding(value: unknown): value is ChannelSessionBinding {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['channel'] === 'string' &&
    typeof record['conversationId'] === 'string' &&
    typeof record['sessionId'] === 'string' &&
    typeof record['workspaceRoot'] === 'string' &&
    typeof record['updatedAt'] === 'number' &&
    CHANNEL_KINDS.has(record['channel'])
  );
}

const CHANNEL_KINDS = new Set<string>(['telegram', 'dingtalk', 'wechat', 'feishu', 'slack']);

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';
}
