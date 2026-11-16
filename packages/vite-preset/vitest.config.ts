import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'vite-preset',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
