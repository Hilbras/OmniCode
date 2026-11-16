import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'app-core',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
