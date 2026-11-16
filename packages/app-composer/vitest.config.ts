import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { omnicodeRendererViteConfig } from '@hilbras/vite-preset';

// icons.ts imports unplugin-icons virtual modules (`~icons/*?raw`) — mirror
// the apps' plugin set (the `omnicode` custom icon collection, sourced from
// app-client's own svg dir) so those imports resolve under vitest too.
// Resolved by path, not by package: app-client depends on this package, so a
// devDependency here would close that cycle again.
const preset = omnicodeRendererViteConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  iconsDir: fileURLToPath(new URL('../app-client/src/icons/omnicode', import.meta.url)),
});

export default defineConfig({
  plugins: preset.plugins,
  test: {
    include: ['test/**/*.test.ts'],
  },
});
