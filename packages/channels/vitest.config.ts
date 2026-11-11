import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'omnicode-channels',
    include: ['test/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
