import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'omnicode-vis-web',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
