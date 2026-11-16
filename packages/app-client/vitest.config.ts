import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { omnicodeRendererViteConfig } from '@hilbras/vite-preset';

// The icons registry imports unplugin-icons virtual modules (`~icons/*`) and
// `?raw` SVGs — mirror the apps' plugin set (Vue + the `omnicode` custom icon
// collection, sourced from this package's own svg dir) so those imports
// resolve under vitest too.
const preset = omnicodeRendererViteConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  iconsDir: fileURLToPath(new URL('./src/icons/omnicode', import.meta.url)),
});

export default defineConfig({
  plugins: preset.plugins,
  test: {
    include: ['test/**/*.test.ts'],
    // The suite drives real composables with real timers: `apply-event-slices`
    // needs ~9 s here (transcript baseline + a 50 ms batcher flush) and outruns
    // Vitest's 5 s default. This is a bound on the slowest honest test, not a
    // synchronization sleep — the tests still await observable state.
    testTimeout: 20_000,
  },
});
