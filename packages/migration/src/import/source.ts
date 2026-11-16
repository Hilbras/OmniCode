import type { ImportBundle, ImportedSource } from './schema.js';

export interface ImportSourceAdapter {
  readonly source: ImportedSource;
  detect(root: string): Promise<boolean>;
  read(root: string): Promise<ImportBundle>;
}
