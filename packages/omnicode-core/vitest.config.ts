import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'omnicode-core',
    include: ['test/**/*.{test,e2e,integration}.ts', 'src/human/test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 30_000,
  },
});
