import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'kernel-api',
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
  },
});