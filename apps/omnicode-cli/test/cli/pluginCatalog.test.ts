import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const PLUGINS_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..', 'plugins');

interface CatalogEntry {
  readonly id: string;
  readonly source?: string;
}

describe('plugin marketplace catalog', () => {
  const catalog = JSON.parse(
    readFileSync(join(PLUGINS_ROOT, 'marketplace.json'), 'utf8'),
  ) as { plugins: CatalogEntry[] };

  it('resolves every in-tree source and has a valid manifest', () => {
    const local = catalog.plugins.filter(
      (entry) => entry.source !== undefined && entry.source.startsWith('./'),
    );
    expect(local.length).toBeGreaterThan(0);
    for (const entry of local) {
      const root = resolve(PLUGINS_ROOT, entry.source as string);
      expect(existsSync(root), entry.id).toBe(true);
      const manifestPath = join(root, 'omnicode.plugin.json');
      expect(existsSync(manifestPath), entry.id).toBe(true);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
      expect(manifest['name'], entry.id).toBe(entry.id);
      expect(typeof manifest['version'], entry.id).toBe('string');
      if (manifest['mcpServers'] !== undefined) {
        const permissions = manifest['permissions'] as Record<string, unknown> | undefined;
        expect(permissions?.['mcpServers'], entry.id).toBe(true);
      }
    }
  });

  it('keeps third-party entries as references only', () => {
    for (const entry of catalog.plugins) {
      if (entry.source === undefined) continue;
      const local = entry.source.startsWith('./');
      const remote = entry.source.startsWith('https://');
      expect(local || remote, entry.id).toBe(true);
      expect(dirname(entry.source).startsWith('/'), entry.id).toBe(false);
    }
  });
});
