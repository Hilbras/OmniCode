import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'omnicode-base',
    include: ['test/**/*.test.ts'],
  },
});
