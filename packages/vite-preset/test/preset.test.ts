import { describe, expect, it } from 'vitest';
import { omnicodeRendererViteConfig } from '#/index';
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
    const cfg = omnicodeRendererViteConfig({ root: '/x', iconsDir: '/x/icons/omnicode' });
    const plugins = (cfg.plugins ?? []).flat().filter(Boolean) as any[];
    const rawIcons = plugins.find((plugin) => plugin.name === 'omnicode-raw-icons');
    const resolved = rawIcons.resolveId('~icons/ri/add-line?raw');

    expect(resolved).toBe('\0omnicode-raw-icon:~icons%2Fri%2Fadd-line%3Fraw');
    await expect(rawIcons.load.call({}, resolved)).resolves.toMatchObject({
      code: expect.stringContaining('export default "<svg'),
    });
  });
});
