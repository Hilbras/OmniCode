// Builds the npm `bin` entry `dist/main.mjs`: a tiny loader that enables the
// compile cache and then imports the CLI bundle `dist/cli.mjs` (tsdown.config.ts).
// The native SEA build does not use it; it has its own V8 code cache.

import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { main: './src/bin.ts' },
  format: ['esm'],
  // Shares the main bundle's dist (never wipe it).
  outDir: 'dist',
  clean: false,
  dts: false,
  hash: false,
  platform: 'node',
  target: 'node24',
  sourcemap: false,
  minify: false,
  silent: true,
  banner: { js: '#!/usr/bin/env node' },
  outputOptions: {
    codeSplitting: false,
    entryFileNames: '[name].mjs',
  },
});
