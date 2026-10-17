import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'omnicode-tools',
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
  },
});
