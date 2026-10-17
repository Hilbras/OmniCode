import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'omnicode-remote',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
