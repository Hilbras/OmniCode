import { rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'pathe';

import type { IHostFileSystem } from '@hilbras/omnicode-engine/os/interface/hostFileSystem';

export type RenameFile = (from: string, to: string) => Promise<void>;

export function atomicTempPath(path: string): string {
  return `${path}.tmp-${randomUUID()}`;
}

export async function writeTextAtomic(
  fs: IHostFileSystem,
  path: string,
  content: string,
  renameImpl: RenameFile = rename,
): Promise<void> {
  const parent = dirname(path);
  await fs.mkdir(parent, { recursive: true });
  const temp = atomicTempPath(path);
  try {
    await fs.writeText(temp, content);
    await renameImpl(temp, path);
  } catch (error) {
    try {
      await fs.remove(temp);
    } catch {
    }
    throw error;
  }
}
