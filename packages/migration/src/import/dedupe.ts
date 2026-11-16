import type { ImportWarning } from './schema.js';

export function dedupeByName<T extends { readonly name: string; readonly sourcePath: string }>(
  items: readonly T[],
  warnings: ImportWarning[],
): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    if (seen.has(item.name)) {
      warnings.push({
        code: 'duplicate-name',
        message: `duplicate entry name ${item.name} at ${item.sourcePath}; kept the first one`,
        sourcePath: item.sourcePath,
      });
      continue;
    }
    seen.add(item.name);
    unique.push(item);
  }
  return unique;
}
