import { defineConfig } from 'tsdown';

const shared = {
  format: ['cjs'],
  platform: 'node',
  outDir: 'dist',
  dts: false,
  hash: false,
  external: ['electron'],
} as const;

export default defineConfig([
  {
    ...shared,
    entry: ['./src/main.ts'],
    clean: true,
    outputOptions: { codeSplitting: false, entryFileNames: 'main.cjs' },
  },
  {
    ...shared,
    entry: ['./src/desktop-preload.ts'],
    clean: false,
    outputOptions: { codeSplitting: false, entryFileNames: 'desktop-preload.cjs' },
  },
]);
