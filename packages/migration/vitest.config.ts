import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'omnicode-migration',
    include: ['test/**/*.test.ts'],
  },
});
