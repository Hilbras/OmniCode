import type { ImportBundle, ImportedSource } from '../schema.js';
import type { ImportSourceAdapter } from '../source.js';
import { claudeCodeSource } from './claude-code.js';
import { codexSource } from './codex.js';
import { qwenSource } from './qwen.js';

export const IMPORT_SOURCE_ADAPTERS: Record<ImportedSource, ImportSourceAdapter> = {
  'claude-code': claudeCodeSource,
  codex: codexSource,
  qwen: qwenSource,
};

export function getImportSourceAdapter(source: ImportedSource): ImportSourceAdapter {
  return IMPORT_SOURCE_ADAPTERS[source];
}

export async function detectImportSources(root: string): Promise<ImportedSource[]> {
  const detected: ImportedSource[] = [];
  for (const source of Object.keys(IMPORT_SOURCE_ADAPTERS) as ImportedSource[]) {
    if (await IMPORT_SOURCE_ADAPTERS[source].detect(root)) detected.push(source);
  }
  return detected;
}

export async function readImportBundle(source: ImportedSource, root: string): Promise<ImportBundle> {
  return getImportSourceAdapter(source).read(root);
}
