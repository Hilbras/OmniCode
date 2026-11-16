import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { omnicodeRendererViteConfig } from '#/index';

// The `omnicode` collection reads from a filesystem directory, so the raw-icon
// case is exercised against a fixture icon rather than an installed
// `@iconify-json/*` collection — this workspace installs none, which is what made
// the suite fail once it was wired.
const FIXTURE_ICONS_DIR = join(import.meta.dirname, 'fixtures', 'icons', 'omnicode');

describe('omnicodeRendererViteConfig', () => {
  it('emits worker.format es, es2022 target, and omnicode icons collection, no alias', () => {
    const cfg = omnicodeRendererViteConfig({ root: '/x', iconsDir: '/x/icons/omnicode', defines: { __OMNICODE_X__: '1' } });
    expect(cfg.worker).toEqual({ format: 'es' });
    expect(cfg.build?.target).toBe('es2022');
    expect(cfg.define).toMatchObject({ __OMNICODE_X__: '1' });
    expect((cfg.resolve?.alias ?? {})).toEqual({});
    const plugins = (cfg.plugins ?? []).flat().filter(Boolean).map((p: any) => p?.name).join('|');
    expect(plugins).toMatch(/unplugin-icons/);
  });

  it('loads raw icon imports through an internal virtual id', async () => {
    const cfg = omnicodeRendererViteConfig({ root: '/x', iconsDir: FIXTURE_ICONS_DIR });
    const plugins = (cfg.plugins ?? []).flat().filter(Boolean) as any[];
    const rawIcons = plugins.find((plugin) => plugin.name === 'omnicode-raw-icons');
    const resolved = rawIcons.resolveId('~icons/omnicode/probe?raw');

    expect(resolved).toBe('\0omnicode-raw-icon:~icons%2Fomnicode%2Fprobe%3Fraw');
    await expect(rawIcons.load.call({}, resolved)).resolves.toMatchObject({
      code: expect.stringContaining('export default "<svg'),
    });
  });
});
