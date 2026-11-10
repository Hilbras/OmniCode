import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'omnicode-vis-server',
    include: ['test/**/*.test.ts'],
  },
});
