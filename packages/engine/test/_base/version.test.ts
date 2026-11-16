import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { getCoreVersion } from '@hilbras/omnicode-base/version';

describe('version', () => {
  it('exposes a non-empty version string', () => {
    expect(typeof getCoreVersion()).toBe('string');
    expect(getCoreVersion().length).toBeGreaterThan(0);
  });

  it('reads the real package version instead of the placeholder', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../../../base/package.json', import.meta.url), 'utf8'),
    ) as { version?: unknown };

    expect(typeof manifest.version).toBe('string');
    expect(getCoreVersion()).toBe(manifest.version);
    expect(getCoreVersion()).not.toBe('0.0.0');
    expect(getCoreVersion()).toMatch(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
  });
});
