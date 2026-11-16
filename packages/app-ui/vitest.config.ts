import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'app-ui',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
