import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'omnicode-addons',
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
  },
});