import { describe, expect, it } from 'vitest';

// The vendored renderer's public icon contract is what components rely on.
// Keep it verified without rendering Vue in a node test.
describe('vendored renderer icon contract', () => {
  it('exposes the core icon set used by the chat page', async () => {
    const mod = await import('../vendor/app-client/src/icons/icons');
    for (const name of ['plus', 'search', 'close', 'send', 'terminal', 'folder'] as const) {
      expect(mod.ICONS[name as keyof typeof mod.ICONS], name).toBeDefined();
    }
    expect(mod.getIcon('plus').component).toBeDefined();
    expect(typeof mod.iconSvg('plus')).toBe('string');
  });
});
